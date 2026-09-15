import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CoherencyRule, Model } from '../src/game/models';
import { checkCoherency, enemyModelsWithinEngagement, isUnitEngaged } from '../src/game/rules/spatial';
import { createTestMatch } from '../src/game/data/prototype';
const rule: CoherencyRule = { maxEdgeDistance: 1, sizeBands: [{ minModels: 1, requiredNeighbours: 1 }], requireConnected: true };
function models(points: number[][]): Model[] {
  return points.map(([x, y], i) => ({ id: `m${i}`, unitId: 'u', position: { x: x!, y: y! }, base: { kind: 'circle', diameterMm: 25.4 }, alive: true, woundsRemaining: 1, movementUsed: 0 }));
}
test('coherent line includes exact edge-distance threshold', () => {
  assert.equal(checkCoherency(models([[0, 0], [2, 0], [4, 0]]), rule).coherent, true);
});
test('coherent cluster satisfies two neighbours per model', () => {
  const clusterRule = { ...rule, sizeBands: [{ minModels: 1, requiredNeighbours: 1 }, { minModels: 3, requiredNeighbours: 2 }] };
  assert.equal(checkCoherency(models([[0, 0], [1, 0], [0.5, 1]]), clusterRule).coherent, true);
});
test('broken formation identifies isolated model', () => {
  const result = checkCoherency(models([[0, 0], [1, 0], [10, 0]]), rule);
  assert.equal(result.coherent, false); assert.deepEqual(result.failingModelIds, ['m2']);
});
test('one living model is coherent regardless of neighbour bands', () => {
  assert.equal(checkCoherency(models([[0, 0]]), rule).coherent, true);
  const pair = models([[0, 0], [10, 0]]); pair[1]!.alive = false;
  assert.equal(checkCoherency(pair, rule).coherent, true);
});
test('disconnected pairs fail connectivity despite enough local neighbours', () => {
  const pairs = models([[0, 0], [1, 0], [10, 0], [11, 0]]);
  assert.equal(checkCoherency(pairs, rule).coherent, false);
  assert.equal(checkCoherency(pairs, { ...rule, requireConnected: false }).coherent, true);
});
test('size bands use living size and thresholds are configurable', () => {
  const line = models([[0, 0], [2, 0], [4, 0]]);
  const bands = { ...rule, sizeBands: [{ minModels: 1, requiredNeighbours: 1 }, { minModels: 3, requiredNeighbours: 2 }] };
  assert.equal(checkCoherency(line, bands).coherent, false);
  line[2]!.alive = false; assert.equal(checkCoherency(line, bands).coherent, true);
  assert.equal(checkCoherency(line, { ...rule, maxEdgeDistance: 0.9 }).coherent, false);
});
test('engagement is enemy-only, inclusive at edge threshold and ignores dead models', () => {
  const state = createTestMatch(); const friendly = state.units[0]!; const enemy = state.units[1]!.models[0]!;
  for (const unit of state.units) for (const model of unit.models) model.base.diameterMm = 25.4;
  friendly.models[0]!.position = { x: 1, y: 1 }; enemy.position = { x: 3, y: 1 };
  assert.deepEqual(enemyModelsWithinEngagement(state, friendly.playerId, friendly.models[0]!).map(m => m.id), [enemy.id]);
  assert.equal(isUnitEngaged(state, friendly), true);
  state.spatialRules.engagementDistance = 0.9; assert.equal(isUnitEngaged(state, friendly), false);
  state.spatialRules.engagementDistance = 1; enemy.alive = false; assert.equal(isUnitEngaged(state, friendly), false);
});
