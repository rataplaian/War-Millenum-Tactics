import type { DeepReadonly, GameState, Unit, Weapon } from '../models';
import { attackToughness, modelDefinition } from '../attachments/queries';

/** Datasheet shield policy; wound modifiers are applied by the shared attack pipeline. */
export function defensiveWoundPenalty(state:GameState|undefined,target:Unit,weapon:DeepReadonly<Weapon>,strength:number):number {
  if (!state || weapon.kind!=='ranged' || strength<=attackToughness(state,target)) return 0;
  return target.models.some(m=>m.alive && modelDefinition(state,target,m).abilities.some(a=>a.id==='WAVE_SERPENT_SHIELD')) ? 1 : 0;
}
/** Mixed unit wargear stays active only while its distinct bearer survives. */
export function serpentShieldSave(target:Unit):number|undefined {
  return target.models.some(m=>m.alive && m.profileRole==='SERPENTS_SCALE_PLATFORM') ? 5 : undefined;
}
/** Apply after each casualty, before any subsequent attack can allocate to the platform. */
export function removeUncrewedPlatform(target:Unit):string[] {
  const guardians=target.models.filter(m=>m.profileRole==='STORM_GUARDIAN');
  if(!guardians.length || guardians.some(m=>m.alive)) return [];
  const removed:string[]=[];
  for(const model of target.models) if(model.profileRole==='SERPENTS_SCALE_PLATFORM' && model.alive){
    model.alive=false;model.woundsRemaining=0;removed.push(model.id);
  }
  return removed;
}
