import test from 'node:test';
import assert from 'node:assert/strict';
import { engine, ok, pass, command, nextPhase } from './flow.helpers';

test('Core CP grants exactly one to both players, once per Command phase', () => {
  const e = engine(); pass(e); ok(e.advanceCommandStep()); assert.deepEqual(e.getState().players.map(p => p.commandPoints), [1, 1]);
  ok(e.advanceCommandStep()); ok(e.advanceCommandStep()); assert.deepEqual(e.getState().players.map(p => p.commandPoints), [1, 1]);
  assert.equal(e.getState().events.filter(x => x.type === 'flow' && x.name === 'CORE_CP_GAINED').length, 2);
});
test('CP spend is exact, integer and never negative', () => {
  const e = engine(); command(e); ok(e.spendCommandPoints('player-1', 1)); const before = e.getState();
  assert.equal(e.spendCommandPoints('player-1', 1).ok, false); assert.equal(e.canSpendCommandPoints('player-1', 1).ok, false); assert.deepEqual(e.getState(), before); assert.equal(before.players[0].commandPoints, 0);
});
for (const amount of [-1, .5, Infinity, NaN]) test(`invalid CP amount ${amount} rejected atomically`, () => {
  const e = engine(), before = e.getState(); assert.equal(e.gainCommandPoints('player-1', amount).ok, false); assert.equal(e.spendCommandPoints('player-1', amount).ok, false); assert.deepEqual(e.getState(), before);
});
test('extra CP capped per player and Core CP does not consume allowance', () => {
  const e = engine(); assert.equal(ok(e.gainCommandPoints('player-1', 3)), 1); assert.equal(ok(e.gainCommandPoints('player-1', 1)), 0); command(e);
  assert.deepEqual(e.getState().players.map(p => p.commandPoints), [2, 1]); assert.deepEqual(e.getState().players.map(p => p.extraCpGainedThisBattleRound), [1, 0]); assert.equal(ok(e.gainCommandPoints('player-2', 1)), 1);
});
test('extra CP resets at Battle Round boundary, not between player turns', () => {
  const e = engine(); ok(e.gainCommandPoints('player-1', 1)); for (let i = 0; i < 5; i++) nextPhase(e);
  assert.equal(e.getState().players[0].extraCpGainedThisBattleRound, 1); for (let i = 0; i < 5; i++) nextPhase(e);
  assert.equal(e.getState().players[0].extraCpGainedThisBattleRound, 0); assert.equal(ok(e.gainCommandPoints('player-1', 1)), 1);
});
test('configurable extra CP and explicit ignore-limit policy', () => {
  const e = engine(undefined, {}, { maxExtraCpPerBattleRound: 2 }); assert.equal(ok(e.gainCommandPoints('player-1', 5)), 2);
  assert.equal(ok(e.gainCommandPoints('player-1', 3, { ignoreLimit: true })), 3); assert.equal(e.getState().players[0].commandPoints, 5);
  assert.equal(ok(e.gainCommandPoints('player-2', 4, { limit: 4 })), 4);
});
