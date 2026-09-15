import { PHASES, type GameState } from '../models';
import { freshUnitState } from '../engine/createUnit';
/** Prototype sequencing only: no eligibility, combat, reactions or victory rules yet. */
export function advanceTurn(state: GameState): GameState {
  if (state.movement) throw new Error('Complete or cancel movement before progression');
  if (state.status !== 'in-progress') throw new Error('Match is finished');
  const index = state.players.findIndex(player => player.id === state.activePlayerId);
  const next = (index + 1) % 2;
  return { ...state, activePlayerId: state.players[next]!.id, phase: 'Command', turn: state.turn + 1,
    round: state.round + (next === 0 ? 1 : 0), units: state.units.map(unit => ({ ...unit, state: freshUnitState(), models: unit.models.map(model => ({ ...model, movementUsed: 0 })) })) };
}
export function advancePhase(state: GameState): GameState {
  if (state.movement) throw new Error('Complete or cancel movement before progression');
  if (state.status !== 'in-progress') throw new Error('Match is finished');
  const index = PHASES.indexOf(state.phase);
  if (index === PHASES.length - 1) return advanceTurn(state);
  return { ...state, phase: PHASES[index + 1]! };
}
