import { createVisibilityProvider, type VisibilityProvider } from '../terrain/visibility';
import { characteristicValue, characteristicModifiers, hitOutcome } from './modifiers';
import type { DeepReadonly, GameState, Weapon, Unit, UnitDefinition, ModelAttackModifiers, DiceValue } from '../models';
import { resolveWeaponValue } from '../rules/weaponValues';
import { woundTarget } from '../rules/combatRolls';
import { attackToughness, modelDefinition, unitKeywords } from '../attachments/queries';
import { allocationModel } from '../attachments/AllocationGroups';
import { allocateDamage, type DamageAllocationPolicy } from '../rules/damageAllocation';
import { effectiveCharacteristic } from '../effects/EffectEngine';
import type { RandomSource } from '../utils/dice';
import type { AttackChoices, WeaponAbilityType } from '../abilities/types';
import { buildAttackContext } from './context';
import type { AttackJob, AttackRecord, AttackContext } from './types';
import { isCriticalWound, rollDie, reroll, canReroll, type RollKind, type RerollPermission } from './dice';
import { resolveSave } from './save';
import { ignoreWounds, resolveMortalWounds } from './damage';
const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const ability = (c: AttackContext, t: WeaponAbilityType) => c.abilities.find(a => a.type === t);
const amount = (c: AttackContext, t: WeaponAbilityType, fallback = 0) => ability(c, t)?.value ?? fallback;
function value(v: DeepReadonly<DiceValue>, rng: RandomSource, permission?: DeepReadonly<RerollPermission>) {
    const initial = resolveWeaponValue(v, rng);
    if (v.kind === 'fixed')
        return initial;
    const dice = initial.rolls.map((r, i) => { const die = { initial: r, value: r, sides: v.sides, wasRerolled: false }; return permission && canReroll(die, permission, permission.kind, i) ? reroll(die, permission, permission.kind, rng, i) : die; });
    return { value: dice.reduce((n, r) => n + r.value, v.modifier), rolls: dice.map(r => r.value), dice };
}
function permission(w: DeepReadonly<Weapon>, kind: RollKind) { return w.rerollPermissions?.find(p => p.kind === kind); }
export function createAttackJob(w: DeepReadonly<Weapon>, ids: readonly string[], target: Unit, d: UnitDefinition, rng: RandomSource, mods: readonly ModelAttackModifiers[] = [], s?: GameState, precisionModelId?: string, choices: AttackChoices = {}, visibility?: VisibilityProvider): AttackJob {
    const provider = visibility ?? (s ? createVisibilityProvider(s) : undefined);
    const contexts = ids.map(id => buildAttackContext(s, id, target, w, choices, mods.find(m => m.modelId === id), provider));
    const selection = s?.shooting?.selectedTarget;
    if (selection?.weaponId === w.id && selection.targetUnitId === target.id)
        for (const c of contexts) {
            c.targetCount = selection.modelCount ?? c.targetCount;
            c.distance = selection.distances?.[c.attackerModelId] ?? c.distance;
        }
    const counts = contexts.map(c => {
        const resolved = value(w.attacks, rng, choices.rerolls?.ATTACK_COUNT === 'ALL' ? permission(w, 'ATTACK_COUNT') : undefined);
        let attacks = resolved.value;
        if (w.kind === 'ranged' && c.distance <= w.range / 2 + 1e-9)
            attacks += amount(c, 'RAPID_FIRE');
        attacks += Math.floor(c.targetCount / 5) * (ability(c, 'BLAST') ? amount(c, 'BLAST', 1) : 0);
        attacks += Math.floor(c.targetCount / 5) * amount(c, 'CLEAVE');
        attacks = s && c.attackerUnitId ? effectiveCharacteristic(s, c.attackerUnitId, 'ATTACKS', attacks, c.attackerModelId) : attacks;
        if (!Number.isSafeInteger(attacks) || attacks < 0 || attacks > 10000)
            throw Error('Attack count exceeds prototype resolution limit');
        return { modelId: c.attackerModelId, resolved: { ...resolved, value: attacks } };
    });
    const resolution = { weaponId: w.id, targetUnitId: target.id, eligibleFiringModelIds: [...ids], attackCounts: counts, attacks: counts.reduce((n, x) => n + x.resolved.value, 0), hitRolls: [], hits: 0, woundTarget: woundTarget(w.strength, s ? attackToughness(s, target) : d.stats.toughness), woundRolls: [], wounds: 0, saveResults: [], savesFailed: 0, damageResults: [], totalDamage: 0, destroyedModelIds: [], attackRecords: [], ...(mods.length ? { attackModifiers: copy([...mods]) } : {}) };
    return { weapon: copy(w) as Weapon, target: copy(target), targetDefinition: d, attackerUnitId: contexts[0]?.attackerUnitId ?? '', choices: copy(choices), precisionModelId, contexts, resolution, modelIds: counts.flatMap(x => Array.from({ length: x.resolved.value }, () => x.modelId)), index: 0, additionalRemaining: 0, current: null, stage: 'HIT', deferredMortals: [] };
}
export type RollWindow = (trigger: 'AFTER_HIT_ROLL' | 'AFTER_WOUND_ROLL', job: AttackJob) => boolean;
/** One serializable state machine for Shooting and melee. Pausing never pre-rolls future dice. */
export function runAttackJob(j: AttackJob, rng: RandomSource, s?: GameState, pause?: RollWindow, allocation: DamageAllocationPolicy = allocateDamage): boolean {
    const r = j.resolution, w = j.weapon;
    const record = (): AttackRecord => ({ modelId: j.modelIds[j.index]!, additional: false, autoHit: false, criticalHit: false, generatedAdditionalHits: 0, criticalWound: false, automaticallyWoundedFromCriticalHit: false, mortalWounds: 0, ignoredDamage: 0, fnpRolls: [], casualtyIds: [], modifiers: characteristicModifiers(s, j.attackerUnitId, j.modelIds[j.index]!, 'ATTACKS', 'CALCULATE_ATTACK_COUNT') });
    const finish = () => { r.attackRecords!.push(j.current!); if (j.additionalRemaining > 0 && j.target.models.some(m => m.alive)) {
        j.additionalRemaining--;
        j.current = { ...record(), additional: true, hitSucceeded: true };
        j.stage = 'WOUND';
    }
    else {
        j.index++;
        j.current = null;
        j.stage = 'HIT';
    } };
    while (j.index < j.modelIds.length && j.target.models.some(m => m.alive)) {
        const c = j.contexts.find(c => c.attackerModelId === j.modelIds[j.index])!;
        const characteristic = (key: Parameters<typeof effectiveCharacteristic>[2], base: number, unitId = c.attackerUnitId, modelId = c.attackerModelId) => characteristicValue(s, unitId, modelId, key, base, j.current ?? undefined, j.stage);
        const mod = (a: AttackRecord, source: string, target: string, n: number) => { if (n)
            a.modifiers.push({ source, target, amount: n, timing: j.stage, stacking: 'STACK', priority: 0 }); return n; };
        if (j.stage === 'HIT') {
            j.current = record();
            const a = j.current;
            if (ability(c, 'TORRENT')) {
                a.autoHit = true;
                a.hitSucceeded = true;
                r.hits++;
                j.stage = 'WOUND';
                continue;
            }
            a.hit = rollDie(6, rng);
            const indirect = !!ability(c, 'INDIRECT_FIRE') && j.choices.shootingMode === 'INDIRECT';
            const hit = hitOutcome(s, c, j.choices, a.hit.value, { ...a, modifiers: [] }, j.stage);
            if (!indirect && permission(w, 'HIT') && (j.choices.rerolls?.HIT === 'ALL' || (j.choices.rerolls?.HIT === 'FAILED' && !hit.success)))
                a.hit = reroll(a.hit, permission(w, 'HIT')!, 'HIT', rng);
            r.hitRolls.push(a.hit.value);
            j.stage = 'HIT_RESULT';
            if (pause?.('AFTER_HIT_ROLL', j)) {
                r.pending = true;
                return false;
            }
        }
        const a = j.current!;
        if (j.stage === 'HIT_RESULT') {
            const hit = hitOutcome(s, c, j.choices, a.hit!.value, a, j.stage);
            a.criticalHit = hit.critical;
            a.hitSucceeded = hit.success;
            if (!a.hitSucceeded) {
                finish();
                continue;
            }
            const extra = a.criticalHit ? amount(c, 'SUSTAINED_HITS') : 0;
            a.generatedAdditionalHits = extra;
            j.additionalRemaining = extra;
            r.hits += 1 + extra;
            a.automaticallyWoundedFromCriticalHit = !!(a.criticalHit && ability(c, 'LETHAL_HITS') && j.choices.lethalHits !== false);
            j.stage = 'WOUND';
        }
        if (j.stage === 'WOUND') {
            if (a.automaticallyWoundedFromCriticalHit) {
                a.woundSucceeded = true;
                j.stage = 'WOUND_RESULT';
            }
            else {
                a.wound = rollDie(6, rng);
                const needed = woundTarget(characteristic('STRENGTH', w.strength), s ? attackToughness(s, j.target) : j.targetDefinition.stats.toughness);
                const wants = j.choices.rerolls?.WOUND ?? (ability(c, 'TWIN_LINKED') ? 'FAILED' : 'NONE');
                const anti = ability(c, 'ANTI'), threshold = anti && s && unitKeywords(s, j.target).includes(anti.keyword?.toUpperCase() ?? '') ? anti.threshold ?? 6 : s?.combatRules?.criticalWoundThreshold ?? 6;
                const delta = Math.max(-1, Math.min(1, characteristic('WOUND_ROLL', 0) + (ability(c, 'LANCE') && c.charged ? 1 : 0)));
                const failed = a.wound.value === 1 || (!isCriticalWound(a.wound.value, Math.min(threshold, s?.combatRules?.criticalWoundThreshold ?? 6)) && a.wound.value + delta < needed);
                if ((ability(c, 'TWIN_LINKED') || permission(w, 'WOUND')) && (wants === 'ALL' || (wants === 'FAILED' && failed)))
                    a.wound = reroll(a.wound, permission(w, 'WOUND') ?? { kind: 'WOUND', scope: 'DIE', source: 'TWIN_LINKED' }, 'WOUND', rng);
                r.woundRolls.push(a.wound.value);
                j.stage = 'WOUND_RESULT';
                if (pause?.('AFTER_WOUND_ROLL', j)) {
                    r.pending = true;
                    return false;
                }
            }
        }
        if (j.stage === 'WOUND_RESULT') {
            const needed = woundTarget(characteristic('STRENGTH', w.strength), s ? attackToughness(s, j.target) : j.targetDefinition.stats.toughness);
            if (j.target.models.some(m => m.componentUnitId) && a.wound) {
                r.woundTargets ??= [];
                r.woundTargets.push(needed);
            }
            if (a.wound) {
                const anti = ability(c, 'ANTI'), threshold = anti && s && unitKeywords(s, j.target).includes(anti.keyword?.toUpperCase() ?? '') ? anti.threshold ?? 6 : s?.combatRules?.criticalWoundThreshold ?? 6;
                a.criticalWound = isCriticalWound(a.wound.value, Math.min(threshold, s?.combatRules?.criticalWoundThreshold ?? 6));
                const delta = Math.max(-1, Math.min(1, characteristic('WOUND_ROLL', 0) + (ability(c, 'LANCE') && c.charged ? mod(a, 'LANCE', 'WOUND', 1) : 0)));
                a.woundSucceeded = a.wound.value !== 1 && (a.criticalWound || a.wound.value + delta >= needed);
            }
            if (!a.woundSucceeded) {
                finish();
                continue;
            }
            r.wounds++;
            const damage = () => { const v = value(w.damage, rng, j.choices.rerolls?.DAMAGE === 'ALL' ? permission(w, 'DAMAGE') : undefined); v.value = characteristic('DAMAGE', v.value) + (w.kind === 'ranged' && c.distance <= w.range / 2 + 1e-9 ? mod(a, 'MELTA', 'DAMAGE', amount(c, 'MELTA')) : 0); return v; };
            if (a.criticalWound && ability(c, 'DEVASTATING_WOUNDS')) {
                a.damage = damage();
                a.mortalWounds = a.damage.value;
                j.deferredMortals.push({ recordIndex: r.attackRecords!.length, amount: a.damage.value });
                finish();
                continue;
            }
            const grouped = s && (j.target.models.some(m => m.sourceDefinitionId) || j.target.models.some(m => modelDefinition(s, j.target, m).keywords.some(k => k.toUpperCase() === 'CHARACTER')));
            const m = grouped ? allocationModel(s!, j.target, j.precisionModelId) : j.target.models.find(m => m.id === allocation(j.target.models, j.targetDefinition.stats.wounds));
            if (!m?.alive)
                throw Error('Invalid allocation');
            const d = s ? modelDefinition(s, j.target, m) : j.targetDefinition;
            const save = characteristic('SAVE', d.stats.save, j.target.id, m.id), ap = characteristic('AP', w.armourPenetration);
            a.save = resolveSave(save, d.invulnerableSave, ap, rng, !!permission(w, 'SAVE') && j.choices.rerolls?.SAVE === 'FAILED');
            r.saveResults.push(a.save);
            if (a.save.saved) {
                finish();
                continue;
            }
            r.savesFailed++;
            a.damage = damage();
            const before = m.woundsRemaining, ignored = ignoreWounds(s, j.target, m, a.damage.value, rng);
            a.ignoredDamage = ignored.ignored;
            a.fnpRolls = ignored.rolls;
            const applied = Math.min(before, ignored.lost);
            m.woundsRemaining -= applied;
            m.alive = m.woundsRemaining > 0;
            r.damageResults.push({ modelId: m.id, resolved: a.damage, woundsBefore: before, woundsAfter: m.woundsRemaining, applied, excess: Math.max(0, ignored.lost - before), destroyed: !m.alive });
            r.totalDamage += applied;
            if (!m.alive) {
                r.destroyedModelIds.push(m.id);
                a.casualtyIds.push(m.id);
            }
            finish();
        }
    }
    for (const deferred of j.deferredMortals) {
        const outcome = resolveMortalWounds(s, j.target, deferred.amount, rng, { singleModel: true, modelId: s ? allocationModel(s, j.target, j.precisionModelId)?.id : allocation(j.target.models, j.targetDefinition.stats.wounds) ?? undefined });
        r.attackRecords![deferred.recordIndex]!.ignoredDamage = outcome.ignored;
        r.attackRecords![deferred.recordIndex]!.fnpRolls = outcome.records.flatMap(x => x.rolls);
        r.attackRecords![deferred.recordIndex]!.casualtyIds = outcome.destroyedModelIds;
        r.totalDamage += outcome.applied;
        r.destroyedModelIds.push(...outcome.destroyedModelIds);
    }
    j.deferredMortals = [];
    j.stage = 'DONE';
    delete r.pending;
    return true;
}
