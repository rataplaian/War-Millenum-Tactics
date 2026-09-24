import { modelKeywords } from '../attachments/queries';
import { isCriticalHit } from './dice';
import type { GameState } from '../models';
import type { Characteristic } from '../effects/types';
import { activeEffects, effectiveCharacteristic } from '../effects/EffectEngine';
import { sourceModifier } from '../attachments/queries';
import type { AttackRecord, AttackContext } from './types';
export type ModifierRecord = AttackRecord['modifiers'][number];
export function characteristicModifiers(s: GameState | undefined, unitId: string, modelId: string, key: Characteristic, timing: string): ModifierRecord[] {
    if (!s || !unitId)
        return [];
    const records = activeEffects(s, unitId).filter(e => e.payload.kind === 'MODIFIER' && e.payload.characteristic === key).map(e => ({ source: e.source, target: key, amount: e.payload.kind === 'MODIFIER' ? e.payload.value : 0, timing, stacking: e.stacking, priority: 0 }));
    const attached = sourceModifier(s, unitId, key, modelId);
    if (attached)
        records.push({ source: 'ATTACHED_ABILITY', target: key, amount: attached, timing, stacking: 'STACK', priority: 0 });
    return records;
}
export function characteristicValue(s: GameState | undefined, unitId: string, modelId: string, key: Characteristic, base: number, record?: AttackRecord, timing = 'RESOLUTION') {
    const modifiers = characteristicModifiers(s, unitId, modelId, key, timing);
    if (record)
        for (const m of modifiers)
            if (!record.modifiers.some(x => JSON.stringify(x) === JSON.stringify(m)))
                record.modifiers.push(m);
    if (key === 'HIT_ROLL' || key === 'WOUND_ROLL')
        return base + modifiers.reduce((n, m) => n + m.amount, 0); // clamp once, after weapon modifiers
    return s && unitId ? effectiveCharacteristic(s, unitId, key, base, modelId) : base;
}
/** Characteristic and Hit modifiers stay separate. Psychic chooses before the final clamps. */
export function skillValue(s: GameState | undefined, c: AttackContext, mode: 'ALL' | 'NONE' | 'PENALTIES', record: AttackRecord, timing: string) {
    const key = c.weapon.kind === 'ranged' ? 'BS' : 'WS';
    const modifiers = [...(c.terrainModifiers?.modifiers.filter(m => m.source !== 'TEMPORARY_EFFECT').map(m => ({ source: m.source, target: key, amount: m.skillDelta, timing, stacking: 'STACK' as const, priority: 0 })) ?? []), ...characteristicModifiers(s, c.attackerUnitId, c.attackerModelId, key, timing)];
    const applied = modifiers.filter(m => mode === 'NONE' || (mode === 'PENALTIES' && m.amount < 0));
    record.modifiers.push(...applied);
    return Math.max(2, Math.min(6, c.weapon.skill + applied.reduce((n, m) => n + m.amount, 0)));
}
/** 05/10.06/24.16/24.29: gather once, choose Psychic exclusions, then cap net Hit delta. */
export function hitOutcome(s: GameState | undefined, c: AttackContext, choices: import('../abilities/types').AttackChoices, roll: number, record: AttackRecord, timing: string) {
    const has = (type: string) => c.abilities.some(a => a.type === type);
    const psychic = has('PSYCHIC') ? choices.psychicIgnore ?? 'PENALTIES' : 'NONE';
    const skill = skillValue(s, c, psychic, record, timing);
    const modifiers = characteristicModifiers(s, c.attackerUnitId, c.attackerModelId, 'HIT_ROLL', timing);
    const owner = s?.units.find(u => u.id === c.attackerUnitId), bearer = owner?.models.find(m => m.id === c.attackerModelId);
    const add = (source: string, amount: number) => modifiers.push({ source, target: 'HIT_ROLL', amount, timing, stacking: 'STACK', priority: 0 });
    if (has('HEAVY') && s?.phase === 'Shooting' && s.activePlayerId === owner?.playerId && !c.engaged && owner?.setupAtTurn !== s.turn && owner?.models.every(m => m.movementUsed <= 3))
        add('HEAVY', 1);
    if (c.engaged && s && owner && bearer && modelKeywords(s, owner, bearer).some(k => k === 'MONSTER' || k === 'VEHICLE') && !(has('CLOSE_QUARTERS') && c.engagedWithTarget))
        add('CLOSE_QUARTERS_SHOOTING', -1);
    const applied = modifiers.filter(m => psychic === 'NONE' || (psychic === 'PENALTIES' && m.amount > 0));
    record.modifiers.push(...applied);
    const delta = Math.max(-1, Math.min(1, applied.reduce((n, m) => n + m.amount, 0)));
    const critical = isCriticalHit(roll, s?.combatRules?.criticalHitThreshold ?? 6);
    const indirect = has('INDIRECT_FIRE') && choices.shootingMode === 'INDIRECT';
    return { critical, success: roll !== 1 && (indirect ? roll >= (c.stationary && c.friendlySpotter ? 4 : 6) : critical || roll + delta >= skill) };
}
