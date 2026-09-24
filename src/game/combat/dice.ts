import type { RandomSource } from '../utils/dice';
export type RollKind = 'HIT' | 'WOUND' | 'SAVE' | 'DAMAGE' | 'ATTACK_COUNT';
export interface DieResolution {
    initial: number;
    value: number;
    sides: 3 | 6;
    wasRerolled: boolean;
    rerollSource?: string;
}
export interface RerollPermission {
    kind: RollKind;
    source: string;
    scope: 'DIE' | 'ROLL';
    dieIndex?: number;
    allowRepeated?: boolean;
}
export function rollDie(sides: 3 | 6, rng: RandomSource): DieResolution { const n = rng(); if (!Number.isFinite(n) || n < 0 || n >= 1)
    throw RangeError('Invalid RNG'); const value = Math.floor(n * sides) + 1; return { initial: value, value, sides, wasRerolled: false }; }
export const canReroll = (die: DieResolution, p: RerollPermission, kind: RollKind, index = 0) => p.kind === kind && (!die.wasRerolled || p.allowRepeated === true) && (p.scope === 'ROLL' || p.dieIndex === undefined || p.dieIndex === index);
export function reroll(die: DieResolution, p: RerollPermission, kind: RollKind, rng: RandomSource, index = 0): DieResolution { if (!canReroll(die, p, kind, index))
    throw Error('REROLL_NOT_ALLOWED'); return { ...die, value: rollDie(die.sides, rng).value, wasRerolled: true, rerollSource: p.source }; }
export const isCriticalHit = (roll: number, threshold = 6) => roll !== 1 && roll >= threshold;
export const isCriticalWound = (roll: number, threshold = 6) => roll !== 1 && roll >= threshold;
