import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GameState, RangedWeapon } from '../src/game/models';
import { GameEngine } from '../src/game/engine/GameEngine';
import { createSeededRng } from '../src/game/utils/dice';
import { createUnit } from '../src/game/engine/createUnit';
import { dice, oneShooter, reject, rifle, shootingGame, shootingState, startedShooting } from './shooting.helpers';
const zeroRandom = () => { throw new Error('Illegal action consumed RNG'); };
test('queries return targets in base-aware range without changing state', () => {
  const game = shootingGame(); const before = game.getState(); const targets = game.getLegalTargets('unit-1', 'test-rifle');
  assert.ok(targets.ok); if (targets.ok) { assert.equal(targets.value.length, 1); assert.equal(targets.value[0]!.eligibleFiringModelIds.length, 3); }
  assert.deepEqual(game.getState(), before);
});
test('exact maximum edge range is legal and a smaller range excludes targets', () => {
  function atRange(range: number) { return shootingGame(s => { for (const u of s.units) for (const m of u.models) m.base.diameterMm = 25.4; rifle(s, { range }); }); }
  assert.ok(atRange(15).getLegalTargets('unit-1', 'test-rifle').ok);
  const exact = atRange(15).getLegalTargets('unit-1', 'test-rifle'); assert.ok(exact.ok && exact.value.length === 1 && exact.value[0]!.nearestDistance === 15);
  assert.deepEqual(atRange(14.99).getLegalTargets('unit-1', 'test-rifle'), { ok: true, value: [] });
});
test('only in-range living firing models generate attacks', () => {
  const game = startedShooting(s => { rifle(s, { range: 15 }); for (const u of s.units) for (const m of u.models) m.base.diameterMm = 25.4;
    s.units[0]!.models[1]!.position.y = 1; s.units[0]!.models[2]!.alive = false; s.units[0]!.models[2]!.woundsRemaining = 0; });
  const result = game.fireWeapon('test-rifle', 'unit-2', dice(1, 1).rng); assert.ok(result.ok);
  if (result.ok) { assert.deepEqual(result.value.eligibleFiringModelIds, ['unit-1:model:1']); assert.equal(result.value.attacks, 2); }
});
test('range and visibility must apply to the same model pair', () => {
  const game = startedShooting(s => { oneShooter(s); rifle(s, { range: 15 }); for (const u of s.units) for (const m of u.models) m.base.diameterMm = 25.4; },
    { visibility: (_shooter, target) => target.id === 'unit-2:model:3' });
  reject(game, () => game.fireWeapon('test-rifle', 'unit-2', zeroRandom), 'TARGET_NOT_VISIBLE');
});
test('wrong phase, enemy shooter, missing unit and finished match reject', () => {
  const wrong = shootingGame(s => { s.phase = 'Command'; }); reject(wrong, () => wrong.beginShooting('unit-1'), 'WRONG_PHASE');
  const game = shootingGame(); reject(game, () => game.beginShooting('unit-2'), 'NOT_YOUR_UNIT'); reject(game, () => game.beginShooting('missing'), 'UNIT_NOT_FOUND');
  const finished = shootingGame(s => { s.status = 'finished'; }); reject(finished, () => finished.beginShooting('unit-1'), 'MATCH_FINISHED');
});
test('open movement blocks shooting and no-ranged/dead/engaged units cannot begin', () => {
  const moving = shootingGame(s => { s.phase = 'Movement'; }); moving.beginMovement('unit-1');
  reject(moving, () => moving.beginShooting('unit-1'), 'MOVEMENT_IN_PROGRESS');
  const noWeapons = shootingGame(s => { s.definitions = s.definitions.map((d, i) => i === 0 ? { ...d, weapons: [] } : d); });
  reject(noWeapons, () => noWeapons.beginShooting('unit-1'), 'NO_RANGED_WEAPONS');
  const dead = shootingGame(s => { for (const m of s.units[0]!.models) { m.alive = false; m.woundsRemaining = 0; } });
  reject(dead, () => dead.beginShooting('unit-1'), 'NO_LIVING_MODELS');
  const engaged = shootingGame(s => { s.units[1]!.models[0]!.position = { x: 4.5, y: 6 }; });
  reject(engaged, () => engaged.beginShooting('unit-1'), 'UNIT_ENGAGED');
});
test('melee and missing weapons are rejected with no RNG consumption', () => {
  const game = shootingGame(s => { s.turn = 2; s.activePlayerId = 'player-2'; }); game.beginShooting('unit-2');
  reject(game, () => game.fireWeapon('test-blade', 'unit-1', zeroRandom), 'WEAPON_NOT_RANGED');
  reject(game, () => game.fireWeapon('missing', 'unit-1', zeroRandom), 'WEAPON_NOT_FOUND');
});
test('invalid targets leave state and RNG unchanged', () => {
  const game = startedShooting(); reject(game, () => game.fireWeapon('test-rifle', 'missing', zeroRandom), 'TARGET_NOT_FOUND');
  reject(game, () => game.fireWeapon('test-rifle', 'unit-1', zeroRandom), 'TARGET_NOT_ENEMY');
  const far = startedShooting(s => rifle(s, { range: 1 })); reject(far, () => far.fireWeapon('test-rifle', 'unit-2', zeroRandom), 'TARGET_OUT_OF_RANGE');
  const blocked = startedShooting(s => { s.battlefield.losBlockers = [{ id: 'wall', kind: 'rectangle', position: { x: 0, y: 10 }, width: 30, height: 1, opaque: true }]; });
  reject(blocked, () => blocked.fireWeapon('test-rifle', 'unit-2', zeroRandom), 'TARGET_NOT_VISIBLE');
});
test('phase and turn progression are blocked while shooting is open', () => {
  const game = startedShooting(); reject(game, () => game.tryNextPhase(), 'SHOOTING_IN_PROGRESS'); reject(game, () => game.tryNextTurn(), 'SHOOTING_IN_PROGRESS');
  reject(game, () => game.beginShooting('unit-1'), 'SHOOTING_IN_PROGRESS');
  assert.throws(() => game.nextPhase());
});
test('cancel before rolling succeeds; completion consumes shooting action', () => {
  const game = startedShooting(); assert.equal(game.cancelShooting().ok, true); assert.equal(game.getState().units[0]!.state.hasShot, false);
  game.beginShooting('unit-1'); assert.equal(game.completeShooting().ok, true); assert.equal(game.getState().units[0]!.state.hasShot, true);
  reject(game, () => game.beginShooting('unit-1'), 'ALREADY_SHOT');
  assert.equal(game.tryNextPhase().ok, true);
});
test('cancel is rejected even when all resolved attacks missed', () => {
  const game = startedShooting(); const result = game.fireWeapon('test-rifle', 'unit-2', dice(1, 1, 1, 1, 1, 1).rng);
  assert.ok(result.ok && result.value.hits === 0); reject(game, () => game.cancelShooting(), 'SHOOTING_ALREADY_RESOLVED');
  reject(game, () => game.fireWeapon('test-rifle', 'unit-2', zeroRandom), 'WEAPON_ALREADY_FIRED');
});
test('missing shooting transaction rejects fire, cancel and complete', () => {
  const game = shootingGame(); reject(game, () => game.fireWeapon('test-rifle', 'unit-2', zeroRandom), 'NO_ACTIVE_SHOOTING');
  reject(game, () => game.cancelShooting(), 'NO_ACTIVE_SHOOTING'); reject(game, () => game.completeShooting(), 'NO_ACTIVE_SHOOTING');
});
test('sequential hit/wound/save/fixed-damage pipeline records exact rolls and casualties', () => {
  const game = startedShooting(); const stream = dice(...Array.from({ length: 6 }, () => [6, 6, 1]).flat());
  const result = game.fireWeapon('test-rifle', 'unit-2', stream.rng); assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.value.attacks, 6); assert.equal(result.value.hits, 6); assert.equal(result.value.wounds, 6);
    assert.equal(result.value.savesFailed, 6); assert.equal(result.value.totalDamage, 6); assert.equal(result.value.destroyedModelIds.length, 3);
    assert.deepEqual(result.value.hitRolls, [6, 6, 6, 6, 6, 6]); assert.equal(result.value.woundTarget, 4);
    assert.deepEqual(result.value.damageResults.map(d => d.modelId), ['unit-2:model:1', 'unit-2:model:1', 'unit-2:model:2', 'unit-2:model:2', 'unit-2:model:3', 'unit-2:model:3']);
  }
  assert.equal(stream.calls(), 18); assert.deepEqual(game.getState().units[1]!.models.map(m => [m.woundsRemaining, m.alive]), [[0, false], [0, false], [0, false]]);
  assert.equal(game.getState().events.filter(e => e.type === 'model-destroyed').length, 3);
  GameEngine.create(game.getState()); // combat snapshot remains valid
});
test('failed wound and successful save prevent damage rolls', () => {
  const game = startedShooting(s => { oneShooter(s); rifle(s, { attacks: { kind: 'fixed', value: 2 }, damage: { kind: 'dice', count: 1, sides: 6, modifier: 0 } }); });
  const stream = dice(6, 1, 6, 6, 6); const result = game.fireWeapon('test-rifle', 'unit-2', stream.rng);
  assert.ok(result.ok && result.value.hits === 2 && result.value.wounds === 1 && result.value.totalDamage === 0);
  assert.equal(stream.calls(), 5);
});
test('dice attacks are rolled independently for each eligible model and recorded', () => {
  const game = startedShooting(s => rifle(s, { attacks: { kind: 'dice', count: 1, sides: 6, modifier: 0 } }));
  const result = game.fireWeapon('test-rifle', 'unit-2', dice(1, 2, 3, 1, 1, 1, 1, 1, 1).rng); assert.ok(result.ok);
  if (result.ok) { assert.equal(result.value.attacks, 6); assert.deepEqual(result.value.attackCounts.map(a => a.resolved.rolls), [[1], [2], [3]]); }
});
test('dice damage kills one model without spilling and reports actual damage', () => {
  const game = startedShooting(s => { oneShooter(s); rifle(s, { damage: { kind: 'dice', count: 1, sides: 6, modifier: 0 } }); });
  const result = game.fireWeapon('test-rifle', 'unit-2', dice(6, 6, 1, 5).rng); assert.ok(result.ok);
  if (result.ok) { assert.equal(result.value.totalDamage, 2); assert.equal(result.value.damageResults[0]!.excess, 3); assert.deepEqual(result.value.damageResults[0]!.resolved.rolls, [5]); }
  assert.deepEqual(game.getState().units[1]!.models.map(m => m.woundsRemaining), [0, 2, 2]);
});
test('impossible save consumes no save RNG and still applies damage', () => {
  const game = startedShooting(s => { oneShooter(s); rifle(s, { armourPenetration: -4 }); });
  const stream = dice(6, 6); const result = game.fireWeapon('test-rifle', 'unit-2', stream.rng);
  assert.ok(result.ok && result.value.saveResults[0]!.roll === null && result.value.totalDamage === 1); assert.equal(stream.calls(), 2);
});
test('wounded target receives damage before a full-health model', () => {
  const game = startedShooting(s => { oneShooter(s); s.units[1]!.models[1]!.woundsRemaining = 1; });
  game.fireWeapon('test-rifle', 'unit-2', dice(6, 6, 1).rng);
  assert.deepEqual(game.getState().units[1]!.models.map(m => m.woundsRemaining), [2, 0, 2]);
});
test('allocation policy is replaceable without rewriting resolution', () => {
  const game = startedShooting(oneShooter, { damageAllocation: models => models[2]!.id });
  game.fireWeapon('test-rifle', 'unit-2', dice(6, 6, 1).rng);
  assert.deepEqual(game.getState().units[1]!.models.map(m => m.woundsRemaining), [2, 2, 1]);
});
test('destroyed target models are ignored by subsequent queries and extra attacks stop', () => {
  const game = startedShooting(s => { for (const m of s.units[1]!.models.slice(1)) { m.alive = false; m.woundsRemaining = 0; } s.units[1]!.models[0]!.woundsRemaining = 1; });
  const stream = dice(6, 6, 1); const result = game.fireWeapon('test-rifle', 'unit-2', stream.rng);
  assert.ok(result.ok && result.value.attacks === 6 && result.value.hitRolls.length === 1); assert.equal(stream.calls(), 3);
  game.completeShooting(); game.nextTurn(); game.nextPhase(); game.nextPhase();
  reject(game, () => game.beginShooting('unit-2'), 'NO_LIVING_MODELS');
});
test('multiple profiles can split fire between different targets, once per profile', () => {
  const game = startedShooting(s => {
    const definition = s.definitions[0]!;
    s.definitions = [{ ...definition, weapons: [definition.weapons[0]!, { ...definition.weapons[0]!, id: 'second-rifle' } as RangedWeapon] }, s.definitions[1]!];
    const extra = createUnit(s.definitions[1]!, 'unit-3', 'player-2', [{ x: 12, y: 16 }, { x: 14, y: 16 }, { x: 16, y: 16 }]);
    s.units.push(extra); s.armies[1]!.unitIds.push(extra.id);
  });
  assert.equal(game.fireWeapon('test-rifle', 'unit-2', dice(1, 1, 1, 1, 1, 1).rng).ok, true);
  reject(game, () => game.fireWeapon('test-rifle', 'unit-3', zeroRandom), 'WEAPON_ALREADY_FIRED');
  assert.equal(game.fireWeapon('second-rifle', 'unit-3', dice(1, 1, 1, 1, 1, 1).rng).ok, true);
  assert.equal(game.completeShooting().ok, true);
});
test('fixed zero attacks consume no RNG and can cancel; dice-zero attacks cannot cancel', () => {
  const fixed = startedShooting(s => rifle(s, { attacks: { kind: 'fixed', value: 0 } }));
  assert.equal(fixed.fireWeapon('test-rifle', 'unit-2', zeroRandom).ok, true); assert.equal(fixed.cancelShooting().ok, true);
  const rolled = startedShooting(s => { oneShooter(s); rifle(s, { attacks: { kind: 'dice', count: 1, sides: 6, modifier: -1 } }); });
  assert.equal(rolled.fireWeapon('test-rifle', 'unit-2', dice(1).rng).ok, true);
  reject(rolled, () => rolled.cancelShooting(), 'SHOOTING_ALREADY_RESOLVED');
});
test('same initial state and seeded RNG produce identical complete state/events', () => {
  function run() { const game = startedShooting(); game.fireWeapon('test-rifle', 'unit-2', createSeededRng(123)); game.completeShooting(); return game.getState(); }
  assert.deepEqual(run(), run());
});
test('query results, combat results and shooting snapshots remain detached', () => {
  const game = startedShooting(); const weapons = game.getRangedWeapons('unit-1');
  if (weapons.ok) (weapons.value[0] as { range: number }).range = 999;
  const result = game.fireWeapon('test-rifle', 'unit-2', dice(1, 1, 1, 1, 1, 1).rng);
  if (result.ok) result.value.hitRolls[0] = 99;
  const snapshot = game.getState(); snapshot.shooting!.firedWeaponIds.length = 0; snapshot.shooting!.hasRolled = false; snapshot.units[1]!.models[0]!.woundsRemaining = 99;
  const event = snapshot.events.find(e => e.type === 'weapon-fired'); if (event?.type === 'weapon-fired') event.resolution.hitRolls[0] = 99;
  const original = game.getState(); assert.equal(original.definitions[0]!.weapons[0]!.kind === 'ranged' && original.definitions[0]!.weapons[0]!.range, 18);
  assert.deepEqual(original.shooting!.firedWeaponIds, ['test-rifle']);
  const fired = original.events.find(e => e.type === 'weapon-fired'); assert.ok(fired?.type === 'weapon-fired' && fired.resolution.hitRolls[0] === 1);
});
test('active shooting snapshot restores fired profiles and cancellation lock', () => {
  const game = startedShooting(); game.fireWeapon('test-rifle', 'unit-2', dice(1, 1, 1, 1, 1, 1).rng);
  const restored = GameEngine.create(JSON.parse(JSON.stringify(game.getState())));
  reject(restored, () => restored.cancelShooting(), 'SHOOTING_ALREADY_RESOLVED'); restored.completeShooting(); game.completeShooting();
  assert.deepEqual(restored.getState(), game.getState());
});
test('a corrupted RNG throws without committing partial damage/events', () => {
  const game = startedShooting(); const before = game.getState();
  assert.throws(() => game.fireWeapon('test-rifle', 'unit-2', dice(6, 6, 1).rng)); assert.deepEqual(game.getState(), before);
});
