import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../src/game/engine/GameEngine';
import { createDeploymentTestMatch } from '../src/game/data/deploymentPrototype';
import { rectangle } from '../src/game/terrain/geometry';
import { declarations, deployAll, formation, stage, ok, no } from './deployment.helpers';
function ready() { const e = declarations(); deployAll(e); ok(e.advancePreBattle()); return e; }
test('Scouts first-turn player resolves before opponent and first turn waits for all opportunities', () => {
  const e = ready(); no(e.beginScoutMove('deploy-9'), 'WRONG_DEPLOYMENT_PLAYER'); no(e.advancePreBattle(), 'SCOUTS_PENDING');
  ok(e.skipScout('deploy-3')); ok(e.skipScout('deploy-4')); ok(e.beginScoutMove('deploy-9'));
});
test('Scouts exactly six inches legal, cumulative excess rejected without mutation', () => {
  const e = ready(); ok(e.beginScoutMove('deploy-3')); const m = e.getState().units[2]!.models[0]!;
  ok(e.moveScoutModel(m.id, { x: m.position.x, y: m.position.y + 6 })); const before = e.getState();
  no(e.moveScoutModel(m.id, { x: m.position.x, y: m.position.y + 6.1 }), 'EXCEEDS_ALLOWANCE'); assert.deepEqual(e.getState(), before);
});
test('Scouts preserves normal allowance, cancels exactly and can resume from snapshot', () => {
  const e = ready(), original = e.getState().units[2]!; ok(e.beginScoutMove(original.id));
  for (const m of original.models) ok(e.moveScoutModel(m.id, { x: m.position.x, y: m.position.y + 2 }));
  const restored = new GameEngine(e.getState()); ok(restored.cancelScoutMove()); assert.deepEqual(restored.getState().units[2], original);
  const committed = new GameEngine(e.getState()); ok(committed.completeScoutMove()); assert.ok(committed.getState().units[2]!.models.every(m => m.movementUsed === 0)); assert.equal(committed.getState().units[2]!.state.hasMoved, false);
});
test('Scouts completion rejects incoherency and remains editable', () => {
  const e = ready(); ok(e.beginScoutMove('deploy-3')); const m = e.getState().units[2]!.models[0]!;
  ok(e.moveScoutModel(m.id, { x: m.position.x, y: m.position.y + 6 })); no(e.completeScoutMove(), 'INCOHERENT'); assert.ok(e.getState().scout);
});
test('Scouts enemy distance is enforced horizontally', () => {
  const e = ready(), s = e.getState(); const enemy = s.units[7]!;
  enemy.models.forEach((m, i) => m.position = { x: 15 + i * 1.5, y: 16 }); e.loadMatch(s);
  ok(e.beginScoutMove('deploy-3')); const m = s.units[2]!.models[0]!;
  no(e.moveScoutModel(m.id, { x: 15, y: 8 }), 'TOO_CLOSE_TO_ENEMY');
});
test('Scouts calls shared Dense terrain validator, respecting model keywords', () => {
  const e = ready(), s = e.getState(); const d = s.definitions.find(d => d.id === s.units[2]!.definitionId)!;
  s.definitions = s.definitions.map(x => x.id === d.id ? { ...x, keywords: ['VEHICLE'] } : x);
  s.battlefield.terrain = { areas: [{ id: 'a', footprint: rectangle(12, 4, 8, 2), featureIds: ['f'], metadata: {} }], features: [{ id: 'f', terrainAreaId: 'a', footprint: rectangle(12, 4, 8, 2), height: 4, category: 'DENSE', sections: [{ footprint: rectangle(12, 4, 8, 2), minZ: 0, maxZ: 4 }], openings: [], surfaces: [] }] };
  e.loadMatch(s); ok(e.beginScoutMove('deploy-3')); no(e.moveScoutModel(s.units[2]!.models[0]!.id, { x: 15, y: 7 }), 'TERRAIN_BLOCKED');
});
test('Scouts requires every model and uses minimum of best per-model distances', () => {
  const s = createDeploymentTestMatch(); s.units[2]!.models[0]!.coreAbilities = [{ kind: 'SCOUTS', distance: 4 }, { kind: 'SCOUTS', distance: 5 }];
  const e = declarations(s); deployAll(e); ok(e.advancePreBattle()); ok(e.beginScoutMove('deploy-3')); assert.equal(e.getState().scout!.allowance, 5);
});
test('Scouts cannot begin outside own zone', () => {
  const e = ready(), s = e.getState(); s.units[2]!.models.forEach(m => m.position.y = 10); e.loadMatch(s); no(e.beginScoutMove('deploy-3'), 'OUTSIDE_DEPLOYMENT_ZONE');
});
test('Scouts reserve option sets up in own zone without a second scout action', () => {
  const e = declarations(); ok(e.selectStrategicReserve('deploy-3')); deployAll(e); ok(e.advancePreBattle());
  ok(e.beginScoutSetup('deploy-3')); stage(e, formation(e.getState().units[2]!, 15, 3)); ok(e.completeSetup());
  assert.equal(e.getState().units[2]!.location, 'BATTLEFIELD'); no(e.beginScoutMove('deploy-3'), 'UNIT_NOT_ELIGIBLE'); new GameEngine(e.getState());
});
test('Scouts completed choice cannot change and dual unit cannot use Infiltrators later', () => {
  const e = ready(); ok(e.skipScout('deploy-3')); ok(e.beginScoutMove('deploy-4')); ok(e.completeScoutMove());
  assert.equal(e.getState().deployment!.choices['deploy-4'], 'SCOUTS'); no(e.chooseDeploymentAbility('deploy-4', 'INFILTRATORS'), 'WRONG_PRE_BATTLE_STEP');
});
