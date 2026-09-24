import { validateWeaponAbilities } from '../abilities/validation';
import type { DeepReadonly, DiceResolution, DiceValue, Weapon } from '../models';
import { rollD6s, type RandomSource } from '../utils/dice';
/** Catalog validation: all possible values must be finite non-negative integers. */
export function validateDiceValue(value: DeepReadonly<DiceValue>): void {
  if (value.kind === 'fixed') {
    if (!Number.isSafeInteger(value.value) || value.value < 0) throw new Error('Invalid fixed weapon value');
  } else if (value.kind === 'dice') {
    if (![3,6].includes(value.sides) || !Number.isSafeInteger(value.count) || value.count < 1 ||
        !Number.isSafeInteger(value.modifier) || value.count + value.modifier < 0 ||
        !Number.isSafeInteger(value.count * value.sides + value.modifier)) throw new Error('Invalid dice weapon value');
  } else throw new Error('Invalid weapon value kind');
}
export function resolveWeaponValue(value: DeepReadonly<DiceValue>, rng: RandomSource): DiceResolution {
  validateDiceValue(value);
  if (value.kind === 'fixed') return { value: value.value, rolls: [] };
  const rolls = rollD6s(value.count, rng).map(r => value.sides === 3 ? Math.ceil(r / 2) : r);
  return { value: rolls.reduce((sum, roll) => sum + roll, value.modifier), rolls };
}
export function validateWeapon(weapon: DeepReadonly<Weapon>): void {
  if (!weapon.id || !Number.isInteger(weapon.skill) || weapon.skill < 2 || weapon.skill > 6 ||
      !Number.isSafeInteger(weapon.strength) || weapon.strength < 1 ||
      !Number.isSafeInteger(weapon.armourPenetration) || weapon.armourPenetration > 0) throw new Error('Invalid weapon profile');
  if (weapon.kind === 'ranged') {
    if (!Number.isFinite(weapon.range) || weapon.range <= 0) throw new Error('Invalid ranged range');
  } else if (weapon.kind !== 'melee' || weapon.range !== null) throw new Error('Invalid weapon kind/range');
  validateWeaponAbilities(weapon);
  validateDiceValue(weapon.attacks);
  validateDiceValue(weapon.damage);
}
