import type { DeepReadonly, GameState, Unit, Weapon } from '../models';
import { modelHasWeapon, sourceAbilities, unitKeywords } from '../attachments/queries';

/** Per-attack weapon view; target-dependent permissions never mutate a datasheet. */
export function factionAttackWeapon(state: GameState, attacker: Unit, weapon: DeepReadonly<Weapon>, target?: Unit): DeepReadonly<Weapon> {
  if (weapon.kind !== 'ranged' || !sourceAbilities(state, attacker).some(a => a.ability.id === 'ASSURED_DESTRUCTION' &&
        attacker.models.some(m => m.alive && (m.componentUnitId ?? attacker.id) === a.sourceUnitId && modelHasWeapon(state,attacker,m,weapon.id))) ||
      (target && !unitKeywords(state, target).some(k => k === 'MONSTER' || k === 'VEHICLE'))) return weapon;
  return { ...weapon, rerollPermissions: [ ...(weapon.rerollPermissions ?? []),
    ...(['HIT','WOUND','DAMAGE'] as const).filter(kind => !weapon.rerollPermissions?.some(p => p.kind === kind))
      .map(kind => ({ kind, source: 'ASSURED_DESTRUCTION', scope: 'DIE' as const })) ] };
}
