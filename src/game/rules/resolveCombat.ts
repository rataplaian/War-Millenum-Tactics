import type { DeepReadonly, Weapon, Unit, UnitDefinition, ModelAttackModifiers, GameState } from '../models';
import type { RandomSource } from '../utils/dice';
import { allocateDamage, type DamageAllocationPolicy } from './damageAllocation';
import { createAttackJob, runAttackJob } from '../combat/AttackPipeline';
import type { AttackChoices } from '../abilities/types';
/** Synchronous facade for the same state machine used by pausable engine commands. */
export function resolveCombat(weapon:DeepReadonly<Weapon>,ids:readonly string[],target:Unit,definition:UnitDefinition,rng:RandomSource,allocation:DamageAllocationPolicy=allocateDamage,modifiers:readonly ModelAttackModifiers[]=[],state?:GameState,precisionModelId?:string,choices:AttackChoices={}) {
 const job=createAttackJob(weapon,ids,target,definition,rng,modifiers,state,precisionModelId,choices);
 runAttackJob(job,rng,state,undefined,allocation);
 return{target:job.target,resolution:job.resolution};
}
