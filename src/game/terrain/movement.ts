import { movementAbilities } from '../abilities/movement';
import { onBattlefield } from '../reserves/location';
import { pointSegmentDistance } from './geometry';
import type { CommandResult, GameState, Model, MovementDistance, MovementPath, Position, TerrainSurface } from '../models';
import { baseRadius, centreDistance, EPSILON, isFinitePosition } from '../utils/geometry';
import { baseIntersectsPolygon, baseSupported, distanceToPolygon, elevation, modelHeight, segmentNearPolygon } from './geometry';
import { hasAnyKeyword, LIGHT_BODY, terrainRules } from './rules';
const success = (): CommandResult => ({ ok: true, value: undefined });
export function canEndMoveOnTerrainSurface(state: GameState, model: Model, surface: TerrainSurface): CommandResult {
  if (!surface.stable || Math.abs(elevation(model.position) - surface.z) > EPSILON) return { ok: false, reason: 'UNSUPPORTED_SURFACE' };
  if (surface.z > EPSILON && !hasAnyKeyword(state, model, [...LIGHT_BODY, 'FLY', 'MONSTER'])) return { ok: false, reason: 'SURFACE_NOT_ALLOWED' };
  if (!baseSupported(model, surface.footprint)) return { ok: false, reason: 'BASE_OVERHANG' };
  return success();
}
/** Final physical placement: no model can end inside a wall, irrespective of traversal permission. */
export function validateTerrainPosition(state: GameState, model: Model): CommandResult {
  const z = elevation(model.position);
  if (!Number.isFinite(z) || z < 0) return { ok: false, reason: 'INVALID_POSITION' };
  const features = state.battlefield.terrain?.features ?? [];
  for (const feature of features) for (const section of feature.sections) {
    if (z >= section.maxZ - EPSILON || z + modelHeight(model) <= section.minZ + EPSILON || !baseIntersectsPolygon(model, section.footprint)) continue;
    if (!feature.openings.some(o => (feature.category !== 'DENSE' || z > terrainRules(state).solidHeight + EPSILON) && z >= o.minZ - EPSILON && z + modelHeight(model) <= o.maxZ + EPSILON && baseSupported(model, o.footprint))) return { ok: false, reason: 'TERRAIN_BLOCKED' };
  }
  if (z <= EPSILON) return success();
  const surfaces = features.flatMap(f => f.surfaces).filter(surface => Math.abs(surface.z - z) <= EPSILON && baseIntersectsPolygon(model, surface.footprint));
  if (!surfaces.length) return { ok: false, reason: 'UNSUPPORTED_SURFACE' };
  const results = surfaces.map(surface => canEndMoveOnTerrainSurface(state, model, surface));
  return results.find(r => r.ok) ?? results[0]!;
}
export function defaultMovementPath(from: Position, to: Position): MovementPath {
  if (Math.abs(elevation(from) - elevation(to)) <= EPSILON) return { waypoints: [{ ...to }] };
  // Up: approach then ascend. Down: descend then leave. Explicit paths allow climbing an outer wall.
  return { waypoints: elevation(to) > elevation(from) ? [{ x: to.x, y: to.y, z: elevation(from) }, { ...to }] : [{ x: from.x, y: from.y, z: elevation(to) }, { ...to }] };
}
/** Shared by every movement kind. No turn, phase, movement allowance or faction logic here. */
export function validateTerrainPath(state: GameState, model: Model, target: Position, path?: MovementPath): CommandResult<MovementDistance> {
  if (!isFinitePosition(target)) return { ok: false, reason: 'INVALID_POSITION' };
  const points = path?.waypoints ?? defaultMovementPath(model.position, target).waypoints;
  if (!points.length || points.length > 64 || points.some(p => !isFinitePosition(p)) ||
      centreDistance(points.at(-1)!, target) > EPSILON || Math.abs(elevation(points.at(-1)!) - elevation(target)) > EPSILON) return { ok: false, reason: 'INVALID_MOVEMENT_PATH' };
  const features = state.battlefield.terrain?.features ?? [], rules = terrainRules(state);
  const ability = movementAbilities(state, model);
  let from = model.position, horizontal = 0, vertical = 0;
  for (const to of points) {
    const h = centreDistance(from, to), v = Math.abs(elevation(to) - elevation(from));
    if (h > EPSILON && v > EPSILON) return { ok: false, reason: 'INVALID_MOVEMENT_PATH' };
    if (to.x < baseRadius(model.base) - EPSILON || to.y < baseRadius(model.base) - EPSILON || to.x + baseRadius(model.base) > state.battlefield.width + EPSILON || to.y + baseRadius(model.base) > state.battlefield.height + EPSILON) return { ok: false, reason: 'OUTSIDE_BATTLEFIELD' };
    if (!ability.flying && v > EPSILON && !features.some(f => f.sections.some(section => Math.max(elevation(from), elevation(to)) <= section.maxZ + EPSILON && distanceToPolygon(from, section.footprint) <= baseRadius(model.base) + rules.climbProximity + EPSILON) || f.surfaces.some(surface => surface.z >= Math.max(elevation(from), elevation(to)) - EPSILON && distanceToPolygon(from, surface.footprint) <= baseRadius(model.base) + rules.climbProximity + EPSILON))) return { ok: false, reason: 'CLIMB_TOO_FAR' };
    for (const feature of features.filter(f => !ability.flying && f.category === 'DENSE')) for (const section of feature.sections) {
      const bottom = Math.min(elevation(from), elevation(to)), top = Math.max(elevation(from), elevation(to)) + modelHeight(model);
      if (bottom >= section.maxZ - EPSILON || top <= section.minZ + EPSILON || !segmentNearPolygon(from, to, section.footprint, baseRadius(model.base))) continue;
      const permitted = v > EPSILON ? hasAnyKeyword(state, model, LIGHT_BODY) : hasAnyKeyword(state, model, [...LIGHT_BODY, 'MOBILE']) || ability.mobile || section.maxZ <= (ability.walker ? Math.max(4, rules.stepOverHeight) : rules.stepOverHeight) + EPSILON;
      const throughOpening = feature.openings.some(o => bottom >= o.minZ - EPSILON && top <= o.maxZ + EPSILON && baseSupported({ ...model, position: from }, o.footprint) && baseSupported({ ...model, position: to }, o.footprint));
      if (!permitted && !throughOpening) return { ok: false, reason: 'TERRAIN_BLOCKED' };
    }
    if (ability.walker && !ability.flying && state.units.filter(onBattlefield).flatMap(u => u.models).some(m => m.alive && m.id !== model.id && hasAnyKeyword(state, m, ['TITANIC']) && pointSegmentDistance(m.position, from, to) < baseRadius(model.base) + baseRadius(m.base) - EPSILON)) return { ok: false, reason: 'BASE_OVERLAP' };
    horizontal += h; vertical += v; from = to;
  }
  const placement = validateTerrainPosition(state, { ...model, position: target }); if (!placement.ok) return placement;
  return { ok: true, value: { horizontal, vertical, totalMovementDistance: horizontal + (ability.flying ? 0 : vertical) } };
}
