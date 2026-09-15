import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hitSucceeds, requiredArmourSave, resolveArmourSave, woundSucceeds, woundTarget } from '../src/game/rules/combatRolls';
import { resolveWeaponValue, validateDiceValue } from '../src/game/rules/weaponValues';
import { allocateDamage, applyDamage } from '../src/game/rules/damageAllocation';
import { createTestMatch } from '../src/game/data/prototype';
import { dice } from './shooting.helpers';
test('fixed values use no RNG; dice values record all rolls and modifier', () => {
  const fixed = dice(); assert.deepEqual(resolveWeaponValue({ kind: 'fixed', value: 2 }, fixed.rng), { value: 2, rolls: [] });
  assert.equal(fixed.calls(), 0);
  assert.deepEqual(resolveWeaponValue({ kind: 'dice', count: 2, sides: 6, modifier: 1 }, dice(2, 5).rng), { value: 8, rolls: [2, 5] });
  assert.throws(() => validateDiceValue({ kind: 'fixed', value: -1 }));
  assert.throws(() => validateDiceValue({ kind: 'dice', count: 1, sides: 6, modifier: -2 }));
});
test('hit skill threshold includes success exactly at the required value', () => {
  assert.equal(hitSucceeds(3, 3), true); assert.equal(hitSucceeds(2, 3), false);
});
for (const [strength, toughness, required] of [[8, 4, 2], [9, 4, 2], [5, 4, 3], [4, 4, 4], [3, 4, 5], [2, 4, 6], [1, 4, 6]]) {
  test(`wound target S${strength} vs T${toughness} is ${required}+`, () => {
    assert.equal(woundTarget(strength!, toughness!), required);
    assert.equal(woundSucceeds(required!, required!), true); assert.equal(woundSucceeds(required! - 1, required!), false);
  });
}
test('signed negative AP worsens normal save; success/failure is recorded', () => {
  assert.equal(requiredArmourSave(3, -2), 5);
  assert.deepEqual(resolveArmourSave(3, 0, dice(3).rng), { required: 3, roll: 3, saved: true });
  assert.deepEqual(resolveArmourSave(3, -2, dice(4).rng), { required: 5, roll: 4, saved: false });
});
test('impossible armour save records null and consumes no save roll', () => {
  const rng = dice(); assert.deepEqual(resolveArmourSave(3, -4, rng.rng), { required: 7, roll: null, saved: false });
  assert.equal(rng.calls(), 0);
});
test('allocation chooses a wounded survivor first then stable array order', () => {
  const target = createTestMatch().units[1]!;
  assert.equal(allocateDamage(target.models, 2), target.models[0]!.id);
  target.models[1]!.woundsRemaining = 1; assert.equal(allocateDamage(target.models, 2), target.models[1]!.id);
});
test('damage is pure, excess does not spill and dead models remain represented', () => {
  const target = createTestMatch().units[1]!; const updated = applyDamage(target, target.models[0]!.id, 99);
  assert.deepEqual(updated.models.map(m => m.woundsRemaining), [0, 2, 2]);
  assert.equal(updated.models[0]!.alive, false); assert.equal(updated.models.length, 3);
  assert.equal(target.models[0]!.woundsRemaining, 2);
  assert.throws(() => applyDamage(updated, updated.models[0]!.id, 1));
});
