import test from 'node:test';
import assert from 'node:assert/strict';
import { engine, ok, pass, command, nextPhase, snapshot } from './flow.helpers';
import { createTestMatch } from '../src/game/data/prototype';
import { createDeploymentTestMatch } from '../src/game/data/deploymentPrototype';
import { GameEngine } from '../src/game/engine/GameEngine';
import { COMMAND_STEPS, type CommandAbility } from '../src/game/flow/types';
import { enableFlow } from '../src/game/flow/MatchFlowController';
import { canStartAction, canCompleteAction, fallBackOptions, getUnitsRequiringBattleShockRoll, isAtOrBelowHalfStrength, isBelowHalfStrength, resolveLeadershipRoll } from '../src/game/command/BattleShock';
import { effectiveObjectiveControl } from '../src/game/effects/EffectEngine';
import { createUnit } from '../src/game/engine/createUnit';

test('flow begins with first player, round one, explicit phase and turn windows', () => {
  const s = engine().getState(); assert.equal(s.activePlayerId, 'player-1'); assert.equal(s.flow!.firstPlayerId, 'player-1');
  assert.equal(s.flow!.phaseIndex, 1); assert.equal(s.flow!.window!.trigger, 'START_OF_TURN'); assert.equal(s.flow!.queuedWindows.length, 2);
});
test('exact five Command steps and mandatory windows cannot be skipped', () => {
  const e = engine(); assert.equal(e.tryNextPhase().ok, false); assert.equal(e.tryNextTurn().ok, false); assert.equal(e.advanceCommandStep().ok, false);
  const steps = []; pass(e); while (e.getState().flow!.commandStep) { steps.push(e.getState().flow!.commandStep); ok(e.advanceCommandStep()); pass(e); }
  assert.deepEqual(steps, COMMAND_STEPS); assert.equal(e.getState().players[0].commandPoints, 1); assert.equal(e.getState().players[1].commandPoints, 1);
});
test('normal phase order, second player and correct round increment', () => {
  const e = engine(); const seen = [];
  for (let i = 0; i < 10; i++) { const s = e.getState(); seen.push([s.round, s.activePlayerId, s.phase]); nextPhase(e); }
  assert.deepEqual(seen.map(x => x[2]), ['Command', 'Movement', 'Shooting', 'Charge', 'Fight', 'Command', 'Movement', 'Shooting', 'Charge', 'Fight']);
  assert.equal(seen[5]![0], 1); assert.equal(seen[5]![1], 'player-2'); assert.equal(e.getState().round, 2); assert.equal(e.getState().activePlayerId, 'player-1');
});
for (const rounds of [1, 2, 3]) test(`configured ${rounds} rounds finishes only after both players`, () => {
  const e = engine(undefined, {}, { maximumBattleRounds: rounds });
  for (let i = 0; i < rounds * 10; i++) nextPhase(e);
  assert.equal(e.getState().status, 'finished'); assert.equal(e.getState().round, rounds); assert.equal(e.getState().turn, rounds * 2); assert.equal(e.tryNextPhase().ok, false);
  assert.deepEqual(new GameEngine(snapshot(e)).getState(), e.getState());
});
test('Command abilities and mission hook resolve in strict end-step order', () => {
  const abilities: CommandAbility[] = [
    { id: 'start', step: 'START_OF_COMMAND_PHASE', mandatory: true, eligible: () => true, resolve: () => ({ ok: true, value: undefined }) },
    { id: 'command', step: 'COMMAND_ABILITIES', mandatory: true, eligible: () => true, resolve: () => ({ ok: true, value: undefined }) },
    { id: 'end', step: 'END_OF_COMMAND_PHASE', mandatory: true, eligible: () => true, resolve: () => ({ ok: true, value: undefined }) },
    { id: 'mission', step: 'MISSION_HOOK', mandatory: true, eligible: () => true, resolve: () => ({ ok: true, value: undefined }) },
  ];
  const e = engine(undefined, { flow: { abilities } }); pass(e); assert.equal(e.advanceCommandStep().ok, false); command(e);
  const completed = e.getState().events.filter(x => x.type === 'flow' && x.name === 'MANDATORY_RESOLUTION_COMPLETED');
  assert.deepEqual(completed.map(x => x.type === 'flow' && String(x.detail.id).split(':').at(-1)), ['start', 'command', 'end', 'mission']);
});
test('missing resolver blocks safely after snapshot load', () => {
  const ability: CommandAbility = { id: 'custom', step: 'START_OF_COMMAND_PHASE', mandatory: true, eligible: () => true, resolve: () => ({ ok: true, value: undefined }) };
  const original = engine(undefined, { flow: { abilities: [ability] } }); pass(original); const e = new GameEngine(snapshot(original)), before = e.getState();
  assert.deepEqual(e.resolveCommandAbility(before.flow!.pending[0]!.id), { ok: false, reason: 'MISSING_RESOLVER' }); assert.deepEqual(e.getState(), before);
});
test('rules engine blockers are returned by canAdvancePhase', () => {
  const e = engine(undefined, { flow: { blockers: s => s.flow?.commandStep ? [] : ['TEST_RULE'] } }); command(e);
  assert.deepEqual(e.canAdvancePhase().blockingReasons, ['TEST_RULE']); assert.equal(e.tryNextPhase().ok, false);
});
test('throwing Command resolver cannot leak state changes', () => {
  const e = engine(undefined, { flow: { abilities: [{ id: 'bad', step: 'START_OF_COMMAND_PHASE', mandatory: true, eligible: () => true, resolve: s => { s.players[0].commandPoints = 999; throw Error('bad'); } }] } });
  pass(e); const before = e.getState(); assert.throws(() => e.resolveCommandAbility(before.flow!.pending[0]!.id)); assert.deepEqual(e.getState(), before);
});
test('flow enable is explicit, non-repeatable and keeps legacy snapshots unchanged', () => {
  const legacy = createTestMatch(); const e = new GameEngine(legacy); assert.deepEqual(e.getState(), legacy); e.nextPhase(); assert.equal(e.getState().phase, 'Movement');
  ok(e.enableMatchFlow()); assert.equal(e.enableMatchFlow().ok, false);
});
test('flow can be enabled before Deployment; no CP or windows until battle starts', () => {
  const s = createDeploymentTestMatch(); const e = engine(s); assert.equal(e.getState().flow!.started, false); assert.equal(e.getState().flow!.window, null); assert.equal(e.getState().players[0].commandPoints, 0);
  assert.equal(e.tryNextPhase().ok, false); ok(e.advancePreBattle());
});
test('queries and snapshots are detached and deterministic', () => {
  const a = engine(), b = engine(); for (let i = 0; i < 10; i++) { nextPhase(a); nextPhase(b); }
  assert.deepEqual(a.getState(), b.getState()); const detached = a.getState(); detached.flow!.pending.push({ id: 'x', kind: 'RULE', label: 'x' }); detached.players[0].commandPoints = 999;
  assert.deepEqual(a.getState(), b.getState()); assert.deepEqual(new GameEngine(snapshot(a)).getState(), a.getState());
});
test('currently shocked full-strength unit tests again, no clearing at Command start', () => {
  const s = createTestMatch(); s.units[0]!.state.battleShocked = true; const e = engine(s); pass(e); assert.equal(e.getState().units[0]!.state.battleShocked, true);
  ok(e.advanceCommandStep()); ok(e.advanceCommandStep()); assert.equal(e.getState().flow!.pending[0]!.unitId, 'unit-1'); assert.equal(e.advanceCommandStep().ok, false);
});
for (const [rng, success] of [[0, false], [.99, true]] as const) test(`Battle-shock deterministic roll ${success ? 'recovers' : 'persists'}`, () => {
  const s = createTestMatch(); s.units[0]!.state.battleShocked = true; const e = engine(s); pass(e); ok(e.advanceCommandStep()); ok(e.advanceCommandStep());
  const result = ok(e.rollBattleShock('unit-1', () => rng)); assert.deepEqual(result.rolls, success ? [6, 6] : [1, 1]); assert.equal(result.success, success); assert.equal(e.getState().units[0]!.state.battleShocked, !success);
  const before = e.getState(); assert.equal(e.rollBattleShock('unit-1', () => rng).ok, false); assert.deepEqual(e.getState(), before);
});
test('invalid RNG leaves pending roll and state unchanged', () => {
  const s = createTestMatch(); s.units[0]!.state.battleShocked = true; const e = engine(s); pass(e); ok(e.advanceCommandStep()); ok(e.advanceCommandStep()); const before = e.getState();
  assert.throws(() => e.rollBattleShock('unit-1', () => NaN)); assert.deepEqual(e.getState(), before);
});
test('Leadership succeeds against any characteristic, including per-model values', () => {
  assert.equal(resolveLeadershipRoll([9, 6], () => .34).success, true);
  const s = createTestMatch(); s.units[0]!.state.battleShocked = true; s.units[0]!.models[1]!.leadership = 4;
  const e = engine(s); pass(e); ok(e.advanceCommandStep()); ok(e.advanceCommandStep()); assert.equal(ok(e.rollBattleShock('unit-1', () => .17)).success, true);
});
test('multi-model strength uses starting count and excludes healthy and destroyed/off-field units', () => {
  const s = createTestMatch(), u = s.units[0]!; assert.equal(isBelowHalfStrength(s, u), false); assert.equal(getUnitsRequiringBattleShockRoll(s).length, 0);
  u.models.slice(1).forEach(m => { m.alive = false; m.woundsRemaining = 0; }); assert.equal(isAtOrBelowHalfStrength(s, u), true); assert.equal(getUnitsRequiringBattleShockRoll(s).length, 1);
  u.location = 'STRATEGIC_RESERVES'; assert.equal(getUnitsRequiringBattleShockRoll(s).length, 0);
});
test('single-model half strength uses wounds and distinguishes exactly half', () => {
  const s = createTestMatch(), d = { ...s.definitions[0]!, modelCount: 1, stats: { ...s.definitions[0]!.stats, wounds: 8 } };
  s.definitions = [d, s.definitions[1]!]; s.units[0] = createUnit(d, 'unit-1', 'player-1', [{ x: 4, y: 4 }]); const u = s.units[0]!; u.models[0]!.woundsRemaining = 4;
  assert.equal(isAtOrBelowHalfStrength(s, u), true); assert.equal(isBelowHalfStrength(s, u), false); u.models[0]!.woundsRemaining = 3; assert.equal(isBelowHalfStrength(s, u), true);
});
test('Battle-shock disables OC, start/complete actions and Ordered Retreat', () => {
  const s = createTestMatch(), u = s.units[0]!; assert.equal(effectiveObjectiveControl(s, u), 1); assert.equal(canStartAction(u), true);
  u.state.battleShocked = true; assert.equal(effectiveObjectiveControl(s, u), null); assert.equal(canStartAction(u), false); assert.equal(canCompleteAction(u), false);
  assert.deepEqual(fallBackOptions(s, u), { orderedRetreat: false, requiresDesperateEscape: true }); assert.equal(s.definitions[0]!.stats.objectiveControl, 1);
});
test('Battle-shock survives legacy turn resets as well', () => {
  const s = createTestMatch(); s.units[0]!.state.battleShocked = true; const e = new GameEngine(s); e.nextTurn(); assert.equal(e.getState().units[0]!.state.battleShocked, true);
});
test('optional Command ability enumerates and resolves once without blocking the step', () => {
  const e = engine(undefined, { flow: { abilities: [{ id: 'optional', step: 'START_OF_COMMAND_PHASE', mandatory: false, eligible: () => true, resolve: () => ({ ok: true, value: undefined }) }] } });
  pass(e); assert.deepEqual(e.getCommandAbilities(), [{ id: 'optional', available: true }]); ok(e.resolveCommandAbility('optional')); assert.equal(e.resolveCommandAbility('optional').ok, false); ok(e.advanceCommandStep());
});
