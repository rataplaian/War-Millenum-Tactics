import type { DeepReadonly, DiceValue, GameState, Unit, Weapon } from '../models';

const mean=(value:DiceValue)=>value.kind==='fixed'?value.value:value.count*(value.sides+1)/2+value.modifier;
/** Cheap heuristic estimate, never used to decide whether an attack is legal. */
export function expectedDamage(state: GameState, attacker: Unit, target: Unit, weapon: DeepReadonly<Weapon>): number {
  const targetProfile=state.definitions.find(d=>d.id===target.definitionId);
  if(!targetProfile)return 0;
  const toughness=targetProfile.stats.toughness,strength=weapon.strength;
  const woundNeed=strength>=toughness*2?2:strength>toughness?3:strength===toughness?4:strength*2<=toughness?6:5;
  const saveNeed=Math.max(2,Math.min(7,targetProfile.stats.save-weapon.armourPenetration));
  const hit=Math.max(0,Math.min(1,(7-weapon.skill)/6));
  const wound=(7-woundNeed)/6,failedSave=Math.min(1,(saveNeed-1)/6);
  const living=target.models.filter(model=>model.alive).length;
  return Math.max(0,Math.min(living*targetProfile.stats.wounds,mean(weapon.attacks)*hit*wound*failedSave*mean(weapon.damage)));
}
