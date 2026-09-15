import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basicLineOfSight, segmentIntersectsRectangle, visibleTargetModels } from '../src/game/rules/visibility';
import { shootingGame, shootingState, rifle } from './shooting.helpers';
const rectangle = { position: { x: 2, y: 2 }, width: 2, height: 2 };
test('segment/rectangle handles crossing, outside, tangency, endpoints and zero-length rays', () => {
  assert.equal(segmentIntersectsRectangle({ x: 0, y: 3 }, { x: 6, y: 3 }, rectangle), true);
  assert.equal(segmentIntersectsRectangle({ x: 3, y: 6 }, { x: 3, y: 0 }, rectangle), true);
  assert.equal(segmentIntersectsRectangle({ x: 0, y: 1 }, { x: 6, y: 1 }, rectangle), false);
  assert.equal(segmentIntersectsRectangle({ x: 0, y: 2 }, { x: 6, y: 2 }, rectangle), true);
  assert.equal(segmentIntersectsRectangle({ x: 0, y: 0 }, { x: 2, y: 2 }, rectangle), true);
  assert.equal(segmentIntersectsRectangle({ x: 0, y: 0 }, { x: 1, y: 1 }, rectangle), false);
  assert.equal(segmentIntersectsRectangle({ x: 3, y: 3 }, { x: 3, y: 3 }, rectangle), true);
  assert.equal(segmentIntersectsRectangle({ x: 1, y: 1 }, { x: 1, y: 1 }, rectangle), false);
});
test('LOS is clear with no blocker; an intersecting opaque rectangle blocks', () => {
  const state = shootingState(); const shooter = state.units[0]!.models[0]!; const target = state.units[1]!.models[0]!;
  assert.equal(basicLineOfSight(shooter, target, state.battlefield), true);
  state.battlefield.losBlockers = [{ id: 'wall', kind: 'rectangle', position: { x: 0, y: 10 }, width: 30, height: 1, opaque: true }];
  assert.equal(basicLineOfSight(shooter, target, state.battlefield), false);
  state.battlefield.losBlockers[0]!.opaque = false; assert.equal(basicLineOfSight(shooter, target, state.battlefield), true);
});
test('rectangle outside the ray and other models do not occlude', () => {
  const state = shootingState(); const shooter = state.units[0]!.models[0]!; const target = state.units[1]!.models[0]!;
  state.battlefield.losBlockers = [{ id: 'side', kind: 'rectangle', position: { x: 20, y: 10 }, width: 1, height: 1, opaque: true }];
  state.units[0]!.models[1]!.position = { x: 4.5, y: 10 };
  assert.equal(basicLineOfSight(shooter, target, state.battlefield), true);
});
test('one visible living model makes a target legal; dead visible models do not', () => {
  const state = shootingState(s => {
    rifle(s, { range: 30 }); s.units[1]!.models[2]!.position.x = 20;
    s.battlefield.losBlockers = [{ id: 'wall', kind: 'rectangle', position: { x: 0, y: 10 }, width: 8, height: 1, opaque: true }];
  });
  const shooter = state.units[0]!.models[0]!;
  assert.deepEqual(visibleTargetModels(shooter, state.units[1]!.models, state.battlefield).map(m => m.id), ['unit-2:model:3']);
  const game = shootingGame(s => Object.assign(s, state));
  const legal = game.getLegalTargets('unit-1', 'test-rifle'); assert.ok(legal.ok && legal.value.length === 1);
  state.units[1]!.models[2]!.alive = false; state.units[1]!.models[2]!.woundsRemaining = 0;
  assert.deepEqual(visibleTargetModels(shooter, state.units[1]!.models, state.battlefield), []);
});
test('visibility policy can be replaced without changing the shooting engine', () => {
  const game = shootingGame(undefined, { visibility: () => false });
  const legal = game.getLegalTargets('unit-1', 'test-rifle'); assert.deepEqual(legal, { ok: true, value: [] });
});
