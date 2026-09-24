import type { GameState, Model, Unit } from '../models';
import { unitHasCore } from './registry';
import { modelKeywords } from '../attachments/queries';
export interface MovementAbilityChoices {
    takingToSkies?: boolean;
    mobile?: boolean;
}
/** 21.03/24.17/24.35: choices last for one movement transaction only. */
export function validateMovementAbilities(s: GameState, u: Unit, choices: MovementAbilityChoices, charge = false) {
    return (!choices.takingToSkies || u.models.some(m => m.alive && modelKeywords(s, u, m).includes('FLY'))) &&
        (!choices.mobile || (!charge && unitHasCore(s, u, 'SUPER_HEAVY_WALKER')));
}
export function movementAbilities(s: GameState, m: Model) {
    const u = s.units.find(u => u.id === m.unitId)!;
    const tx = s.movement?.unitId === u.id ? s.movement : s.closeCombat?.charge?.unitId === u.id ? s.closeCombat.charge : undefined;
    const takingToSkies = !!tx?.abilityChoices?.takingToSkies;
    const flying = takingToSkies && modelKeywords(s, u, m).includes('FLY');
    return { flying, penalty: takingToSkies && !unitHasCore(s, u, 'HOVER') ? 2 : 0,
        walker: s.movement?.unitId === u.id && unitHasCore(s, u, 'SUPER_HEAVY_WALKER'), mobile: !!s.movement?.abilityChoices?.mobile && s.movement.unitId === u.id };
}
