import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerrainTestMatch, TERRAIN_SCENARIOS } from '../src/game/data/terrainPrototype';
import { GameEngine } from '../src/game/engine/GameEngine';
import { createVisibilityProvider } from '../src/game/terrain/visibility';
import { plungingFire } from '../src/game/terrain/attackModifiers';
for (const scenario of TERRAIN_SCENARIOS) test(`debug scenario ${scenario} loads and round-trips`, () => {
  const state = createTerrainTestMatch(scenario); const game = GameEngine.create(state);
  assert.deepEqual(GameEngine.create(game.getState()).getState(), state);
});
test('named visibility scenarios demonstrate their stated results', () => {
  for (const [scenario, expected] of [['CLEAR', 'FULLY_VISIBLE'], ['PARTIAL', 'VISIBLE'], ['BLOCKED', 'NOT_VISIBLE'], ['OBSCURING', 'NOT_VISIBLE']] as const) {
    const s = createTerrainTestMatch(scenario); assert.equal(createVisibilityProvider(s).inspect(s.units[0]!.models[0]!, s.units[1]!.models[0]!).level, expected, scenario);
  }
  for (const [scenario, visible] of [['HIDDEN_FAR', false], ['HIDDEN_NEAR', true]] as const) {
    const s = createTerrainTestMatch(scenario); assert.equal(createVisibilityProvider(s).isUnitVisible(s.units[1]!.models[0]!, s.units[0]!), visible, scenario);
  }
  const s = createTerrainTestMatch('PLUNGING'); assert.equal(plungingFire(s, s.units[0]!.models[0]!, s.units[1]!, createVisibilityProvider(s)), true);
});
test('vertical debug scenario can ascend three inches with a normal engine command', () => {
  const s = createTerrainTestMatch('VERTICAL'), game = GameEngine.create(s); game.tryNextPhase(); game.beginMovement('unit-1');
  assert.equal(game.moveModel('unit-1:model:1', { x: 4.5, y: 5, z: 3 }).ok, true);
  assert.equal(game.getState().units[0]!.models[0]!.movementUsed, 3);
});
