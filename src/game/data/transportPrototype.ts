import type { GameState, UnitDefinition } from '../models';
import { createDeploymentTestMatch } from './deploymentPrototype';
import { PROTOTYPE_UNITS } from './prototype';
import { createUnit } from '../engine/createUnit';
/** Invented technical profiles; no faction abilities or official datasheets. */
export function createTransportTestMatch(): GameState {
  const s = createDeploymentTestMatch();
  s.battlefield = { width: 48, height: 36, losBlockers: [] };
  const base = PROTOTYPE_UNITS[0]!;
  const body: UnitDefinition = { ...base, id: 'test-bodyguard', name: 'Test Bodyguard', modelCount: 5, points: 100, keywords: ['INFANTRY'], coreAbilities: [{ kind: 'SCOUTS', distance: 6 }] };
  const leader: UnitDefinition = { ...base, id: 'test-leader', name: 'Test Leader', modelCount: 1, points: 50, stats: { ...base.stats, toughness: 5, wounds: 3 }, keywords: ['INFANTRY', 'CHARACTER', 'PSYKER'], attachment: { role: 'LEADER', canLeadDatasheetIds: [body.id] }, coreAbilities: [{ kind: 'SCOUTS', distance: 6 }], abilities: [{ id: 'test-leadership', name: 'Placeholder leadership', parameters: {}, scope: 'UNIT', whileLeading: true, effect: { kind: 'MODIFIER', characteristic: 'LEADERSHIP', value: -1 } }] };
  const support: UnitDefinition = { ...leader, id: 'test-support', name: 'Test Support', keywords: ['INFANTRY', 'CHARACTER'], attachment: { role: 'SUPPORT', canLeadDatasheetIds: [body.id] }, abilities: [] };
  const transport: UnitDefinition = { ...base, id: 'test-transport-a', name: 'Test Transport A', modelCount: 1, points: 100, defaultBase: { kind: 'circle', diameterMm: 76.2 }, stats: { ...base.stats, movement: 10, toughness: 8, wounds: 10 }, keywords: ['VEHICLE', 'TRANSPORT'], weapons: [], transport: { maximumModels: 6, allowedKeywords: ['INFANTRY'], excludedKeywords: [], firingDeck: 2 } };
  const dedicated: UnitDefinition = { ...transport, id: 'test-transport-b', name: 'Test Transport B', transport: { ...transport.transport!, maximumModels: 12, dedicated: true } };
  const enemy: UnitDefinition = { ...PROTOTYPE_UNITS[1]!, id: 'test-enemy', name: 'Test Bodyguard B', modelCount: 5, weapons: PROTOTYPE_UNITS[1]!.weapons.map(w => ({ ...w, traits: [{ id: 'PRECISION' }] })) };
  s.definitions = [body, leader, support, transport, dedicated, enemy];
  s.units = s.definitions.map((d, i) => ({ ...createUnit(d, ['bodyguard', 'leader', 'support', 'transport-a', 'transport-b', 'enemy'][i]!, i === 5 ? 'player-2' : 'player-1', Array.from({ length: d.modelCount }, () => ({ x: 0, y: 0 }))), location: 'RESERVES' }));
  s.armies.forEach(a => a.unitIds = s.units.filter(u => u.playerId === a.playerId).map(u => u.id));
  s.deployment!.pointsLimit = 1000;
  return s;
}
