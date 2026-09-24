import type { SaveResult } from '../models';
import type { RandomSource } from '../utils/dice';
import { rollDie, reroll } from './dice';
/** 05.03: AP changes armour only; choose the lowest legal target. */
export function resolveSave(normal: number, invulnerable: number | undefined, ap: number, rng: RandomSource, rerollFailed = false): SaveResult {
    const armour = normal - ap, selected = invulnerable !== undefined && invulnerable < armour ? 'INVULNERABLE' : 'ARMOUR', required = selected === 'INVULNERABLE' ? invulnerable! : armour;
    if (required > 6)
        return { required, roll: null, saved: false, selected };
    let die = rollDie(6, rng);
    if (rerollFailed && die.value < required)
        die = reroll(die, { kind: 'SAVE', scope: 'DIE', source: 'permission' }, 'SAVE', rng);
    return { required, roll: die.value, saved: die.value !== 1 && die.value >= required, selected, die };
}
