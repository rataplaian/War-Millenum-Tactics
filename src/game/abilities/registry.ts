import type { DeepReadonly, GameState, Model, Unit, Weapon } from '../models';
import { modelDefinition, unitKeywords } from '../attachments/queries';
import { chosenCore } from './core';
import { WEAPON_ABILITIES, type WeaponAbilityDefinition, type WeaponAbilityType, type AttackChoices } from './types';
const LEGACY_IDS = Object.fromEntries(WEAPON_ABILITIES.flatMap(type => [type, type.replaceAll('_', '-'), type.replaceAll('_', ' ')].flatMap(id => [[id, type], [id.toLowerCase(), type]]))) as Record<string, WeaponAbilityType | undefined>;
/** Import boundary for old fixture traits. Combat consumes typed definitions, not display labels. */
export function weaponAbilities(w: DeepReadonly<Weapon>): WeaponAbilityDefinition[] {
    return [...(w.weaponAbilities ?? []), ...w.traits.flatMap((t, i) => {
            const type = LEGACY_IDS[t.id];
            return type ? [{ id: `legacy:${w.id}:${i}`, type, ...(t.value === undefined ? {} : { value: t.value }), source: 'legacy-trait' }] : [];
        })].map(a => ({ ...a, type: a.type === 'PISTOL' ? 'CLOSE_QUARTERS' : a.type }));
}
export const hasWeaponAbility = (w: DeepReadonly<Weapon>, type: WeaponAbilityType) => weaponAbilities(w).some(a => a.type === (type === 'PISTOL' ? 'CLOSE_QUARTERS' : type));
/** 24.02: select one instance, never add parameters. A missing duplicate choice is explicit. */
export function resolveApplicableAbilityInstance(instances: readonly WeaponAbilityDefinition[], type: WeaponAbilityType, keywords: readonly string[], choices: AttackChoices = {}): WeaponAbilityDefinition | undefined {
    const candidates = instances.filter(a => a.type === type);
    if (!candidates.length)
        return;
    const selected = choices.abilities?.[type];
    if (candidates.length > 1 && !selected)
        throw Error(`ABILITY_CHOICE_REQUIRED:${type}`);
    const a = selected ? candidates.find(a => a.id === selected) : candidates[0];
    if (!a)
        throw Error(`INVALID_ABILITY_CHOICE:${type}`);
    return !a.targetKeyword || keywords.includes(a.targetKeyword.toUpperCase()) ? a : undefined;
}
export function resolvedAbilities(s: GameState | undefined, target: Unit, w: DeepReadonly<Weapon>, choices: AttackChoices = {}) {
    const all = weaponAbilities(w), keys = s ? unitKeywords(s, target) : [];
    return [...new Set(all.map(a => a.type))].flatMap(type => { const a = resolveApplicableAbilityInstance(all, type, keys, choices); return a ? [a] : []; });
}
export const modelCore = (s: GameState, u: Unit, m: Model, kind: string) => chosenCore(s, u, m, kind);
export const unitHasCore = (s: GameState, u: Unit, kind: string) => u.models.some(m => m.alive) && u.models.filter(m => m.alive).every(m => modelCore(s, u, m, kind).length > 0);
export function loneOperativeDistance(s: GameState, u: Unit): number | null {
    if (s.attachments?.some(a => a.id === u.id && a.active) || !unitHasCore(s, u, 'LONE_OPERATIVE'))
        return null;
    return Math.min(...u.models.filter(m => m.alive).map(m => Math.max(...modelCore(s, u, m, 'LONE_OPERATIVE').map(a => a.kind === 'LONE_OPERATIVE' ? a.distance ?? s.combatRules?.loneOperativeDistance ?? 12 : 12))));
}
export const weaponInstanceId = (s: GameState, u: Unit, m: Model, w: DeepReadonly<Weapon>) => modelDefinition(s, u, m).weapons.find(x => x.id === w.id || `${m.componentUnitId}:${x.id}` === w.id)?.id ?? w.id;
/** Catalog query only: existing controllers still implement these structural core abilities. */
export function coreAbilityCatalog(s: GameState, u: Unit, m: Model) {
    const d = modelDefinition(s, u, m);
    return [...(m.coreAbilities ?? d.coreAbilities ?? []),
        ...(d.transport?.firingDeck ? [{ kind: 'FIRING_DECK' as const, value: d.transport.firingDeck }] : []),
        ...(d.attachment ? [{ kind: d.attachment.role, canLeadDatasheetIds: [...d.attachment.canLeadDatasheetIds] }] : [])];
}
