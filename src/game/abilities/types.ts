import type { DiceValue } from '../models';
export const WEAPON_ABILITIES = ['ANTI', 'ASSAULT', 'BLAST', 'CLEAVE', 'CLOSE_QUARTERS', 'DEVASTATING_WOUNDS', 'EXTRA_ATTACKS', 'HAZARDOUS', 'HEAVY', 'IGNORES_COVER', 'INDIRECT_FIRE', 'LANCE', 'LETHAL_HITS', 'MELTA', 'ONE_SHOT', 'PISTOL', 'PRECISION', 'PSYCHIC', 'RAPID_FIRE', 'SUSTAINED_HITS', 'TORRENT', 'TWIN_LINKED'] as const;
export type WeaponAbilityType = typeof WEAPON_ABILITIES[number];
export interface WeaponAbilityDefinition {
    id: string;
    type: WeaponAbilityType;
    value?: number;
    keyword?: string;
    targetKeyword?: string;
    threshold?: number;
    source?: string;
    metadata?: Record<string, string | number | boolean>;
}
export type UniversalCoreAbility = {
    kind: 'FEEL_NO_PAIN';
    threshold: number;
} | {
    kind: 'DEADLY_DEMISE';
    damage: DiceValue;
} | {
    kind: 'LONE_OPERATIVE';
    distance?: number;
} | {
    kind: 'STEALTH' | 'HOVER' | 'SUPER_HEAVY_WALKER' | 'FIGHTS_FIRST';
};
export interface AttackChoices {
    abilities?: Record<string, string>;
    lethalHits?: boolean;
    psychicIgnore?: 'NONE' | 'PENALTIES' | 'ALL';
    rerolls?: Partial<Record<'HIT' | 'WOUND' | 'SAVE' | 'DAMAGE' | 'ATTACK_COUNT', 'FAILED' | 'ALL' | 'NONE'>>;
    shootingMode?: 'NORMAL' | 'INDIRECT';
}
export const RULE_IDS: Record<WeaponAbilityType, string> = { ANTI: '24.03', ASSAULT: '24.04', BLAST: '24.05', CLEAVE: '24.06', CLOSE_QUARTERS: '24.07', DEVASTATING_WOUNDS: '24.10', EXTRA_ATTACKS: '24.11', HAZARDOUS: '24.15', HEAVY: '24.16', IGNORES_COVER: '24.18', INDIRECT_FIRE: '24.19/10.07', LANCE: '24.21', LETHAL_HITS: '24.23', MELTA: '24.25', ONE_SHOT: '24.26', PISTOL: '24.27', PRECISION: '24.28', PSYCHIC: '24.29', RAPID_FIRE: '24.30', SUSTAINED_HITS: '24.36', TORRENT: '24.37', TWIN_LINKED: '24.38' };
/** Existing deployment/attachment/transport implementations remain authoritative. */
export const CORE_ABILITY_RULES = {
    DEADLY_DEMISE: '24.08', DEEP_STRIKE: '24.09', FEEL_NO_PAIN: '24.12', FIGHTS_FIRST: '24.13',
    FIRING_DECK: '24.14', HOVER: '24.17', INFILTRATORS: '24.20', LEADER: '24.22', LONE_OPERATIVE: '24.24',
    SCOUTS: '24.31', STEALTH: '24.33', SUPPORT: '24.34', SUPER_HEAVY_WALKER: '24.35',
} as const;
