import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../src/game/engine/GameEngine';
import { createDeploymentTestMatch } from '../src/game/data/deploymentPrototype';
import { validateSetup } from '../src/game/setup/SetupValidator';
import { createVisibilityProvider } from '../src/game/terrain/visibility';
import { isUnitEngaged } from '../src/game/rules/spatial';
import { getModelsEligibleToFight } from '../src/game/rules/closeCombat';
import { declarations, battle, toRound, formation, stage, ok, no } from './deployment.helpers';
import { baseRadius } from '../src/game/utils/geometry';

test('reserve selection updates location and points; deselect returns to pending deployment', () => {
  const e = declarations(); ok(e.selectStrategicReserve('deploy-1'));
  assert.equal(e.getState().units[0]!.location, 'STRATEGIC_RESERVES'); assert.equal(e.getDeploymentOptions().points[0]!.used, 100);
  ok(e.selectStrategicReserve('deploy-1', false)); assert.equal(e.getDeploymentOptions().points[0]!.used, 0); assert.equal(e.getState().units[0]!.location, 'RESERVES');
});
for (const ratio of [0.5, 0.25, 1]) test(`reserve points ratio ${ratio} is configurable and allows exact limit`, () => {
  const s = createDeploymentTestMatch(); s.deployment!.pointsLimit = 400; s.deployment!.rules.strategicReservePointsLimitRatio = ratio;
  const e = declarations(s); for (let i = 1; i <= 4 * ratio; i++) ok(e.selectStrategicReserve(`deploy-${i}`));
  const before = e.getState(); no(e.selectStrategicReserve(`deploy-${4 * ratio + 1}`), 'RESERVE_POINTS_LIMIT'); assert.deepEqual(e.getState(), before);
});
test('Fortification cannot be placed into initial Strategic Reserves', () => { const e = declarations(); no(e.selectStrategicReserve('deploy-6'), 'FORTIFICATION_FORBIDDEN'); });
test('reserve limits are per player and selection is idempotent', () => {
  const e = declarations(); ok(e.selectStrategicReserve('deploy-1')); ok(e.selectStrategicReserve('deploy-1')); ok(e.selectStrategicReserve('deploy-7'));
  assert.deepEqual(e.getDeploymentOptions().points.map(p => p.used), [100, 100]);
});
test('Ingress is a Movement action, unavailable in round one, available in round two', () => {
  const e = battle(['deploy-5']); no(e.beginIngress('deploy-5', 'DEEP_STRIKE'), 'WRONG_PHASE'); ok(e.tryNextPhase());
  no(e.beginIngress('deploy-5', 'DEEP_STRIKE'), 'INGRESS_TOO_EARLY'); toRound(e, 2); ok(e.tryNextPhase()); ok(e.beginIngress('deploy-5', 'DEEP_STRIKE'));
  no(e.tryNextPhase(), 'SETUP_IN_PROGRESS'); no(e.beginMovement('deploy-1'), 'SETUP_IN_PROGRESS');
});
test('minimum ingress round is configurable', () => {
  const e = battle(['deploy-5'], s => { s.deployment!.rules.standardIngressMinimumRound = 1; }); ok(e.tryNextPhase()); ok(e.beginIngress('deploy-5', 'DEEP_STRIKE'));
});
test('standard Ingress requires one common edge, full base within six inches', () => {
  const e = battle(['deploy-1']); toRound(e, 2); ok(e.tryNextPhase()); ok(e.beginIngress('deploy-1', 'STRATEGIC_EDGE'));
  const u = e.getState().units[0]!;
  stage(e, formation(u, 2, 16)); ok(e.previewSetup());
  stage(e, formation(u, 7, 16)); no(e.previewSetup(), 'NOT_WITHIN_EDGE');
  const r = baseRadius(u.models[0]!.base); const f = formation(u, 3, 16); f[u.models[1]!.id]!.x = 6 - r; stage(e, f); ok(e.previewSetup());
  f[u.models[1]!.id]!.x += 0.01; stage(e, f); no(e.previewSetup(), 'NOT_WITHIN_EDGE');
});
test('models near different edges do not satisfy common-edge contract', () => {
  const s = createDeploymentTestMatch(), u = s.units[0]!, f = formation(u, 2, 16); f[u.models[1]!.id] = { x: 46, y: 16 };
  no(validateSetup(s, u, f, { edgeDistance: 6 }), 'NOT_WITHIN_EDGE');
});
test('ingress enemy distance is strictly greater than eight horizontal base inches', () => {
  const e = battle(['deploy-1']); toRound(e, 2); ok(e.tryNextPhase()); ok(e.beginIngress('deploy-1', 'STRATEGIC_EDGE'));
  const s = e.getState(), u = s.units[0]!, enemy = s.units[6]!.models[0]!;
  const y = enemy.position.y - 8 - baseRadius(enemy.base) - baseRadius(u.models[0]!.base);
  stage(e, formation(u, 3, y)); no(e.previewSetup(), 'TOO_CLOSE_TO_ENEMY');
  stage(e, formation(u, 3, y - 0.01)); ok(e.previewSetup());
});
for (const round of [2, 3]) test(`enemy deployment zone ${round === 2 ? 'forbidden' : 'allowed'} at round ${round}`, () => {
  const e = battle(['deploy-1']); toRound(e, round); ok(e.tryNextPhase()); ok(e.beginIngress('deploy-1', 'STRATEGIC_EDGE'));
  stage(e, formation(e.getState().units[0]!, 44, 30));
  if (round === 2) no(e.previewSetup(), 'ENEMY_DEPLOYMENT_ZONE'); else ok(e.previewSetup());
});
test('Deep Strike ignores edge and opponent zone restrictions; arrival event/lock are explicit', () => {
  const e = battle(['deploy-5']); toRound(e, 2); ok(e.tryNextPhase()); ok(e.beginIngress('deploy-5', 'DEEP_STRIKE'));
  const u = e.getState().units[4]!; stage(e, formation(u, 44, 30)); ok(e.completeSetup());
  const landed = e.getState().units[4]!; assert.equal(landed.location, 'BATTLEFIELD'); assert.equal(landed.arrival!.ingressMethod, 'DEEP_STRIKE'); assert.equal(landed.arrival!.turn, 3);
  assert.ok(e.getState().events.some(e => e.type === 'unit-deep-struck')); no(e.beginMovement(u.id), 'ARRIVAL_MOVE_LOCK');
  ok(e.tryNextPhase()); assert.ok(e.getState().units[4]!.moveLock); ok(e.tryNextPhase()); assert.equal(e.getState().units[4]!.moveLock, undefined); new GameEngine(e.getState());
});
test('Deep Strike and strategic edge methods are explicitly selectable for same unit', () => {
  const e = battle(['deploy-5']); toRound(e, 2); ok(e.tryNextPhase());
  ok(e.beginIngress('deploy-5', 'STRATEGIC_EDGE')); stage(e, formation(e.getState().units[4]!, 22, 15, 3)); no(e.previewSetup(), 'NOT_WITHIN_EDGE'); ok(e.cancelSetup());
  ok(e.beginIngress('deploy-5', 'DEEP_STRIKE')); stage(e, formation(e.getState().units[4]!, 22, 15, 3)); ok(e.previewSetup()); ok(e.completeSetup());
});
test('Deep Strike requires every living model ability and cannot ingress an enemy unit', () => {
  const e = battle(['deploy-1', 'deploy-5', 'deploy-11'], s => { s.units[4]!.models[0]!.coreAbilities = []; }); toRound(e, 2); ok(e.tryNextPhase());
  no(e.beginIngress('deploy-1', 'DEEP_STRIKE'), 'ABILITY_REQUIRED'); no(e.beginIngress('deploy-5', 'DEEP_STRIKE'), 'ABILITY_REQUIRED'); no(e.beginIngress('deploy-11', 'DEEP_STRIKE'), 'NOT_YOUR_UNIT');
});
test('Ingress coherency, terrain and invalid confirmation leave state unchanged', () => {
  const e = battle(['deploy-5']); toRound(e, 2); ok(e.tryNextPhase()); ok(e.beginIngress('deploy-5', 'DEEP_STRIKE'));
  const u = e.getState().units[4]!, f = formation(u, 22, 15, 3); f[u.models[1]!.id]!.x = 26; stage(e, f); no(e.previewSetup(), 'INCOHERENT');
  stage(e, formation(u, 22, 15, 2)); const before = e.getState(); no(e.completeSetup(), 'TERRAIN_BLOCKED'); assert.deepEqual(e.getState(), before);
});
test('Ingress cancellation and in-flight snapshot do not materialize reserve models', () => {
  const e = battle(['deploy-5']); toRound(e, 2); ok(e.tryNextPhase()); const before = e.getState().units;
  ok(e.beginIngress('deploy-5', 'DEEP_STRIKE')); stage(e, formation(e.getState().units[4]!, 22, 15, 3));
  const restored = new GameEngine(e.getState()); ok(restored.cancelSetup()); assert.deepEqual(restored.getState().units, before);
  const resumed = new GameEngine(e.getState()); ok(resumed.completeSetup()); new GameEngine(resumed.getState());
});
test('reposition preserves health, action flags, Battle-shock, history and temporary effects', () => {
  const e = battle(); const s = e.getState(), u = s.units[0]!;
  u.state = { ...u.state, hasAdvanced: true, hasFallenBack: true, hasMoved: true, battleShocked: true }; u.lastRangedAttackTurnIndex = 1;
  s.closeCombat = { charge: null, move: null, declared: [], fight: null, effects: [{ unitId: u.id, kind: 'FIGHTS_FIRST', expiresAt: 'END_OF_TURN', turn: 1 }] }; e.loadMatch(s);
  ok(e.moveUnitToStrategicReserves(u.id, 'test hook'));
  assert.deepEqual(e.getState().units[0]!.state, u.state); assert.equal(e.getState().units[0]!.lastRangedAttackTurnIndex, 1); assert.deepEqual(e.getState().closeCombat!.effects, s.closeCombat.effects);
  assert.deepEqual(e.getState().units[0]!.models, u.models); new GameEngine(e.getState());
});
test('same-turn reposition and ingress preserves Advanced/Fell Back', () => {
  const e = battle(); toRound(e, 2); ok(e.tryNextPhase()); const s = e.getState(); s.units[0]!.state.hasAdvanced = true; s.units[0]!.state.hasFallenBack = true; e.loadMatch(s);
  ok(e.moveUnitToStrategicReserves('deploy-1', 'test')); ok(e.beginIngress('deploy-1', 'STRATEGIC_EDGE')); stage(e, formation(e.getState().units[0]!, 2, 16)); ok(e.completeSetup());
  assert.equal(e.getState().units[0]!.state.hasAdvanced, true); assert.equal(e.getState().units[0]!.state.hasFallenBack, true); assert.equal(e.getState().units[0]!.arrival!.method, 'REPOSITION');
});
test('round-three expiration destroys unarrived initial reserves, but not repositioned units', () => {
  const e = battle(['deploy-5']); ok(e.moveUnitToStrategicReserves('deploy-1', 'test')); toRound(e, 3);
  assert.equal(e.getState().units[4]!.location, 'STRATEGIC_RESERVES'); toRound(e, 4);
  assert.equal(e.getState().units[4]!.location, 'DESTROYED'); assert.ok(e.getState().units[4]!.models.every(m => !m.alive && m.woundsRemaining === 0));
  assert.equal(e.getState().units[0]!.location, 'STRATEGIC_RESERVES'); new GameEngine(e.getState());
});
test('expiration exception policy and future embarked-arrival metadata are supported', () => {
  const e = battle(['deploy-5']); const s = e.getState(); s.units[4]!.reserve!.transportHasIngressed = true;
  const restored = new GameEngine(s); toRound(restored, 4); assert.equal(restored.getState().units[4]!.location, 'STRATEGIC_RESERVES');
  const custom = new GameEngine(e.getState(), { reserves: { shouldDestroyUnarrived: () => false } }); toRound(custom, 4); assert.equal(custom.getState().units[4]!.location, 'STRATEGIC_RESERVES');
});
test('end-battle resolution destroys both reserve locations, policy can exempt', () => {
  const e = battle(['deploy-5']); ok(e.moveUnitToGenericReserves('deploy-1', 'future ability')); ok(e.finishBattle());
  assert.equal(e.getState().units[0]!.location, 'DESTROYED'); assert.equal(e.getState().units[4]!.location, 'DESTROYED'); assert.equal(e.getState().status, 'finished'); new GameEngine(e.getState());
  const custom = new GameEngine(battle(['deploy-5']).getState(), { reserves: { shouldDestroyAtEnd: () => false } }); ok(custom.finishBattle()); assert.equal(custom.getState().units[4]!.location, 'STRATEGIC_RESERVES');
});
test('generic reserves require an explicit arrival policy instead of inheriting strategic rules', () => {
  const e = battle(); ok(e.moveUnitToGenericReserves('deploy-5', 'future ability')); ok(e.tryNextPhase()); no(e.beginIngress('deploy-5', 'DEEP_STRIKE'), 'NOT_IN_RESERVES');
  const custom = new GameEngine(e.getState(), { reserves: { canIngress: () => ({ ok: true, value: undefined }) } }); ok(custom.beginIngress('deploy-5', 'DEEP_STRIKE'));
});
test('off-field models cannot shoot, charge, fight, engage, block or be visible', () => {
  const e = battle(); ok(e.moveUnitToStrategicReserves('deploy-1', 'test')); const s = e.getState(), reserve = s.units[0]!, enemy = s.units[6]!;
  assert.equal(isUnitEngaged(s, reserve), false); assert.equal(getModelsEligibleToFight(s, reserve, enemy).length, 0);
  assert.equal(createVisibilityProvider(s).isUnitVisible(enemy.models[0]!, reserve), false);
  ok(e.tryNextPhase()); no(e.beginMovement('deploy-1'), 'NOT_ON_BATTLEFIELD'); ok(e.tryNextPhase()); no(e.beginShooting('deploy-1'), 'NOT_ON_BATTLEFIELD'); ok(e.tryNextPhase()); no(e.declareCharge('deploy-1', () => 0), 'NOT_ON_BATTLEFIELD');
});
test('oversized edge base rejected by default, centralized fallback can opt in', () => {
  const s = createDeploymentTestMatch(), u = s.units[0]!; u.models = [u.models[0]!]; u.models[0]!.base.diameterMm = 8 * 25.4;
  const f = formation(u, 4, 16); no(validateSetup(s, u, f, { edgeDistance: 6 }), 'NOT_WITHIN_EDGE');
  ok(validateSetup(s, u, f, { edgeDistance: 6 }, { largeModelEdgeFallback: () => true }));
});
test('custom setup restriction is respected by every preview/commit', () => {
  const e = new GameEngine(createDeploymentTestMatch(), { setup: { extraRestriction: () => ({ ok: false, reason: 'UNIT_NOT_ELIGIBLE' }) } });
  ok(e.advancePreBattle()); ok(e.advancePreBattle()); ok(e.beginDeployment('deploy-1')); stage(e, formation(e.getState().units[0]!, 3, 3)); no(e.previewSetup(), 'UNIT_NOT_ELIGIBLE'); no(e.completeSetup(), 'UNIT_NOT_ELIGIBLE');
});
test('reserves cannot be selected as shooting or melee targets even at retained coordinates', () => {
  const e = battle(); ok(e.moveUnitToStrategicReserves('deploy-7', 'test')); ok(e.tryNextPhase()); ok(e.tryNextPhase());
  const s = e.getState(), target = s.units[6]!;
  assert.equal(getModelsEligibleToFight(s, s.units[0]!, target).length, 0);
  const legal = ok(e.getLegalTargets('deploy-1', 'test-rifle')); assert.ok(!legal.some(t => t.targetUnitId === target.id));
});
test('third-party reserve volume does not occlude LOS or collide at its retained position', () => {
  const e = battle(), s = e.getState(), source = s.units[0]!, target = s.units[6]!, blocker = s.units[1]!;
  source.models.forEach((m, i) => m.position = { x: 3, y: 12 + i * 1.5 }); target.models.forEach((m, i) => m.position = { x: 13, y: 12 + i * 1.5 });
  blocker.models.forEach((m, i) => { m.position = { x: 8, y: 12 + i * 8 }; m.base.diameterMm = 100; m.volume = { kind: 'cylinder', height: 10 }; });
  blocker.location = 'STRATEGIC_RESERVES'; e.loadMatch(s);
  assert.equal(createVisibilityProvider(e.getState()).isUnitVisible(source.models[0]!, target), true);
  ok(validateSetup(e.getState(), s.units[2]!, formation(s.units[2]!, 8, 12), {}));
});
