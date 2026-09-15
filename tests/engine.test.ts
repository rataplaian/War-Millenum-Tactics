import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../src/game/engine/GameEngine';
import { createUnit } from '../src/game/engine/createUnit';
import { createTestMatch, PROTOTYPE_UNITS } from '../src/game/data/prototype';
import { PHASES } from '../src/game/models';
const engine = () => GameEngine.create(createTestMatch());
test('creation initializes two players, armies and units', () => {
  const state = engine().getState();
  assert.equal(state.round, 1); assert.equal(state.turn, 1); assert.equal(state.phase, 'Command');
  assert.equal(state.activePlayerId, 'player-1'); assert.equal(state.status, 'in-progress');
  assert.equal(state.players.length, 2); assert.equal(state.armies.length, 2); assert.equal(state.units.length, 2);
  assert.deepEqual(state.armies.map(a => a.unitIds), [['unit-1'], ['unit-2']]);
});
test('each of the five phases progresses in order', () => {
  const game = engine();
  for (const phase of PHASES.slice(1)) { assert.equal(game.nextPhase().phase, phase); assert.equal(game.getState().activePlayerId, 'player-1'); }
  const next = game.nextPhase(); assert.equal(next.phase, 'Command'); assert.equal(next.activePlayerId, 'player-2'); assert.equal(next.round, 1);
});
test('ten phases complete a round; direct turns reset flags', () => {
  const game = engine(); for (let i = 0; i < 10; i++) game.nextPhase();
  assert.equal(game.getState().round, 2); assert.equal(game.getState().turn, 3); assert.equal(game.getState().activePlayerId, 'player-1');
  const state = game.getState(); state.units[0]!.state.hasMoved = true; game.loadMatch(state);
  assert.equal(game.nextTurn().units[0]!.state.hasMoved, false);
  assert.equal(game.nextTurn().round, 3);
});
test('units initialize unique models at fractional coordinates with full wounds', () => {
  const state = createTestMatch(); const models = state.units.flatMap(u => u.models);
  assert.equal(new Set(models.map(m => m.id)).size, 6);
  for (const unit of state.units) for (const model of unit.models) {
    assert.equal(model.unitId, unit.id); assert.equal(model.woundsRemaining, state.definitions.find(d => d.id === unit.definitionId)!.stats.wounds); assert.equal(model.alive, true);
  }
  assert.deepEqual(state.units[0]!.models[0]!.position, { x: 4.5, y: 4.5 });
  assert.equal(state.units[0]!.state.hasShot, false);
});
test('snapshots and fixtures are isolated from external mutations', () => {
  const source = createTestMatch(); const game = GameEngine.create(source);
  source.units[0]!.models[0]!.position.x = 900;
  const snapshot = game.getState(); snapshot.units[0]!.models[0]!.woundsRemaining = 900;
  assert.equal(game.getState().units[0]!.models[0]!.position.x, 4.5);
  assert.equal(game.getState().units[0]!.models[0]!.woundsRemaining, 1);
  assert.equal(PROTOTYPE_UNITS[0]!.stats.wounds, 1);
});
test('JSON snapshot round trip continues identically', () => {
  const original = engine(); original.nextTurn(); original.nextPhase();
  const restored = engine(); const snapshot = JSON.parse(JSON.stringify(original.getState())); restored.loadMatch(snapshot);
  snapshot.round = 99;
  assert.deepEqual(restored.nextPhase(), original.nextPhase());
});
test('invalid snapshots fail without replacing the current match', () => {
  const game = engine();
  for (const change of [
    (s: ReturnType<typeof createTestMatch>) => { s.round = 0; },
    (s: ReturnType<typeof createTestMatch>) => { s.activePlayerId = 'missing'; },
    (s: ReturnType<typeof createTestMatch>) => { s.units[0]!.models[0]!.alive = false; },
    (s: ReturnType<typeof createTestMatch>) => { s.armies[0]!.unitIds = ['missing']; },
    (s: ReturnType<typeof createTestMatch>) => { s.units[0]!.models[1]!.id = s.units[0]!.models[0]!.id; },
    (s: ReturnType<typeof createTestMatch>) => { s.units[0]!.models[0]!.position.x = Infinity; },
  ]) { const state = createTestMatch(); change(state); assert.throws(() => game.loadMatch(state)); }
  assert.deepEqual(game.getState(), createTestMatch());
});
test('finished matches cannot advance', () => {
  const state = createTestMatch(); state.status = 'finished'; const game = GameEngine.create(state);
  assert.throws(() => game.nextPhase()); assert.throws(() => game.nextTurn());
});
test('unit creation rejects mismatched positions and does not retain input references', () => {
  assert.throws(() => createUnit(PROTOTYPE_UNITS[0]!, 'u', 'p', []));
  const positions = [{ x: 0.1, y: 0.2 }, { x: 1.1, y: 0.2 }, { x: 2.1, y: 0.2 }];
  const unit = createUnit(PROTOTYPE_UNITS[0]!, 'u', 'p', positions); positions[0]!.x = 99;
  assert.equal(unit.models[0]!.position.x, 0.1);
});
