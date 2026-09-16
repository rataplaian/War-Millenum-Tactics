import { actionBusy, battleStarted } from '../reserves/location';
import { PHASES, type GameState } from '../models';
import { freshUnitState } from '../engine/createUnit';
/** Turn/phase transitions; GameEngine guards unfinished Fight steps before calling these. */
export function advanceTurn(state: GameState): GameState {
  if (!battleStarted(state) || actionBusy(state)) throw new Error('Unfinished action or pre-battle');
  if (state.closeCombat?.charge || state.closeCombat?.move) throw new Error('Complete combat action before progression');
  if (state.shooting) throw new Error('Complete or cancel shooting before progression');
  if (state.movement) throw new Error('Complete or cancel movement before progression');
  if (state.status !== 'in-progress') throw new Error('Match is finished');
  const index = state.players.findIndex(player => player.id === state.activePlayerId);
  const next = (index + 1) % 2;
  return { ...state, closeCombat: undefined, activePlayerId: state.players[next]!.id, phase: 'Command', turn: state.turn + 1,
    round: state.round + (state.players[next]!.id === (state.deployment?.firstTurnPlayerId ?? state.players[0].id) ? 1 : 0), units: state.units.map(unit => ({ ...unit, state: { ...freshUnitState(), ...(unit.state.battleShocked === undefined ? {} : { battleShocked: unit.state.battleShocked }) }, models: unit.models.map(model => ({ ...model, movementUsed: 0 })) })) };
}
export function advancePhase(state: GameState): GameState {
  if (!battleStarted(state) || actionBusy(state)) throw new Error('Unfinished action or pre-battle');
  if (state.closeCombat?.charge || state.closeCombat?.move) throw new Error('Complete combat action before progression');
  if (state.shooting) throw new Error('Complete or cancel shooting before progression');
  if (state.movement) throw new Error('Complete or cancel movement before progression');
  if (state.status !== 'in-progress') throw new Error('Match is finished');
  const index = PHASES.indexOf(state.phase);
  if (index === PHASES.length - 1) return advanceTurn(state);
  return { ...state, phase: PHASES[index + 1]! };
}
