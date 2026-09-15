import type { GameState, UnitDefinition } from '../models';
import { createUnit } from '../engine/createUnit';
/** Technical fixtures only. All statistics and equipment are invented placeholders. */
export const PROTOTYPE_UNITS: readonly UnitDefinition[] = [
  { id: 'aeldari-test', name: 'Aeldari Test Unit', factionId: 'aeldari', modelCount: 3, placeholder: true,
    defaultBase: { kind: 'circle', diameterMm: 25 },
    stats: { movement: 7, toughness: 3, save: 4, wounds: 1, leadership: 7, objectiveControl: 1 },
    keywords: ['Infantry'], abilities: [], weapons: [{ id: 'test-rifle', name: 'Placeholder rifle', kind: 'ranged', range: 18,
      attacks: { kind: 'fixed', value: 2 }, skill: 3, strength: 4, armourPenetration: 0, damage: { kind: 'fixed', value: 1 }, traits: [] }] },
  { id: 'emperors-children-test', name: "Emperor’s Children Test Unit", factionId: 'emperors-children', modelCount: 3, placeholder: true,
    defaultBase: { kind: 'circle', diameterMm: 32 },
    stats: { movement: 6, toughness: 4, save: 3, wounds: 2, leadership: 6, objectiveControl: 1 },
    keywords: ['Infantry'], abilities: [], weapons: [{ id: 'test-blade', name: 'Placeholder blade', kind: 'melee', range: null,
      attacks: { kind: 'fixed', value: 3 }, skill: 3, strength: 4, armourPenetration: -1, damage: { kind: 'fixed', value: 1 }, traits: [] }] },
];
export function createTestMatch(): GameState {
  const players: GameState['players'] = [
    { id: 'player-1', name: 'Player 1', factionId: 'aeldari' },
    { id: 'player-2', name: 'Player 2', factionId: 'emperors-children' },
  ];
  const units = PROTOTYPE_UNITS.map((definition, i) => createUnit(definition, `unit-${i + 1}`, players[i]!.id,
    Array.from({ length: definition.modelCount }, (_, j) => ({ x: 4.5 + j * 1.5, y: i === 0 ? 4.5 : 20.5 }))));
  return { schemaVersion: 2, id: 'test-battle', round: 1, turn: 1, activePlayerId: players[0].id,
    phase: 'Command', status: 'in-progress', players, units,
    definitions: JSON.parse(JSON.stringify(PROTOTYPE_UNITS)),
    battlefield: { width: 30, height: 24 },
    // Prototype tuning, not an official rule transcription.
    spatialRules: { engagementDistance: 1, coherency: { maxEdgeDistance: 2,
      sizeBands: [{ minModels: 1, requiredNeighbours: 1 }, { minModels: 6, requiredNeighbours: 2 }],
      requireConnected: true } },
    movement: null, events: [],
    armies: players.map((p, i) => ({ id: `army-${i + 1}`, playerId: p.id, factionId: p.factionId,
      unitIds: units.filter(u => u.playerId === p.id).map(u => u.id) })) };
}
