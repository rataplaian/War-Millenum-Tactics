import type { SaveResult } from '../models';
import { rollD6, type RandomSource } from '../utils/dice';
/** No modifiers, automatic successes, critical effects or rerolls in Task 003. */
export const hitSucceeds = (roll: number, skill: number): boolean => roll >= skill;
export function woundTarget(strength: number, toughness: number): number {
  if (strength >= toughness * 2) return 2;
  if (strength > toughness) return 3;
  if (strength === toughness) return 4;
  if (strength * 2 <= toughness) return 6;
  return 5;
}
export const woundSucceeds = (roll: number, target: number): boolean => roll >= target;
export const requiredArmourSave = (save: number, signedAP: number): number => save - signedAP;
export function resolveArmourSave(save: number, signedAP: number, rng: RandomSource): SaveResult {
  const required = requiredArmourSave(save, signedAP);
  if (required > 6) return { required, roll: null, saved: false };
  const roll = rollD6(rng);
  return { required, roll, saved: roll >= required };
}
