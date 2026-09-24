import type { GameState, Unit } from '../models';
import { rollD6s, type RandomSource } from '../utils/dice';
import { modelKeywords } from '../attachments/queries';
import { resolveMortalWounds } from '../combat/damage';
import type { HazardResult } from './types';
/** Roll simultaneously; mortal wounds then spill one at a time through allocation groups. */
export function resolveHazardRolls(s: GameState, u: Unit, count: number, rng: RandomSource): HazardResult {
  const living = u.models.filter(m => m.alive), heavy = living.length > 0 && living.every(m => modelKeywords(s, u, m).some(k => k === 'MONSTER' || k === 'VEHICLE'));
  const rolls = rollD6s(count, rng), mortalWounds = rolls.filter(r => r <= 2).length * (heavy ? 3 : 1), destroyedModelIds: string[] = [];
  destroyedModelIds.push(...resolveMortalWounds(s, u, mortalWounds, rng).destroyedModelIds);
  return { rolls, mortalWounds, destroyedModelIds };
}
