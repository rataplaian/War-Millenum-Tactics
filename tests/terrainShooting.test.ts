import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../src/game/engine/GameEngine';
import { terrainState, areaOnly, feature, observer, target } from './terrain.helpers';
import { isModelHidden } from '../src/game/terrain/rules';
import { createVisibilityProvider } from '../src/game/terrain/visibility';
import { dice } from './shooting.helpers';
import { createTestMatch } from '../src/game/data/prototype';

test('Shooting applies cover to BS and preserves the immutable catalog', () => {
  const s = terrainState(); s.phase = 'Shooting'; areaOnly(s, 'LIGHT', 18, 2, 4, 7); const game = GameEngine.create(s), catalog = game.getState().definitions;
  game.beginShooting('unit-1'); const result = game.fireWeapon('test-rifle', 'unit-2', dice(3, 3).rng);
  assert.equal(result.ok, true); if (result.ok) { assert.equal(result.value.hits, 0); assert.equal(result.value.attackModifiers![0]!.effectiveSkill, 4); }
  assert.deepEqual(game.getState().definitions, catalog); assert.ok(game.getState().events.some(e => e.type === 'cover-applied'));
  assert.deepEqual(GameEngine.create(game.getState()).getState(), game.getState());
});
test('Plunging Fire improves ranged skill and emits resolution metadata', () => {
  const s = terrainState(); s.phase = 'Shooting'; feature(s, 'EXPOSED', 3, 3, 3, 4, 3); observer(s).position.z = 3;
  const game = GameEngine.create(s); game.beginShooting('unit-1'); const result = game.fireWeapon('test-rifle', 'unit-2', dice(2, 1, 2, 1).rng);
  assert.equal(result.ok, true); if (result.ok) { assert.equal(result.value.hits, 2); assert.equal(result.value.attackModifiers![0]!.effectiveSkill, 2); }
  assert.ok(game.getState().events.some(e => e.type === 'plunging-fire-applied'));
});
test('modifiers apply independently to models at different elevations', () => {
  const s = terrainState(); s.phase = 'Shooting'; feature(s, 'EXPOSED', 3, 3, 3, 3, 3); observer(s).position.z = 3;
  const second = s.units[0]!.models[1]!; second.alive = true; second.woundsRemaining = 1; second.position = { x: 4, y: 8, z: 0 };
  const game = GameEngine.create(s); game.beginShooting('unit-1'); const result = game.fireWeapon('test-rifle', 'unit-2', dice(2, 1, 2, 1, 2, 2).rng);
  assert.equal(result.ok, true); if (result.ok) { assert.equal(result.value.hits, 2); assert.deepEqual(result.value.attackModifiers!.map(m => m.effectiveSkill), [2, 3]); }
});
test('Hidden is lost on the first ranged attack, even a miss, before completion', () => {
  const s = terrainState(); s.phase = 'Shooting'; areaOnly(s, 'DENSE', 2, 2, 4, 7); const game = GameEngine.create(s);
  assert.equal(isModelHidden(game.getState(), observer(s)), true); game.beginShooting('unit-1'); assert.equal(game.fireWeapon('test-rifle', 'unit-2', () => 0).ok, true);
  assert.equal(isModelHidden(game.getState(), observer(s)), false); assert.equal(game.getState().units[0]!.lastRangedAttackTurnIndex, 1);
  assert.ok(game.getState().events.some(e => e.type === 'hidden-lost')); game.completeShooting(); game.tryNextTurn();
  assert.equal(isModelHidden(game.getState(), observer(s)), false); game.tryNextTurn(); assert.equal(isModelHidden(game.getState(), observer(s)), true);
  assert.ok(game.getState().events.some(e => e.type === 'hidden-gained' && e.turn === 3));
  assert.deepEqual(GameEngine.create(game.getState()).getState(), game.getState());
});
test('zero generated ranged attacks do not remove Hidden', () => {
  const s = terrainState(); s.phase = 'Shooting'; areaOnly(s, 'DENSE', 2, 2, 4, 7);
  s.definitions = s.definitions.map(d => ({ ...d, weapons: d.weapons.map(w => ({ ...w, attacks: { kind: 'fixed' as const, value: 0 } })) }));
  const game = GameEngine.create(s); game.beginShooting('unit-1'); assert.equal(game.fireWeapon('test-rifle', 'unit-2', dice().rng).ok, true); assert.equal(isModelHidden(game.getState(), observer(s)), true);
});
test('legacy shooting events preserve Hidden history without the new field', () => {
  const s = terrainState(); s.phase = 'Shooting'; areaOnly(s, 'DENSE', 2, 2, 4, 7);
  const game = GameEngine.create(s); game.beginShooting('unit-1'); game.fireWeapon('test-rifle', 'unit-2', () => 0); game.completeShooting();
  const snapshot = game.getState(); delete snapshot.units[0]!.lastRangedAttackTurnIndex;
  assert.equal(isModelHidden(GameEngine.create(snapshot).getState(), observer(s)), false);
});
test('Hidden target outside detection is rejected without consuming RNG', () => {
  const s = terrainState(); s.phase = 'Shooting'; target(s).position.x = 22; areaOnly(s, 'DENSE', 19, 2, 5, 7); const game = GameEngine.create(s); game.beginShooting('unit-1');
  const before = game.getState(), rng = dice(); assert.deepEqual(game.fireWeapon('test-rifle', 'unit-2', rng.rng), { ok: false, reason: 'TARGET_NOT_VISIBLE' }); assert.equal(rng.calls(), 0); assert.deepEqual(game.getState(), before);
});
test('engine supports an injected Detection policy without changing weapon range', () => {
  const s = terrainState(); s.phase = 'Shooting'; target(s).position.x = 22; areaOnly(s, 'DENSE', 19, 2, 5, 7);
  const game = GameEngine.create(s, { detectionRange: () => 20 }); game.beginShooting('unit-1'); assert.equal(game.fireWeapon('test-rifle', 'unit-2', () => 0).ok, true);
});
test('VisibilityProvider can be replaced independently of the combat pipeline', () => {
  const s = terrainState(); s.phase = 'Shooting';
  const game = GameEngine.create(s, { visibilityProvider: state => ({ ...createVisibilityProvider(state), isModelVisible: () => false }) }); game.beginShooting('unit-1');
  assert.deepEqual(game.fireWeapon('test-rifle', 'unit-2', dice().rng), { ok: false, reason: 'TARGET_NOT_VISIBLE' });
});
test('successful movement invalidates engine visibility queries and records area changes; cancellation reverses them', () => {
  const s = terrainState(); s.phase = 'Movement'; areaOnly(s, 'DENSE', 7, 3, 4, 4); const game = GameEngine.create(s);
  const initial = game.getTerrainDebug(); game.beginMovement('unit-1'); assert.equal(game.moveModel(observer(s).id, { x: 8, y: 5, z: 0 }).ok, true);
  assert.equal(game.getTerrainDebug().models.find(m => m.modelId === observer(s).id)!.hidden, true);
  game.cancelMovement(); assert.deepEqual(game.getTerrainDebug(), initial);
  for (const type of ['model-entered-terrain-area', 'model-left-terrain-area', 'hidden-gained', 'hidden-lost']) assert.ok(game.getState().events.some(e => e.type === type));
});
test('legacy schema 3 with omitted elevation remains byte-shape compatible at load', () => {
  const s = createTestMatch(); assert.deepEqual(GameEngine.create(s).getState(), s);
});

test('Cover and Plunging Fire are simultaneously recorded by actual Shooting', () => {
  const s = terrainState(); s.phase = 'Shooting'; feature(s, 'EXPOSED', 3, 3, 3, 4, 3); observer(s).position.z = 3; areaOnly(s, 'LIGHT', 18, 2, 4, 7);
  const game = GameEngine.create(s); game.beginShooting('unit-1'); const result = game.fireWeapon('test-rifle', 'unit-2', dice(3, 1, 3, 1).rng);
  assert.equal(result.ok, true); if (result.ok) { assert.equal(result.value.hits, 2); assert.equal(result.value.attackModifiers![0]!.effectiveSkill, 3); assert.equal(result.value.attackModifiers![0]!.modifiers.length, 2); }
  assert.ok(game.getState().events.some(e => e.type === 'cover-applied')); assert.ok(game.getState().events.some(e => e.type === 'plunging-fire-applied'));
});
