import { recordTerrainChanges } from '../terrain/events';
import { createVisibilityProvider, type VisibilityProviderFactory } from '../terrain/visibility';
import { getDetectionRange, type DetectionRangePolicy, areasForModel, isModelHidden } from '../terrain/rules';
import { shootingModifiers } from '../terrain/attackModifiers';
import { elevation } from '../terrain/geometry';
import { CloseCombatController } from './CloseCombatController';
import { getLegalChargeTargets, type ChargeExceptions } from '../rules/closeCombat';
import type { CommandResult, GameState, GameEvent, MovementPath, Position, WeaponResolution } from '../models';
import { advancePhase, advanceTurn } from '../rules/progression';
import { failure, movementPhaseError, validateBeginMovement, validateFinalPosition, validateModelMove } from '../rules/movement';
import { checkCoherency, isUnitEngaged } from '../rules/spatial';
import { validateState } from './validateState';
import { availableRangedWeapons, legalShootingTargets, shootingPhaseError, validateRangedWeapon, validateShootingTarget } from '../rules/shootingTargets';
import { definitionFor } from '../rules/movement';
import { type VisibilityPolicy } from '../rules/visibility';
import { allocateDamage, type DamageAllocationPolicy } from '../rules/damageAllocation';
import { resolveShooting } from '../rules/resolveShooting';
import type { RandomSource } from '../utils/dice';
export interface EnginePolicies { visibility?: VisibilityPolicy; visibilityProvider?: VisibilityProviderFactory; detectionRange?: DetectionRangePolicy; damageAllocation?: DamageAllocationPolicy; chargeExceptions?: (state: GameState, unitId: string) => ChargeExceptions }

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
  tryNextTurn(): CommandResult<GameState> { return this.progress(advanceTurn); }
  private progress(transition: (state: GameState) => GameState): CommandResult<GameState> {
    if (this.state.status !== 'in-progress') return failure('MATCH_FINISHED');
    if (this.state.movement) return failure('MOVEMENT_IN_PROGRESS');
    if (this.state.shooting) return failure('SHOOTING_IN_PROGRESS');
    if (this.state.closeCombat?.charge || this.state.closeCombat?.move) return failure('COMBAT_IN_PROGRESS');
    if (this.state.phase === 'Fight' && this.state.closeCombat?.fight && this.state.closeCombat.fight.step !== 'END') return failure('WRONG_FIGHT_STEP');
    if (this.state.phase === 'Fight' && !this.state.closeCombat?.fight && this.state.units.some(u => u.state.hasCharged || isUnitEngaged(this.state, u))) return failure('WRONG_FIGHT_STEP');
    const before = this.getState();
    this.state = transition(this.state);
    recordTerrainChanges(before, this.state);
    return { ok: true, value: this.getState() };
  }
  private event(unitId: string, payload: EventPayload): void {
    this.state.events.push(copy({ ...payload, sequence: this.state.events.length + 1,
      round: this.state.round, turn: this.state.turn, playerId: this.state.activePlayerId, unitId } as GameEvent));
  }
  beginMovement(unitId: string): CommandResult {
    const result = validateBeginMovement(this.state, unitId);
    if (!result.ok) return result;
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
  completeMovement(): CommandResult {
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
    unit.state.hasMoved = true;
    this.state.movement = null;
    this.event(unit.id, { type: 'movement-completed' });
    return { ok: true, value: undefined };
  }
  beginShooting(unitId: string): CommandResult {
    const error = shootingPhaseError(this.state);
    if (error) return error;
    if (this.state.shooting) return failure('SHOOTING_IN_PROGRESS');
    const weapons = availableRangedWeapons(this.state, unitId);
    if (!weapons.ok) return weapons;
    this.state.shooting = { unitId, firedWeaponIds: [], hasRolled: false };
    this.event(unitId, { type: 'shooting-started' });
    return { ok: true, value: undefined };
  }
  getRangedWeapons(unitId: string) { return copy(availableRangedWeapons(this.state, unitId)); }
  getLegalTargets(unitId: string, weaponId: string) {
    return copy(legalShootingTargets(this.state, unitId, weaponId, this.visibility()));
  }
  fireWeapon(weaponId: string, targetUnitId: string, rng: RandomSource): CommandResult<WeaponResolution> {
    const error = shootingPhaseError(this.state);
    if (error) return error;
    const transaction = this.state.shooting;
    if (!transaction) return failure('NO_ACTIVE_SHOOTING');
    const provider = this.visibility();
    const legal = validateShootingTarget(this.state, transaction.unitId, weaponId, targetUnitId,
      provider);
    if (!legal.ok) return legal;
    const weapon = validateRangedWeapon(this.state, transaction.unitId, weaponId);
    if (!weapon.ok) return weapon;
    const target = this.state.units.find(u => u.id === targetUnitId)!;
    // Resolve against detached data. Rule rejections above consume no RNG; a broken RNG/policy
    // throws without partially changing battle state. External RNG state cannot be rolled back.
    const before = this.getState();
    const shooter = this.state.units.find(u => u.id === transaction.unitId)!;
    const modifiers = shooter.models.filter(m => legal.value.eligibleFiringModelIds.includes(m.id)).map(m => shootingModifiers(this.state, m, target, weapon.value.skill, provider));
    const outcome = resolveShooting(weapon.value, legal.value.eligibleFiringModelIds, copy(target),
      definitionFor(this.state, target), rng, this.policies.damageAllocation ?? allocateDamage, modifiers);
    this.state.units = this.state.units.map(u => u.id === target.id ? outcome.target : u);
    if (outcome.resolution.attacks > 0) shooter.lastRangedAttackTurnIndex = this.state.turn;
    transaction.firedWeaponIds.push(weaponId);
    transaction.hasRolled ||= outcome.resolution.hitRolls.length > 0 ||
      outcome.resolution.attackCounts.some(count => count.resolved.rolls.length > 0);
    this.event(transaction.unitId, { type: 'weapon-fired', resolution: outcome.resolution });
    for (const m of modifiers) for (const modifier of m.modifiers) this.event(transaction.unitId, { type: modifier.source === 'COVER' ? 'cover-applied' : 'plunging-fire-applied', modelId: m.modelId, targetUnitId, effectiveSkill: m.effectiveSkill });
    recordTerrainChanges(before, this.state);
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
    if (this.state.shooting.hasRolled) return failure('SHOOTING_ALREADY_RESOLVED');
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
    this.state.units.find(u => u.id === unitId)!.state.hasShot = true;
    this.state.shooting = null;
    this.event(unitId, { type: 'shooting-completed' });
    return { ok: true, value: undefined };
  }

  private combatCommand<T>(command: (controller: CloseCombatController) => CommandResult<T>): CommandResult<T> {
    const draft = this.getState();
    const result = command(new CloseCombatController(draft));
    if (result.ok) { recordTerrainChanges(this.state, draft); this.state = draft; }
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
  meleeAttack(weaponId: string, targetId: string, rng: RandomSource) {
    return this.combatCommand(c => c.meleeAttack(weaponId, targetId, rng, this.policies.damageAllocation));
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
    return copy({ models: snapshot.units.flatMap(u => u.models).filter(m => m.alive).map(m => ({ modelId: m.id, elevation: elevation(m.position), areaIds: areasForModel(snapshot, m).map(a => a.id), hidden: isModelHidden(snapshot, m), detectionRange: (this.policies.detectionRange ?? getDetectionRange)(m, snapshot) })),
      target: observer && target ? { visible: provider.isUnitVisible(observer, target), fullyVisible: provider.isUnitFullyVisible(observer, target),
        models: target.models.filter(m => m.alive).map(m => ({ modelId: m.id, ...provider.inspect(observer, m) })),
        attack: weapon ? shootingModifiers(snapshot, observer, target, weapon.skill, provider) : null } : null });
  }

}
