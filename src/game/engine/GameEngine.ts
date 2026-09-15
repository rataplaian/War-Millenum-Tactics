import type { CommandResult, GameState, MovementEvent, Position } from '../models';
import { advancePhase, advanceTurn } from '../rules/progression';
import { failure, movementPhaseError, validateBeginMovement, validateFinalPosition, validateModelMove } from '../rules/movement';
import { checkCoherency } from '../rules/spatial';
import { validateState } from './validateState';
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
type EventPayload = MovementEvent extends infer E ? E extends MovementEvent ?
  Omit<E, 'sequence' | 'round' | 'turn' | 'playerId' | 'unitId'> : never : never;
export class GameEngine {
  private state: GameState;
  constructor(initialState: GameState) { validateState(initialState); this.state = copy(initialState); }
  static create(initialState: GameState): GameEngine { return new GameEngine(initialState); }
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
    this.state = transition(this.state);
    return { ok: true, value: this.getState() };
  }
  private event(unitId: string, payload: EventPayload): void {
    this.state.events.push(copy({ ...payload, sequence: this.state.events.length + 1,
      round: this.state.round, turn: this.state.turn, playerId: this.state.activePlayerId, unitId } as MovementEvent));
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
  previewMove(modelId: string, target: Position) { return validateModelMove(this.state, modelId, target); }
  moveModel(modelId: string, target: Position) {
    const result = this.previewMove(modelId, target);
    if (!result.ok) return result;
    const unit = this.state.units.find(u => u.id === this.state.movement!.unitId)!;
    const model = unit.models.find(m => m.id === modelId)!;
    const from = { ...model.position };
    model.position = { ...target };
    model.movementUsed = result.value.totalUsed;
    this.event(unit.id, { type: 'model-moved', modelId, from, to: { ...target },
      distance: result.value.distance, totalUsed: result.value.totalUsed });
    return result;
  }
  cancelMovement(): CommandResult {
    const error = movementPhaseError(this.state);
    if (error) return error;
    const transaction = this.state.movement;
    if (!transaction) return failure('NO_ACTIVE_MOVEMENT');
    const unit = this.state.units.find(u => u.id === transaction.unitId)!;
    for (const original of transaction.originals) {
      const model = unit.models.find(m => m.id === original.modelId)!;
      model.position = { ...original.position };
      model.movementUsed = original.movementUsed;
    }
    this.state.movement = null;
    this.event(unit.id, { type: 'movement-cancelled', restored: transaction.originals.map(o => ({ modelId: o.modelId, position: { ...o.position } })) });
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
}
