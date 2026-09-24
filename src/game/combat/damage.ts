import type { GameState, Model, Unit } from '../models';
import type { RandomSource } from '../utils/dice';
import { allocationModel } from '../attachments/AllocationGroups';
import { modelCore } from '../abilities/registry';
import { rollDie } from './dice';
/** 24.12: one independent ignore-wound roll per lost wound, after saves. */
export function ignoreWounds(s: GameState | undefined, u: Unit, m: Model, amount: number, rng: RandomSource) {
    if (!Number.isSafeInteger(amount) || amount < 0) throw Error('Invalid damage amount');
    const abilities = s ? modelCore(s, u, m, 'FEEL_NO_PAIN') : [];
    const threshold = abilities.length ? Math.min(...abilities.map(a => a.kind === 'FEEL_NO_PAIN' ? a.threshold : 7)) : null;
    const rolls = threshold ? Array.from({ length: amount }, () => rollDie(6, rng).value) : [];
    const ignored = threshold ? rolls.filter(r => r >= threshold).length : 0;
    return { rolls, ignored, lost: amount - ignored };
}
/** 06.02: mortal points spill, except attacks explicitly capped to one allocated model (24.10). */
export function resolveMortalWounds(s: GameState | undefined, u: Unit, amount: number, rng: RandomSource, options: {
    singleModel?: boolean;
    modelId?: string;
} = {}) {
    if (!Number.isSafeInteger(amount) || amount < 0) throw Error('Invalid mortal wound amount');
    const records: {
        modelId: string;
        lost: number;
        ignored: number;
        rolls: number[];
        destroyed: boolean;
    }[] = [];
    const allocate = () => s ? allocationModel(s, u) : u.models.find(m => m.alive);
    let chosen = options.modelId ? u.models.find(m => m.id === options.modelId && m.alive) : allocate();
    for (let i = 0; i < amount; i++) {
        const m = options.singleModel ? chosen : allocate();
        if (!m?.alive)
            break;
        const result = ignoreWounds(s, u, m, 1, rng);
        m.woundsRemaining -= result.lost;
        m.alive = m.woundsRemaining > 0;
        records.push({ modelId: m.id, ...result, destroyed: !m.alive });
    }
    return { records, ignored: records.reduce((n, r) => n + r.ignored, 0), applied: records.reduce((n, r) => n + r.lost, 0), destroyedModelIds: records.filter(r => r.destroyed).map(r => r.modelId) };
}
