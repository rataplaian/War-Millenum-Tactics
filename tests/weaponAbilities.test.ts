import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ability, abilityState, resolve, patchWeapon } from './abilities.helpers';
import { resolveApplicableAbilityInstance } from '../src/game/abilities/registry';
import { canReroll, reroll, rollDie, isCriticalHit, isCriticalWound } from '../src/game/combat/dice';
import { resolveWeaponValue } from '../src/game/rules/weaponValues';
import { resolveSave } from '../src/game/combat/save';
import { resolveMortalWounds } from '../src/game/combat/damage';
import { createAttackJob, runAttackJob } from '../src/game/combat/AttackPipeline';
import { dice } from './shooting.helpers';
import { baseRadius } from '../src/game/utils/geometry';
test('duplicated parameterized abilities require one explicit instance, never sum', () => {
    const list = [ability('SUSTAINED_HITS', { id: 'a', value: 1 }), ability('SUSTAINED_HITS', { id: 'b', value: 2 })];
    assert.throws(() => resolveApplicableAbilityInstance(list, 'SUSTAINED_HITS', []), /CHOICE_REQUIRED/);
    assert.equal(resolveApplicableAbilityInstance(list, 'SUSTAINED_HITS', [], { abilities: { SUSTAINED_HITS: 'b' } })?.value, 2);
});
test('keyword-qualified Lethal applies only to matching target UNIT', () => {
    const s = abilityState([ability('LETHAL_HITS', { targetKeyword: 'VEHICLE' })]);
    assert.equal(resolve(s, [6, 1]).record.automaticallyWoundedFromCriticalHit, false);
    s.definitions = s.definitions.map((d, i) => i === 1 ? { ...d, keywords: ['VEHICLE'] } : d);
    assert.equal(resolve(s, [6]).record.automaticallyWoundedFromCriticalHit, true);
});
test('D3 and D6+1 resolve with explicit RNG and no formula parser', () => {
    assert.deepEqual(resolveWeaponValue({ kind: 'dice', count: 1, sides: 3, modifier: 0 }, dice(6).rng), { value: 3, rolls: [3] });
    assert.deepEqual(resolveWeaponValue({ kind: 'dice', count: 1, sides: 6, modifier: 1 }, dice(4).rng), { value: 5, rolls: [4] });
});
test('Torrent consumes no Hit die and cannot trigger critical-hit abilities', () => {
    const r = resolve(abilityState([ability('TORRENT'), ability('LETHAL_HITS'), ability('SUSTAINED_HITS', { value: 2 })]), [4]);
    assert.equal(r.calls, 1);
    assert.deepEqual(r.resolution.hitRolls, []);
    assert.equal(r.record.autoHit, true);
    assert.equal(r.record.criticalHit, false);
    assert.equal(r.resolution.hits, 1);
});
test('Lethal critical bypasses Wound roll; optional opt-out permits normal wound', () => {
    const s = abilityState([ability('LETHAL_HITS')]);
    assert.equal(resolve(s, [6]).calls, 1);
    assert.equal(resolve(s, [6, 4], { lethalHits: false }).record.automaticallyWoundedFromCriticalHit, false);
});
test('Sustained additional hits have explicit non-critical records and no recursive generation', () => {
    const r = resolve(abilityState([ability('SUSTAINED_HITS', { value: 2 })]), [6, 1, 1, 1]);
    assert.equal(r.resolution.hits, 3);
    assert.equal(r.resolution.attackRecords!.length, 3);
    assert.equal(r.record.generatedAdditionalHits, 2);
    assert.ok(r.resolution.attackRecords!.slice(1).every(a => a.additional && !a.criticalHit));
});
test('Lethal plus Sustained auto-wounds only the original critical hit', () => {
    const r = resolve(abilityState([ability('LETHAL_HITS'), ability('SUSTAINED_HITS', { value: 1 })]), [6, 1]);
    assert.equal(r.resolution.wounds, 1);
    assert.deepEqual(r.resolution.woundRolls, [1]);
    assert.equal(r.resolution.attackRecords![1]!.automaticallyWoundedFromCriticalHit, false);
});
test('Anti changes unmodified wound threshold on matching unit keyword', () => {
    const s = abilityState([ability('ANTI', { keyword: 'VEHICLE', threshold: 2 })]);
    assert.equal(resolve(s, [3, 2]).record.criticalWound, false);
    s.definitions = s.definitions.map((d, i) => i ? { ...d, keywords: ['VEHICLE'] } : d);
    assert.equal(resolve(s, [3, 2]).record.criticalWound, true);
});
test('natural Devastating Wound bypasses saves and caps damage to one model', () => {
    const s = abilityState([ability('DEVASTATING_WOUNDS')]);
    patchWeapon(s, { damage: { kind: 'fixed', value: 8 } });
    const r = resolve(s, [3, 6]);
    assert.equal(r.calls, 2);
    assert.equal(r.resolution.saveResults.length, 0);
    assert.equal(r.resolution.totalDamage, 2);
    assert.equal(r.target.models.filter(m => m.alive).length, 2);
    assert.equal(r.record.mortalWounds, 8);
});
test('Anti critical activates Devastating Wounds', () => {
    const s = abilityState([ability('ANTI', { keyword: 'INFANTRY', threshold: 2 }), ability('DEVASTATING_WOUNDS')]);
    const r = resolve(s, [3, 2]);
    assert.equal(r.record.criticalWound, true);
    assert.equal(r.record.mortalWounds, 1);
});
test('Lethal automatic wounds never become Devastating Wounds', () => {
    const r = resolve(abilityState([ability('LETHAL_HITS'), ability('DEVASTATING_WOUNDS')]), [6]);
    assert.equal(r.record.criticalWound, false);
    assert.equal(r.record.mortalWounds, 0);
    assert.equal(r.resolution.saveResults.length, 1);
});
test('Twin-linked uses generic single reroll and records both die values', () => {
    const r = resolve(abilityState([ability('TWIN_LINKED')]), [3, 1, 4]);
    assert.equal(r.record.wound?.initial, 1);
    assert.equal(r.record.wound?.value, 4);
    assert.equal(r.record.wound?.wasRerolled, true);
    assert.equal(r.record.wound?.rerollSource, 'TWIN_LINKED');
});
test('Twin-linked failed-only choice retains a successful Anti wound below normal threshold', () => {
    const s = abilityState([ability('ANTI', { keyword: 'INFANTRY', threshold: 2 }), ability('TWIN_LINKED')]);
    assert.equal(resolve(s, [3, 2]).calls, 2);
});
test('generic reroll honors die index, roll kind and prohibition on a second reroll', () => {
    const d = rollDie(6, dice(1).rng), p = { kind: 'HIT' as const, source: 'test', scope: 'DIE' as const, dieIndex: 1 };
    assert.equal(canReroll(d, p, 'HIT', 0), false);
    assert.equal(canReroll(d, p, 'WOUND', 1), false);
    const r = reroll(d, p, 'HIT', dice(6).rng, 1);
    assert.equal(canReroll(r, p, 'HIT', 1), false);
    assert.throws(() => reroll(r, p, 'HIT', dice().rng, 1));
    assert.equal(canReroll(r, { ...p, allowRepeated: true }, 'HIT', 1), true);
});
test('Hit reroll requires a rule permission; player preference cannot grant it', () => {
    const s = abilityState();
    assert.equal(resolve(s, [1], { rerolls: { HIT: 'ALL' } }).calls, 1);
    patchWeapon(s, { rerollPermissions: [{ kind: 'HIT', source: 'technical-rule', scope: 'DIE' }] });
    assert.equal(resolve(s, [1, 3, 1], { rerolls: { HIT: 'FAILED' } }).record.hit?.rerollSource, 'technical-rule');
});
test('Attack-count and Damage rerolls retain per-die provenance', () => {
    const s = abilityState();
    patchWeapon(s, { attacks: { kind: 'dice', count: 1, sides: 3, modifier: 0 }, damage: { kind: 'dice', count: 1, sides: 6, modifier: 0 }, rerollPermissions: [{ kind: 'ATTACK_COUNT', source: 'count', scope: 'ROLL' }, { kind: 'DAMAGE', source: 'damage', scope: 'ROLL' }] });
    const r = resolve(s, [1, 1, 3, 4, 1, 2], { rerolls: { ATTACK_COUNT: 'ALL', DAMAGE: 'ALL' } });
    assert.equal(r.resolution.attackCounts[0]!.resolved.dice![0]!.wasRerolled, true);
    assert.equal(r.record.damage?.dice?.[0]?.rerollSource, 'damage');
});
test('critical thresholds are centralized and configurable; natural one always fails', () => {
    assert.equal(isCriticalHit(5, 5), true);
    assert.equal(isCriticalWound(1, 1), false);
    const s = abilityState([ability('LETHAL_HITS')]);
    s.combatRules = { criticalHitThreshold: 5, criticalWoundThreshold: 5, loneOperativeDistance: 12 };
    assert.equal(resolve(s, [5]).record.criticalHit, true);
});
test('Lance adds wound modifier only after charge and records its source', () => {
    const s = abilityState([ability('LANCE')]);
    assert.equal(resolve(s, [3, 3]).resolution.wounds, 0);
    s.units[0]!.state.hasCharged = true;
    const r = resolve(s, [3, 3]);
    assert.equal(r.resolution.wounds, 1);
    assert.ok(r.record.modifiers.some(m => m.source === 'LANCE' && m.amount === 1));
});
test('Rapid Fire and Melta include exact half range and exclude beyond boundary', () => {
    const s = abilityState([ability('RAPID_FIRE', { value: 1 }), ability('MELTA', { value: 2 })]);
    const a = s.units[0]!.models[0]!;
    s.units[1]!.models.forEach((m, i) => m.position = { x: a.position.x + i * 2, y: a.position.y + 18 + baseRadius(a.base) + baseRadius(m.base) });
    const r = resolve(s, [3, 4, 1]);
    assert.equal(r.resolution.attacks, 2);
    assert.equal(r.record.damage?.value, 3);
    s.units[1]!.models.forEach(m => m.position.y += .001);
    const far = resolve(s, [3, 4]);
    assert.equal(far.resolution.attacks, 1);
    assert.equal(far.record.damage?.value, 1);
});
test('Blast and Cleave use target model count, including optional Blast multiplier', () => {
    for (const type of ['BLAST', 'CLEAVE'] as const) {
        const s = abilityState([ability(type, { value: 2 })]);
        const t = s.units[1]!;
        t.models = Array.from({ length: 11 }, (_, i) => ({ ...t.models[0]!, id: `t-${i}` }));
        const r = resolve(s, [1, 1, 1, 1, 1]);
        assert.equal(r.resolution.attacks, 5);
    }
});
test('Heavy tolerates movement up to three inches but not more or a newly set-up unit', () => {
    const s = abilityState([ability('HEAVY')]);
    s.units[0]!.models[0]!.movementUsed = 3;
    assert.equal(resolve(s, [2, 1]).resolution.hits, 1);
    s.units[0]!.models[0]!.movementUsed = 3.01;
    assert.equal(resolve(s, [2]).resolution.hits, 0);
    s.units[0]!.models[0]!.movementUsed = 0;
    s.units[0]!.setupAtTurn = s.turn;
    assert.equal(resolve(s, [2]).resolution.hits, 0);
});
test('normal and invulnerable save choose the best legal target; AP never changes invulnerable', () => {
    assert.equal(resolveSave(3, 4, -3, dice(4).rng).selected, 'INVULNERABLE');
    assert.equal(resolveSave(3, 4, 0, dice(3).rng).selected, 'ARMOUR');
    assert.equal(resolveSave(2, 2, 0, dice(1).rng).saved, false);
    assert.equal(resolveSave(7, undefined, 0, dice().rng).roll, null);
});
test('Feel No Pain applies to each lost damage point after the failed save', () => {
    const s = abilityState();
    s.definitions = s.definitions.map((d, i) => i ? { ...d, coreAbilities: [{ kind: 'FEEL_NO_PAIN', threshold: 5 }] } : d);
    patchWeapon(s, { damage: { kind: 'fixed', value: 2 } });
    const r = resolve(s, [3, 4, 5, 1]);
    assert.equal(r.record.ignoredDamage, 1);
    assert.deepEqual(r.record.fnpRolls, [5, 1]);
    assert.equal(r.resolution.totalDamage, 1);
});
test('central mortal wounds spill across models and share Feel No Pain', () => {
    const s = abilityState();
    s.definitions = s.definitions.map((d, i) => i ? { ...d, coreAbilities: [{ kind: 'FEEL_NO_PAIN', threshold: 5 }] } : d);
    const r = resolveMortalWounds(s, s.units[1]!, 4, dice(1, 5, 1, 1).rng);
    assert.equal(r.ignored, 1);
    assert.equal(r.applied, 3);
    assert.equal(r.destroyedModelIds.length, 1);
    assert.equal(s.units[1]!.models[1]!.woundsRemaining, 1);
});
test('deferred Devastating damage occurs after normal attacks and survives job serialization', () => {
    const s = abilityState([ability('DEVASTATING_WOUNDS')]);
    patchWeapon(s, { attacks: { kind: 'fixed', value: 2 } });
    const j = createAttackJob(s.definitions[0]!.weapons[0]!, [s.units[0]!.models[0]!.id], s.units[1]!, s.definitions[1]!, dice().rng, [], s);
    let hits = 0;
    assert.equal(runAttackJob(j, dice(3, 6, 3).rng, s, t => t === 'AFTER_HIT_ROLL' && ++hits === 2), false);
    const restored = JSON.parse(JSON.stringify(j));
    assert.equal(runAttackJob(restored, dice(4).rng, s), true);
    assert.equal(restored.resolution.totalDamage, 2);
    assert.equal(restored.resolution.attackRecords[0].casualtyIds.length, 1);
});
test('failed-only Hit reroll respects Heavy before deciding to reroll', () => {
    const s = abilityState([ability('HEAVY')]);
    patchWeapon(s, { rerollPermissions: [{ kind: 'HIT', source: 'test', scope: 'DIE' }] });
    const r = resolve(s, [2, 1], { rerolls: { HIT: 'FAILED' } });
    assert.equal(r.record.hit?.wasRerolled, false);
    assert.equal(r.resolution.hits, 1);
});
test('save rerolls use generic dice metadata and can still fail on a natural one', () => {
    const saved = resolveSave(4, undefined, 0, dice(1, 4).rng, true);
    assert.equal(saved.saved, true);
    assert.equal(saved.die?.initial, 1);
    assert.equal(saved.die?.wasRerolled, true);
    assert.equal(resolveSave(2, undefined, 0, dice(1, 1).rng, true).saved, false);
});
