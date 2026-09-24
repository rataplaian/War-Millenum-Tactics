import type { GameState, Weapon, RangedWeapon } from '../src/game/models';
import type { WeaponAbilityDefinition, WeaponAbilityType, AttackChoices } from '../src/game/abilities/types';
import { shootingState, oneShooter, rifle, dice } from './shooting.helpers';
import { resolveCombat } from '../src/game/rules/resolveCombat';
export const ability = (type: WeaponAbilityType, patch: Partial<WeaponAbilityDefinition> = {}): WeaponAbilityDefinition => ({ id: type.toLowerCase(), type, ...patch });
export function abilityState(abilities: WeaponAbilityDefinition[] = [], edit?: (s: GameState) => void) {
    const s = shootingState();
    oneShooter(s);
    rifle(s, { name: 'Technical Test Rifle', strength: 4, skill: 3, range: 36, armourPenetration: 0, damage: { kind: 'fixed', value: 1 }, traits: [], weaponAbilities: abilities });
    s.definitions = s.definitions.map((d, i) => ({ ...d, name: i ? 'Technical Defender' : 'Technical Attacker', stats: { ...d.stats, toughness: 4, save: 7 } }));
    edit?.(s);
    return s;
}
export function resolve(s: GameState, rolls: number[], choices: AttackChoices = {}) {
    const rng = dice(...rolls), weapon = s.definitions[0]!.weapons[0]!;
    const result = resolveCombat(weapon, [s.units[0]!.models[0]!.id], s.units[1]!, s.definitions[1]!, rng.rng, undefined, [], s, undefined, choices);
    return { ...result, calls: rng.calls(), record: result.resolution.attackRecords![0]! };
}
export function patchWeapon(s: GameState, patch: Partial<Weapon>) { rifle(s, patch as Partial<RangedWeapon>); }
