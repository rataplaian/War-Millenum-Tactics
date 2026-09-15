import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseInsideBattlefield, baseRadius, basesOverlap, centreDistance, distanceTravelled, edgeDistance, inchesToMm, mmToInches, positionInsideBattlefield } from '../src/game/utils/geometry';
import { coordinateTransform } from '../src/ui/coordinates';
const circle = (x: number, y: number, diameterMm = 25.4) => ({ position: { x, y }, base: { kind: 'circle' as const, diameterMm } });
test('inch/mm conversion and circular radius retain fractional precision', () => {
  assert.equal(mmToInches(25.4), 1); assert.equal(inchesToMm(1), 25.4);
  assert.ok(Math.abs(inchesToMm(mmToInches(32)) - 32) < 1e-12);
  assert.equal(baseRadius(circle(0, 0).base), 0.5);
});
test('centre distance and travel use continuous Euclidean geometry', () => {
  assert.equal(centreDistance({ x: 0.5, y: 0.5 }, { x: 3.5, y: 4.5 }), 5);
  assert.equal(distanceTravelled({ x: 1.2, y: 7.4 }, { x: 1.2, y: 7.4 }), 0);
});
test('edge gap uses both base sizes and clamps overlap to zero', () => {
  assert.equal(edgeDistance(circle(0, 0), circle(3, 0, 50.8)), 1.5);
  assert.equal(edgeDistance(circle(0, 0), circle(0.25, 0)), 0);
});
test('overlap excludes tangency and includes containment', () => {
  assert.equal(basesOverlap(circle(0, 0), circle(1, 0)), false);
  assert.equal(basesOverlap(circle(0, 0), circle(0.99, 0)), true);
  assert.equal(basesOverlap(circle(0, 0), circle(0, 0, 50.8)), true);
});
test('point bounds include corners and reject invalid/negative positions', () => {
  const field = { width: 30, height: 24 };
  assert.equal(positionInsideBattlefield({ x: 30, y: 24 }, field), true);
  for (const p of [{ x: -0.01, y: 1 }, { x: 1, y: 24.01 }, { x: NaN, y: 1 }]) assert.equal(positionInsideBattlefield(p, field), false);
});
test('base bounds check the entire radius on all four sides', () => {
  const field = { width: 10, height: 8 };
  for (const [x, y] of [[0.5, 0.5], [9.5, 7.5]]) assert.equal(baseInsideBattlefield(circle(x!, y!), field), true);
  for (const [x, y] of [[0.49, 3], [9.51, 3], [3, 0.49], [3, 7.51]]) assert.equal(baseInsideBattlefield(circle(x!, y!), field), false);
});
test('coordinate conversion is reversible across sizes and letterboxing', () => {
  const field = { width: 30, height: 24 };
  for (const viewport of [{ width: 300, height: 240 }, { width: 960, height: 400 }, { width: 360, height: 800 }]) {
    const map = coordinateTransform(field, viewport);
    const p = { x: 6.125, y: 14.375 };
    const restored = map.screenToGame(map.gameToScreen(p));
    assert.ok(Math.abs(restored.x - p.x) < 1e-12); assert.ok(Math.abs(restored.y - p.y) < 1e-12);
    const outside = map.screenToGame({ x: -1000, y: -1000 });
    assert.ok(outside.x < 0 && outside.y < 0); // conversion must not clamp illegal game positions
  }
  assert.throws(() => coordinateTransform(field, { width: 0, height: 100 }));
});
