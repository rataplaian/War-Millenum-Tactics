import type { CommandResult, GameState } from '../models';
import { failure } from '../rules/movement';
import { actionBusy, battleStarted, onBattlefield, locationOf } from './location';
import { reserveRules, shouldDestroyReserveAtBattleEnd, shouldDestroyUnarrivedReserveUnit, type ReservePolicy } from './ReservePolicy';
import { setupEvent } from '../setup/events';
/** Generic removal hook: the caller supplying a future ability is responsible for its trigger/cost. */
export function moveUnitToReserves(s: GameState, unitId: string, reason: string, location: 'STRATEGIC_RESERVES' | 'RESERVES' = 'STRATEGIC_RESERVES'): CommandResult {
  if (s.status !== 'in-progress') return failure('MATCH_FINISHED');
  if (!battleStarted(s)) return failure('PRE_BATTLE');
  if (actionBusy(s)) return failure('SETUP_IN_PROGRESS');
  const u = s.units.find(u => u.id === unitId); if (!u) return failure('UNIT_NOT_FOUND');
  if (!onBattlefield(u) || !u.models.some(m => m.alive)) return failure('NOT_ON_BATTLEFIELD');
  if (!reason.trim() || !['RESERVES', 'STRATEGIC_RESERVES'].includes(location)) return failure('INVALID_CONFIGURATION');
  u.location = location;
  u.reserve = { initial: false, repositioned: true, reason, enteredTurn: s.turn, ingressCount: u.reserve?.ingressCount ?? 0 };
  setupEvent(s, u, 'unit-repositioned-to-reserves', { reason, method: location });
  return { ok: true, value: undefined };
}
export function resolveReserveExpiration(s: GameState, completedRound: number, policy: ReservePolicy = {}, endBattle = false): void {
  if (!endBattle && completedRound < reserveRules(s).reserveExpirationRound) return;
  const shouldDestroy = endBattle ? policy.shouldDestroyAtEnd ?? shouldDestroyReserveAtBattleEnd : policy.shouldDestroyUnarrived ?? shouldDestroyUnarrivedReserveUnit;
  for (const u of s.units) if ((endBattle ? ['RESERVES', 'STRATEGIC_RESERVES'].includes(locationOf(u)) : locationOf(u) === 'STRATEGIC_RESERVES') && shouldDestroy(s, u)) {
    u.location = 'DESTROYED'; delete u.moveLock;
    for (const m of u.models) { m.alive = false; m.woundsRemaining = 0; }
    for (const passenger of s.units.filter(p => p.embarked?.transportId === u.id)) {
      passenger.location = 'DESTROYED'; delete passenger.embarked; delete passenger.moveLock;
      for (const m of passenger.models) { m.alive = false; m.woundsRemaining = 0; }
      setupEvent(s, passenger, 'reserve-unit-destroyed', { reason: 'parent-never-arrived' });
    }
    setupEvent(s, u, 'reserve-unit-destroyed', { reason: endBattle ? 'end-of-battle' : 'arrival-deadline' });
  }
}
