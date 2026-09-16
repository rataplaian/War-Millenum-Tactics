import { createTestMatch } from '../src/game/data/prototype';
import type { GameState, TerrainCategory, TerrainFeature } from '../src/game/models';
import { rectangle } from '../src/game/terrain/geometry';
export function terrainState(keywords = ['INFANTRY']): GameState {
  const s = createTestMatch(); s.battlefield.width = 40; s.battlefield.height = 30;
  s.battlefield.terrain = { areas: [], features: [] };
  s.definitions = s.definitions.map(d => ({ ...d, keywords }));
  s.units.forEach((u, i) => u.models.forEach((m, j) => { m.position = { x: i ? 20 : 4, y: 5 + j * 1.5, z: 0 }; if (j) { m.alive = false; m.woundsRemaining = 0; } }));
  return s;
}
export function feature(s: GameState, category: TerrainCategory = 'DENSE', x = 8, y = 3, width = 2, depth = 4, height = 4): TerrainFeature {
  const index = s.battlefield.terrain!.features.length, id = `feature-${index}`, areaId = `area-${index}`;
  const f: TerrainFeature = { id, terrainAreaId: areaId, category, footprint: rectangle(x, y, width, depth), height,
    sections: [{ footprint: rectangle(x, y, width, depth), minZ: 0, maxZ: height }], openings: [],
    surfaces: [{ id: `surface-${index}`, footprint: rectangle(x, y, width, depth), z: height, stable: true }] };
  s.battlefield.terrain!.areas.push({ id: areaId, footprint: rectangle(x - 1, y - 1, width + 2, depth + 2), featureIds: [id], metadata: {} });
  s.battlefield.terrain!.features.push(f); return f;
}
export function areaOnly(s: GameState, category: TerrainCategory, x: number, y: number, width: number, depth: number) {
  const f = feature(s, category, x, y, width, depth, 4); f.sections = []; f.surfaces = [];
  s.battlefield.terrain!.areas.at(-1)!.footprint = rectangle(x, y, width, depth); return f;
}
export const observer = (s: GameState) => s.units[0]!.models[0]!;
export const target = (s: GameState) => s.units[1]!.models[0]!;
