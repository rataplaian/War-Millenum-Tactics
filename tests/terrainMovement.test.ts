import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../src/game/engine/GameEngine';
import { validateTerrainPath, validateTerrainPosition, canEndMoveOnTerrainSurface } from '../src/game/terrain/movement';
import { rectangle, baseSupported, prismIntervals } from '../src/game/terrain/geometry';
import { terrainState, feature, observer } from './terrain.helpers';
import { dice } from './shooting.helpers';
for (const category of ['EXPOSED', 'LIGHT'] as const) test(`${category}: any model may traverse horizontally and vertically`, () => {
  const s = terrainState(['VEHICLE']); const f = feature(s, category); const m = observer(s);
  assert.equal(validateTerrainPath(s, m, { x: 12, y: 5 }).ok, true);
  // Flying vehicle may end upstairs; ordinary vehicle cannot.
  s.definitions = s.definitions.map(d => ({ ...d, keywords: ['VEHICLE', 'FLY'] }));
  const result = validateTerrainPath(s, m, { x: 9, y: 5, z: 4 }); assert.equal(result.ok, true);
  assert.equal(canEndMoveOnTerrainSurface(s, { ...m, position: { x: 9, y: 5, z: 4 } }, f.surfaces[0]!).ok, true);
});
for (const keyword of ['INFANTRY', 'BEASTS', 'SWARM', 'MOBILE']) test(`Dense horizontal traversal permits ${keyword}`, () => {
  const s = terrainState([keyword]); feature(s); assert.equal(validateTerrainPath(s, observer(s), { x: 12, y: 5 }).ok, true);
});
for (const keyword of ['INFANTRY', 'BEASTS', 'SWARM']) test(`Dense vertical traversal permits ${keyword}`, () => {
  const s = terrainState([keyword]); feature(s); assert.equal(validateTerrainPath(s, observer(s), { x: 9, y: 5, z: 4 }).ok, true);
});
for (const keyword of ['VEHICLE', 'MONSTER', 'FLY']) test(`Dense wall rejects direct ${keyword} traversal`, () => {
  const s = terrainState([keyword]); feature(s); assert.deepEqual(validateTerrainPath(s, observer(s), { x: 12, y: 5 }), { ok: false, reason: 'TERRAIN_BLOCKED' });
});
test('Dense sections up to two inches can be crossed, taller sections require climbing', () => {
  const s = terrainState(['VEHICLE']); const f = feature(s, 'DENSE', 8, 3, 2, 4, 2);
  assert.equal(validateTerrainPath(s, observer(s), { x: 12, y: 5 }).ok, true);
  f.sections[0]!.maxZ = 2.01; f.height = 2.01; assert.equal(validateTerrainPath(s, observer(s), { x: 12, y: 5 }).ok, false);
});
test('a vehicle can climb around a tall feature and descend, without ending on its surface', () => {
  const s = terrainState(['VEHICLE']); feature(s); const result = validateTerrainPath(s, observer(s), { x: 12, y: 5 }, { waypoints: [
    { x: 7.5, y: 5, z: 0 }, { x: 7.5, y: 5, z: 4 }, { x: 10.5, y: 5, z: 4 }, { x: 10.5, y: 5, z: 0 }, { x: 12, y: 5, z: 0 },
  ] });
  assert.equal(result.ok, true); if (result.ok) assert.deepEqual(result.value, { horizontal: 8, vertical: 8, totalMovementDistance: 16 });
});
test('mobile and monsters cannot go vertically through a Dense floor', () => {
  for (const keyword of ['MOBILE', 'MONSTER']) {
    const s = terrainState([keyword]); const f = feature(s); f.sections[0]!.minZ = 2.8;
    assert.equal(validateTerrainPath(s, observer(s), { x: 9, y: 5, z: 4 }).ok, false);
  }
});
test('vertical distance is added, not Euclidean diagonal distance', () => {
  const s = terrainState(); feature(s); const result = validateTerrainPath(s, observer(s), { x: 9, y: 5, z: 4 });
  assert.equal(result.ok, true); if (result.ok) assert.deepEqual(result.value, { horizontal: 5, vertical: 4, totalMovementDistance: 9 });
});
test('vertical movement requires feature proximity throughout ascent', () => {
  const s = terrainState(); feature(s); assert.deepEqual(validateTerrainPath(s, observer(s), { x: 9, y: 5, z: 4 }, { waypoints: [{ x: 4, y: 5, z: 4 }, { x: 9, y: 5, z: 4 }] }), { ok: false, reason: 'CLIMB_TOO_FAR' });
});
test('diagonal elevation paths and mismatched endpoints are rejected', () => {
  const s = terrainState(); feature(s);
  assert.equal(validateTerrainPath(s, observer(s), { x: 9, y: 5, z: 4 }, { waypoints: [{ x: 9, y: 5, z: 4 }] }).ok, false);
  assert.equal(validateTerrainPath(s, observer(s), { x: 9, y: 5 }, { waypoints: [{ x: 8, y: 5 }] }).ok, false);
});
for (const keyword of ['INFANTRY', 'BEASTS', 'SWARM', 'FLY', 'MONSTER']) test(`stable fully supported elevated placement permits ${keyword}`, () => {
  const s = terrainState([keyword]); feature(s); assert.equal(validateTerrainPosition(s, { ...observer(s), position: { x: 9, y: 5, z: 4 } }).ok, true);
});
test('elevated placement rejects vehicle, overhang, unstable and unsupported destinations', () => {
  const s = terrainState(['VEHICLE']); const f = feature(s); const m = { ...observer(s), position: { x: 9, y: 5, z: 4 } };
  assert.deepEqual(validateTerrainPosition(s, m), { ok: false, reason: 'SURFACE_NOT_ALLOWED' });
  s.definitions = s.definitions.map(d => ({ ...d, keywords: ['INFANTRY'] }));
  assert.deepEqual(validateTerrainPosition(s, { ...m, position: { x: 8, y: 5, z: 4 } }), { ok: false, reason: 'BASE_OVERHANG' });
  f.surfaces[0]!.stable = false; assert.equal(validateTerrainPosition(s, m).ok, false);
  assert.equal(validateTerrainPosition(s, { ...m, position: { x: 15, y: 5, z: 4 } }).ok, false);
});
test('concave surface support prevents a base crossing an internal corner', () => {
  const polygon = { vertices: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 4 }, { x: 0, y: 4 }] };
  const m = observer(terrainState()); assert.equal(baseSupported({ ...m, position: { x: 0.8, y: 0.8 } }, polygon), false);
});
test('normal movement includes vertical allowance and cancellation restores z exactly', () => {
  const s = terrainState(); s.phase = 'Movement'; feature(s, 'DENSE', 6, 3, 2, 4, 3); const game = GameEngine.create(s);
  assert.equal(game.beginMovement('unit-1').ok, true); const before = game.getState().units;
  assert.equal(game.moveModel(observer(s).id, { x: 7, y: 5, z: 3 }).ok, true);
  assert.equal(game.getState().units[0]!.models[0]!.movementUsed, 6);
  assert.ok(game.getState().events.some(e => e.type === 'model-changed-elevation'));
  assert.equal(game.cancelMovement().ok, true); assert.deepEqual(game.getState().units, before);
});
test('vertical movement cannot bypass its normal allowance', () => {
  const s = terrainState(); s.phase = 'Movement'; feature(s); const game = GameEngine.create(s); game.beginMovement('unit-1'); const before = game.getState();
  const result = game.moveModel(observer(s).id, { x: 9, y: 5, z: 4 }); assert.equal(result.ok, false); if (!result.ok) assert.equal(result.reason, 'EXCEEDS_ALLOWANCE'); assert.deepEqual(game.getState(), before);
});
test('stacked models on separate floors do not overlap in snapshots', () => {
  const s = terrainState(); const f = feature(s); f.sections[0]!.minZ = 3.8;
  observer(s).position = { x: 9, y: 5, z: 0 }; s.units[1]!.models[0]!.position = { x: 9, y: 5, z: 4 };
  assert.doesNotThrow(() => GameEngine.create(s));
});
test('terrain snapshots round-trip; invalid geometry, references, heights and elevation fail atomically', () => {
  const s = terrainState(); feature(s); const game = GameEngine.create(s); assert.deepEqual(GameEngine.create(game.getState()).getState(), s);
  for (const corrupt of [(x: typeof s) => { x.battlefield.terrain!.features[0]!.height = NaN; }, (x: typeof s) => { x.battlefield.terrain!.areas[0]!.featureIds = ['missing']; }, (x: typeof s) => { observer(x).position.z = 12; }]) {
    const snapshot = game.getState(); corrupt(snapshot); assert.throws(() => game.loadMatch(snapshot)); assert.deepEqual(game.getState(), s);
  }
});
test('prism ray intersection accounts for height and touching boundaries', () => {
  const prism = { footprint: rectangle(8, 3, 2, 4), minZ: 0, maxZ: 3 };
  assert.ok(prismIntervals({ x: 4, y: 5, z: 1 }, { x: 12, y: 5, z: 1 }, prism).length);
  assert.equal(prismIntervals({ x: 4, y: 5, z: 4 }, { x: 12, y: 5, z: 4 }, prism).length, 0);
});
test('charge, pile-in and consolidation all reject a path through Dense terrain', () => {
  for (const kind of ['charge', 'pile-in', 'consolidate'] as const) {
    const s = terrainState(['VEHICLE']); observer(s).position.x = 6.5; s.units[1]!.models[0]!.position.x = 10.5;
    if (kind === 'charge') {
      s.phase = 'Charge'; const game = GameEngine.create(s); game.declareCharge('unit-1', dice(6, 6).rng);
      assert.equal(game.selectChargeTargets(['unit-2']).ok, true);
      const snapshot = game.getState(); feature(snapshot, 'DENSE', 8, 3, 1, 4, 4); game.loadMatch(snapshot);
      const before = game.getState(); assert.equal(game.moveCombatModel(observer(s).id, { x: 9.3, y: 5 }).ok, false); assert.deepEqual(game.getState(), before);
    } else {
      feature(s, 'DENSE', 8, 3, 1, 4, 4); s.phase = 'Fight'; s.units[0]!.state.hasCharged = true;
      s.closeCombat = { charge: null, declared: [], effects: [], move: null, fight: { step: kind === 'pile-in' ? 'PILE_IN' : 'CONSOLIDATE', category: 'REMAINING_COMBATS', nextPlayerId: 'player-1', pileInDone: [], eligibleAtFightStart: ['unit-1'], engagedAtFightStart: [], fought: ['unit-1'], consolidateDone: [], selected: null } };
      const game = GameEngine.create(s); const begin = kind === 'pile-in' ? game.beginPileIn('unit-1', ['unit-2']) : game.beginConsolidation('unit-1', ['unit-2']);
      assert.equal(begin.ok, true);
      const before = game.getState(); assert.equal(game.moveCombatModel(observer(s).id, { x: 9.3, y: 5 }).ok, false); assert.deepEqual(game.getState(), before);
    }
  }
});
test('Solid forbids ending a model inside a ground-level opening', () => {
  const s = terrainState(); const f = feature(s); f.openings = [{ footprint: f.footprint, minZ: 0, maxZ: 2 }];
  assert.deepEqual(validateTerrainPosition(s, { ...observer(s), position: { x: 9, y: 5 } }), { ok: false, reason: 'TERRAIN_BLOCKED' });
});
