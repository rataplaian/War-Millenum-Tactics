import type { GameState, Unit, CommandResult } from '../models';
import type { IngressMethod, ReserveRules } from '../setup/types';
import { locationOf } from './location';
export const DEFAULT_RESERVE_RULES: Readonly<ReserveRules> = Object.freeze({ strategicReservePointsLimitRatio: 0.5, standardIngressMinimumRound: 2, ingressEdgeDistance: 6, enemySetupDistance: 8, infiltratorZoneDistance: 8, scoutEnemyDistance: 8, enemyZoneAllowedRound: 3, reserveExpirationRound: 3 });
export const reserveRules = (s: GameState): ReserveRules => s.deployment?.rules ?? { ...DEFAULT_RESERVE_RULES };
export interface ReservePolicy {
  canIngress?: (state: GameState, unit: Unit, method: IngressMethod) => CommandResult;
  shouldDestroyUnarrived?: (state: GameState, unit: Unit) => boolean;
  shouldDestroyAtEnd?: (state: GameState, unit: Unit) => boolean;
}
export function shouldDestroyUnarrivedReserveUnit(_s: GameState, u: Unit): boolean {
  return locationOf(u) === 'STRATEGIC_RESERVES' && !u.reserve?.repositioned && !u.reserve?.transportHasIngressed && !(u.reserve?.ingressCount);
}
export const shouldDestroyReserveAtBattleEnd = (_s: GameState, u: Unit) => ['RESERVES', 'STRATEGIC_RESERVES'].includes(locationOf(u));
export function reservePoints(s: GameState, playerId: string) {
  const ids = s.deployment?.initialReserveIds ?? [];
  return { used: s.units.filter(u => u.playerId === playerId && (ids.includes(u.id) || (u.location === 'EMBARKED' && ids.includes(u.embarked!.transportId)))).reduce((n, u) => n + (s.definitions.find(d => d.id === u.definitionId)!.points ?? 0), 0), limit: (s.deployment?.pointsLimit ?? 0) * reserveRules(s).strategicReservePointsLimitRatio };
}
