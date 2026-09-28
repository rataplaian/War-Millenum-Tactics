import type { DeepReadonly, GameState, Unit, Weapon } from '../models';
import { attackToughness, modelDefinition } from '../attachments/queries';

/** Datasheet shield policy; wound modifiers are applied by the shared attack pipeline. */
export function defensiveWoundPenalty(state:GameState|undefined,target:Unit,weapon:DeepReadonly<Weapon>,strength:number):number {
  if (!state || weapon.kind!=='ranged' || strength<=attackToughness(state,target)) return 0;
  return target.models.some(m=>m.alive && modelDefinition(state,target,m).abilities.some(a=>a.id==='WAVE_SERPENT_SHIELD')) ? 1 : 0;
}
