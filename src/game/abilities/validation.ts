import type { DeepReadonly, Weapon } from '../models';
import type { CoreAbility } from '../setup/types';
import { WEAPON_ABILITIES, type AttackChoices } from './types';
import { hasWeaponAbility, weaponAbilities } from './registry';
import { validateDiceValue } from '../rules/weaponValues';
const integer = (n: number | undefined, min: number, max = Number.MAX_SAFE_INTEGER) => n !== undefined && Number.isSafeInteger(n) && n >= min && n <= max;
export function validateWeaponAbilities(w: DeepReadonly<Weapon>) {
    const all = w.weaponAbilities ?? [];
    if (new Set(all.map(a => a.id)).size !== all.length)
        throw Error('Duplicate ability instance ID');
    for (const a of all) {
        if (!a.id || !WEAPON_ABILITIES.includes(a.type) || (a.value !== undefined && !integer(a.value, 0)) || (a.threshold !== undefined && !integer(a.threshold, 2, 6)))
            throw Error('Invalid weapon ability');
        if (['CLEAVE', 'MELTA', 'RAPID_FIRE', 'SUSTAINED_HITS'].includes(a.type) && !integer(a.value, 1))
            throw Error('Missing ability parameter');
        if (a.type === 'ANTI' && (!a.keyword || !integer(a.threshold, 2, 6)))
            throw Error('Invalid Anti condition');
    }
    for (const p of w.rerollPermissions ?? [])
        if (!['HIT', 'WOUND', 'ATTACK_COUNT', 'DAMAGE', 'SAVE'].includes(p.kind) || !p.source || !['DIE', 'ROLL'].includes(p.scope) || (p.dieIndex !== undefined && !integer(p.dieIndex, 0)))
            throw Error('Invalid reroll permission');
}
export function validateCoreAbilities(list: readonly DeepReadonly<CoreAbility>[] = []) {
    for (const a of list) {
        if (a.kind === 'FEEL_NO_PAIN' && !integer(a.threshold, 2, 6))
            throw Error('Invalid Feel No Pain');
        if (a.kind === 'LONE_OPERATIVE' && a.distance !== undefined && (!Number.isFinite(a.distance) || a.distance < 0))
            throw Error('Invalid Lone Operative distance');
        if (a.kind === 'DEADLY_DEMISE')
            validateDiceValue(a.damage);
    }
}
export function validAttackChoices(w: DeepReadonly<Weapon>, c: AttackChoices) {
    if (c.shootingMode !== undefined && !['NORMAL', 'INDIRECT'].includes(c.shootingMode))
        return false;
    if (c.psychicIgnore !== undefined && !['ALL', 'NONE', 'PENALTIES'].includes(c.psychicIgnore))
        return false;
    if (c.lethalHits !== undefined && typeof c.lethalHits !== 'boolean')
        return false;
    if (c.shootingMode === 'INDIRECT' && !hasWeaponAbility(w, 'INDIRECT_FIRE'))
        return false;
    const instances = weaponAbilities(w);
    if (Object.entries(c.abilities ?? {}).some(([kind, id]) => !instances.some(a => a.type === kind && a.id === id)))
        return false;
    return Object.entries(c.rerolls ?? {}).every(([kind, mode]) => ['ALL', 'FAILED', 'NONE'].includes(mode) && (mode === 'NONE' || (kind === 'WOUND' && hasWeaponAbility(w, 'TWIN_LINKED')) || w.rerollPermissions?.some(p => p.kind === kind)));
}
