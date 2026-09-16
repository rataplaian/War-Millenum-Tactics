import type { GameState, UnitDefinition } from '../models';
import { createTestMatch, PROTOTYPE_UNITS } from './prototype';
import { createUnit } from '../engine/createUnit';
import { rectangle } from '../terrain/geometry';
import { DEFAULT_RESERVE_RULES } from '../reserves/ReservePolicy';
import type { CoreAbility } from '../setup/types';
/** Six invented archetypes for each player. No official datasheets or costs. */
export function createDeploymentTestMatch(): GameState {
  const s = createTestMatch();
  const abilities: CoreAbility[][] = [[], [{ kind: 'INFILTRATORS' }], [{ kind: 'SCOUTS', distance: 6 }], [{ kind: 'INFILTRATORS' }, { kind: 'SCOUTS', distance: 6 }], [{ kind: 'DEEP_STRIKE' }], []];
  s.battlefield = { width: 48, height: 36, losBlockers: [], terrain: { areas: [{ id: 'platform-area', footprint: rectangle(19, 12, 10, 10), featureIds: ['platform'], metadata: {} }], features: [{ id: 'platform', terrainAreaId: 'platform-area', footprint: rectangle(20, 13, 8, 8), category: 'EXPOSED', height: 3, sections: [{ footprint: rectangle(20, 13, 8, 8), minZ: 2.8, maxZ: 3 }], openings: [], surfaces: [{ id: 'platform-top', footprint: rectangle(20, 13, 8, 8), z: 3, stable: true }] }] } };
  const definitions: UnitDefinition[] = s.players.flatMap((p, pi) => abilities.map((coreAbilities, i) => ({ ...PROTOTYPE_UNITS[pi]!, id: `deployment-${pi}-${i}`, name: `Test ${String.fromCharCode(65 + i)}${pi + 1}`, modelCount: 2, points: i === 5 ? 150 : 100, coreAbilities, keywords: i === 5 ? ['FORTIFICATION'] : ['INFANTRY'] })));
  s.definitions = definitions;
  s.units = definitions.map((d, i) => ({ ...createUnit(d, `deploy-${i + 1}`, s.players[Math.floor(i / 6)]!.id, [{ x: 0, y: 0 }, { x: 0, y: 0 }]), location: 'RESERVES' }));
  s.armies = s.players.map((p, i) => ({ id: `army-${i + 1}`, playerId: p.id, factionId: p.factionId, unitIds: s.units.filter(u => u.playerId === p.id).map(u => u.id) }));
  s.deployment = { stage: 'PRE_BATTLE', zones: [{ id: 'zone-1', playerId: s.players[0].id, footprint: rectangle(0, 0, 48, 8), metadata: {} }, { id: 'zone-2', playerId: s.players[1].id, footprint: rectangle(0, 28, 48, 8), metadata: {} }], pointsLimit: 650, rules: { ...DEFAULT_RESERVE_RULES }, firstDeploymentPlayerId: s.players[0].id, nextPlayerId: s.players[0].id, firstTurnPlayerId: null, deployed: [], scoutDone: [], choices: {}, initialReserveIds: [] };
  return s;
}
