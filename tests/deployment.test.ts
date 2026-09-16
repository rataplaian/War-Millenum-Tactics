import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../src/game/engine/GameEngine';
import { createDeploymentTestMatch } from '../src/game/data/deploymentPrototype';
import { validateSetup, horizontalEdgeDistance } from '../src/game/setup/SetupValidator';
import { canDeployUsingInfiltrators } from '../src/game/setup/SetupController';
import { baseRadius } from '../src/game/utils/geometry';
import { declarations, deployAll, formation, stage, ok, no, battle } from './deployment.helpers';

test('pre-battle fixture has six placeholder archetypes per side and detached snapshots', () => {
  const e = new GameEngine(createDeploymentTestMatch()); assert.equal(e.getState().units.length, 12);
  const s = e.getState(); s.deployment!.rules.enemySetupDistance = 0; assert.equal(e.getState().deployment!.rules.enemySetupDistance, 8);
  no(e.beginMovement('deploy-1'), 'PRE_BATTLE'); no(e.tryNextPhase(), 'PRE_BATTLE'); no(e.finishBattle(), 'PRE_BATTLE');
  assert.deepEqual(new GameEngine(e.getState()).getState(), e.getState());
});
test('legal deployment commits atomically and alternates players', () => {
  const e = declarations(); ok(e.advancePreBattle()); const u = e.getState().units[0]!;
  ok(e.beginDeployment(u.id)); stage(e, formation(u, 3, 3)); assert.equal(e.getState().units[0]!.location, 'RESERVES');
  ok(e.previewSetup()); ok(e.completeSetup()); assert.equal(e.getState().units[0]!.location, 'BATTLEFIELD');
  assert.equal(e.getDeploymentOptions().nextPlayerId, 'player-2'); no(e.beginDeployment('deploy-2'), 'WRONG_DEPLOYMENT_PLAYER');
});
test('cancelled deployment restores source/queue exactly and snapshot resumes candidates', () => {
  const e = declarations(); ok(e.advancePreBattle()); const before = e.getState();
  ok(e.beginDeployment('deploy-1')); stage(e, formation(before.units[0]!, 3, 3));
  const restored = new GameEngine(e.getState()); assert.deepEqual(restored.previewSetup(), e.previewSetup());
  ok(restored.cancelSetup()); assert.deepEqual(restored.getState().units, before.units); assert.deepEqual(restored.getState().deployment, before.deployment);
});
for (const [name, x, y, reason] of [['partially outside zone', 3, 7.8, 'OUTSIDE_DEPLOYMENT_ZONE'], ['outside battlefield', 0, 3, 'OUTSIDE_BATTLEFIELD'], ['unsupported elevation', 3, 3, 'UNSUPPORTED_SURFACE']] as const) test(`setup rejects ${name}`, () => {
  const s = createDeploymentTestMatch(), u = s.units[0]!;
  no(validateSetup(s, u, formation(u, x, y, name === 'unsupported elevation' ? 3 : 0), { ownZone: true }), reason);
});
test('wholly-within applies to every model, not just the first', () => {
  const s = createDeploymentTestMatch(), u = s.units[0]!, f = formation(u, 3, 3); f[u.models[1]!.id]!.y = 8;
  no(validateSetup(s, u, f, { ownZone: true }), 'OUTSIDE_DEPLOYMENT_ZONE');
});
test('setup collision within candidate and with battlefield units; reserve coordinates are ignored', () => {
  const s = createDeploymentTestMatch(), u = s.units[0]!;
  ok(validateSetup(s, u, formation(u, 3, 3), { ownZone: true }));
  const f = formation(u, 3, 3); f[u.models[1]!.id] = { x: 3, y: 3 }; no(validateSetup(s, u, f, {}), 'BASE_OVERLAP');
  const other = s.units[1]!; other.location = 'BATTLEFIELD'; other.models.forEach((m, i) => m.position = { x: 3 + i * 1.5, y: 3 });
  no(validateSetup(s, u, formation(u, 3, 3), {}), 'BASE_OVERLAP');
});
test('setup rejects incoherent formation and incomplete model set', () => {
  const s = createDeploymentTestMatch(), u = s.units[0]!, f = formation(u, 3, 3); f[u.models[1]!.id]!.x = 20;
  no(validateSetup(s, u, f, {}), 'INCOHERENT'); delete f[u.models[1]!.id]; no(validateSetup(s, u, f, {}), 'INCOMPLETE_FORMATION');
});
test('supported elevated setup works, overhang and solid terrain reject', () => {
  const s = createDeploymentTestMatch(), u = s.units[0]!;
  ok(validateSetup(s, u, formation(u, 22, 15, 3), {}));
  no(validateSetup(s, u, formation(u, 20.1, 15, 3), {}), 'BASE_OVERHANG');
  no(validateSetup(s, u, formation(u, 22, 15, 2), {}), 'TERRAIN_BLOCKED');
});
test('deployment skips empty side and refuses stage progression with pending units', () => {
  const e = declarations(); ok(e.selectStrategicReserve('deploy-7')); ok(e.advancePreBattle());
  no(e.advancePreBattle(), 'INCOMPLETE_FORMATION'); ok(e.beginDeployment('deploy-1')); stage(e, formation(e.getState().units[0]!, 3, 3)); ok(e.completeSetup());
  no(e.beginDeployment('deploy-7'), 'ALREADY_DEPLOYED'); ok(e.beginDeployment('deploy-8'));
});
test('first-turn hook can select second player without corrupting turn/round or event snapshots', () => {
  const e = declarations(); deployAll(e); ok(e.setFirstTurn('player-2')); ok(e.advancePreBattle());
  assert.equal(e.getDeploymentOptions().scoutUnitIds[0], 'deploy-9');
  while (e.getDeploymentOptions().scoutUnitIds.length) ok(e.skipScout(e.getDeploymentOptions().scoutUnitIds[0]!));
  ok(e.advancePreBattle()); assert.equal(e.getState().activePlayerId, 'player-2'); new GameEngine(e.getState());
  ok(e.tryNextTurn()); assert.equal(e.getState().activePlayerId, 'player-1'); assert.equal(e.getState().round, 1);
  ok(e.tryNextTurn()); assert.equal(e.getState().round, 2); new GameEngine(e.getState());
});
test('Infiltrators legal forward deployment and horizontal enemy zone exclusion', () => {
  const s = createDeploymentTestMatch(), u = s.units[1]!;
  ok(canDeployUsingInfiltrators(s, u, formation(u, 5, 14)));
  no(canDeployUsingInfiltrators(s, u, formation(u, 5, 20)), 'TOO_CLOSE_TO_ENEMY_ZONE');
  const radius = baseRadius(u.models[0]!.base);
  no(canDeployUsingInfiltrators(s, u, formation(u, 5, 28 - 8 - radius)), 'TOO_CLOSE_TO_ENEMY_ZONE');
});
test('Infiltrators enemy distance is strictly over eight horizontally regardless of elevation', () => {
  const s = createDeploymentTestMatch(), u = s.units[1]!, enemy = s.units[6]!;
  enemy.location = 'BATTLEFIELD'; enemy.models.forEach((m, i) => m.position = { x: 22 + i * 1.5, y: 24, z: 30 });
  no(canDeployUsingInfiltrators(s, u, formation(u, 22, 16, 3)), 'TOO_CLOSE_TO_ENEMY');
  assert.equal(horizontalEdgeDistance({ ...u.models[0]!, position: { x: 0, y: 0, z: 90 } }, { ...u.models[0]!, position: { x: 0, y: 0 } }), 0);
});
test('Infiltrators uses the shared terrain and coherency checks', () => {
  const s = createDeploymentTestMatch(), u = s.units[1]!; const f = formation(u, 3, 14); f[u.models[1]!.id]!.x = 20;
  no(canDeployUsingInfiltrators(s, u, f), 'INCOHERENT'); no(canDeployUsingInfiltrators(s, u, formation(u, 22, 15, 2)), 'TERRAIN_BLOCKED');
  no(canDeployUsingInfiltrators(s, s.units[0]!, formation(s.units[0]!, 3, 14)), 'ABILITY_REQUIRED');
});
test('dual ability choice required and Scouts disables Infiltrators', () => {
  const s = createDeploymentTestMatch(), e = new GameEngine(s); ok(e.advancePreBattle());
  no(canDeployUsingInfiltrators(s, s.units[3]!, formation(s.units[3]!, 3, 14)), 'ABILITY_CHOICE_REQUIRED');
  ok(e.chooseDeploymentAbility('deploy-4', 'SCOUTS'));
  no(canDeployUsingInfiltrators(e.getState(), e.getState().units[3]!, formation(s.units[3]!, 3, 14)), 'INCOMPATIBLE_ABILITY');
});
test('Infiltrators choice disables Scouts and persists after deployment snapshot', () => {
  const e = declarations(); ok(e.chooseDeploymentAbility('deploy-4', 'INFILTRATORS')); deployAll(e); ok(e.advancePreBattle());
  assert.ok(!e.getDeploymentOptions().scoutUnitIds.includes('deploy-4')); no(e.beginScoutMove('deploy-4'), 'UNIT_NOT_ELIGIBLE');
  assert.equal(new GameEngine(e.getState()).getState().deployment!.choices['deploy-4'], 'INFILTRATORS');
});
test('all models must have Infiltrators, per-model overrides are explicit', () => {
  const s = createDeploymentTestMatch(), u = s.units[1]!; u.models[0]!.coreAbilities = [];
  no(canDeployUsingInfiltrators(s, u, formation(u, 3, 14)), 'ABILITY_REQUIRED');
});
test('invalid confirmation does not mutate any state; preview is read-only', () => {
  const e = declarations(); ok(e.advancePreBattle()); ok(e.beginDeployment('deploy-1')); stage(e, formation(e.getState().units[0]!, 3, 10));
  const before = e.getState(); no(e.completeSetup(), 'OUTSIDE_DEPLOYMENT_ZONE'); assert.deepEqual(e.getState(), before);
  e.getSetupPreviewSamples(); assert.deepEqual(e.getState(), before);
});
test('started battle cannot reopen setup sequencing', () => { const e = battle(); no(e.advancePreBattle(), 'WRONG_PRE_BATTLE_STEP'); no(e.selectStrategicReserve('deploy-1'), 'WRONG_PRE_BATTLE_STEP'); });
test('Infiltrators deployment command commits forward formation and records chosen ability', () => {
  const e = declarations(); ok(e.advancePreBattle()); ok(e.beginDeployment('deploy-2', true));
  stage(e, formation(e.getState().units[1]!, 5, 14)); ok(e.completeSetup());
  assert.equal(e.getState().deployment!.choices['deploy-2'], 'INFILTRATORS'); assert.ok(e.getState().events.some(e => e.type === 'unit-deployed-using-infiltrators'));
  no(e.chooseDeploymentAbility('deploy-2', 'SCOUTS'), 'ABILITY_REQUIRED'); new GameEngine(e.getState());
});
test('setup can commit exact floating-point coordinates without snapping to preview samples', () => {
  const e = declarations(); ok(e.advancePreBattle()); ok(e.beginDeployment('deploy-1')); const u = e.getState().units[0]!;
  stage(e, formation(u, 3.123456, 4.654321)); ok(e.completeSetup()); assert.equal(e.getState().units[0]!.models[0]!.position.x, 3.123456);
});
