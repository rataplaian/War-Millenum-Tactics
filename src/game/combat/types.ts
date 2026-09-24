import type { GameState, ModelAttackModifiers, Unit, UnitDefinition, Weapon, WeaponResolution, DiceResolution, SaveResult } from '../models';
import type { WeaponAbilityDefinition, AttackChoices } from '../abilities/types';
import type { DieResolution } from './dice';
export interface AttackContext {
    attackerUnitId: string;
    attackerModelId: string;
    targetUnitId: string;
    weapon: Weapon;
    attackType: 'ranged' | 'melee';
    phase: GameState['phase'];
    turn: number;
    distance: number;
    visible: boolean;
    engaged: boolean;
    engagedWithTarget: boolean;
    moved: boolean;
    advanced: boolean;
    charged: boolean;
    stationary: boolean;
    friendlySpotter: boolean;
    targetCount: number;
    abilities: WeaponAbilityDefinition[];
    terrainModifiers: ModelAttackModifiers | null;
    activeEffects: string[];
}
export interface AttackRecord {
    modelId: string;
    additional: boolean;
    autoHit: boolean;
    criticalHit: boolean;
    hit?: DieResolution;
    hitSucceeded?: boolean;
    generatedAdditionalHits: number;
    wound?: DieResolution;
    woundSucceeded?: boolean;
    criticalWound: boolean;
    automaticallyWoundedFromCriticalHit: boolean;
    save?: SaveResult;
    damage?: DiceResolution;
    mortalWounds: number;
    ignoredDamage: number;
    fnpRolls: number[];
    casualtyIds: string[];
    modifiers: {
        source: string;
        target: string;
        amount: number;
        timing: string;
        stacking?: import('../effects/types').Stacking;
        priority?: number;
    }[];
}
export interface AttackJob {
    weapon: Weapon;
    target: Unit;
    targetDefinition: UnitDefinition;
    attackerUnitId: string;
    choices: AttackChoices;
    precisionModelId?: string;
    contexts: AttackContext[];
    resolution: WeaponResolution;
    modelIds: string[];
    index: number;
    additionalRemaining: number;
    current: AttackRecord | null;
    stage: 'HIT' | 'HIT_RESULT' | 'WOUND' | 'WOUND_RESULT' | 'DONE';
    deferredMortals: {
        recordIndex: number;
        amount: number;
    }[];
}
