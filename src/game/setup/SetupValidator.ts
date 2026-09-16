import type { CommandResult, GameState, Model, Unit } from '../models';
import type { DeploymentZone, Formation, SetupConstraints } from './types';
import { baseSupported, baseIntersectsPolygon, distanceToPolygon } from '../terrain/geometry';
import { baseRadius, centreDistance, EPSILON } from '../utils/geometry';
import { validateFinalPosition, failure } from '../rules/movement';
import { checkCoherency } from '../rules/spatial';
import { onBattlefield } from '../reserves/location';
export const horizontalEdgeDistance = (a: Model, b: Model) => Math.max(0, centreDistance(a.position, b.position) - baseRadius(a.base) - baseRadius(b.base));
export const isModelInsideDeploymentZone = (m: Model, z: DeploymentZone) => baseSupported(m, z.footprint);
export const isUnitWhollyWithinDeploymentZone = (u: Unit, z: DeploymentZone) => u.models.some(m => m.alive) && u.models.filter(m => m.alive).every(m => isModelInsideDeploymentZone(m, z));
export type SetupRestriction = (state: GameState, unit: Unit) => CommandResult;
export interface SetupPolicy { extraRestriction?: SetupRestriction; /** Default rejects oversized bases. Future fallback remains centralized. */ largeModelEdgeFallback?: (state: GameState, unit: Unit, distance: number) => boolean }
export function whollyWithinSingleEdge(s: GameState, u: Unit, d: number) {
  const models = u.models.filter(m => m.alive);
  return [ (m: Model) => m.position.x + baseRadius(m.base), (m: Model) => s.battlefield.width - m.position.x + baseRadius(m.base),
    (m: Model) => m.position.y + baseRadius(m.base), (m: Model) => s.battlefield.height - m.position.y + baseRadius(m.base) ].some(distance => models.every(m => distance(m) <= d + EPSILON));
}
/** One validator for all setup methods. No mutation, implicit search or UI coordinates. */
export function validateSetup(s: GameState, unit: Unit, formation: Formation, constraints: SetupConstraints, policy: SetupPolicy = {}): CommandResult<Unit> {
  const alive = unit.models.filter(m => m.alive);
  if (!alive.length) return failure('NO_LIVING_MODELS');
  if (Object.keys(formation).length !== alive.length || alive.some(m => !formation[m.id])) return failure('INCOMPLETE_FORMATION');
  const candidate: Unit = { ...unit, location: 'BATTLEFIELD', models: unit.models.map(m => ({ ...m, position: formation[m.id] ?? m.position })) };
  const draft = { ...s, units: s.units.map(u => u.id === unit.id ? candidate : u) };
  const own = s.deployment?.zones.filter(z => z.playerId === unit.playerId) ?? [], enemyZones = s.deployment?.zones.filter(z => z.playerId !== unit.playerId) ?? [];
  for (const m of candidate.models.filter(m => m.alive)) {
    const legal = validateFinalPosition(draft, candidate, m, m.position, true); if (!legal.ok) return legal;
    if (constraints.enemyDistance !== undefined && s.units.filter(u => onBattlefield(u) && u.playerId !== unit.playerId).flatMap(u => u.models).some(e => e.alive && horizontalEdgeDistance(m, e) <= constraints.enemyDistance! + EPSILON)) return failure('TOO_CLOSE_TO_ENEMY');
    if (constraints.enemyZoneDistance !== undefined && enemyZones.some(z => distanceToPolygon(m.position, z.footprint) - baseRadius(m.base) <= constraints.enemyZoneDistance! + EPSILON)) return failure('TOO_CLOSE_TO_ENEMY_ZONE');
    if (constraints.excludeEnemyZone && enemyZones.some(z => baseIntersectsPolygon(m, z.footprint))) return failure('ENEMY_DEPLOYMENT_ZONE');
  }
  if (constraints.ownZone && !own.some(z => isUnitWhollyWithinDeploymentZone(candidate, z))) return failure('OUTSIDE_DEPLOYMENT_ZONE');
  if (constraints.edgeDistance !== undefined && !whollyWithinSingleEdge(s, candidate, constraints.edgeDistance) && !policy.largeModelEdgeFallback?.(s, candidate, constraints.edgeDistance)) return failure('NOT_WITHIN_EDGE');
  const coherent = checkCoherency(candidate.models, s.spatialRules.coherency);
  if (!coherent.coherent) return { ...failure('INCOHERENT'), modelIds: coherent.failingModelIds };
  const custom = policy.extraRestriction?.(draft, candidate); if (custom && !custom.ok) return custom;
  return { ok: true, value: candidate };
}
