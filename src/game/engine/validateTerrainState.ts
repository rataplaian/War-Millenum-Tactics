import type { GameState, Polygon, TerrainPrism } from '../models';
import { isFinitePosition } from '../utils/geometry';
import { edges, modelsOverlap, pointInPolygon, segmentCrossParameters } from '../terrain/geometry';
import { terrainRules } from '../terrain/rules';
import { validateTerrainPosition } from '../terrain/movement';
export function validateTerrainState(state: GameState): void {
  const require = (condition: unknown, message: string) => { if (!condition) throw new Error(`Invalid terrain snapshot: ${message}`); };
  const terrain = state.battlefield.terrain;
  const polygon = (p: Polygon) => {
    require(p.vertices.length >= 3 && p.vertices.length <= 128 && p.vertices.every(v => isFinitePosition(v) && v.x >= 0 && v.y >= 0 && v.x <= state.battlefield.width && v.y <= state.battlefield.height), 'polygon vertices');
    const segments = edges(p);
    require(Math.abs(segments.reduce((sum, [a, b]) => sum + a.x * b.y - b.x * a.y, 0)) > 1e-9, 'polygon area');
    for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
      if (j === i + 1 || (i === 0 && j === segments.length - 1)) continue;
      require(!segmentCrossParameters(...segments[i]!, ...segments[j]!).length, 'self-intersecting polygon');
    }
  };
  if (terrain) {
    require(new Set(terrain.areas.map(a => a.id)).size === terrain.areas.length && terrain.areas.every(a => !!a.id), 'area ids');
    require(new Set(terrain.features.map(f => f.id)).size === terrain.features.length && terrain.features.every(f => !!f.id), 'feature ids');
    require(Object.values(terrainRules(state)).every(v => Number.isFinite(v) && v >= 0), 'rules');
    const surfaces = terrain.features.flatMap(f => f.surfaces);
    require(surfaces.every(s => !!s.id) && new Set(surfaces.map(s => s.id)).size === surfaces.length, 'surface ids');
    for (const area of terrain.areas) {
      polygon(area.footprint);
      require(new Set(area.featureIds).size === area.featureIds.length && area.featureIds.every(id => terrain.features.some(f => f.id === id && f.terrainAreaId === area.id)), 'area feature references');
    }
    for (const feature of terrain.features) {
      polygon(feature.footprint);
      const area = terrain.areas.find(a => a.id === feature.terrainAreaId);
      require(area?.featureIds.includes(feature.id) && feature.footprint.vertices.every(p => pointInPolygon(p, area!.footprint)), 'feature area');
      require(['EXPOSED', 'LIGHT', 'DENSE'].includes(feature.category) && Number.isFinite(feature.height) && feature.height > 0, 'feature category/height');
      const prism = (p: TerrainPrism) => { polygon(p.footprint); require(Number.isFinite(p.minZ) && Number.isFinite(p.maxZ) && p.minZ >= 0 && p.maxZ > p.minZ && p.maxZ <= feature.height && p.footprint.vertices.every(v => pointInPolygon(v, feature.footprint)), 'prism'); };
      feature.sections.forEach(prism); feature.openings.forEach(prism);
      for (const surface of feature.surfaces) { polygon(surface.footprint); require(Number.isFinite(surface.z) && surface.z >= 0 && surface.z <= feature.height && typeof surface.stable === 'boolean' && surface.footprint.vertices.every(v => pointInPolygon(v, feature.footprint)), 'surface'); }
    }
  }
  for (const unit of state.units) {
    require(unit.lastRangedAttackTurnIndex === undefined || (Number.isSafeInteger(unit.lastRangedAttackTurnIndex) && unit.lastRangedAttackTurnIndex >= 1 && unit.lastRangedAttackTurnIndex <= state.turn), 'ranged history');
    for (const model of unit.models) {
      require(!model.volume || (model.volume.kind === 'cylinder' && Number.isFinite(model.volume.height) && model.volume.height > 0), 'model volume');
      if (model.alive) require(validateTerrainPosition(state, model).ok, 'model placement');
    }
  }
  for (const transaction of [state.movement, state.closeCombat?.move]) if (transaction) {
    const restored = state.units.flatMap(u => u.models).filter(m => m.alive).map(m => ({ ...m, position: transaction.originals.find(o => o.modelId === m.id)?.position ?? m.position }));
    for (const model of restored) require(validateTerrainPosition(state, model).ok, 'original placement');
    require(!restored.some((m, i) => restored.slice(i + 1).some(n => modelsOverlap(m, n))), 'original collision');
  }
}
