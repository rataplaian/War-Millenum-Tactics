import { movementAbilities, validateMovementAbilities, type MovementAbilityChoices } from '../abilities/movement';
import { hasWeaponAbility, resolvedAbilities, weaponInstanceId } from '../abilities/registry';
import { createAttackJob, runAttackJob, type RollWindow } from '../combat/AttackPipeline';
import type { AttackJob } from '../combat/types';
import { modelHasWeapon } from '../attachments/queries';
import { applyEffect, effectiveFlag } from '../effects/EffectEngine';
import { battleStarted, setupBusy } from '../reserves/location';
import { validateTerrainPath } from '../terrain/movement';
import type { CommandResult, CombatMoveKind, CloseCombatEvent, GameState, MovementPath, Position, Unit, WeaponResolution } from '../models';
import { rollD6s, type RandomSource } from '../utils/dice';
import { centreDistance, edgeDistance, EPSILON, isFinitePosition } from '../utils/geometry';
import { definitionFor, failure, validateFinalPosition } from '../rules/movement';
import { checkCoherency, isUnitEngaged } from '../rules/spatial';
import { canDeclareCharge, COMBAT_RULES, emptyCloseCombat, engagedTargets, enemies, findChargeFormation, getModelsEligibleToFight, living, reachablePositions, unitDistance, type ChargeExceptions } from '../rules/closeCombat';
import { eligibleFighters, nextFightSelection, otherPlayer } from '../rules/FightSequenceController';
import { hasFactionRule, recordFactionTarget, thrillTargetLegal } from '../content/factionRules';
import { flowEvent } from '../flow/events';
import type { DamageAllocationPolicy } from '../rules/damageAllocation';

type Payload = CloseCombatEvent extends infer E ? E extends CloseCombatEvent ? Omit<E, 'sequence' | 'round' | 'turn' | 'playerId' | 'unitId'> : never : never;
const success = (): CommandResult => ({ ok: true, value: undefined });
/** Operates on a private draft. GameEngine commits the draft only on success. */
export class CloseCombatController {
  constructor(private readonly state: GameState) {}
  private get combat() { return this.state.closeCombat ??= emptyCloseCombat(); }
  private unit(id: string) { const unit = this.state.units.find(u => u.id === id); if (!unit) throw new Error('Missing combat unit'); return unit; }
  private emit(unitId: string, payload: Payload) {
    this.state.events.push({ ...payload, sequence: this.state.events.length + 1, round: this.state.round,
      turn: this.state.turn, playerId: this.unit(unitId).playerId, unitId } as CloseCombatEvent);
  }
  private phase(phase: 'Charge' | 'Fight'): CommandResult {
    if (!battleStarted(this.state)) return failure('PRE_BATTLE');
    if (setupBusy(this.state) && !(this.state.closeCombat?.fight?.selected && this.state.transportState?.destroyed.length && !this.state.transportState.disembark)) return failure('SETUP_IN_PROGRESS');
    if (this.state.status !== 'in-progress') return failure('MATCH_FINISHED');
    if (this.state.phase !== phase && !(phase==='Charge' && this.state.phase==='Movement' && !!this.state.closeCombat?.reaction)) return failure('WRONG_PHASE');
    if (this.state.movement || this.state.shooting) return failure('COMBAT_IN_PROGRESS');
    return success();
  }
  declareCharge(unitId: string, rng: RandomSource, exceptions: ChargeExceptions = {}, abilityChoices: MovementAbilityChoices = {}): CommandResult<number> {
    const legal = canDeclareCharge(this.state, unitId, exceptions);
    if (!legal.ok) return legal;
    if (!validateMovementAbilities(this.state, this.unit(unitId), abilityChoices, true)) return failure('INVALID_ABILITY_CHOICE');
    const rolls = rollD6s(2, rng), rolled = rolls.reduce((a, b) => a + b, 0);
    const distance = this.combat.reaction?.mode==='INTO_THE_FRAY' ? Math.min(6,rolled) : rolled;
    this.combat.charge = { unitId, rolls, distance, targetIds: [], abilityChoices };
    this.combat.declared.push(unitId);
    this.emit(unitId, { type: 'charge-declared' });
    this.emit(unitId, { type: 'charge-rolled', rolls, distance });
    return { ok: true, value: distance };
  }
  selectChargeTargets(targetIds: string[]): CommandResult {
    const phase = this.phase('Charge'); if (!phase.ok) return phase;
    const charge = this.combat.charge;
    if (!charge) return failure('NO_CHARGE');
    if (this.combat.move) return failure('COMBAT_IN_PROGRESS');
    if (!targetIds.length || new Set(targetIds).size !== targetIds.length) return failure('TARGETS_REQUIRED');
    const legal = enemies(this.state, this.unit(charge.unitId)).filter(target => thrillTargetLegal(this.state,this.unit(charge.unitId),target.id) && unitDistance(this.unit(charge.unitId), target) <= Math.min(COMBAT_RULES.chargeTargetDistance, charge.distance) + EPSILON);
    const reaction=this.combat.reaction;
    if (targetIds.some(id => !legal.some(u => u.id === id)) ||
        (reaction?.targetUnitId && !targetIds.includes(reaction.targetUnitId)) ||
        (reaction?.mode==='LEAP_TO_DEFEND' && targetIds.some(id=>!this.unit(id).state.hasCharged)) ||
        (reaction?.mode==='INTO_THE_FRAY' && targetIds.some(id=>unitDistance(this.unit(charge.unitId),this.unit(id))>6+EPSILON))) return failure('UNREACHABLE_TARGET');
    if (!findChargeFormation(this.state, this.unit(charge.unitId), targetIds, charge.distance)) return failure('UNREACHABLE_TARGET');
    charge.targetIds = [...targetIds];
    recordFactionTarget(this.state,'chargedByPhase',charge.unitId,targetIds);
    this.emit(charge.unitId, { type: 'charge-target-selected', targetIds: [...targetIds] });
    return this.startMove('charge', charge.unitId, targetIds, charge.distance);
  }
  /** Resolve a failed charge without refunding its roll or permitting another declaration. */
  failCharge(): CommandResult {
    const phase = this.phase('Charge'); if (!phase.ok) return phase;
    if (!this.combat.charge) return failure('NO_CHARGE');
    const unitId = this.combat.charge.unitId;
    this.restore(); this.combat.charge = null;
    delete this.combat.reaction;
    this.emit(unitId, { type: 'charge-failed' }); return success();
  }
  private startMove(kind: CombatMoveKind, unitId: string, targetIds: string[], allowance: number): CommandResult {
    if (this.combat.move) return failure('COMBAT_IN_PROGRESS');
    this.combat.move = { kind, unitId, targetIds: [...targetIds], allowance, used: {},
      originals: this.unit(unitId).models.map(m => ({ modelId: m.id, position: { ...m.position }, movementUsed: m.movementUsed })) };
    this.emit(unitId, { type: 'combat-move-started', kind, targetIds: [...targetIds] }); return success();
  }
  private restore() {
    const move = this.combat.move;
    if (!move) return;
    for (const original of move.originals) {
      const model = this.unit(move.unitId).models.find(m => m.id === original.modelId)!;
      model.position = { ...original.position }; model.movementUsed = original.movementUsed;
    }
    this.combat.move = null;
  }
  cancelCombatMove(): CommandResult {
    const move = this.combat.move;
    if (!move) return this.combat.charge ? failure('IRREVERSIBLE_ACTION') : failure('NO_COMBAT_MOVE');
    if (move.kind === 'charge') return failure('IRREVERSIBLE_ACTION');
    this.restore(); this.emit(move.unitId, { type: 'combat-move-cancelled', kind: move.kind }); return success();
  }
  moveCombatModel(modelId: string, position: Position, path?: MovementPath): CommandResult {
    const move = this.combat.move; if (!move) return failure('NO_COMBAT_MOVE');
    const phase = this.phase(move.kind === 'charge' ? 'Charge' : 'Fight'); if (!phase.ok) return phase;
    const unit = this.unit(move.unitId), model = unit.models.find(m => m.id === modelId);
    if (!model) return failure('MODEL_NOT_IN_UNIT');
    if (!model.alive) return failure('MODEL_DEAD');
    if (!isFinitePosition(position)) return failure('INVALID_POSITION');
    const terrainPath = validateTerrainPath(this.state, model, position, path); if (!terrainPath.ok) return terrainPath;
    const distance = terrainPath.value.totalMovementDistance, total = (move.used[modelId] ?? 0) + distance;
    if (total > move.allowance - movementAbilities(this.state, model).penalty + EPSILON) return { ...failure('EXCEEDS_ALLOWANCE'), distance, remaining: move.allowance - (move.used[modelId] ?? 0) };
    const placement = validateFinalPosition(this.state, unit, model, position, true); if (!placement.ok) return placement;
    const targets = move.targetIds.flatMap(id => living(this.unit(id)));
    const original = move.originals.find(o => o.modelId === modelId)!;
    const originalModel = { ...model, position: original.position };
    const before = Math.min(...targets.map(t => edgeDistance(originalModel, t)));
    if (distance > EPSILON && move.kind !== 'charge' && before <= EPSILON) return failure('BASE_CONTACT_LOCKED');
    if (centreDistance(original.position, position) > EPSILON) {
      // Charge may approach any selected target; other moves must approach the closest target.
      const closer = move.kind === 'charge' ? targets.some(t => edgeDistance({ ...model, position }, t) < edgeDistance(originalModel, t) - EPSILON) : targets.filter(t => Math.abs(edgeDistance(originalModel, t) - before) <= EPSILON).some(t => edgeDistance({ ...model, position }, t) < before - EPSILON);
      if (!closer) return failure('NOT_CLOSER');
    }
    const from = { ...model.position }; model.position = { ...position }; move.used[modelId] = total;
    this.emit(unit.id, { type: 'combat-model-moved', kind: move.kind, modelId, from, to: { ...position }, distance, totalUsed: total });
    return success();
  }
  completeCombatMove(): CommandResult {
    const move = this.combat.move; if (!move) return failure('NO_COMBAT_MOVE');
    const phase = this.phase(move.kind === 'charge' ? 'Charge' : 'Fight'); if (!phase.ok) return phase;
    const unit = this.unit(move.unitId), targets = move.targetIds.flatMap(id => living(this.unit(id)));
    const coherent = checkCoherency(unit.models, this.state.spatialRules.coherency);
    if (!coherent.coherent) return { ...failure('INCOHERENT'), modelIds: coherent.failingModelIds };
    for (const model of living(unit)) {
      const placement = validateFinalPosition(this.state, unit, model, model.position, true); if (!placement.ok) return placement;
      const original = move.originals.find(o => o.modelId === model.id)!;
      const originalModel = { ...model, position: original.position };
      const moved = centreDistance(original.position, model.position) > EPSILON;
      if (move.kind === 'charge' && !targets.some(t => edgeDistance(model, t) < edgeDistance(originalModel, t) - EPSILON)) return failure('NOT_CLOSER');
      if (moved || move.kind === 'charge') {
        const required = move.kind === 'charge' ? [COMBAT_RULES.chargeCloseDistance, this.state.spatialRules.engagementDistance] : [this.state.spatialRules.engagementDistance];
        for (const threshold of required) {
          if (targets.some(t => edgeDistance(model, t) <= threshold + EPSILON)) continue;
          if (reachablePositions(this.state, unit, model, original.position, move.allowance, targets, threshold).length) return failure('MUST_ENGAGE');
        }
      }
      if (move.kind !== 'charge') for (const enemy of enemies(this.state, unit)) {
        if (living(enemy).some(t => edgeDistance(originalModel, t) <= this.state.spatialRules.engagementDistance + EPSILON) &&
            !living(enemy).some(t => edgeDistance(model, t) <= this.state.spatialRules.engagementDistance + EPSILON)) return failure('INVALID_FINAL_ENGAGEMENT');
      }
    }
    const engaged = engagedTargets(this.state, unit).map(u => u.id);
    if (!engaged.length || (move.kind === 'charge' && (move.targetIds.some(id => !engaged.includes(id)) || engaged.some(id => !move.targetIds.includes(id)))) ||
        (move.kind === 'consolidate' && move.targetIds.some(id => !engaged.includes(id)))) return failure('INVALID_FINAL_ENGAGEMENT');
    this.combat.move = null;
    if (move.kind === 'charge') {
      unit.state.hasCharged = true;
      if (this.state.flow && !this.combat.reaction) applyEffect(this.state, { source: 'charge', target: { unitId: unit.id }, payload: { kind: 'FLAG', flag: 'FIGHTS_FIRST', value: true }, expiry: 'END_OF_CURRENT_TURN', stacking: 'NON_STACKING' });
      else if (!this.state.flow && !this.combat.reaction) this.combat.effects.push({ unitId: unit.id, kind: 'FIGHTS_FIRST', expiresAt: 'END_OF_TURN', turn: this.state.turn });
      this.combat.charge = null;
      delete this.combat.reaction;
    } else if (move.kind === 'pile-in') this.combat.fight!.pileInDone.push(unit.id);
    else if (move.kind === 'overrun') this.combat.fight!.selected!.overrunDone = true;
    else {
      this.combat.fight!.consolidateDone.push(unit.id);
      // Freshly engaged, unfought opponents must get a combat opportunity before continuing.
      if (eligibleFighters(this.state).length) this.combat.fight!.step = 'FIGHT';
    }
    this.emit(unit.id, { type: 'combat-move-completed', kind: move.kind }); return success();
  }
  startFightPhase(): CommandResult {
    const phase = this.phase('Fight'); if (!phase.ok) return phase;
    if (this.combat.fight) return failure('WRONG_FIGHT_STEP');
    this.combat.fight = { step: 'START', category: 'FIGHTS_FIRST', nextPlayerId: this.state.activePlayerId,
      pileInDone: [], eligibleAtFightStart: [], engagedAtFightStart: [], fought: [], consolidateDone: [], consolidationWindowsOffered: [], selected: null };
    return success();
  }
  private ordered(units: Unit[]) {
    return [...units.filter(u => u.playerId === this.state.activePlayerId), ...units.filter(u => u.playerId !== this.state.activePlayerId)];
  }
  pileInUnits() { return this.ordered(this.state.units.filter(u => living(u).length && !this.combat.fight?.pileInDone.includes(u.id) && (isUnitEngaged(this.state, u) || u.state.hasCharged))); }
  consolidateUnits() { return this.ordered(this.state.units.filter(u => living(u).length && !this.combat.fight?.consolidateDone.includes(u.id) && (this.combat.fight?.eligibleAtFightStart.includes(u.id) || this.combat.fight?.fought.includes(u.id)))); }
  advanceFightStep(): CommandResult {
    const phase = this.phase('Fight'); if (!phase.ok) return phase;
    if (this.state.fightOnDeath?.length) return failure('PENDING_RESOLUTION');
    const fight = this.combat.fight; if (!fight) return this.startFightPhase();
    if (this.combat.move || fight.selected) return failure('COMBAT_IN_PROGRESS');
    if (fight.step === 'START') fight.step = 'PILE_IN';
    else if (fight.step === 'PILE_IN') {
      if (this.pileInUnits().length) return failure('UNIT_NOT_ELIGIBLE');
      fight.step = 'FIGHT';
      fight.engagedAtFightStart = this.state.units.filter(u => isUnitEngaged(this.state, u)).map(u => u.id);
      fight.eligibleAtFightStart = this.state.units.filter(u => living(u).length && (isUnitEngaged(this.state, u) || u.state.hasCharged)).map(u => u.id);
    } else if (fight.step === 'FIGHT') {
      if (eligibleFighters(this.state).length) return failure('UNIT_NOT_ELIGIBLE');
      fight.step = 'CONSOLIDATE';
    } else if (fight.step === 'CONSOLIDATE') {
      if (this.consolidateUnits().length) return failure('UNIT_NOT_ELIGIBLE');
      fight.step = 'END';
    } else return failure('WRONG_FIGHT_STEP');
    return success();
  }
  beginPileIn(unitId: string, targetIds: string[] = []): CommandResult { return this.beginTacticalMove('pile-in', unitId, targetIds); }
  beginConsolidation(unitId: string, targetIds: string[] = []): CommandResult { return this.beginTacticalMove('consolidate', unitId, targetIds); }
  private beginTacticalMove(kind: 'pile-in' | 'consolidate' | 'overrun', unitId: string, targetIds: string[]): CommandResult {
    const phase = this.phase('Fight'); if (!phase.ok) return phase;
    const fight = this.combat.fight;
    const expected = kind === 'pile-in' ? 'PILE_IN' : kind === 'consolidate' ? 'CONSOLIDATE' : 'FIGHT';
    if (!fight || fight.step !== expected) return failure('WRONG_FIGHT_STEP');
    if (this.combat.move) return failure('COMBAT_IN_PROGRESS');
    const unit = this.state.units.find(u => u.id === unitId); if (!unit) return failure('UNIT_NOT_FOUND');
    if (kind === 'overrun') {
      if (fight.selected?.unitId !== unitId || fight.selected.overrunDone || fight.selected.usedModelIds.length) return failure('UNIT_NOT_ELIGIBLE');
      if (isUnitEngaged(this.state, unit) && fight.engagedAtFightStart.includes(unitId)) return failure('UNIT_NOT_ELIGIBLE');
    } else {
      const eligible = kind === 'pile-in' ? this.pileInUnits() : this.consolidateUnits();
      if (!eligible.some(u => u.id === unitId)) return failure('UNIT_NOT_ELIGIBLE');
      if (eligible[0]!.playerId !== unit.playerId) return failure('WRONG_FIGHT_PLAYER');
    }
    const engaged = engagedTargets(this.state, unit);
    const ids = engaged.length ? engaged.map(u => u.id) : targetIds;
    const extended=effectiveFlag(this.state,unit.id,'EXTENDED_TACTICAL_MOVE');
    const violent=kind==='consolidate' && effectiveFlag(this.state,unit.id,'EXTENDED_ENGAGING_CONSOLIDATE');
    const maximum = extended ? 8 : violent ? 6 : kind === 'consolidate' ? COMBAT_RULES.consolidate : COMBAT_RULES.pileInTargetDistance;
    if (!ids.length || new Set(ids).size !== ids.length) return failure('TARGETS_REQUIRED');
    if (ids.some(id => !enemies(this.state, unit).some(e => e.id === id && (engaged.length || unitDistance(unit, e) <= maximum + EPSILON)))) return failure('UNREACHABLE_TARGET');
    if (kind === 'overrun') this.emit(unitId, { type: 'overrun-fight' });
    return this.startMove(kind, unitId, ids, extended || violent ? 6 : kind === 'consolidate' ? COMBAT_RULES.consolidate : COMBAT_RULES.pileIn);
  }
  /** Pile-in and consolidation are optional. Explicitly passing consumes that opportunity. */
  skipTacticalMove(unitId: string): CommandResult {
    const phase = this.phase('Fight'); if (!phase.ok) return phase;
    if (this.combat.move) return failure('COMBAT_IN_PROGRESS');
    const fight = this.combat.fight;
    if (!fight || !['PILE_IN', 'CONSOLIDATE'].includes(fight.step)) return failure('WRONG_FIGHT_STEP');
    const units = fight.step === 'PILE_IN' ? this.pileInUnits() : this.consolidateUnits();
    const unit = units.find(u => u.id === unitId); if (!unit) return failure('UNIT_NOT_ELIGIBLE');
    if (units[0]!.playerId !== unit.playerId) return failure('WRONG_FIGHT_PLAYER');
    (fight.step === 'PILE_IN' ? fight.pileInDone : fight.consolidateDone).push(unitId);
    return success();
  }
  selectFightUnit(unitId: string): CommandResult {
    if (this.state.fightOnDeath?.length) return failure('PENDING_RESOLUTION');
    const phase = this.phase('Fight'); if (!phase.ok) return phase;
    const fight = this.combat.fight;
    if (!fight || fight.step !== 'FIGHT') return failure('WRONG_FIGHT_STEP');
    if (fight.selected || this.combat.move) return failure('COMBAT_IN_PROGRESS');
    const selection = nextFightSelection(this.state);
    if (!selection?.unitIds.includes(unitId)) return failure('UNIT_NOT_ELIGIBLE');
    const previousPlayerId = fight.nextPlayerId, previousCategory = fight.category;
    fight.category = selection.category; fight.nextPlayerId = otherPlayer(this.state, selection.playerId);
    fight.selected = { unitId, usedModelIds: [], hasRolled: false, overrunDone: false, previousPlayerId, previousCategory };
    this.emit(unitId, { type: 'fight-unit-selected' }); return success();
  }
  chooseExquisiteSwordsmanship(choice: 'LETHAL_HITS' | 'SUSTAINED_HITS'): CommandResult {
    const selected=this.combat.fight?.selected;
    if (!selected || this.state.phase !== 'Fight') return failure('NO_FIGHT_SELECTED');
    const unit=this.unit(selected.unitId);
    if (!unit.state.hasCharged || !hasFactionRule(this.state,unit,'EXQUISITE_SWORDSMANSHIP')) return failure('UNIT_NOT_ELIGIBLE');
    if (selected.exquisiteChoice || selected.hasRolled) return failure('IRREVERSIBLE_ACTION');
    if (!['LETHAL_HITS','SUSTAINED_HITS'].includes(choice)) return failure('INVALID_ABILITY_CHOICE');
    selected.exquisiteChoice=choice;
    return success();
  }
  selectMeleeTarget(weaponId:string,targetUnitId:string): CommandResult {
    const selected=this.combat.fight?.selected;
    if(!selected || this.state.phase!=='Fight') return failure('NO_FIGHT_SELECTED');
    if(selected.selectedTarget) return failure('TARGET_SELECTION_LOCKED');
    const unit=this.unit(selected.unitId),target=this.state.units.find(u=>u.id===targetUnitId);
    if(!target || target.playerId===unit.playerId || !living(target).length) return failure('TARGET_NOT_ENEMY');
    const weapon=definitionFor(this.state,unit).weapons.find(w=>w.id===weaponId);
    if(!weapon || weapon.kind!=='melee') return failure('WEAPON_NOT_MELEE');
    if(!getModelsEligibleToFight(this.state,unit,target).some(m=>modelHasWeapon(this.state,unit,m,weaponId) && !selected.usedModelIds.includes(m.id))) return failure('NO_ELIGIBLE_FIGHTERS');
    selected.selectedTarget={weaponId,targetUnitId};return success();
  }
  beginOverrun(targetIds: string[]): CommandResult {
    const selected = this.combat.fight?.selected; if (!selected) return failure('NO_FIGHT_SELECTED');
    return this.beginTacticalMove('overrun', selected.unitId, targetIds);
  }
  meleeAttack(weaponId: string, targetUnitId: string, rng: RandomSource, allocation?: DamageAllocationPolicy, precisionModelId?: string, pause?: (s: GameState, trigger: Parameters<RollWindow>[0], job: AttackJob) => boolean): CommandResult<WeaponResolution> {
    const phase = this.phase('Fight'); if (!phase.ok) return phase;
    const selected = this.combat.fight?.selected; if (!selected) return failure('NO_FIGHT_SELECTED');
    if (this.combat.move) return failure('COMBAT_IN_PROGRESS');
    const unit = this.unit(selected.unitId), target = this.state.units.find(u => u.id === targetUnitId);
    if (!target) return failure('TARGET_NOT_FOUND');
    if (target.playerId === unit.playerId) return failure('TARGET_NOT_ENEMY');
    if (!living(target).length) return failure('TARGET_DESTROYED');
    const weapon = definitionFor(this.state, unit).weapons.find(w => w.id === weaponId);
    if (!weapon) return failure('WEAPON_NOT_FOUND');
    if (weapon.kind !== 'melee') return failure('WEAPON_NOT_MELEE');
    if(this.state.flow && this.state.factionRuleIds && (selected.selectedTarget?.weaponId!==weaponId || selected.selectedTarget?.targetUnitId!==targetUnitId)) return failure('TARGET_SELECTION_REQUIRED');
    const models = getModelsEligibleToFight(this.state, unit, target).filter(m => (hasWeaponAbility(weapon, 'EXTRA_ATTACKS') ? !selected.extraWeaponsUsed?.includes(`${m.id}|${weapon.id}`) : !selected.usedModelIds.includes(m.id)) && (!hasWeaponAbility(weapon, 'ONE_SHOT') || !m.oneShotExpended?.includes(weaponInstanceId(this.state, unit, m, weapon))) && modelHasWeapon(this.state, unit, m, weaponId));
    if (!models.length) return failure('NO_ELIGIBLE_FIGHTERS');
    if (unit.state.hasCharged && hasFactionRule(this.state,unit,'EXQUISITE_SWORDSMANSHIP') && !selected.exquisiteChoice) return failure('ABILITY_CHOICE_REQUIRED');
    const choices = selected.attackChoices?.[weaponId] ?? {};
    try { resolvedAbilities(this.state, target, weapon, choices); } catch { return failure('ABILITY_CHOICE_REQUIRED'); }
    const job = createAttackJob(weapon, models.map(m => m.id), target, definitionFor(this.state, target), rng, [], this.state, precisionModelId, choices);
    if (selected.exquisiteChoice) for (const context of job.contexts) context.abilities.push({
      id: `exquisite-swordsmanship:${context.attackerModelId}`, type: selected.exquisiteChoice,
      ...(selected.exquisiteChoice === 'SUSTAINED_HITS' ? { value: 1 } : {}), source: 'EXQUISITE_SWORDSMANSHIP' });
    if (hasWeaponAbility(weapon, 'EXTRA_ATTACKS')) { selected.extraWeaponsUsed ??= []; selected.extraWeaponsUsed.push(...models.map(m => `${m.id}|${weapon.id}`)); }
    else selected.usedModelIds.push(...models.map(m => m.id));
    for (const model of models) if (hasWeaponAbility(weapon, 'ONE_SHOT')) { model.oneShotExpended ??= []; model.oneShotExpended.push(weaponInstanceId(this.state, unit, model, weapon)); }
    if (hasWeaponAbility(weapon, 'HAZARDOUS')) selected.hazardousCount = (selected.hazardousCount ?? 0) + models.length;
    selected.hasRolled = true;
    this.emit(unit.id, { type: 'melee-attack-started', weaponId, targetUnitId });
    const complete = runAttackJob(job, rng, this.state, (t, j) => pause?.(this.state, t, j) ?? false, allocation);
    this.state.units = this.state.units.map(u => u.id === target.id ? job.target : u);
    if (complete && effectiveFlag(this.state,target.id,'FIGHT_ON_DEATH') && !target.state.hasFought && !this.combat.fight?.fought.includes(target.id)) {
      const slain=job.resolution.destroyedModelIds.filter(id=>target.models.some(m=>m.id===id));
      if(slain.length) {
        this.state.fightOnDeath ??= [];
        const pending=this.state.fightOnDeath.find(p=>p.defenderUnitId===target.id && p.attackerUnitId===unit.id);
        if(pending) pending.modelIds.push(...slain.filter(id=>!pending.modelIds.includes(id)));
        else this.state.fightOnDeath.push({defenderUnitId:target.id,attackerUnitId:unit.id,modelIds:[...new Set(slain)]});
      }
    }
    if (complete) { delete selected.selectedTarget; this.emit(unit.id, { type: 'melee-attack-resolved', resolution: job.resolution }); }
    else this.state.attackJob = job;
    return { ok: true, value: job.resolution };
  }

  cancelFightUnit(): CommandResult {
    const phase = this.phase('Fight'); if (!phase.ok) return phase;
    const fight = this.combat.fight, selected = fight?.selected;
    if (!fight || !selected) return failure('NO_FIGHT_SELECTED');
    if (this.combat.move) return failure('COMBAT_IN_PROGRESS');
    if (selected.hasRolled || selected.overrunDone || selected.usedModelIds.length || !selected.previousPlayerId || !selected.previousCategory) return failure('IRREVERSIBLE_ACTION');
    fight.nextPlayerId = selected.previousPlayerId; fight.category = selected.previousCategory;
    fight.selected = null; this.emit(selected.unitId, { type: 'fight-unit-cancelled' }); return success();
  }
  completeFightUnit(): CommandResult {
    const phase = this.phase('Fight'); if (!phase.ok) return phase;
    const fight = this.combat.fight; if (!fight?.selected) return failure('NO_FIGHT_SELECTED');
    if(fight.selected.selectedTarget) return failure('TARGET_SELECTION_LOCKED');
    if (this.combat.move) return failure('COMBAT_IN_PROGRESS');
    const unit = this.unit(fight.selected.unitId);
    const selected = fight.selected;
    for (const target of this.state.units.filter(u => u.playerId !== unit.playerId)) for (const m of getModelsEligibleToFight(this.state, unit, target)) {
      const weapons = definitionFor(this.state, unit).weapons.filter(w => w.kind === 'melee' && modelHasWeapon(this.state, unit, m, w.id));
      if (weapons.some(w => hasWeaponAbility(w, 'EXTRA_ATTACKS') && !selected.extraWeaponsUsed?.includes(`${m.id}|${w.id}`)) || (selected.extraWeaponsUsed?.some(id => id.startsWith(`${m.id}|`)) && !selected.usedModelIds.includes(m.id) && weapons.some(w => !hasWeaponAbility(w, 'EXTRA_ATTACKS')))) return failure('EXTRA_ATTACKS_PENDING');
    }
    fight.fought.push(unit.id); unit.state.hasFought = true; fight.selected = null;
    if(this.state.fightOnDeath) this.state.fightOnDeath=this.state.fightOnDeath.filter(p=>living(this.unit(p.attackerUnitId)).length>0);
    this.emit(unit.id, { type: 'fight-unit-completed' }); return success();
  }
  /** Destroyed models resolve once, after the attacking unit has completed its full activation. */
  resolveFightOnDeath(defenderUnitId:string,weaponId:string,rng:RandomSource, allocation?:DamageAllocationPolicy):CommandResult<WeaponResolution> {
    const pending=this.state.fightOnDeath?.[0];
    if(!pending || pending.defenderUnitId!==defenderUnitId || !this.combat.fight?.fought.includes(pending.attackerUnitId)) return failure('PENDING_RESOLUTION');
    const defender=this.unit(defenderUnitId),target=this.unit(pending.attackerUnitId);
    if(!living(target).length) return failure('TARGET_DESTROYED');
    const weapon=definitionFor(this.state,defender).weapons.find(w=>w.id===weaponId && w.kind==='melee');
    if(!weapon) return failure('WEAPON_NOT_MELEE');
    const fighters=pending.modelIds.filter(id=>defender.models.some(m=>m.id===id && modelHasWeapon(this.state,defender,m,weaponId)));
    if(!fighters.length) return failure('NO_ELIGIBLE_FIGHTERS');
    const job=createAttackJob(weapon,fighters,target,definitionFor(this.state,target),rng,[],this.state);
    this.emit(defender.id,{type:'melee-attack-started',weaponId,targetUnitId:target.id});
    runAttackJob(job,rng,this.state,undefined,allocation);
    this.state.units=this.state.units.map(u=>u.id===target.id?job.target:u);
    pending.modelIds=pending.modelIds.filter(id=>!fighters.includes(id));
    if(!pending.modelIds.length) this.state.fightOnDeath!.shift();
    this.emit(defender.id,{type:'melee-attack-resolved',resolution:job.resolution});
    if(this.state.flow) flowEvent(this.state,'FIGHT_ON_DEATH_RESOLVED',{attackerUnitId:target.id,modelIds:fighters,weaponId},defender.id,defender.playerId);
    return {ok:true,value:job.resolution};
  }
}
