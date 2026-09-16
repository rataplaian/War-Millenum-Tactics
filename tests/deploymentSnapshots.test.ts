import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../src/game/engine/GameEngine';
import { createDeploymentTestMatch } from '../src/game/data/deploymentPrototype';
import { createTestMatch } from '../src/game/data/prototype';
import { battle, declarations, deployAll, formation, stage, toRound, ok, no } from './deployment.helpers';
import type { GameState } from '../src/game/models';

test('legacy schema 3 loads byte-shape unchanged without deployment/location extensions', () => {
  const s = createTestMatch(); assert.deepEqual(new GameEngine(s).getState(), s);
});
const corruptions: [string, (s: GameState) => void][] = [
  ['unknown location', s => { (s.units[0] as any).location = 'EMBARKED'; }],
  ['destroyed with living models', s => { s.units[0]!.location = 'DESTROYED'; }],
  ['invalid points', s => { s.definitions = s.definitions.map((d, i) => i ? d : { ...d, points: -1 }); }],
  ['invalid scout allowance', s => { s.units[0]!.models[0]!.coreAbilities = [{ kind: 'SCOUTS', distance: NaN }]; }],
  ['missing rules field', s => { delete (s.deployment!.rules as any).enemySetupDistance; }],
  ['invalid ratio', s => { s.deployment!.rules.strategicReservePointsLimitRatio = 2; }],
  ['unknown zone owner', s => { s.deployment!.zones[0]!.playerId = 'absent'; }],
  ['zone outside table', s => { s.deployment!.zones[0]!.footprint.vertices[0]!.x = -1; }],
  ['zero-area zone', s => { s.deployment!.zones[0]!.footprint.vertices.forEach(p => p.y = 0); }],
  ['unknown choice unit', s => { s.deployment!.choices.absent = 'SCOUTS'; }],
  ['undeployed battlefield unit', s => { s.units[0]!.location = 'BATTLEFIELD'; s.units[0]!.models.forEach((m, i) => m.position = { x: 3 + i * 1.5, y: 3 }); }],
  ['invalid arrival', s => { s.units[0]!.arrival = { method: 'REPOSITION', ingressMethod: 'STRATEGIC_EDGE', turn: 3 }; }],
];
for (const [name, mutate] of corruptions) test(`snapshot rejects ${name} without replacing engine state`, () => {
  const s = createDeploymentTestMatch(), e = new GameEngine(s); mutate(s); assert.throws(() => e.loadMatch(s)); assert.deepEqual(e.getState(), createDeploymentTestMatch());
});
test('exclusive transactions reject corrupted scout/setup snapshot', () => {
  const e = declarations(); deployAll(e); ok(e.advancePreBattle()); ok(e.beginScoutMove('deploy-3'));
  const s = e.getState(); s.setup = { unitId: 'deploy-5', kind: 'INGRESS_MOVE', mode: 'DEEP_STRIKE', positions: {} }; assert.throws(() => new GameEngine(s));
});
test('snapshot validates scout cumulative usage and original model identities', () => {
  const e = declarations(); deployAll(e); ok(e.advancePreBattle()); ok(e.beginScoutMove('deploy-3'));
  const s = e.getState(); s.scout!.used[s.units[2]!.models[0]!.id] = 20; assert.throws(() => new GameEngine(s));
  const t = e.getState(); t.scout!.originals[0]!.modelId = 'missing'; assert.throws(() => new GameEngine(t));
});
test('deterministic end-to-end commands: formations, deployment, scouts, start, ingress, expiration', () => {
  const run = () => {
    const e = declarations(); ok(e.selectStrategicReserve('deploy-5')); ok(e.selectStrategicReserve('deploy-11'));
    deployAll(e); ok(e.advancePreBattle());
    for (;;) {
      const id = e.getDeploymentOptions().scoutUnitIds[0]; if (!id) break;
      ok(e.beginScoutMove(id)); const u = e.getState().units.find(u => u.id === id)!;
      for (const m of u.models) ok(e.moveScoutModel(m.id, { ...m.position, y: m.position.y + (u.playerId === 'player-1' ? 2 : -2) }));
      ok(e.completeScoutMove());
    }
    ok(e.advancePreBattle()); toRound(e, 2); ok(e.tryNextPhase()); ok(e.beginIngress('deploy-5', 'DEEP_STRIKE'));
    stage(e, formation(e.getState().units[4]!, 22, 15, 3)); ok(e.completeSetup());
    toRound(e, 4); assert.equal(e.getState().units[10]!.location, 'DESTROYED');
    return new GameEngine(e.getState()).getState();
  };
  assert.deepEqual(run(), run());
});
test('preview samples are bounded and cannot mutate engine state', () => {
  const e = declarations(); ok(e.advancePreBattle()); ok(e.beginDeployment('deploy-1')); const before = e.getState();
  const samples = e.getSetupPreviewSamples(); assert.equal(samples.length, 108); assert.ok(samples.some(p => p.legal)); assert.ok(samples.some(p => !p.legal)); assert.deepEqual(e.getState(), before);
});
test('reservation and reposition are forbidden while another action is active', () => {
  const e = battle(); ok(e.tryNextPhase()); ok(e.beginMovement('deploy-1')); no(e.moveUnitToStrategicReserves('deploy-2', 'test'), 'SETUP_IN_PROGRESS'); no(e.finishBattle(), 'SETUP_IN_PROGRESS');
});
test('normal movement after scout does not inherit scout distance consumed', () => {
  const e = declarations(); deployAll(e); ok(e.advancePreBattle()); ok(e.beginScoutMove('deploy-3'));
  const unit = e.getState().units[2]!; for (const m of unit.models) ok(e.moveScoutModel(m.id, { ...m.position, y: m.position.y + 6 })); ok(e.completeScoutMove());
  while (e.getDeploymentOptions().scoutUnitIds.length) ok(e.skipScout(e.getDeploymentOptions().scoutUnitIds[0]!)); ok(e.advancePreBattle()); ok(e.tryNextPhase()); ok(e.beginMovement(unit.id));
  const m = e.getState().units[2]!.models[0]!; const result = ok(e.moveModel(m.id, { ...m.position, y: m.position.y + 3 })); assert.equal(result.totalUsed, 3);
});
test('reserve policies cannot accidentally destroy battlefield units', () => {
  const e = new GameEngine(battle(['deploy-5']).getState(), { reserves: { shouldDestroyAtEnd: () => true, shouldDestroyUnarrived: () => true } });
  toRound(e, 4); assert.equal(e.getState().units[0]!.location, 'BATTLEFIELD'); ok(e.finishBattle()); assert.equal(e.getState().units[0]!.location, 'BATTLEFIELD');
});
test('throwing expiration policy cannot partially commit a round transition', () => {
  const initial = battle(['deploy-1', 'deploy-5']); toRound(initial, 3); ok(initial.tryNextTurn());
  let calls = 0;
  const e = new GameEngine(initial.getState(), { reserves: { shouldDestroyUnarrived: () => { if (++calls === 2) throw new Error('broken policy'); return true; } } });
  const before = e.getState(); assert.throws(() => e.tryNextTurn(), /broken policy/); assert.deepEqual(e.getState(), before);
});
