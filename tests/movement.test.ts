import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../src/game/engine/GameEngine';
import { createTestMatch } from '../src/game/data/prototype';
import type { CommandResult, FailureReason, GameState } from '../src/game/models';
const id = 'unit-1:model:1';
function game(edit?: (s: GameState) => void) {
  const state = createTestMatch(); state.phase = 'Movement'; edit?.(state); return GameEngine.create(state);
}
function started(edit?: (s: GameState) => void) { const engine = game(edit); assert.equal(engine.beginMovement('unit-1').ok, true); return engine; }
function rejected(engine: GameEngine, action: () => CommandResult<unknown>, reason: FailureReason) {
  const before = engine.getState(); const result = action();
  assert.equal(result.ok, false); if (!result.ok) assert.equal(result.reason, reason);
  assert.deepEqual(engine.getState(), before); return result;
}
test('legal move updates position and cumulative engine-owned usage', () => {
  const engine = started(); const result = engine.moveModel(id, { x: 4.5, y: 6.5 });
  assert.deepEqual(result, { ok: true, value: { distance: 2, totalUsed: 2, remaining: 5 } });
  assert.deepEqual(engine.getState().units[0]!.models[0]!.position, { x: 4.5, y: 6.5 });
});
test('exact maximum movement succeeds; further movement fails unchanged', () => {
  const engine = started(); assert.equal(engine.moveModel(id, { x: 4.5, y: 11.5 }).ok, true);
  rejected(engine, () => engine.moveModel(id, { x: 4.5, y: 11.6 }), 'EXCEEDS_ALLOWANCE');
});
test('excessive movement and invalid coordinates are rejected unchanged', () => {
  const engine = started(); rejected(engine, () => engine.moveModel(id, { x: 4.5, y: 11.51 }), 'EXCEEDS_ALLOWANCE');
  for (const n of [NaN, Infinity, -Infinity]) rejected(engine, () => engine.moveModel(id, { x: n, y: 4.5 }), 'INVALID_POSITION');
});
test('full base outside the configurable battlefield is rejected', () => {
  const engine = started(); rejected(engine, () => engine.moveModel(id, { x: 0.1, y: 4.5 }), 'OUTSIDE_BATTLEFIELD');
  const small = started(s => { s.battlefield.width = 8.2; });
  rejected(small, () => small.moveModel('unit-1:model:3', { x: 8.1, y: 4.5 }), 'OUTSIDE_BATTLEFIELD');
});
test('friendly collision reports blocking model and leaves all state unchanged', () => {
  const engine = started(); const result = rejected(engine, () => engine.moveModel(id, { x: 6, y: 4.5 }), 'BASE_OVERLAP');
  if (!result.ok) assert.equal(result.blockingModelId, 'unit-1:model:2');
});
test('enemy collision is rejected before engagement checks', () => {
  const engine = started(s => { s.units[1]!.models[0]!.position = { x: 4.5, y: 9 }; });
  const result = rejected(engine, () => engine.moveModel(id, { x: 4.5, y: 9 }), 'BASE_OVERLAP');
  if (!result.ok) assert.equal(result.blockingModelId, 'unit-2:model:1');
});
test('tangent friendly bases are legal; dead models do not block', () => {
  const engine = started(s => { for (const m of s.units[0]!.models) m.base.diameterMm = 25.4; });
  assert.equal(engine.moveModel(id, { x: 5, y: 4.5 }).ok, true);
  const dead = started(s => { s.units[0]!.models[1]!.alive = false; s.units[0]!.models[1]!.woundsRemaining = 0; });
  assert.equal(dead.moveModel(id, { x: 6, y: 4.5 }).ok, true);
});
test('wrong phase and finished match reject normal actions', () => {
  const engine = game(s => { s.phase = 'Command'; });
  rejected(engine, () => engine.beginMovement('unit-1'), 'WRONG_PHASE');
  rejected(engine, () => engine.moveModel(id, { x: 4.5, y: 5 }), 'WRONG_PHASE');
  rejected(engine, () => engine.cancelMovement(), 'WRONG_PHASE');
  rejected(engine, () => engine.completeMovement(), 'WRONG_PHASE');
  const finished = game(s => { s.status = 'finished'; });
  rejected(finished, () => finished.beginMovement('unit-1'), 'MATCH_FINISHED');
});
test('enemy unit/model movement and nonexistent IDs are rejected', () => {
  const engine = game(); rejected(engine, () => engine.beginMovement('unit-2'), 'NOT_YOUR_UNIT');
  rejected(engine, () => engine.beginMovement('missing'), 'UNIT_NOT_FOUND');
  assert.equal(engine.beginMovement('unit-1').ok, true);
  rejected(engine, () => engine.moveModel('unit-2:model:1', { x: 4, y: 4 }), 'MODEL_NOT_IN_UNIT');
  rejected(engine, () => engine.moveModel('missing', { x: 4, y: 4 }), 'MODEL_NOT_IN_UNIT');
});
test('commands require an action; only one unit action is active', () => {
  const engine = game(); rejected(engine, () => engine.moveModel(id, { x: 4.5, y: 5 }), 'NO_ACTIVE_MOVEMENT');
  rejected(engine, () => engine.cancelMovement(), 'NO_ACTIVE_MOVEMENT');
  rejected(engine, () => engine.completeMovement(), 'NO_ACTIVE_MOVEMENT');
  engine.beginMovement('unit-1'); rejected(engine, () => engine.beginMovement('unit-1'), 'MOVEMENT_IN_PROGRESS');
  rejected(engine, () => engine.tryNextPhase(), 'MOVEMENT_IN_PROGRESS');
  rejected(engine, () => engine.tryNextTurn(), 'MOVEMENT_IN_PROGRESS');
  assert.throws(() => engine.nextPhase()); assert.equal(engine.getState().phase, 'Movement');
});
test('models move independently; returning towards origin still consumes distance', () => {
  const engine = started(); engine.moveModel(id, { x: 4.5, y: 7.5 }); engine.moveModel(id, { x: 4.5, y: 5.5 });
  engine.moveModel('unit-1:model:2', { x: 6, y: 6.5 });
  assert.deepEqual(engine.getState().units[0]!.models.map(m => m.movementUsed), [5, 2, 0]);
  rejected(engine, () => engine.moveModel(id, { x: 4.5, y: 8.5 }), 'EXCEEDS_ALLOWANCE');
});
test('cancel restores exact fractional positions and usage after multiple moves', () => {
  const engine = game(); const original = engine.getState().units;
  engine.beginMovement('unit-1'); engine.moveModel(id, { x: 3.125, y: 5.375 }); engine.moveModel('unit-1:model:2', { x: 6, y: 7 });
  assert.equal(engine.cancelMovement().ok, true); assert.deepEqual(engine.getState().units, original);
  assert.equal(engine.getState().movement, null); assert.equal(engine.beginMovement('unit-1').ok, true);
});
test('complete commits coherent formation and prevents a second normal move', () => {
  const engine = started(); for (const model of engine.getState().units[0]!.models) {
    assert.equal(engine.moveModel(model.id, { ...model.position, y: model.position.y + 2 }).ok, true);
  }
  assert.equal(engine.completeMovement().ok, true); const state = engine.getState();
  assert.equal(state.units[0]!.state.hasMoved, true); assert.equal(state.movement, null);
  assert.deepEqual(state.units[0]!.models.map(m => m.position.y), [6.5, 6.5, 6.5]);
  rejected(engine, () => engine.beginMovement('unit-1'), 'ALREADY_MOVED');
  rejected(engine, () => engine.cancelMovement(), 'NO_ACTIVE_MOVEMENT');
});
test('incoherent completion leaves transaction open for correction or cancel', () => {
  const engine = started(); engine.moveModel(id, { x: 4.5, y: 11.5 });
  rejected(engine, () => engine.completeMovement(), 'INCOHERENT');
  assert.equal(engine.cancelMovement().ok, true);
});
test('unit with one living model can complete movement', () => {
  const engine = started(s => { for (const m of s.units[0]!.models.slice(1)) { m.alive = false; m.woundsRemaining = 0; } });
  assert.equal(engine.moveModel(id, { x: 4.5, y: 11.5 }).ok, true); assert.equal(engine.completeMovement().ok, true);
});
test('destroyed units and dead models cannot move', () => {
  const engine = started(s => { s.units[0]!.models[1]!.alive = false; s.units[0]!.models[1]!.woundsRemaining = 0; });
  rejected(engine, () => engine.moveModel('unit-1:model:2', { x: 6, y: 6 }), 'MODEL_DEAD');
  const dead = game(s => { for (const m of s.units[0]!.models) { m.alive = false; m.woundsRemaining = 0; } });
  rejected(dead, () => dead.beginMovement('unit-1'), 'NO_LIVING_MODELS');
});
test('normal movement cannot start engaged or end in configurable engagement distance', () => {
  const engaged = game(s => { s.units[1]!.models[0]!.position = { x: 4.5, y: 6 }; });
  rejected(engaged, () => engaged.beginMovement('unit-1'), 'UNIT_ENGAGED');
  const engine = started(s => { s.units[1]!.models[0]!.position = { x: 4.5, y: 10 }; });
  rejected(engine, () => engine.moveModel(id, { x: 4.5, y: 8 }), 'ENEMY_ENGAGEMENT');
});
test('endpoint-only policy permits crossing a blocker when destination is clear', () => {
  const engine = started(); assert.equal(engine.moveModel(id, { x: 10, y: 4.5 }).ok, true);
});
test('usage and completed flags reset at turn boundary', () => {
  const engine = started(); engine.moveModel(id, { x: 4.5, y: 5.5 }); engine.completeMovement();
  engine.nextTurn(); engine.nextTurn(); engine.nextPhase();
  assert.equal(engine.getState().units[0]!.models[0]!.movementUsed, 0);
  assert.equal(engine.beginMovement('unit-1').ok, true);
});
test('identical command streams yield identical states and ordered events', () => {
  function run() { const engine = started(); engine.moveModel(id, { x: 4.5, y: 5.5 }); engine.cancelMovement(); engine.beginMovement('unit-1'); engine.completeMovement(); return engine.getState(); }
  assert.deepEqual(run(), run()); assert.deepEqual(run().events.map(e => e.type), ['movement-started', 'model-moved', 'movement-cancelled', 'movement-started', 'movement-completed']);
  assert.deepEqual(run().events.map(e => e.sequence), [1, 2, 3, 4, 5]);
});
test('preview, target objects, catalog and detached transaction snapshots cannot mutate engine', () => {
  const engine = started(); const before = engine.getState(); const target = { x: 4.5, y: 5.5 };
  assert.equal(engine.previewMove(id, target).ok, true); assert.deepEqual(engine.getState(), before);
  engine.moveModel(id, target); target.x = 900;
  const snapshot = engine.getState(); snapshot.movement!.originals[0]!.position.x = 900;
  snapshot.units[0]!.models[0]!.base.diameterMm = 999; snapshot.events.length = 0;
  // Deliberately bypass static readonly checks to verify the runtime boundary too.
  (snapshot.definitions[0]!.stats as { movement: number }).movement = 999;
  assert.equal(engine.getState().definitions[0]!.stats.movement, 7);
  assert.equal(engine.getState().units[0]!.models[0]!.position.x, 4.5);
  engine.cancelMovement(); assert.equal(engine.getState().units[0]!.models[0]!.position.x, 4.5);
});
test('mid-movement JSON snapshot can resume and cancel exactly', () => {
  const engine = started(); engine.moveModel(id, { x: 4.5, y: 5.75 });
  const restored = GameEngine.create(JSON.parse(JSON.stringify(engine.getState())));
  assert.deepEqual(restored.moveModel(id, { x: 4.5, y: 6.25 }), engine.moveModel(id, { x: 4.5, y: 6.25 }));
  restored.cancelMovement(); engine.cancelMovement(); assert.deepEqual(restored.getState(), engine.getState());
});
test('invalid geometry, catalog, configuration and transaction snapshots fail atomically', () => {
  const engine = started(); const before = engine.getState();
  const edits: ((s: GameState) => void)[] = [
    s => { s.battlefield.width = 0; }, s => { s.spatialRules.engagementDistance = NaN; },
    s => { s.spatialRules.coherency.sizeBands = []; }, s => { s.units[0]!.definitionId = 'missing'; },
    s => { s.units[0]!.models[0]!.base.diameterMm = -1; },
    s => { s.units[0]!.models[0]!.movementUsed = 8; },
    s => { s.movement!.originals[0]!.position.x = 20; },
    s => { s.movement!.originals[0]!.modelId = 'missing'; },
    s => { s.phase = 'Fight'; },
  ];
  for (const edit of edits) { const snapshot = engine.getState(); edit(snapshot); assert.throws(() => engine.loadMatch(snapshot)); assert.deepEqual(engine.getState(), before); }
});
