import { instantiateMission, shuffleTactical, discardTactical, synchronizeMission, awardVictoryPoints, scoreBreakdown, recordDestroyedUnits } from '../missions/MissionEngine';
import { canStartMissionAction, startMissionAction, interruptActionsOnCommit, eligibleActionObjectives } from '../missions/actions';
import { calculateLevelOfControl, secureObjective, effectiveModelOC } from '../missions/objectives';
import type { MissionDefinition, VictoryPointEntry } from '../missions/types';
import { validateMovementAbilities, type MovementAbilityChoices } from '../abilities/movement';
import { validAttackChoices } from '../abilities/validation';
import { edgeDistance } from '../utils/geometry';
import { abilitiesFor } from '../deployment/abilities';
import { pendingCoreChoices } from '../abilities/core';
import { queueDestructions, releaseDestructions, resolveDestructions } from '../combat/destruction';
import { hasWeaponAbility, resolvedAbilities, weaponInstanceId } from '../abilities/registry';
import type { AttackChoices } from '../abilities/types';
import type { AttackJob } from '../combat/types';
import { createAttackJob, runAttackJob, type RollWindow } from '../combat/AttackPipeline';
import { formAttachments, processAttachmentCasualties, finishAttacker } from '../attachments/AttachmentController';
import type { AttachmentAssignment, AttachmentPolicy } from '../attachments/types';
import { attachmentFor, historicalUnit, modelDefinition, modelHasWeapon, modelKeywords, unitKeywords, sourceAbilities, attackToughness } from '../attachments/queries';
import { allocationGroups } from '../attachments/AllocationGroups';
import { TransportController, embark, detectDestroyedTransports } from '../transports/TransportController';
import { passengers, remainingTransportCapacity, capacityDefinition } from '../transports/capacity';
import { selectFiringDeck, firingDeckOptions } from '../transports/FiringDeck';
import { resolveHazardRolls } from '../transports/HazardRoll';
import { rollD6 } from '../utils/dice';
import { resolveBattleShockRoll } from '../command/BattleShock';
import { flowEvent } from '../flow/events';
import { MatchFlowController, enableFlow } from '../flow/MatchFlowController';
import { CommandController } from '../command/CommandController';
import { passWindow, openWindow, temporalBlock } from '../flow/TimingWindows';
import type { FlowPolicies, FlowRules } from '../flow/types';
import { StratagemEngine } from '../stratagems/StratagemEngine';
import type { StratagemPolicies } from '../stratagems/types';
import { gainCommandPoints, spendCommandPoints, canSpendCommandPoints } from '../resources/CommandPoints';
import { applyEffect, effectiveCharacteristic, effectiveObjectiveControl, removeEffect } from '../effects/EffectEngine';
import type { EffectInput } from '../effects/types';
import { canStartAction, canCompleteAction, fallBackOptions } from '../command/BattleShock';
import { DeploymentController, nextDeploymentPlayer } from '../deployment/DeploymentController';
import { ScoutController } from '../deployment/ScoutController';
import { SetupController } from '../setup/SetupController';
import type { SetupPolicy } from '../setup/SetupValidator';
import type { DeploymentAbilityChoice, Formation, IngressMethod } from '../setup/types';
import { reservePoints, type ReservePolicy } from '../reserves/ReservePolicy';
import { moveUnitToReserves, resolveReserveExpiration } from '../reserves/ReserveController';
import { actionBusy, battleStarted, onBattlefield, setupBusy, normalizeDestroyed } from '../reserves/location';
import { recordTerrainChanges } from '../terrain/events';
import { createVisibilityProvider, type VisibilityProviderFactory } from '../terrain/visibility';
import { getDetectionRange, type DetectionRangePolicy, areasForModel, isModelHidden } from '../terrain/rules';
import { shootingModifiers } from '../terrain/attackModifiers';
import { elevation } from '../terrain/geometry';
import { CloseCombatController } from './CloseCombatController';
import { getModelsEligibleToFight, getLegalChargeTargets, type ChargeExceptions } from '../rules/closeCombat';
import type { CommandResult, GameState, GameEvent, MovementPath, Position, WeaponResolution } from '../models';
import { advancePhase, advanceTurn } from '../rules/progression';
import { failure, movementPhaseError, validateBeginMovement, validateFinalPosition, validateModelMove } from '../rules/movement';
import { checkCoherency, isUnitEngaged } from '../rules/spatial';
import { validateState } from './validateState';
import { availableRangedWeapons, validateShooter, legalShootingTargets, shootingPhaseError, validateRangedWeapon, validateShootingTarget } from '../rules/shootingTargets';
import { definitionFor } from '../rules/movement';
import { type VisibilityPolicy } from '../rules/visibility';
import { allocateDamage, type DamageAllocationPolicy } from '../rules/damageAllocation';
import type { RandomSource } from '../utils/dice';
export interface EnginePolicies { flow?: FlowPolicies; stratagems?: StratagemPolicies; setup?: SetupPolicy; reserves?: ReservePolicy; visibility?: VisibilityPolicy; visibilityProvider?: VisibilityProviderFactory; detectionRange?: DetectionRangePolicy; damageAllocation?: DamageAllocationPolicy; chargeExceptions?: (state: GameState, unitId: string) => ChargeExceptions }

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
type EventPayload = GameEvent extends infer E ? E extends GameEvent ?
  Omit<E, 'sequence' | 'round' | 'turn' | 'playerId' | 'unitId'> : never : never;
export class GameEngine {
  private state: GameState;
  constructor(initialState: GameState, private readonly policies: EnginePolicies = {}) { validateState(initialState); this.state = copy(initialState); }
  static create(initialState: GameState, policies: EnginePolicies = {}): GameEngine { return new GameEngine(initialState, policies); }
  loadMatch(snapshot: GameState): void { validateState(snapshot); this.state = copy(snapshot); }
  getState(): GameState { return copy(this.state); }

  /** Legacy Task 001 helpers. New UI commands use tryNextPhase/tryNextTurn results. */
  nextPhase(): GameState {
    const result = this.tryNextPhase();
    if (!result.ok) throw new Error(result.reason);
    return result.value;
  }
  nextTurn(): GameState {
    const result = this.tryNextTurn();
    if (!result.ok) throw new Error(result.reason);
    return result.value;
  }
  tryNextPhase(): CommandResult<GameState> { return this.progress(advancePhase); }
  tryNextTurn(): CommandResult<GameState> { if (this.state.flow && this.state.phase !== 'Fight') return failure('PHASE_BLOCKED'); return this.progress(advanceTurn); }
  private progress(transition: (state: GameState) => GameState): CommandResult<GameState> {
    if (this.state.flow) {
      const draft = this.getState(), before = this.getState();
      const result = new MatchFlowController(draft, this.policies.flow, this.policies.reserves).advance();
      if (!result.ok) return result;
      if (draft.round > before.round) resolveReserveExpiration(draft, before.round, this.policies.reserves);
      if (draft.status === 'finished') resolveReserveExpiration(draft, draft.round, this.policies.reserves, true);
      if (draft.phase === 'Charge' || draft.turn > before.turn) for (const u of draft.units) delete u.moveLock;
      recordTerrainChanges(before, draft); this.commit(draft);
      return { ok: true, value: this.getState() };
    }
    if (!battleStarted(this.state)) return failure('PRE_BATTLE');
    if (setupBusy(this.state)) return failure('SETUP_IN_PROGRESS');
    if (this.state.status !== 'in-progress') return failure('MATCH_FINISHED');
    if (this.state.movement) return failure('MOVEMENT_IN_PROGRESS');
    if (this.state.shooting) return failure('SHOOTING_IN_PROGRESS');
    if (this.state.closeCombat?.charge || this.state.closeCombat?.move) return failure('COMBAT_IN_PROGRESS');
    if (this.state.phase === 'Fight' && this.state.closeCombat?.fight && this.state.closeCombat.fight.step !== 'END') return failure('WRONG_FIGHT_STEP');
    if (this.state.phase === 'Fight' && !this.state.closeCombat?.fight && this.state.units.some(u => onBattlefield(u) && (u.state.hasCharged || isUnitEngaged(this.state, u)))) return failure('WRONG_FIGHT_STEP');
    const before = this.getState();
    const next = transition(this.getState());
    if (next.round > before.round) resolveReserveExpiration(next, before.round, this.policies.reserves);
    if (next.phase === 'Charge' || next.turn > before.turn) for (const u of next.units) delete u.moveLock;
    this.commit(next);
    recordTerrainChanges(before, this.state);
    return { ok: true, value: this.getState() };
  }
  private commit(draft: GameState): void {
    recordDestroyedUnits(this.state, draft); interruptActionsOnCommit(this.state, draft); synchronizeMission(draft, this.policies.reserves); this.state = draft;
  }
  private event(unitId: string, payload: EventPayload): void {
    this.state.events.push(copy({ ...payload, sequence: this.state.events.length + 1,
      round: this.state.round, turn: this.state.turn, playerId: historicalUnit(this.state, unitId)?.playerId ?? this.state.activePlayerId, unitId } as GameEvent));
    synchronizeMission(this.state, this.policies.reserves);
  }
  beginMovement(unitId: string, moveType: 'NORMAL_MOVE' | 'ADVANCE_MOVE' | 'FALL_BACK_MOVE' = 'NORMAL_MOVE', rng?: RandomSource, abilityChoices: MovementAbilityChoices = {}): CommandResult {
    const result = validateBeginMovement(this.state, unitId, moveType);
    if (!result.ok) return result;
    if (!validateMovementAbilities(this.state, result.value, abilityChoices)) return failure('INVALID_ABILITY_CHOICE');
    if (moveType !== 'NORMAL_MOVE') {
      const draft = this.getState(), unit = draft.units.find(u => u.id === unitId)!;
      if (!rng && (moveType === 'ADVANCE_MOVE' || !fallBackOptions(draft, unit).orderedRetreat)) return failure('INVALID_CONFIGURATION');
      const bonus = moveType === 'ADVANCE_MOVE' ? rollD6(rng!) : 0;
      const desperate = moveType === 'FALL_BACK_MOVE' && !fallBackOptions(draft, unit).orderedRetreat;
      if (desperate) {
        const hazard = resolveHazardRolls(draft, unit, unit.models.filter(m => m.alive).length, rng!);
        flowEvent(draft, 'HAZARD_ROLLED', { rolls: hazard.rolls, mortalWounds: hazard.mortalWounds }, unitId);
        queueDestructions(this.state, draft); detectDestroyedTransports(draft); resolveDestructions(draft, rng!);
        if (!unit.models.some(m => m.alive)) {
          unit.state.hasMoved = true; processAttachmentCasualties(draft); normalizeDestroyed(draft);
          this.commit(draft); this.event(unitId, { type: 'movement-started' }); this.event(unitId, { type: 'movement-completed' });
          return { ok: true, value: undefined };
        }
      }
      draft.movement = { unitId, abilityChoices: copy(abilityChoices), moveType, bonus, desperate, irreversible: moveType === 'ADVANCE_MOVE' || desperate, originals: unit.models.map(m => ({ modelId: m.id, position: { ...m.position }, movementUsed: m.movementUsed })) };
      if (bonus) { unit.advanceBonus = { turn: draft.turn, value: bonus }; flowEvent(draft, 'ADVANCE_ROLLED', { bonus }, unitId); }
      this.commit(draft); this.event(unitId, { type: 'movement-started' }); return { ok: true, value: undefined };
    }
    this.state.movement = { unitId, abilityChoices: copy(abilityChoices), originals: result.value.models.map(m => ({
      modelId: m.id, position: { ...m.position }, movementUsed: m.movementUsed })) };
    this.event(unitId, { type: 'movement-started' });
    return { ok: true, value: undefined };
  }
  /** Same validator as moveModel, with no state changes or emitted events. */
  previewMove(modelId: string, target: Position, path?: MovementPath) { return validateModelMove(this.state, modelId, target, path); }
  moveModel(modelId: string, target: Position, path?: MovementPath) {
    const result = this.previewMove(modelId, target, path);
    if (!result.ok) return result;
    const unit = this.state.units.find(u => u.id === this.state.movement!.unitId)!;
    const model = unit.models.find(m => m.id === modelId)!;
    const before = this.getState();
    const from = { ...model.position };
    model.position = { ...target };
    model.movementUsed = result.value.totalUsed;
    this.event(unit.id, { type: 'model-moved', modelId, from, to: { ...target },
      distance: result.value.distance, totalUsed: result.value.totalUsed });
    recordTerrainChanges(before, this.state);
    return result;
  }
  cancelMovement(): CommandResult {
    const error = movementPhaseError(this.state);
    if (error) return error;
    const transaction = this.state.movement;
    if (!transaction) return failure('NO_ACTIVE_MOVEMENT');
    if (transaction.irreversible) return failure('IRREVERSIBLE_ACTION');
    const unit = this.state.units.find(u => u.id === transaction.unitId)!;
    const before = this.getState();
    for (const original of transaction.originals) {
      const model = unit.models.find(m => m.id === original.modelId)!;
      model.position = { ...original.position };
      model.movementUsed = original.movementUsed;
    }
    this.state.movement = null;
    this.event(unit.id, { type: 'movement-cancelled', restored: transaction.originals.map(o => ({ modelId: o.modelId, position: { ...o.position } })) });
    recordTerrainChanges(before, this.state);
    return { ok: true, value: undefined };
  }
  completeMovement(embarkTransportId?: string, rng?: RandomSource): CommandResult {
    const error = movementPhaseError(this.state);
    if (error) return error;
    if (!this.state.movement) return failure('NO_ACTIVE_MOVEMENT');
    const unit = this.state.units.find(u => u.id === this.state.movement!.unitId)!;
    for (const model of unit.models.filter(m => m.alive)) {
      const placement = validateFinalPosition(this.state, unit, model, model.position);
      if (!placement.ok) return placement;
    }
    const coherency = checkCoherency(unit.models, this.state.spatialRules.coherency);
    if (!coherency.coherent) return { ...failure('INCOHERENT'), modelIds: coherency.failingModelIds.length ?
      coherency.failingModelIds : unit.models.filter(m => m.alive).map(m => m.id) };
    if (this.state.movement.abilityChoices?.mobile && !rng) return failure('INVALID_CONFIGURATION');
    const before = this.getState(), draft = this.getState();
    if (embarkTransportId) {
      const result = embark(draft, unit.id, embarkTransportId);
      if (!result.ok) return result;
    }
    const moved = draft.units.find(u => u.id === unit.id)!, moveType = draft.movement!.moveType ?? 'NORMAL_MOVE';
    moved.state.hasMoved = true;
    moved.lastMove = { kind: moveType, turn: draft.turn, phase: draft.phase };
    if (moveType === 'ADVANCE_MOVE') moved.state.hasAdvanced = true;
    if (moveType === 'FALL_BACK_MOVE') { moved.state.hasFallenBack = true; moved.cannotShootUntilTurn = draft.turn; }
    if (moveType !== 'NORMAL_MOVE') moved.cannotChargeUntilTurn = draft.turn;
    if (draft.transportState?.tacticalFollowUp === unit.id) delete draft.transportState.tacticalFollowUp;
    if (draft.movement!.abilityChoices?.mobile) { const roll = rollD6(rng!); if (roll === 1) moved.state.battleShocked = true; flowEvent(draft, 'SUPER_HEAVY_WALKER_TEST', { roll }, moved.id); }
    draft.movement = null;
    draft.events.push({ type: 'movement-completed', unitId: unit.id, playerId: unit.playerId, turn: draft.turn, round: draft.round, sequence: draft.events.length + 1 });
    processAttachmentCasualties(draft); normalizeDestroyed(draft); recordTerrainChanges(before, draft);
    this.commit(draft);
    return { ok: true, value: undefined };
  }
  beginShooting(unitId: string, deck: { modelId: string; weaponId: string }[] = []): CommandResult {
    if (this.state.attackJob) return failure('ATTACK_PENDING');
    const error = shootingPhaseError(this.state);
    if (error) return error;
    if (this.state.shooting) return failure('SHOOTING_IN_PROGRESS');
    const weapons = availableRangedWeapons(this.state, unitId);
    const shooter = validateShooter(this.state, unitId); if (!shooter.ok) return shooter;
    if (!weapons.ok && !(weapons.reason === 'NO_RANGED_WEAPONS' && capacityDefinition(this.state, shooter.value)?.firingDeck)) return weapons;
    const draft = this.getState(); draft.shooting = { unitId, firedWeaponIds: [], hasRolled: false };
    if (capacityDefinition(draft, shooter.value)?.firingDeck) { const selected = selectFiringDeck(draft, unitId, deck); if (!selected.ok) return selected; }
    else if (deck.length) return failure('FIRING_DECK_LIMIT');
    this.commit(draft);
    this.state.units.find(u => u.id === unitId)!.selectedToShootAt = { turn: this.state.turn, phase: this.state.phase };
    this.event(unitId, { type: 'shooting-started' });
    return { ok: true, value: undefined };
  }
  getRangedWeapons(unitId: string) { return copy(availableRangedWeapons(this.state, unitId)); }
  getLegalTargets(unitId: string, weaponId: string) {
    return copy(legalShootingTargets(this.state, unitId, weaponId, this.visibility()));
  }
  setAttackChoices(weaponId: string, choices: AttackChoices): CommandResult {
    const block = temporalBlock(this.state); if (block) return block;
    if (this.state.attackJob) return failure('ATTACK_PENDING');
    const tx = this.state.shooting ?? this.state.closeCombat?.fight?.selected;
    if (!tx) return failure('UNIT_NOT_ELIGIBLE');
    if (this.state.shooting?.selectedTarget) return failure('TARGET_SELECTION_LOCKED');
    const unit = this.state.units.find(u => u.id === tx.unitId)!;
    const weapon = definitionFor(this.state, unit).weapons.find(w => w.id === weaponId) ?? this.state.shooting?.firingDeck?.find(x => x.borrowed.id === weaponId)?.borrowed;
    if (!weapon) return failure('WEAPON_NOT_FOUND');
    const draft = copy(choices);
    if (!validAttackChoices(weapon, draft)) return failure('INVALID_ABILITY_CHOICE');
    if (draft.shootingMode === 'INDIRECT' && !hasWeaponAbility(weapon, 'INDIRECT_FIRE')) return failure('INVALID_ABILITY_CHOICE');
    try { resolvedAbilities(this.state, unit, weapon, draft); } catch { return failure('ABILITY_CHOICE_REQUIRED'); }
    if (this.state.shooting && draft.shootingMode) {
      if (this.state.shooting.firedWeaponIds.length && (this.state.shooting.shootingMode ?? 'NORMAL') !== draft.shootingMode) return failure('IRREVERSIBLE_ACTION');
      if (draft.shootingMode === 'INDIRECT' && (unit.state.hasAdvanced || isUnitEngaged(this.state, unit))) return failure('UNIT_NOT_ELIGIBLE');
      this.state.shooting.shootingMode = draft.shootingMode;
    }
    tx.attackChoices ??= {}; tx.attackChoices[weaponId] = draft;
    return { ok: true, value: undefined };
  }
  private rollWindow(state: GameState): RollWindow {
    return (trigger, job) => {
      state.units = state.units.map(u => u.id === job.target.id ? job.target : u);
      flowEvent(state, trigger, { weaponId: job.weapon.id, modelId: job.current!.modelId, roll: (trigger === 'AFTER_HIT_ROLL' ? job.current!.hit : job.current!.wound)!.value }, job.attackerUnitId);
      if (!state.flow) return false;
      const probe = copy(state);
      openWindow(probe, trigger, { unitId: job.attackerUnitId, targetUnitId: job.target.id });
      if (!probe.players.some(p => new StratagemEngine(probe, this.policies.stratagems).options(p.id).some(o => o.result.ok))) return false;
      openWindow(state, trigger, { unitId: job.attackerUnitId, targetUnitId: job.target.id });
      return true;
    };
  }
  resumeAttack(rng: RandomSource): CommandResult<WeaponResolution> {
    const block = temporalBlock(this.state); if (block) return block;
    if (!this.state.attackJob) return failure('NO_PENDING_ATTACK');
    const before = this.getState(), draft = this.getState(), job = draft.attackJob!;
    job.target = copy(draft.units.find(u => u.id === job.target.id)!);
    const complete = runAttackJob(job, rng, draft, this.rollWindow(draft), this.policies.damageAllocation ?? allocateDamage);
    draft.units = draft.units.map(u => u.id === job.target.id ? job.target : u);
    queueDestructions(before, draft, job.attackerUnitId);
    this.commit(draft);
    if (complete) this.commitAttack(job, before);
    return { ok: true, value: copy(job.resolution) };
  }
  getPendingCoreChoices() { return pendingCoreChoices(this.getState()); }
  chooseCoreAbility(modelId: string, kind: string, instance: number): CommandResult {
    if (actionBusy(this.state) || this.state.flow?.window) return failure('COMBAT_IN_PROGRESS');
    const u = this.state.units.find(u => u.models.some(m => m.id === modelId)), m = u?.models.find(m => m.id === modelId);
    if (!u || !m || !Number.isSafeInteger(instance) || instance < 0 || !abilitiesFor(this.state, u, m).filter(a => a.kind === kind)[instance]) return failure('INVALID_ABILITY_CHOICE');
    m.coreAbilityChoices ??= {}; m.coreAbilityChoices[kind] = instance;
    return { ok: true, value: undefined };
  }
  resolveDestructionEffects(rng: RandomSource): CommandResult {
    const block = temporalBlock(this.state); if (block) return block;
    if (this.state.attackJob || this.state.transportState?.destroyed.length || this.state.transportState?.disembark) return failure('PENDING_RESOLUTION');
    const before = this.getState(), draft = this.getState();
    resolveDestructions(draft, rng); recordTerrainChanges(before, draft); this.commit(draft);
    return { ok: true, value: undefined };
  }
  private commitAttack(job: AttackJob, before: GameState) {
    delete this.state.attackJob;
    const { weapon, resolution, attackerUnitId } = job;
    if (weapon.kind === 'ranged') {
      const tx = this.state.shooting!;
      delete tx.selectedTarget; tx.firedWeaponIds.push(weapon.id);
      tx.hasRolled ||= resolution.hitRolls.length > 0 || resolution.woundRolls.length > 0 || resolution.attackCounts.some(c => c.resolved.rolls.length > 0);
      this.event(attackerUnitId, { type: 'weapon-fired', resolution });
      for (const m of resolution.attackModifiers ?? []) for (const modifier of m.modifiers.filter(x => x.source !== 'TEMPORARY_EFFECT')) this.event(attackerUnitId, { type: modifier.source === 'COVER' ? 'cover-applied' : 'plunging-fire-applied', modelId: m.modelId, targetUnitId: job.target.id, effectiveSkill: m.effectiveSkill });
      for (const damage of resolution.damageResults) this.event(attackerUnitId, { type: 'model-damaged', targetUnitId: job.target.id, weaponId: weapon.id, damage });
      for (const modelId of resolution.destroyedModelIds) this.event(attackerUnitId, { type: 'model-destroyed', targetUnitId: job.target.id, weaponId: weapon.id, modelId });
    } else this.event(attackerUnitId, { type: 'melee-attack-resolved', resolution });
    queueDestructions(before, this.state, attackerUnitId);
    processAttachmentCasualties(this.state, attackerUnitId);
    detectDestroyedTransports(this.state); normalizeDestroyed(this.state); recordTerrainChanges(before, this.state);
  }
  selectShootingTarget(weaponId: string, targetUnitId: string): CommandResult {
    return this.flowCommand(s => {
      const block = temporalBlock(s); if (block) return block;
      if (s.attackJob) return failure('ATTACK_PENDING');
      if (!s.shooting) return failure('NO_ACTIVE_SHOOTING');
      if (s.shooting.selectedTarget) return failure('TARGET_SELECTION_LOCKED');
      const legal = validateShootingTarget(s, s.shooting.unitId, weaponId, targetUnitId, this.visibility());
      if (!legal.ok) return legal;
      const target = s.units.find(u => u.id === targetUnitId)!;
      s.shooting.selectedTarget = { weaponId, targetUnitId, modelCount: target.models.filter(m => m.alive).length, distances: Object.fromEntries(s.units.find(u => u.id === s.shooting!.unitId)!.models.filter(m => legal.value.eligibleFiringModelIds.includes(m.id)).map(m => [m.id, Math.min(...target.models.filter(m => m.alive).map(t => edgeDistance(m, t)))])) };
      openWindow(s, 'AFTER_TARGET_SELECTED', { unitId: s.shooting.unitId, targetUnitId });
      return { ok: true, value: undefined };
    });
  }
  fireWeapon(weaponId: string, targetUnitId: string, rng: RandomSource, precisionModelId?: string): CommandResult<WeaponResolution> {
    if (this.state.attackJob) return failure('ATTACK_PENDING');
    const error = shootingPhaseError(this.state);
    if (error) return error;
    const transaction = this.state.shooting;
    if (!transaction) return failure('NO_ACTIVE_SHOOTING');
    if (this.state.flow && (!transaction.selectedTarget || transaction.selectedTarget.weaponId !== weaponId || transaction.selectedTarget.targetUnitId !== targetUnitId)) return failure('TARGET_SELECTION_REQUIRED');
    const provider = this.visibility();
    const legal = validateShootingTarget(this.state, transaction.unitId, weaponId, targetUnitId,
      provider);
    if (!legal.ok) return legal;
    const weapon = validateRangedWeapon(this.state, transaction.unitId, weaponId);
    if (!weapon.ok) return weapon;
    const target = this.state.units.find(u => u.id === targetUnitId)!;
    if (precisionModelId && !this.precisionTargets(transaction.unitId, weaponId, targetUnitId).includes(precisionModelId)) return failure('PRECISION_TARGET_INVALID');
    const choices = { ...transaction.attackChoices?.[weaponId], ...(hasWeaponAbility(weapon.value, 'INDIRECT_FIRE') ? { shootingMode: transaction.shootingMode ?? 'NORMAL' as const } : {}) };
    try { resolvedAbilities(this.state, target, weapon.value, choices); } catch { return failure('ABILITY_CHOICE_REQUIRED'); }
    const before = this.getState(), draft = this.getState();
    const shooter = draft.units.find(u => u.id === transaction.unitId)!;
    const modifiers = shooter.models.filter(m => legal.value.eligibleFiringModelIds.includes(m.id)).map(m => shootingModifiers(draft, m, target, weapon.value.skill, provider, weapon.value, choices));
    const job = createAttackJob(weapon.value, legal.value.eligibleFiringModelIds, copy(target), definitionFor(draft, target), rng, modifiers, draft, precisionModelId, choices, provider);
    // Reserve selection before the first irreversible roll; One Shot is per original bearer/weapon.
    for (const model of shooter.models.filter(m => legal.value.eligibleFiringModelIds.includes(m.id))) {
      if (job.contexts.find(c => c.attackerModelId === model.id)!.abilities.some(a => a.type === 'ONE_SHOT')) { model.oneShotExpended ??= []; model.oneShotExpended.push(weaponInstanceId(draft, shooter, model, weapon.value)); }
    }
    if (job.contexts.some(c => c.abilities.some(a => a.type === 'HAZARDOUS'))) draft.shooting!.hazardousCount = (draft.shooting!.hazardousCount ?? 0) + job.contexts.filter(c => c.abilities.some(a => a.type === 'HAZARDOUS')).length;
    if (job.resolution.attacks > 0) shooter.lastRangedAttackTurnIndex = draft.turn;
    const complete = runAttackJob(job, rng, draft, this.rollWindow(draft), this.policies.damageAllocation ?? allocateDamage);
    draft.units = draft.units.map(u => u.id === target.id ? job.target : u);
    if (!complete) { draft.attackJob = job; draft.shooting!.hasRolled = true; }
    queueDestructions(before, draft, job.attackerUnitId);
    this.commit(draft);
    if (complete) this.commitAttack(job, before);
    return { ok: true, value: copy(job.resolution) };
  }

  cancelShooting(): CommandResult {
    if (this.state.attackJob) return failure('ATTACK_PENDING');
    const error = shootingPhaseError(this.state);
    if (error) return error;
    if (!this.state.shooting) return failure('NO_ACTIVE_SHOOTING');
    if (this.state.shooting.hasRolled || this.state.shooting.selectedTarget || this.state.shooting.hazardousCount || this.state.shooting.firedWeaponIds.some(id => { const w = definitionFor(this.state, this.state.units.find(u => u.id === this.state.shooting!.unitId)!).weapons.find(w => w.id === id); return w && hasWeaponAbility(w, 'ONE_SHOT'); })) return failure('SHOOTING_ALREADY_RESOLVED');
    const { unitId } = this.state.shooting;
    this.state.shooting = null;
    this.event(unitId, { type: 'shooting-cancelled' });
    return { ok: true, value: undefined };
  }
  completeShooting(rng?: RandomSource): CommandResult {
    if (this.state.attackJob) return failure('ATTACK_PENDING');
    const error = shootingPhaseError(this.state);
    if (error) return error;
    if (!this.state.shooting) return failure('NO_ACTIVE_SHOOTING');
    const { unitId } = this.state.shooting;
    if (this.state.shooting.selectedTarget) return failure('TARGET_SELECTION_LOCKED');
    const count = this.state.shooting.hazardousCount ?? 0;
    if ((count || this.state.destructionQueue?.some(q => !q.resolved)) && !rng) return failure('INVALID_CONFIGURATION');
    const before = this.getState(), draft = this.getState();
    if (count) {
      const unit = draft.units.find(u => u.id === unitId)!;
      const hazard = resolveHazardRolls(draft, unit, count, rng!);
      flowEvent(draft, 'HAZARD_ROLLED', { rolls: hazard.rolls, mortalWounds: hazard.mortalWounds }, unitId);
    }
    draft.units.find(u => u.id === unitId)!.state.hasShot = true;
    draft.shooting = null;
    draft.events.push({ type: 'shooting-completed', unitId, sequence: draft.events.length + 1, round: draft.round, turn: draft.turn, playerId: draft.activePlayerId });
    queueDestructions(before, draft, unitId);
    finishAttacker(draft, unitId); releaseDestructions(draft, unitId);
    detectDestroyedTransports(draft); if (rng) resolveDestructions(draft, rng);
    processAttachmentCasualties(draft); normalizeDestroyed(draft); recordTerrainChanges(before, draft);
    openWindow(draft, 'AFTER_UNIT_SHOT', { unitId }); this.commit(draft);
    return { ok: true, value: undefined };
  }

  private combatCommand<T>(command: (controller: CloseCombatController) => CommandResult<T>): CommandResult<T> {
    if (this.state.attackJob) return failure('ATTACK_PENDING');
    const draft = this.getState();
    const block = temporalBlock(draft); if (block) return block;
    const result = command(new CloseCombatController(draft));
    if (result.ok) {
      queueDestructions(this.state, draft, draft.closeCombat?.fight?.selected?.unitId);
      for (const event of draft.events.slice(this.state.events.length)) {
        if (event.type === 'combat-move-completed' && event.kind === 'charge') openWindow(draft, 'AFTER_CHARGE_MOVE', { unitId: event.unitId });
        if (event.type === 'fight-unit-completed') { finishAttacker(draft, event.unitId); }
        if (event.type === 'melee-attack-resolved') processAttachmentCasualties(draft, event.unitId);
        if (event.type === 'fight-unit-completed') openWindow(draft, 'AFTER_UNIT_FOUGHT', { unitId: event.unitId });
      }
      detectDestroyedTransports(draft); normalizeDestroyed(draft); recordTerrainChanges(this.state, draft); this.commit(draft); }
    return copy(result);
  }
  declareCharge(unitId: string, rng: RandomSource, choices: MovementAbilityChoices = {}) {
    return this.combatCommand(c => c.declareCharge(unitId, rng, this.policies.chargeExceptions?.(this.getState(), unitId), choices));
  }
  getLegalChargeTargets() {
    const charge = this.state.closeCombat?.charge;
    if (!charge || this.state.closeCombat?.move) return [];
    return copy(getLegalChargeTargets(this.state, this.state.units.find(u => u.id === charge.unitId)!, charge.distance));
  }
  selectChargeTargets(ids: string[]) { return this.combatCommand(c => c.selectChargeTargets(ids)); }
  failCharge() { return this.combatCommand(c => c.failCharge()); }
  moveCombatModel(id: string, position: Position, path?: MovementPath) { return this.combatCommand(c => c.moveCombatModel(id, position, path)); }
  previewCombatMove(id: string, position: Position, path?: MovementPath) { return new CloseCombatController(this.getState()).moveCombatModel(id, position, path); }
  completeCombatMove() { return this.combatCommand(c => c.completeCombatMove()); }
  cancelCombatMove() { return this.combatCommand(c => c.cancelCombatMove()); }
  startFightPhase() { return this.combatCommand(c => c.startFightPhase()); }
  advanceFightStep() { return this.combatCommand(c => c.advanceFightStep()); }
  beginPileIn(id: string, targets: string[] = []) { return this.combatCommand(c => c.beginPileIn(id, targets)); }
  beginConsolidation(id: string, targets: string[] = []) { return this.combatCommand(c => c.beginConsolidation(id, targets)); }
  skipTacticalMove(id: string) { return this.combatCommand(c => c.skipTacticalMove(id)); }
  selectFightUnit(id: string) { return this.combatCommand(c => c.selectFightUnit(id)); }
  beginOverrun(targets: string[]) { return this.combatCommand(c => c.beginOverrun(targets)); }
  meleeAttack(weaponId: string, targetId: string, rng: RandomSource, precisionModelId?: string) {
    const id = this.state.closeCombat?.fight?.selected?.unitId;
    if (precisionModelId && (!id || !this.precisionTargets(id, weaponId, targetId).includes(precisionModelId))) return failure('PRECISION_TARGET_INVALID');
    return this.combatCommand(c => c.meleeAttack(weaponId, targetId, rng, this.policies.damageAllocation, precisionModelId, this.rollWindowForCombat()));
  }
  private rollWindowForCombat() { return (s: GameState, trigger: Parameters<RollWindow>[0], job: AttackJob) => this.rollWindow(s)(trigger, job); }
  cancelFightUnit() { return this.combatCommand(c => c.cancelFightUnit()); }
  completeFightUnit(rng?: RandomSource): CommandResult {
    if (this.state.attackJob) return failure('ATTACK_PENDING');
    const draft = this.getState(), block = temporalBlock(draft); if (block) return block;
    const selected = draft.closeCombat?.fight?.selected, count = selected?.hazardousCount ?? 0;
    if ((count || draft.destructionQueue?.some(q => !q.resolved)) && !rng) return failure('INVALID_CONFIGURATION');
    const result = new CloseCombatController(draft).completeFightUnit(); if (!result.ok) return result;
    const id = selected!.unitId;
    if (count) { const hazard = resolveHazardRolls(draft, draft.units.find(u => u.id === id)!, count, rng!); flowEvent(draft, 'HAZARD_ROLLED', { rolls: hazard.rolls, mortalWounds: hazard.mortalWounds }, id); }
    queueDestructions(this.state, draft, id); finishAttacker(draft, id); releaseDestructions(draft, id);
    detectDestroyedTransports(draft); if (rng) resolveDestructions(draft, rng);
    processAttachmentCasualties(draft); normalizeDestroyed(draft); recordTerrainChanges(this.state, draft);
    openWindow(draft, 'AFTER_UNIT_FOUGHT', { unitId: id }); this.commit(draft); return result;
  }

  private visibility() {
    const snapshot = this.getState();
    return this.policies.visibilityProvider?.(snapshot) ?? createVisibilityProvider(snapshot, this.policies.detectionRange ?? getDetectionRange, this.policies.visibility);
  }
  getTerrainDebug(observerId?: string, targetUnitId?: string, weaponId?: string) {
    const snapshot = this.getState(), provider = this.visibility();
    const observer = snapshot.units.flatMap(u => u.models).find(m => m.id === observerId);
    const target = snapshot.units.find(u => u.id === targetUnitId);
    const source = observer && snapshot.units.find(u => u.id === observer.unitId)!;
    const weapon = source && definitionFor(snapshot, source).weapons.find(w => w.id === weaponId && w.kind === 'ranged');
    return copy({ models: snapshot.units.filter(onBattlefield).flatMap(u => u.models).filter(m => m.alive).map(m => ({ modelId: m.id, elevation: elevation(m.position), areaIds: areasForModel(snapshot, m).map(a => a.id), hidden: isModelHidden(snapshot, m), detectionRange: (this.policies.detectionRange ?? getDetectionRange)(m, snapshot) })),
      target: observer && target ? { visible: provider.isUnitVisible(observer, target), fullyVisible: provider.isUnitFullyVisible(observer, target),
        models: target.models.filter(m => m.alive).map(m => ({ modelId: m.id, ...provider.inspect(observer, m) })),
        attack: weapon?.kind === 'ranged' ? (() => { try { return shootingModifiers(snapshot, observer, target, weapon.skill, provider, weapon, snapshot.shooting?.attackChoices?.[weapon.id]); } catch { return null; } })() : null } : null });
  }

  private setupCommand<T>(command: (draft: GameState) => CommandResult<T>): CommandResult<T> {
    if (this.state.status !== 'in-progress') return failure('MATCH_FINISHED');
    const block = temporalBlock(this.state); if (block) return block;
    const draft = this.getState(), result = command(draft);
    if (result.ok) { new MatchFlowController(draft, this.policies.flow, this.policies.reserves).start(); recordTerrainChanges(this.state, draft); this.commit(draft); }
    return copy(result);
  }
  advancePreBattle() { return this.setupCommand(s => new DeploymentController(s).advance()); }
  setFirstTurn(playerId: string) { return this.setupCommand(s => new DeploymentController(s).setFirstTurn(playerId)); }
  chooseDeploymentAbility(unitId: string, choice: DeploymentAbilityChoice) { return this.setupCommand(s => new DeploymentController(s).choose(unitId, choice)); }
  selectStrategicReserve(unitId: string, selected = true) { return this.setupCommand(s => new DeploymentController(s).selectReserve(unitId, selected)); }
  getDeploymentOptions() {
    const s = this.getState(); return { nextPlayerId: s.deployment ? nextDeploymentPlayer(s) : null,
      scoutUnitIds: new DeploymentController(s).scoutUnits().map(u => u.id),
      points: s.players.map(p => ({ playerId: p.id, ...reservePoints(s, p.id) })) };
  }
  beginDeployment(unitId: string, infiltrators = false) { return this.setupCommand(s => new SetupController(s, this.policies.setup).begin(unitId, 'DEPLOYMENT', infiltrators ? 'INFILTRATORS' : 'NORMAL')); }
  beginIngress(unitId: string, method: IngressMethod) { return this.setupCommand(s => new SetupController(s, this.policies.setup, this.policies.reserves).begin(unitId, 'INGRESS_MOVE', method)); }
  beginScoutSetup(unitId: string) { return this.setupCommand(s => new SetupController(s, this.policies.setup).begin(unitId, 'SCOUT_SETUP', 'NORMAL')); }
  stageSetupModel(modelId: string, position: Position) { return this.setupCommand(s => new SetupController(s).stageModel(modelId, position)); }
  previewSetup(formation?: Formation) { return copy(new SetupController(this.getState(), this.policies.setup).preview(formation)); }
  completeSetup() { return this.setupCommand(s => new SetupController(s, this.policies.setup).complete()); }
  cancelSetup() { return this.setupCommand(s => new SetupController(s).cancel()); }
  beginScoutMove(unitId: string) { return this.setupCommand(s => new ScoutController(s).begin(unitId)); }
  moveScoutModel(modelId: string, position: Position, path?: MovementPath) { return this.setupCommand(s => new ScoutController(s).move(modelId, position, path)); }
  completeScoutMove() { return this.setupCommand(s => new ScoutController(s).finish()); }
  cancelScoutMove() { return this.setupCommand(s => new ScoutController(s).finish(true)); }
  skipScout(unitId: string) { return this.setupCommand(s => new DeploymentController(s).skipScout(unitId)); }
  moveUnitToStrategicReserves(unitId: string, reason: string) { return this.setupCommand(s => moveUnitToReserves(s, unitId, reason)); }
  moveUnitToGenericReserves(unitId: string, reason: string) { return this.setupCommand(s => moveUnitToReserves(s, unitId, reason, 'RESERVES')); }
  finishBattle(): CommandResult {
    return this.setupCommand(s => {
      if (!battleStarted(s)) return failure('PRE_BATTLE');
      if (actionBusy(s)) return failure('SETUP_IN_PROGRESS');
      resolveReserveExpiration(s, s.round, this.policies.reserves, true); s.status = 'finished';
      return { ok: true, value: undefined };
    });
  }

  private passengerCommand<T>(action: (s: GameState) => CommandResult<T>): CommandResult<T> {
    if (this.state.attackJob || ((this.state.shooting || this.state.closeCombat?.fight?.selected) && this.state.transportState?.destroyed.length)) return failure('ATTACK_PENDING');
    if (this.state.status !== 'in-progress') return failure('MATCH_FINISHED');
    const block = temporalBlock(this.state); if (block && !this.state.transportState?.destroyed.length) return block;
    const draft = this.getState(), result = action(draft);
    if (result.ok) { queueDestructions(this.state, draft); if (!draft.transportState?.disembark) processAttachmentCasualties(draft); normalizeDestroyed(draft); recordTerrainChanges(this.state, draft); this.commit(draft); }
    return copy(result);
  }
  configureAttachments(assignments: AttachmentAssignment[], policy?: AttachmentPolicy) { return this.passengerCommand(s => formAttachments(s, assignments, policy)); }
  startEmbarked(unitId: string, transportId: string) { return this.passengerCommand(s => embark(s, unitId, transportId, true)); }
  getDisembarkMode(unitId: string) { return copy(new TransportController(this.getState()).mode(unitId)); }
  beginDisembark(unitId: string, rng?: RandomSource, candidate?: Formation) { return this.passengerCommand(s => new TransportController(s).begin(unitId, rng, candidate)); }
  stageDisembarkModel(modelId: string, p: Position) { return this.passengerCommand(s => new TransportController(s).stage(modelId, p)); }
  previewDisembark() { return copy(new TransportController(this.getState()).preview()); }
  completeDisembark() { return this.passengerCommand(s => new TransportController(s).complete()); }
  resolveEmergencyDisembark() { return this.passengerCommand(s => new TransportController(s).emergency()); }
  cancelDisembark() { return this.passengerCommand(s => new TransportController(s).cancel()); }
  getFiringDeckOptions(unitId: string) { return copy(firingDeckOptions(this.getState(), unitId)); }
  precisionTargets(shooterId: string, weaponId: string, targetId: string) {
    const s = this.getState(), shooter = s.units.find(u => u.id === shooterId), target = s.units.find(u => u.id === targetId);
    if (!shooter || !target || !attachmentFor(s, targetId)) return [];
    const weapon = definitionFor(s, shooter).weapons.find(w => w.id === weaponId) ?? s.shooting?.firingDeck?.find(x => x.borrowed.id === weaponId)?.borrowed;
    if (!weapon || !hasWeaponAbility(weapon, 'PRECISION')) return [];
    const provider = this.visibility();
    const ranged = weapon.kind === 'ranged' ? validateShootingTarget(s, shooterId, weaponId, targetId, provider) : null;
    const eligible = weapon.kind === 'ranged' ? ranged?.ok ? shooter.models.filter(m => ranged.value.eligibleFiringModelIds.includes(m.id)) : [] : getModelsEligibleToFight(s, shooter, target).filter(m => modelHasWeapon(s, shooter, m, weaponId) && !s.closeCombat?.fight?.selected?.usedModelIds.includes(m.id));
    return target.models.filter(m => m.alive && modelKeywords(s, target, m).includes('CHARACTER') && eligible.some(a => a.alive && provider.isModelVisible(a, m))).map(m => m.id);
  }
  getTransportDebug() {
    const s = this.getState(); return { transports: s.units.filter(u => capacityDefinition(s, u)).map(u => ({ id: u.id, remaining: remainingTransportCapacity(s, u), passengers: passengers(s, u.id).map(x => x.id) })),
      units: s.units.map(u => ({ id: u.id, keywords: unitKeywords(s, u), abilities: sourceAbilities(s, u), toughness: u.models.some(m => m.alive) ? attackToughness(s, u) : null, groups: allocationGroups(s, u), components: attachmentFor(s, u.id)?.components.map(c => ({ id: c.original.id, role: c.role })) ?? [] })) };
  }

  private flowCommand<T>(command: (draft: GameState) => CommandResult<T>): CommandResult<T> {
    if (this.state.status !== 'in-progress') return failure('MATCH_FINISHED');
    if (!this.state.flow) return failure('FLOW_REQUIRED');
    const draft = this.getState(), result = command(draft);
    if (result.ok) { queueDestructions(this.state, draft, draft.attackJob?.attackerUnitId); if (draft.attackJob) draft.attackJob.target = copy(draft.units.find(u => u.id === draft.attackJob!.target.id)!); recordDestroyedUnits(this.state, draft); interruptActionsOnCommit(this.state, draft); synchronizeMission(draft, this.policies.reserves); validateState(draft); this.state = draft; }
    return copy(result);
  }
  /** Explicit migration: legacy snapshots keep their original phase progression until enabled. */
  enableMatchFlow(rules: Partial<FlowRules> = {}): CommandResult {
    const draft = this.getState(), result = enableFlow(draft, rules);
    if (result.ok) { new MatchFlowController(draft, this.policies.flow, this.policies.reserves).start(); validateState(draft); this.commit(draft); }
    return result;
  }
  setupMission(definition: MissionDefinition, attackerPlayerId: string, fixed: Record<string, string[]> = {}, rng?: RandomSource) {
    if (this.state.mission) return failure('MISSION_ALREADY_SET');
    const draft = this.getState();
    if (!draft.flow) { const enabled = enableFlow(draft, { maximumBattleRounds: definition.maximumBattleRounds }); if (!enabled.ok) return enabled; }
    const result = instantiateMission(draft, definition, attackerPlayerId, fixed);
    if (!result.ok) return result;
    if (rng) for (const p of draft.players) if (!fixed[p.id]?.length) { const shuffled = shuffleTactical(draft, p.id, rng); if (!shuffled.ok) return shuffled; }
    new MatchFlowController(draft, this.policies.flow, this.policies.reserves).start(); this.commit(draft); return result;
  }
  getMissionDebug(selectedUnitId?: string) {
    const s = this.getState(), m = s.mission; if (!m) return null;
    const unit = s.units.find(u => u.id === selectedUnitId);
    return copy({ name: m.definition.name, round: s.round, scores: s.players.map(p => scoreBreakdown(s, p.id)),
      objectives: m.objectives.map(o => ({ id: o.id, owner: o.controllingPlayerId, secured: o.securedByPlayerId,
        control: s.players.map(p => ({ playerId: p.id, value: calculateLevelOfControl(s, o, p.id) })) })),
      selectedUnitOC: unit?.models.filter(x => x.alive).map(x => ({ id: x.id, value: effectiveModelOC(s, unit, x) })) ?? [],
      actions: m.definition.actions.map(a => ({ id: a.id, objectives: unit ? eligibleActionObjectives(s, unit, a).map(o => o.id) : [],
        eligibility: unit ? canStartMissionAction(s, unit.id, a.id, a.requiresObjective ? eligibleActionObjectives(s, unit, a)[0]?.id : undefined) : null })),
      activeActions: m.activeActions.filter(a => a.state === 'ACTIVE'), fixed: m.fixed, tactical: m.tactical, result: m.matchResult });
  }
  getObjectiveControl(objectiveId: string) {
    const s = this.getState(), objective = s.mission?.objectives.find(o => o.id === objectiveId);
    return objective ? copy({ owner: objective.controllingPlayerId, levels: s.players.map(p => ({ playerId: p.id, level: calculateLevelOfControl(s, objective, p.id) })) }) : null;
  }
  startAction(unitId: string, actionId: string, objectiveId?: string) { return this.flowCommand(s => startMissionAction(s, unitId, actionId, objectiveId)); }
  secureObjective(objectiveId: string, playerId: string, source: string) {
    return this.flowCommand(s => secureObjective(s, objectiveId, playerId, source) ? { ok: true, value: undefined } : failure('OBJECTIVE_NOT_CONTROLLED'));
  }
  getTacticalHand(playerId: string) { return copy(this.state.mission?.tactical[playerId]?.hand ?? []); }
  shuffleTactical(playerId: string, rng: RandomSource) { return this.flowCommand(s => shuffleTactical(s, playerId, rng)); }
  discardTactical(playerId: string, id: string) { return this.flowCommand(s => discardTactical(s, playerId, id)); }
  awardMissionPoints(playerId: string, amount: number, sourceType: VictoryPointEntry['sourceType'], sourceId: string) {
    return this.flowCommand(s => {
      if (!s.mission || !s.players.some(p => p.id === playerId) || !Number.isSafeInteger(amount) || amount < 0 || !sourceId) return failure('INVALID_CONFIGURATION');
      return { ok: true, value: awardVictoryPoints(s, playerId, amount, sourceType, sourceId) };
    });
  }
  canAdvancePhase() { return new MatchFlowController(this.getState(), this.policies.flow, this.policies.reserves).canAdvancePhase(); }
  advanceCommandStep() { return this.flowCommand(s => new CommandController(s, this.policies.flow).advance()); }
  rollBattleShock(unitId: string, rng: RandomSource) { return this.flowCommand(s => new CommandController(s, this.policies.flow).roll(unitId, rng)); }
  getCommandAbilities() { return copy(new CommandController(this.getState(), this.policies.flow).options()); }
  resolveCommandAbility(id: string) { return this.flowCommand(s => new CommandController(s, this.policies.flow).resolve(id)); }
  passTimingWindow(playerId: string) { return this.flowCommand(s => passWindow(s, playerId)); }
  getStratagemOptions(playerId: string) { return copy(new StratagemEngine(this.getState(), this.policies.stratagems).options(playerId)); }
  useStratagem(id: string, playerId: string, targets: string[]) { return this.flowCommand(s => new StratagemEngine(s, this.policies.stratagems).use(id, playerId, targets)); }
  gainCommandPoints(playerId: string, amount: number, policy: { ignoreLimit?: boolean; limit?: number } = {}) { return this.flowCommand(s => gainCommandPoints(s, playerId, amount, 'OTHER_CP_GAIN', policy)); }
  canSpendCommandPoints(playerId: string, amount: number) { return canSpendCommandPoints(this.state, playerId, amount); }
  spendCommandPoints(playerId: string, amount: number) { return this.flowCommand(s => spendCommandPoints(s, playerId, amount)); }
  addTemporaryEffect(effect: EffectInput) { return this.flowCommand(s => ({ ok: true, value: applyEffect(s, effect) })); }
  removeTemporaryEffect(id: string) { return this.flowCommand(s => { removeEffect(s, id); return { ok: true, value: undefined }; }); }
  getCommandDebug() {
    const s = this.getState(); return { blockers: this.canAdvancePhase().blockingReasons,
      units: s.units.map(u => ({ id: u.id, battleShocked: !!u.state.battleShocked, objectiveControl: effectiveObjectiveControl(s, u),
        canStartAction: canStartAction(u), canCompleteAction: canCompleteAction(u), ...fallBackOptions(s, u),
        movement: effectiveCharacteristic(s, u.id, 'MOVE', definitionFor(s, u).stats.movement) })) };
  }

  getSetupFormationAt(anchor: Position): Formation {
    const s = this.state, tx = s.setup; if (!tx) return {};
    const models = s.units.find(u => u.id === tx.unitId)!.models.filter(m => m.alive);
    const origin = tx.positions[models[0]!.id];
    return Object.fromEntries(models.map((m, i) => {
      const p = tx.positions[m.id];
      return [m.id, { x: anchor.x + (origin && p ? p.x - origin.x : i * 1.5), y: anchor.y + (origin && p ? p.y - origin.y : 0), z: anchor.z ?? 0 }];
    }));
  }
  stageSetupFormationAt(anchor: Position) {
    const positions = this.getSetupFormationAt(anchor);
    return this.setupCommand(s => {
      if (!s.setup) return failure('NO_SETUP');
      const c = new SetupController(s);
      for (const [id, p] of Object.entries(positions)) { const result = c.stageModel(id, p); if (!result.ok) return result; }
      return { ok: true, value: undefined };
    });
  }
  /** Bounded debug samples of complete formations, not a game-world grid or exhaustive legal region. */
  getSetupPreviewSamples(z = 0) {
    if (!this.state.setup) return [];
    const controller = new SetupController(this.getState(), this.policies.setup);
    return Array.from({ length: 108 }, (_, i) => {
      const position = { x: ((i % 12) + 0.5) * this.state.battlefield.width / 12, y: (Math.floor(i / 12) + 0.5) * this.state.battlefield.height / 9, z };
      const result = controller.preview(this.getSetupFormationAt(position));
      return { position, legal: result.ok };
    });
  }

}
