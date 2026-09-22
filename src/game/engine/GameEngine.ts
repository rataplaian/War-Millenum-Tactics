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
import { resolveShooting } from '../rules/resolveShooting';
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
      const result = new MatchFlowController(draft, this.policies.flow).advance();
      if (!result.ok) return result;
      if (draft.round > before.round) resolveReserveExpiration(draft, before.round, this.policies.reserves);
      if (draft.status === 'finished') resolveReserveExpiration(draft, draft.round, this.policies.reserves, true);
      if (draft.phase === 'Charge' || draft.turn > before.turn) for (const u of draft.units) delete u.moveLock;
      recordTerrainChanges(before, draft); this.state = draft;
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
    this.state = next;
    recordTerrainChanges(before, this.state);
    return { ok: true, value: this.getState() };
  }
  private event(unitId: string, payload: EventPayload): void {
    this.state.events.push(copy({ ...payload, sequence: this.state.events.length + 1,
      round: this.state.round, turn: this.state.turn, playerId: this.state.activePlayerId, unitId } as GameEvent));
  }
  beginMovement(unitId: string, moveType: 'NORMAL_MOVE' | 'ADVANCE_MOVE' | 'FALL_BACK_MOVE' = 'NORMAL_MOVE', rng?: RandomSource): CommandResult {
    const result = validateBeginMovement(this.state, unitId, moveType);
    if (!result.ok) return result;
    if (moveType !== 'NORMAL_MOVE') {
      const draft = this.getState(), unit = draft.units.find(u => u.id === unitId)!;
      if (!rng && (moveType === 'ADVANCE_MOVE' || !fallBackOptions(draft, unit).orderedRetreat)) return failure('INVALID_CONFIGURATION');
      const bonus = moveType === 'ADVANCE_MOVE' ? rollD6(rng!) : 0;
      const desperate = moveType === 'FALL_BACK_MOVE' && !fallBackOptions(draft, unit).orderedRetreat;
      if (desperate) { const hazard = resolveHazardRolls(draft, unit, unit.models.filter(m => m.alive).length, rng!); flowEvent(draft, 'HAZARD_ROLLED', { rolls: hazard.rolls, mortalWounds: hazard.mortalWounds }, unitId); }
      draft.movement = { unitId, moveType, bonus, desperate, irreversible: moveType === 'ADVANCE_MOVE' || desperate, originals: unit.models.map(m => ({ modelId: m.id, position: { ...m.position }, movementUsed: m.movementUsed })) };
      if (bonus) { unit.advanceBonus = { turn: draft.turn, value: bonus }; flowEvent(draft, 'ADVANCE_ROLLED', { bonus }, unitId); }
      this.state = draft; this.event(unitId, { type: 'movement-started' }); return { ok: true, value: undefined };
    }
    this.state.movement = { unitId, originals: result.value.models.map(m => ({
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
  completeMovement(embarkTransportId?: string): CommandResult {
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
    const before = this.getState();
    if (embarkTransportId) {
      const draft = this.getState(); const result = embark(draft, unit.id, embarkTransportId);
      if (!result.ok) return result;
      this.state = draft;
    }
    const moved = this.state.units.find(u => u.id === unit.id)!, moveType = this.state.movement!.moveType ?? 'NORMAL_MOVE';
    moved.state.hasMoved = true;
    moved.lastMove = { kind: moveType, turn: this.state.turn, phase: this.state.phase };
    if (moveType === 'ADVANCE_MOVE') moved.state.hasAdvanced = true;
    if (moveType === 'FALL_BACK_MOVE') { moved.state.hasFallenBack = true; moved.cannotShootUntilTurn = this.state.turn; }
    if (moveType !== 'NORMAL_MOVE') moved.cannotChargeUntilTurn = this.state.turn;
    if (this.state.transportState?.tacticalFollowUp === unit.id) delete this.state.transportState.tacticalFollowUp;
    this.state.movement = null;
    this.event(unit.id, { type: 'movement-completed' });
    processAttachmentCasualties(this.state); normalizeDestroyed(this.state); recordTerrainChanges(before, this.state);
    return { ok: true, value: undefined };
  }
  beginShooting(unitId: string, deck: { modelId: string; weaponId: string }[] = []): CommandResult {
    const error = shootingPhaseError(this.state);
    if (error) return error;
    if (this.state.shooting) return failure('SHOOTING_IN_PROGRESS');
    const weapons = availableRangedWeapons(this.state, unitId);
    const shooter = validateShooter(this.state, unitId); if (!shooter.ok) return shooter;
    if (!weapons.ok && !(weapons.reason === 'NO_RANGED_WEAPONS' && capacityDefinition(this.state, shooter.value)?.firingDeck)) return weapons;
    const draft = this.getState(); draft.shooting = { unitId, firedWeaponIds: [], hasRolled: false };
    if (capacityDefinition(draft, shooter.value)?.firingDeck) { const selected = selectFiringDeck(draft, unitId, deck); if (!selected.ok) return selected; }
    else if (deck.length) return failure('FIRING_DECK_LIMIT');
    this.state = draft;
    this.state.units.find(u => u.id === unitId)!.selectedToShootAt = { turn: this.state.turn, phase: this.state.phase };
    this.event(unitId, { type: 'shooting-started' });
    return { ok: true, value: undefined };
  }
  getRangedWeapons(unitId: string) { return copy(availableRangedWeapons(this.state, unitId)); }
  getLegalTargets(unitId: string, weaponId: string) {
    return copy(legalShootingTargets(this.state, unitId, weaponId, this.visibility()));
  }
  selectShootingTarget(weaponId: string, targetUnitId: string): CommandResult {
    return this.flowCommand(s => {
      const block = temporalBlock(s); if (block) return block;
      if (!s.shooting) return failure('NO_ACTIVE_SHOOTING');
      if (s.shooting.selectedTarget) return failure('TARGET_SELECTION_LOCKED');
      const legal = validateShootingTarget(s, s.shooting.unitId, weaponId, targetUnitId, this.visibility());
      if (!legal.ok) return legal;
      s.shooting.selectedTarget = { weaponId, targetUnitId };
      openWindow(s, 'AFTER_TARGET_SELECTED', { unitId: s.shooting.unitId, targetUnitId });
      return { ok: true, value: undefined };
    });
  }
  fireWeapon(weaponId: string, targetUnitId: string, rng: RandomSource, precisionModelId?: string): CommandResult<WeaponResolution> {
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
    // Resolve against detached data. Rule rejections above consume no RNG; a broken RNG/policy
    // throws without partially changing battle state. External RNG state cannot be rolled back.
    const before = this.getState();
    const shooter = this.state.units.find(u => u.id === transaction.unitId)!;
    const modifiers = shooter.models.filter(m => legal.value.eligibleFiringModelIds.includes(m.id)).map(m => shootingModifiers(this.state, m, target, weapon.value.skill, provider));
    const outcome = resolveShooting(weapon.value, legal.value.eligibleFiringModelIds, copy(target),
      definitionFor(this.state, target), rng, this.policies.damageAllocation ?? allocateDamage, modifiers, this.state, precisionModelId);
    this.state.units = this.state.units.map(u => u.id === target.id ? outcome.target : u);
    if (outcome.resolution.attacks > 0) shooter.lastRangedAttackTurnIndex = this.state.turn;
    delete transaction.selectedTarget;
    transaction.firedWeaponIds.push(weaponId);
    transaction.hasRolled ||= outcome.resolution.hitRolls.length > 0 ||
      outcome.resolution.attackCounts.some(count => count.resolved.rolls.length > 0);
    this.event(transaction.unitId, { type: 'weapon-fired', resolution: outcome.resolution });
    for (const m of modifiers) for (const modifier of m.modifiers.filter(x => x.source !== 'TEMPORARY_EFFECT')) this.event(transaction.unitId, { type: modifier.source === 'COVER' ? 'cover-applied' : 'plunging-fire-applied', modelId: m.modelId, targetUnitId, effectiveSkill: m.effectiveSkill });
    recordTerrainChanges(before, this.state);
    processAttachmentCasualties(this.state, transaction.unitId);
    detectDestroyedTransports(this.state);
    normalizeDestroyed(this.state);
    for (const damage of outcome.resolution.damageResults) {
      this.event(transaction.unitId, { type: 'model-damaged', targetUnitId, weaponId, damage });
      if (damage.destroyed) this.event(transaction.unitId, { type: 'model-destroyed', targetUnitId, weaponId, modelId: damage.modelId });
    }
    return { ok: true, value: copy(outcome.resolution) };
  }
  cancelShooting(): CommandResult {
    const error = shootingPhaseError(this.state);
    if (error) return error;
    if (!this.state.shooting) return failure('NO_ACTIVE_SHOOTING');
    if (this.state.shooting.hasRolled || this.state.shooting.selectedTarget) return failure('SHOOTING_ALREADY_RESOLVED');
    const { unitId } = this.state.shooting;
    this.state.shooting = null;
    this.event(unitId, { type: 'shooting-cancelled' });
    return { ok: true, value: undefined };
  }
  completeShooting(): CommandResult {
    const error = shootingPhaseError(this.state);
    if (error) return error;
    if (!this.state.shooting) return failure('NO_ACTIVE_SHOOTING');
    const { unitId } = this.state.shooting;
    if (this.state.shooting.selectedTarget) return failure('TARGET_SELECTION_LOCKED');
    this.state.units.find(u => u.id === unitId)!.state.hasShot = true;
    this.state.shooting = null;
    this.event(unitId, { type: 'shooting-completed' });
    finishAttacker(this.state, unitId);
    openWindow(this.state, 'AFTER_UNIT_SHOT', { unitId });
    return { ok: true, value: undefined };
  }

  private combatCommand<T>(command: (controller: CloseCombatController) => CommandResult<T>): CommandResult<T> {
    const draft = this.getState();
    const block = temporalBlock(draft); if (block) return block;
    const result = command(new CloseCombatController(draft));
    if (result.ok) {
      for (const event of draft.events.slice(this.state.events.length)) {
        if (event.type === 'combat-move-completed' && event.kind === 'charge') openWindow(draft, 'AFTER_CHARGE_MOVE', { unitId: event.unitId });
        if (event.type === 'fight-unit-completed') { finishAttacker(draft, event.unitId); }
        if (event.type === 'melee-attack-resolved') processAttachmentCasualties(draft, event.unitId);
        if (event.type === 'fight-unit-completed') openWindow(draft, 'AFTER_UNIT_FOUGHT', { unitId: event.unitId });
      }
      detectDestroyedTransports(draft); normalizeDestroyed(draft); recordTerrainChanges(this.state, draft); this.state = draft; }
    return copy(result);
  }
  declareCharge(unitId: string, rng: RandomSource) {
    return this.combatCommand(c => c.declareCharge(unitId, rng, this.policies.chargeExceptions?.(this.getState(), unitId)));
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
    return this.combatCommand(c => c.meleeAttack(weaponId, targetId, rng, this.policies.damageAllocation, precisionModelId));
  }
  cancelFightUnit() { return this.combatCommand(c => c.cancelFightUnit()); }
  completeFightUnit() { return this.combatCommand(c => c.completeFightUnit()); }

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
        attack: weapon ? shootingModifiers(snapshot, observer, target, weapon.skill, provider) : null } : null });
  }

  private setupCommand<T>(command: (draft: GameState) => CommandResult<T>): CommandResult<T> {
    if (this.state.status !== 'in-progress') return failure('MATCH_FINISHED');
    const block = temporalBlock(this.state); if (block) return block;
    const draft = this.getState(), result = command(draft);
    if (result.ok) { new MatchFlowController(draft, this.policies.flow).start(); recordTerrainChanges(this.state, draft); this.state = draft; }
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
    if (this.state.status !== 'in-progress') return failure('MATCH_FINISHED');
    const block = temporalBlock(this.state); if (block && !this.state.transportState?.destroyed.length) return block;
    const draft = this.getState(), result = action(draft);
    if (result.ok) { if (!draft.transportState?.disembark) processAttachmentCasualties(draft); normalizeDestroyed(draft); recordTerrainChanges(this.state, draft); this.state = draft; }
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
    if (!weapon?.traits.some(t => t.id.toUpperCase() === 'PRECISION')) return [];
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
    if (result.ok) { validateState(draft); this.state = draft; }
    return copy(result);
  }
  /** Explicit migration: legacy snapshots keep their original phase progression until enabled. */
  enableMatchFlow(rules: Partial<FlowRules> = {}): CommandResult {
    const draft = this.getState(), result = enableFlow(draft, rules);
    if (result.ok) { new MatchFlowController(draft, this.policies.flow).start(); validateState(draft); this.state = draft; }
    return result;
  }
  canAdvancePhase() { return new MatchFlowController(this.getState(), this.policies.flow).canAdvancePhase(); }
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
