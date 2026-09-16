import type { GameState, Unit } from '../models';
import { hasFightsFirst, living } from './closeCombat';
import { isUnitEngaged } from './spatial';
export const otherPlayer = (state: GameState, playerId: string) => state.players.find(p => p.id !== playerId)!.id;
export function eligibleFighters(state: GameState): Unit[] {
  const fight = state.closeCombat?.fight;
  if (!fight) return [];
  return state.units.filter(u => living(u).length && !fight.fought.includes(u.id) &&
    (isUnitEngaged(state, u) || fight.eligibleAtFightStart.includes(u.id) || u.state.hasCharged));
}
/** Pure controller. Carry the next selector across category boundaries; skip empty sides. */
export function nextFightSelection(state: GameState) {
  const fight = state.closeCombat?.fight;
  if (!fight) return null;
  const eligible = eligibleFighters(state);
  if (!eligible.length) return null;
  const first = eligible.filter(u => hasFightsFirst(state, u));
  const category = first.length ? 'FIGHTS_FIRST' as const : 'REMAINING_COMBATS' as const;
  const pool = first.length ? first : eligible;
  const playerId = pool.some(u => u.playerId === fight.nextPlayerId) ? fight.nextPlayerId : otherPlayer(state, fight.nextPlayerId);
  return { category, playerId, unitIds: pool.filter(u => u.playerId === playerId).map(u => u.id) };
}
