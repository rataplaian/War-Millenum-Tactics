import type { GameState, Unit } from '../models';
import { rollD6s, type RandomSource } from '../utils/dice';
import { modelKeywords } from '../attachments/queries';
import { allocationModel } from '../attachments/AllocationGroups';
import type { HazardResult } from './types';
/** Roll simultaneously; mortal wounds then spill one at a time through allocation groups. */
export function resolveHazardRolls(s: GameState, u: Unit, count: number, rng: RandomSource): HazardResult {
  const living = u.models.filter(m => m.alive), heavy = living.length > 0 && living.every(m => modelKeywords(s, u, m).some(k => k === 'MONSTER' || k === 'VEHICLE'));
  const rolls = rollD6s(count, rng), mortalWounds = rolls.filter(r => r <= 2).length * (heavy ? 3 : 1), destroyedModelIds: string[] = [];
  for (let i = 0; i < mortalWounds; i++) {
    const model = allocationModel(s, u); if (!model) break;
    model.woundsRemaining--; if (!model.woundsRemaining) { model.alive = false; destroyedModelIds.push(model.id); }
  }
  return { rolls, mortalWounds, destroyedModelIds };
}
