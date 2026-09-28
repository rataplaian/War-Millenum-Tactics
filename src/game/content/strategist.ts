import type { GameState, Unit } from '../models';
import { attachmentFor, modelDefinition } from '../attachments/queries';
import { reroll, rollDie } from '../combat/dice';
import type { RandomSource } from '../utils/dice';

export function canUseSuperlativeStrategist(state:GameState,unit:Unit):boolean {
  return !!attachmentFor(state,unit.id) && unit.models.some(m=>m.alive&&
    modelDefinition(state,unit,m).abilities.some(a=>a.id==='SUPERLATIVE_STRATEGIST'));
}
/** The universal die permission forbids rerolling a previously rerolled die. */
export function rollStrategistDie(rng:RandomSource,rerollChoice:boolean) {
  const initial=rollDie(6,rng);
  return rerollChoice?reroll(initial,{kind:'ATTACK_COUNT',source:'SUPERLATIVE_STRATEGIST',scope:'DIE'},'ATTACK_COUNT',rng):initial;
}
