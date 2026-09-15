import type { GameState } from '../models';
import { PHASES } from '../models';
import { advancePhase, advanceTurn } from '../rules/progression';
const copy = (state: GameState): GameState => JSON.parse(JSON.stringify(state));
/** Validates trusted typed snapshots; untrusted JSON will need a full schema parser later. */
function validate(state: GameState): void {
  if (state.schemaVersion !== 1 || !state.id || !Number.isSafeInteger(state.round) || state.round < 1 ||
      !Number.isSafeInteger(state.turn) || state.turn < 1 || !PHASES.includes(state.phase) ||
      !['in-progress', 'finished'].includes(state.status)) throw new Error('Invalid match state');
  if (state.players.length !== 2 || new Set(state.players.map(p => p.id)).size !== 2 ||
      state.players.some(p => !p.id || !p.factionId) || !state.players.some(p => p.id === state.activePlayerId)) throw new Error('Invalid players');
  if (state.round !== Math.floor((state.turn - 1) / 2) + 1 || state.activePlayerId !== state.players[(state.turn - 1) % 2]!.id) throw new Error('Inconsistent turn');
  const ids = [...state.armies.map(a => a.id), ...state.units.map(u => u.id), ...state.units.flatMap(u => u.models.map(m => m.id))];
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) throw new Error('Duplicate or empty entity IDs');
  if (state.armies.length !== 2 || state.players.some(p => state.armies.filter(a => a.playerId === p.id && a.factionId === p.factionId).length !== 1)) throw new Error('Invalid armies');
  const references = state.armies.flatMap(a => a.unitIds);
  if (references.length !== state.units.length || new Set(references).size !== references.length || references.some(id => !state.units.some(u => u.id === id))) throw new Error('Invalid unit references');
  for (const unit of state.units) {
    const army = state.armies.find(a => a.unitIds.includes(unit.id));
    if (!army || army.playerId !== unit.playerId || army.factionId !== unit.factionId || unit.models.length !== unit.modelCount || unit.modelCount < 1) throw new Error('Invalid unit ownership or model count');
    for (const model of unit.models) {
      if (model.unitId !== unit.id || !Number.isInteger(model.woundsRemaining) || model.woundsRemaining < 0 || model.woundsRemaining > unit.stats.wounds ||
          model.alive !== (model.woundsRemaining > 0) || !Number.isFinite(model.position.x) || !Number.isFinite(model.position.y)) throw new Error('Invalid model');
    }
  }
}
export class GameEngine {
  private state: GameState;
  constructor(initialState: GameState) { validate(initialState); this.state = copy(initialState); }
  static create(initialState: GameState): GameEngine { return new GameEngine(initialState); }
  loadMatch(snapshot: GameState): void { validate(snapshot); this.state = copy(snapshot); }
  getState(): GameState { return copy(this.state); }
  nextPhase(): GameState { this.state = advancePhase(this.state); return this.getState(); }
  nextTurn(): GameState { this.state = advanceTurn(this.state); return this.getState(); }
}
