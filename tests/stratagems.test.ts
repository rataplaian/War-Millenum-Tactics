import test from 'node:test';
import assert from 'node:assert/strict';
import { engine, ok, pass, nextPhase } from './flow.helpers';
import { createTestMatch } from '../src/game/data/prototype';
import { GameEngine } from '../src/game/engine/GameEngine';
import { TEST_STRATAGEMS } from '../src/game/stratagems/testStratagems';
import { effectiveCharacteristic } from '../src/game/effects/EffectEngine';
import type { StratagemDefinition } from '../src/game/stratagems/types';
function shooting() {
  const s = createTestMatch(); s.phase = 'Shooting'; s.players.forEach(p => p.commandPoints = 3);
  return engine(s);
}
function passTurnOnly(e: GameEngine) { ok(e.passTimingWindow('player-1')); ok(e.passTimingWindow('player-2')); }

test('offensive fixture validates timing, spends CP once and applies temporary BS', () => {
  const e = shooting(); passTurnOnly(e); const catalog = e.getState().definitions;
  ok(e.useStratagem('test-offensive', 'player-1', ['unit-1'])); const s = e.getState(); assert.equal(s.players[0].commandPoints, 2); assert.equal(effectiveCharacteristic(s, 'unit-1', 'BS', 3), 2); assert.deepEqual(s.definitions, catalog);
  assert.equal(s.events.filter(x => x.type === 'flow' && x.name === 'CP_SPENT').length, 1);
});
test('wrong timing spends no CP and changes no state', () => {
  const e = shooting(), before = e.getState(); assert.deepEqual(e.useStratagem('test-offensive', 'player-1', ['unit-1']), { ok: false, reason: 'WRONG_TIMING' }); assert.deepEqual(e.getState(), before);
});
for (const ids of [['unit-2'], ['missing'], [], ['unit-1', 'unit-1']]) test(`invalid stratagem targets ${ids.join(',')} reject atomically`, () => {
  const e = shooting(); passTurnOnly(e); const before = e.getState(); assert.equal(e.useStratagem('test-offensive', 'player-1', ids).ok, false); assert.deepEqual(e.getState(), before);
});
test('insufficient CP rejects a otherwise legal stratagem', () => {
  const e = shooting(); passTurnOnly(e); ok(e.spendCommandPoints('player-1', 3)); const before = e.getState(); assert.deepEqual(e.useStratagem('test-offensive', 'player-1', ['unit-1']), { ok: false, reason: 'INSUFFICIENT_CP' }); assert.deepEqual(e.getState(), before);
});
test('same Stratagem twice in phase rejected without charging twice', () => {
  const e = shooting(); passTurnOnly(e); ok(e.useStratagem('test-offensive', 'player-1', ['unit-1'])); const before = e.getState(); assert.deepEqual(e.useStratagem('test-offensive', 'player-1', ['unit-1']), { ok: false, reason: 'USAGE_LIMIT' }); assert.deepEqual(e.getState(), before);
});
test('second stratagem on same unit forbidden unless explicit target override', () => {
  const s = createTestMatch(); s.phase = 'Shooting'; s.players[0].commandPoints = 5;
  const second: StratagemDefinition = { ...TEST_STRATAGEMS[0]!, id: 'second' };
  for (const allow of [false, true]) {
    const e = engine(s, { stratagems: { definitions: [TEST_STRATAGEMS[0]!, { ...second, overrides: { allowMultipleOnTarget: allow } }] } }); passTurnOnly(e);
    ok(e.useStratagem('test-offensive', 'player-1', ['unit-1'])); assert.equal(e.useStratagem('second', 'player-1', ['unit-1']).ok, allow);
  }
});
test('explicit per-phase limit permits repeat uses when target override also allows', () => {
  const s = createTestMatch(); s.phase = 'Shooting'; s.players[0].commandPoints = 4;
  const e = engine(s, { stratagems: { definitions: [{ ...TEST_STRATAGEMS[0]!, usageLimits: { perPhase: 2 }, overrides: { allowMultipleOnTarget: true } }] } }); passTurnOnly(e);
  ok(e.useStratagem('test-offensive', 'player-1', ['unit-1'])); ok(e.useStratagem('test-offensive', 'player-1', ['unit-1'])); assert.equal(e.useStratagem('test-offensive', 'player-1', ['unit-1']).ok, false);
});
test('Battle-shock forbids controlling player targeting their unit', () => {
  const s = createTestMatch(); s.phase = 'Shooting'; s.players[0].commandPoints = 2; s.units[0]!.state.battleShocked = true;
  const e = engine(s); passTurnOnly(e); assert.deepEqual(e.useStratagem('test-offensive', 'player-1', ['unit-1']), { ok: false, reason: 'BATTLE_SHOCKED' });
});
test('Battle-shock override targets only failed unit and clears shock immediately', () => {
  const s = createTestMatch(); s.units[0]!.state.battleShocked = true; const e = engine(s); pass(e); ok(e.advanceCommandStep()); ok(e.advanceCommandStep()); ok(e.rollBattleShock('unit-1', () => 0));
  assert.equal(e.getState().flow!.window!.trigger, 'AFTER_BATTLE_SHOCK_FAILED'); ok(e.useStratagem('test-shock', 'player-1', ['unit-1'])); assert.equal(e.getState().units[0]!.state.battleShocked, false); assert.equal(e.getState().players[0].commandPoints, 0);
});
test('reactive defence occurs after target selection and before RNG/damage', () => {
  const e = shooting(); pass(e); ok(e.beginShooting('unit-1')); let calls = 0;
  assert.equal(e.fireWeapon('test-rifle', 'unit-2', () => { calls++; return .99; }).ok, false);
  ok(e.selectShootingTarget('test-rifle', 'unit-2')); const before = e.getState();
  assert.equal(e.fireWeapon('test-rifle', 'unit-2', () => { calls++; return .99; }).ok, false); assert.equal(calls, 0); assert.deepEqual(e.getState(), before);
  assert.equal(e.getStratagemOptions('player-2').some(o => o.stratagemId === 'test-defence' && o.result.ok), true);
  ok(e.useStratagem('test-defence', 'player-2', ['unit-2'])); pass(e);
  assert.equal(e.cancelShooting().ok, false); assert.equal(e.completeShooting().ok, false);
  const rolls = [.99, .99, .17]; let index = 0; const result = ok(e.fireWeapon('test-rifle', 'unit-2', () => rolls[index++ % 3]!));
  assert.equal(result.saveResults[0]!.required, 2); assert.equal(result.totalDamage, 0); assert.equal(e.getState().definitions[1]!.stats.save, 3);
  ok(e.completeShooting()); assert.equal(e.getState().flow!.window!.trigger, 'AFTER_UNIT_SHOT');
});
test('target selection cannot be changed after a reaction was offered; snapshot resumes safely', () => {
  const e = shooting(); pass(e); ok(e.beginShooting('unit-1')); ok(e.selectShootingTarget('test-rifle', 'unit-2'));
  const resumed = new GameEngine(e.getState()); pass(resumed); assert.equal(resumed.selectShootingTarget('test-rifle', 'unit-2').ok, false);
  ok(resumed.fireWeapon('test-rifle', 'unit-2', () => 0)); assert.equal(resumed.getState().shooting!.selectedTarget, undefined);
});
test('failed custom resolver rolls back CP, effects and usage atomically', () => {
  const s = createTestMatch(); s.phase = 'Shooting'; s.players[0].commandPoints = 3;
  const e = engine(s, { stratagems: { definitions: [{ ...TEST_STRATAGEMS[0]!, resolverId: 'FAIL' }], resolvers: { FAIL: state => { state.units[0]!.state.battleShocked = true; return { ok: false, reason: 'INVALID_TARGET' }; } } } });
  passTurnOnly(e); const before = e.getState(); assert.equal(e.useStratagem('test-offensive', 'player-1', ['unit-1']).ok, false); assert.deepEqual(e.getState(), before);
});
test('passing is per-player, duplicate/unknown pass invalid, all pass closes window', () => {
  const e = shooting(); const before = e.getState(); assert.equal(e.passTimingWindow('nobody').ok, false); assert.deepEqual(e.getState(), before);
  ok(e.passTimingWindow('player-1')); assert.equal(e.passTimingWindow('player-1').ok, false); assert.ok(e.getState().flow!.window); ok(e.passTimingWindow('player-2')); assert.equal(e.getState().flow!.window!.trigger, 'START_OF_PHASE');
  pass(e); assert.equal(e.getState().flow!.window, null); assert.equal(e.passTimingWindow('player-1').ok, false);
});
test('window queries are pure and availability reports illegal reasons', () => {
  const e = shooting(); passTurnOnly(e); const before = e.getState(), options = e.getStratagemOptions('player-1'); assert.ok(options.some(o => o.result.ok)); assert.ok(options.some(o => !o.result.ok)); assert.deepEqual(e.getState(), before);
});
test('start/end phase windows prevent commands and phase progression', () => {
  const e = shooting(); assert.equal(e.beginShooting('unit-1').ok, false); assert.equal(e.canAdvancePhase().allowed, false); pass(e);
  ok(e.tryNextPhase()); assert.equal(e.getState().flow!.window!.trigger, 'END_OF_PHASE'); assert.equal(e.beginShooting('unit-1').ok, false); pass(e); assert.equal(e.beginShooting('unit-1').ok, false); ok(e.tryNextPhase());
});
