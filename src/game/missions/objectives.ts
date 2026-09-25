import { effectiveCharacteristic } from '../effects/EffectEngine';
import { modelDefinition } from '../attachments/queries';
import { onBattlefield } from '../reserves/location';
import { baseIntersectsPolygon } from '../terrain/geometry';
import { baseRadius, centreDistance, EPSILON } from '../utils/geometry';
import { flowEvent } from '../flow/events';
import type { GameState, Model, Unit } from '../models';
import type { ObjectiveState } from './types';
export function modelWithinObjective(s: GameState, m: Model, o: ObjectiveState): boolean {
  if (o.type === 'TERRAIN_OBJECTIVE') {
    const area = s.battlefield.terrain?.areas.find(a => a.id === o.terrainAreaId);
    if (!area) throw new Error('Mission terrain area missing');
    return baseIntersectsPolygon(m, area.footprint);
  }
  return !!o.position && centreDistance(m.position, o.position) <= (o.markerRange ?? 0) + baseRadius(m.base) + EPSILON;
}
export function effectiveModelOC(s: GameState, u: Unit, m: Model): number {
  if (!m.alive || !onBattlefield(u) || u.state.battleShocked) return 0;
  return effectiveCharacteristic(s, u.id, 'OC', modelDefinition(s, u, m).stats.objectiveControl, m.id);
}
export function calculateLevelOfControl(s: GameState, o: ObjectiveState, playerId: string): number {
  return s.units.filter(u => u.playerId === playerId && onBattlefield(u)).reduce((sum, u) => sum +
    u.models.filter(m => m.alive && modelWithinObjective(s, m, o)).reduce((n, m) => n + effectiveModelOC(s, u, m), 0), 0);
}
/** Secured control breaks only on a phase-end comparison, per core rules 14.03. */
export function resolveObjectiveControl(s: GameState, o: ObjectiveState, phaseEnd = false): string | null {
  const a = calculateLevelOfControl(s, o, s.players[0].id), b = calculateLevelOfControl(s, o, s.players[1].id);
  const old = o.controllingPlayerId, secured = o.securedByPlayerId;
  if (secured && phaseEnd && (secured === s.players[0].id ? b > a : a > b)) {
    o.securedByPlayerId = null; delete o.securedAtRound; delete o.securedAtTurn; delete o.securedSource;
    flowEvent(s, 'OBJECTIVE_LOST', { objectiveId: o.id, playerId: secured }, '', secured);
  }
  const winner = o.securedByPlayerId ?? (a > b && a > 0 ? s.players[0].id : b > a && b > 0 ? s.players[1].id : null);
  o.controllingPlayerId = winner;
  if (old !== winner) flowEvent(s, 'OBJECTIVE_CONTROL_CHANGED', { objectiveId: o.id, previous: old ?? '', next: winner ?? '' });
  if (!winner && old && a === b) flowEvent(s, 'OBJECTIVE_CONTESTED', { objectiveId: o.id });
  return winner;
}
export function secureObjective(s: GameState, objectiveId: string, playerId: string, source: string) {
  const objective = s.mission?.objectives.find(o => o.id === objectiveId);
  if (!objective || !s.players.some(p => p.id === playerId) || !source) return false;
  if (objective.controllingPlayerId !== playerId || objective.securedByPlayerId) return false;
  objective.securedByPlayerId = playerId; objective.securedAtRound = s.round; objective.securedAtTurn = s.turn; objective.securedSource = source;
  flowEvent(s, 'OBJECTIVE_SECURED', { objectiveId, source }, '', playerId);
  return true;
}
