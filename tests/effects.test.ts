import test from 'node:test';
import assert from 'node:assert/strict';
import { engine, ok, pass, command, nextPhase, atPhase } from './flow.helpers';
import { GameEngine } from '../src/game/engine/GameEngine';
import { effectiveCharacteristic, activeEffects } from '../src/game/effects/EffectEngine';
import type { EffectInput, Expiry, Stacking, Characteristic } from '../src/game/effects/types';
import { createTestMatch } from '../src/game/data/prototype';
import { createCloseCombatTestMatch } from '../src/game/data/closeCombatPrototype';
import { hasFightsFirst } from '../src/game/rules/closeCombat';
const input = (expiry: Expiry = 'END_OF_CURRENT_PHASE', stacking: Stacking = 'STACK', value = 1, source = 'test'): EffectInput => ({ source, target: { unitId: 'unit-1' }, payload: { kind: 'MODIFIER', characteristic: 'OC', value }, expiry, stacking });

test('end-of-phase effect stays through end window then expires automatically', () => {
  const e = atPhase('Movement'); ok(e.addTemporaryEffect(input())); const catalog = e.getState().definitions; ok(e.tryNextPhase()); assert.equal(activeEffects(e.getState(), 'unit-1').length, 1);
  pass(e); ok(e.tryNextPhase()); assert.equal(activeEffects(e.getState(), 'unit-1').length, 0); assert.deepEqual(e.getState().definitions, catalog);
});
test('end-of-turn effect survives every phase and expires before next turn', () => {
  const e = engine(); ok(e.addTemporaryEffect(input('END_OF_CURRENT_TURN'))); for (let i = 0; i < 4; i++) nextPhase(e);
  assert.equal(activeEffects(e.getState(), 'unit-1').length, 1); nextPhase(e); assert.equal(activeEffects(e.getState(), 'unit-1').length, 0);
});
test('Fight end-of-phase expires before end-of-turn window', () => {
  const e = atPhase('Fight'); ok(e.addTemporaryEffect(input())); ok(e.tryNextPhase()); pass(e); ok(e.tryNextPhase());
  assert.equal(e.getState().flow!.window!.trigger, 'END_OF_TURN'); assert.equal(activeEffects(e.getState(), 'unit-1').length, 0);
});
test('end-of-round expiry survives opposing player turn', () => {
  const e = engine(); ok(e.addTemporaryEffect(input('END_OF_BATTLE_ROUND'))); for (let i = 0; i < 5; i++) nextPhase(e);
  assert.equal(activeEffects(e.getState(), 'unit-1').length, 1); for (let i = 0; i < 5; i++) nextPhase(e); assert.equal(activeEffects(e.getState(), 'unit-1').length, 0);
});
test('next Command expiry is owner-specific, not the opponent Command phase', () => {
  const e = engine(); pass(e); ok(e.addTemporaryEffect(input('START_OF_NEXT_COMMAND_PHASE')));
  for (let i = 0; i < 5; i++) nextPhase(e); assert.equal(activeEffects(e.getState(), 'unit-1').length, 1);
  for (let i = 0; i < 5; i++) nextPhase(e); assert.equal(activeEffects(e.getState(), 'unit-1').length, 0);
});
test('end of next Command effect survives current Command and next Command rolls', () => {
  const e = engine(); pass(e); ok(e.addTemporaryEffect(input('END_OF_NEXT_COMMAND_PHASE')));
  for (let i = 0; i < 10; i++) nextPhase(e); assert.equal(activeEffects(e.getState(), 'unit-1').length, 1);
  command(e); assert.equal(activeEffects(e.getState(), 'unit-1').length, 1); nextPhase(e); assert.equal(activeEffects(e.getState(), 'unit-1').length, 0);
});
test('explicit expiry survives rounds until engine removal', () => {
  const e = engine(); const added = ok(e.addTemporaryEffect(input('UNTIL_EXPLICITLY_REMOVED'))); for (let i = 0; i < 10; i++) nextPhase(e);
  assert.equal(activeEffects(e.getState(), 'unit-1').length, 1); ok(e.removeTemporaryEffect(added.id)); assert.equal(activeEffects(e.getState(), 'unit-1').length, 0);
});
for (const [stacking, expected] of [['STACK', 6], ['REPLACE_SAME_SOURCE', 4], ['NON_STACKING', 3], ['HIGHEST_ONLY', 4]] as const) test(`effect stacking ${stacking}`, () => {
  const e = engine(); ok(e.addTemporaryEffect(input('END_OF_CURRENT_PHASE', stacking, 2))); ok(e.addTemporaryEffect(input('END_OF_CURRENT_PHASE', stacking, 3)));
  assert.equal(effectiveCharacteristic(e.getState(), 'unit-1', 'OC', 1), expected);
});
test('highest-only suppression re-evaluates after higher effect removal', () => {
  const e = engine(); ok(e.addTemporaryEffect(input('END_OF_CURRENT_PHASE', 'HIGHEST_ONLY', 2))); const higher = ok(e.addTemporaryEffect(input('END_OF_CURRENT_PHASE', 'HIGHEST_ONLY', 3, 'other')));
  ok(e.removeTemporaryEffect(higher.id)); assert.equal(effectiveCharacteristic(e.getState(), 'unit-1', 'OC', 1), 3);
});
test('replacement only affects same source and characteristic', () => {
  const e = engine(); ok(e.addTemporaryEffect(input('END_OF_CURRENT_PHASE', 'REPLACE_SAME_SOURCE', 2))); ok(e.addTemporaryEffect(input('END_OF_CURRENT_PHASE', 'REPLACE_SAME_SOURCE', 3, 'other')));
  assert.equal(effectiveCharacteristic(e.getState(), 'unit-1', 'OC', 1), 6);
});
for (const characteristic of ['MOVE', 'BS', 'WS', 'SAVE', 'LEADERSHIP', 'OC', 'HIT_ROLL', 'WOUND_ROLL'] as Characteristic[]) test(`central modifier supports ${characteristic} without catalog mutation`, () => {
  const e = engine(), before = e.getState().definitions; ok(e.addTemporaryEffect({ ...input(), payload: { kind: 'MODIFIER', characteristic, value: 1 } }));
  const base = characteristic.includes('ROLL') ? 0 : 5; assert.equal(effectiveCharacteristic(e.getState(), 'unit-1', characteristic, base), base + 1); assert.deepEqual(e.getState().definitions, before);
});
test('Move modifier is enforced by the existing movement validator and survives snapshot', () => {
  const e = atPhase('Movement'); ok(e.addTemporaryEffect({ ...input(), payload: { kind: 'MODIFIER', characteristic: 'MOVE', value: 2 } })); ok(e.beginMovement('unit-1'));
  ok(e.moveModel('unit-1:model:1', { x: 4.5, y: 13.5 })); assert.equal(e.getState().units[0]!.models[0]!.movementUsed, 9);
  assert.deepEqual(new GameEngine(e.getState()).getState(), e.getState()); ok(e.cancelMovement()); assert.equal(e.getState().units[0]!.models[0]!.position.y, 4.5);
});
test('charge Fights First uses shared effect engine and emits post-charge window', () => {
  const s = createCloseCombatTestMatch(); s.phase = 'Charge'; const e = engine(s); pass(e);
  ok(e.declareCharge('unit-1', () => .34)); ok(e.selectChargeTargets(['unit-2']));
  for (const m of e.getState().units[0]!.models) ok(e.moveCombatModel(m.id, { x: m.position.x, y: 8.5 }));
  ok(e.completeCombatMove()); const result = e.getState(); assert.equal(hasFightsFirst(result, result.units[0]!), true); assert.equal(result.closeCombat!.effects.length, 0); assert.equal(result.flow!.window!.trigger, 'AFTER_CHARGE_MOVE');
  assert.deepEqual(new GameEngine(result).getState(), result);
});
test('legacy Fights First explicitly migrates into shared effects', () => {
  const s = createTestMatch(); s.closeCombat = { charge: null, move: null, fight: null, declared: [], effects: [{ unitId: 'unit-1', kind: 'FIGHTS_FIRST', expiresAt: 'END_OF_TURN', turn: 1 }] };
  const e = engine(s); assert.equal(e.getState().closeCombat!.effects.length, 0); assert.equal(hasFightsFirst(e.getState(), e.getState().units[0]!), true);
});
test('effect snapshot round-trip preserves counters, expiry, usage and window', () => {
  const e = engine(); ok(e.addTemporaryEffect(input('END_OF_NEXT_COMMAND_PHASE'))); const loaded = new GameEngine(JSON.parse(JSON.stringify(e.getState())));
  assert.deepEqual(loaded.getState(), e.getState()); pass(e); pass(loaded); for (let i = 0; i < 11; i++) { nextPhase(e); nextPhase(loaded); } assert.deepEqual(loaded.getState(), e.getState());
});
