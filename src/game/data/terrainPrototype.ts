import { createCloseCombatTestMatch } from './closeCombatPrototype';
import { rectangle } from '../terrain/geometry';
export const TERRAIN_SCENARIOS = ['HIDDEN_FAR', 'HIDDEN_NEAR', 'CLEAR', 'PARTIAL', 'BLOCKED', 'OBSCURING', 'PLUNGING', 'VERTICAL'] as const;
export type TerrainScenario = typeof TERRAIN_SCENARIOS[number];
/** Invented logical geometry only; no copyrighted artwork or official datasheets. */
export function createTerrainTestMatch(scenario: TerrainScenario = 'VERTICAL') {
  const s = createCloseCombatTestMatch(); s.id = `terrain-${scenario.toLowerCase()}`;
  s.battlefield.width = 40; s.battlefield.height = 30;
  s.battlefield.terrain = {
    areas: [
      { id: 'ruin-area', footprint: rectangle(3, 3, 10, 8), featureIds: ['ruin'], metadata: { label: 'Dense ruin' } },
      { id: 'light-area', footprint: rectangle(20, 10, 3, 7), featureIds: ['light'], metadata: { label: 'Light grove' } },
      { id: 'exposed-area', footprint: rectangle(15, 22, 7, 4), featureIds: ['exposed'], metadata: { label: 'Low exposed barrier' } },
    ],
    features: [
      { id: 'ruin', terrainAreaId: 'ruin-area', category: 'DENSE', footprint: rectangle(3, 3, 10, 8), height: 5,
        sections: [{ footprint: rectangle(10, 3, 0.4, 8), minZ: 0, maxZ: 5 }, { footprint: rectangle(4, 4, 4, 4), minZ: 2.8, maxZ: 3 }],
        openings: [{ footprint: rectangle(10, 4, 0.4, 2), minZ: 0.2, maxZ: 2.2 }, { footprint: rectangle(10, 7, 0.4, 2), minZ: 3.2, maxZ: 4.8 }],
        surfaces: [{ id: 'ruin-ground', footprint: rectangle(3, 3, 10, 8), z: 0, stable: true }, { id: 'ruin-floor-3', footprint: rectangle(4, 4, 4, 4), z: 3, stable: true }] },
      { id: 'light', terrainAreaId: 'light-area', category: 'LIGHT', footprint: rectangle(20, 10, 3, 7), height: 2,
        sections: [{ footprint: rectangle(21, 12, 0.5, 0.5), minZ: 0, maxZ: 2 }], openings: [], surfaces: [] },
      { id: 'exposed', terrainAreaId: 'exposed-area', category: 'EXPOSED', footprint: rectangle(15, 22, 7, 4), height: 1.2,
        sections: [{ footprint: rectangle(15, 24, 7, 1), minZ: 0, maxZ: 1.2 }], openings: [],
        surfaces: [{ id: 'exposed-top', footprint: rectangle(15, 24, 7, 1), z: 1.2, stable: true }] },
    ],
  };
  const place = (index: number, x: number, y: number, z = 0) => s.units[index]!.models.forEach((m, i) => { m.position = { x: x + i * 1.5, y, z }; m.volume = { kind: 'cylinder', height: 1.5 }; });
  place(0, 4.5, 5); place(1, 4.5, 16);
  if (scenario === 'HIDDEN_FAR') place(1, 4.5, 26);
  if (scenario === 'CLEAR') { place(0, 25, 4.5); place(1, 25, 10); }
  if (scenario === 'PARTIAL') { place(0, 16, 20); place(1, 16, 28); }
  if (scenario === 'BLOCKED') place(1, 14, 5);
  if (scenario === 'OBSCURING') { place(0, 15.5, 13); place(1, 25, 13); }
  if (scenario === 'PLUNGING') place(0, 4.5, 5, 3);
  return s;
}
