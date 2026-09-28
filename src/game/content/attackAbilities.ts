import type { DeepReadonly, GameState, Unit, Weapon } from '../models';
import { modelDefinition, modelHasWeapon, sourceAbilities, unitKeywords } from '../attachments/queries';

/** Per-attack weapon view; target-dependent permissions never mutate a datasheet. */
export function factionAttackWeapon(state: GameState, attacker: Unit, weapon: DeepReadonly<Weapon>, target?: Unit): DeepReadonly<Weapon> {
  if (weapon.kind==='ranged' && (weapon.id==='destructor'||weapon.id.endsWith(':destructor')) && state.shooting?.unitId===attacker.id && state.shooting.psychicCommunionBonus &&
      attacker.models.some(m=>m.alive && modelDefinition(state,attacker,m).abilities.some(a=>a.id==='PSYCHIC_COMMUNION') && modelHasWeapon(state,attacker,m,weapon.id))) {
    const bonus=state.shooting.psychicCommunionBonus;
    return {...weapon,attacks:weapon.attacks.kind==='fixed'?{...weapon.attacks,value:weapon.attacks.value+bonus}:{...weapon.attacks,modifier:weapon.attacks.modifier+bonus},strength:weapon.strength+bonus};
  }
  if (weapon.kind !== 'ranged' || !sourceAbilities(state, attacker).some(a => a.ability.id === 'ASSURED_DESTRUCTION' &&
        attacker.models.some(m => m.alive && (m.componentUnitId ?? attacker.id) === a.sourceUnitId && modelHasWeapon(state,attacker,m,weapon.id))) ||
      (target && !unitKeywords(state, target).some(k => k === 'MONSTER' || k === 'VEHICLE'))) return weapon;
  return { ...weapon, rerollPermissions: [ ...(weapon.rerollPermissions ?? []),
    ...(['HIT','WOUND','DAMAGE'] as const).filter(kind => !weapon.rerollPermissions?.some(p => p.kind === kind))
      .map(kind => ({ kind, source: 'ASSURED_DESTRUCTION', scope: 'DIE' as const })) ] };
}
