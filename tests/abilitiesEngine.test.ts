import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../src/game/engine/GameEngine';
import { ability, abilityState, patchWeapon } from './abilities.helpers';
import { dice, reject } from './shooting.helpers';
import { ok, engine, pass } from './flow.helpers';
import type { StratagemDefinition } from '../src/game/stratagems/types';
import { createCloseCombatTestMatch } from '../src/game/data/closeCombatPrototype';
import { nextFightSelection } from '../src/game/rules/FightSequenceController';
import { createVisibilityProvider } from '../src/game/terrain/visibility';
import { processAttachmentCasualties } from '../src/game/attachments/AttachmentController';
import { embarked, field } from './transports.helpers';
import { resolvedAbilities } from '../src/game/abilities/registry';
const blank = () => { throw Error('unexpected RNG'); };
function fire(s = abilityState(), rolls = [3, 4]) { const e = new GameEngine(s); ok(e.beginShooting('unit-1')); return { e, result: ok(e.fireWeapon('test-rifle', 'unit-2', dice(...rolls).rng)) }; }
test('Advance allows only Assault weapons; rejection consumes no dice', () => {
    const s = abilityState([ability('ASSAULT')]);
    s.units[0]!.state.hasAdvanced = true;
    s.definitions = s.definitions.map((d, i) => i ? d : { ...d, weapons: [...d.weapons, { ...d.weapons[0]!, id: 'ordinary', weaponAbilities: [] }] });
    const e = new GameEngine(s);
    ok(e.beginShooting('unit-1'));
    assert.deepEqual(ok(e.getRangedWeapons('unit-1')).map(w => w.id), ['test-rifle']);
    reject(e, () => e.fireWeapon('ordinary', 'unit-2', blank), 'UNIT_NOT_ELIGIBLE');
    ok(e.fireWeapon('test-rifle', 'unit-2', dice(1).rng));
});
test('Stealth requires every living model and shares terrain Cover', () => {
    const s = abilityState();
    s.units[1]!.models.forEach(m => m.coreAbilities = [{ kind: 'STEALTH' }]);
    const { e, result } = fire(s, [3]);
    assert.equal(result.hits, 0);
    assert.equal(result.attackModifiers![0]!.effectiveSkill, 4);
    assert.equal(e.getState().definitions[0]!.weapons[0]!.skill, 3);
    s.units[1]!.models[0]!.coreAbilities = [];
    assert.equal(fire(s).result.hits, 1);
});
test('Ignores Cover removes Stealth penalty but does not bypass obstructed visibility', () => {
    const s = abilityState([ability('IGNORES_COVER')]);
    s.units[1]!.models.forEach(m => m.coreAbilities = [{ kind: 'STEALTH' }]);
    assert.equal(fire(s).result.hits, 1);
    const e = new GameEngine(s, { visibility: () => false });
    ok(e.beginShooting('unit-1'));
    reject(e, () => e.fireWeapon('test-rifle', 'unit-2', blank), 'TARGET_NOT_VISIBLE');
});
test('Psychic can ignore BS penalties, retain bonuses, or explicitly retain all modifiers', () => {
    const s = abilityState([ability('PSYCHIC')]);
    s.units[1]!.models.forEach(m => m.coreAbilities = [{ kind: 'STEALTH' }]);
    assert.equal(fire(s).result.hits, 1);
    const e = new GameEngine(s);
    ok(e.beginShooting('unit-1'));
    ok(e.setAttackChoices('test-rifle', { psychicIgnore: 'NONE' }));
    assert.equal(ok(e.fireWeapon('test-rifle', 'unit-2', dice(3).rng)).hits, 0);
});
test('Indirect is an explicit mode: unseen targets legal, unmodified 1–5 fail, Cover applies', () => {
    const s = abilityState([ability('INDIRECT_FIRE')]);
    const e = new GameEngine(s, { visibility: () => false });
    ok(e.beginShooting('unit-1'));
    assert.deepEqual(ok(e.getLegalTargets('unit-1', 'test-rifle')), []);
    ok(e.setAttackChoices('test-rifle', { shootingMode: 'INDIRECT' }));
    assert.equal(ok(e.getLegalTargets('unit-1', 'test-rifle')).length, 1);
    const r = ok(e.fireWeapon('test-rifle', 'unit-2', dice(5).rng));
    assert.equal(r.hits, 0);
    assert.ok(r.attackModifiers![0]!.modifiers.some(m => m.source === 'COVER'));
});
test('Indirect stationary with a friendly spotter succeeds on four; moving needs six', () => {
    const s = abilityState([ability('INDIRECT_FIRE')]);
    s.units[0]!.state.hasMoved = true;
    const e = new GameEngine(s);
    ok(e.beginShooting('unit-1'));
    ok(e.setAttackChoices('test-rifle', { shootingMode: 'INDIRECT' }));
    assert.equal(ok(e.fireWeapon('test-rifle', 'unit-2', dice(4, 1).rng)).hits, 1);
    s.units[0]!.models[0]!.movementUsed = 1;
    const m = new GameEngine(s);
    ok(m.beginShooting('unit-1'));
    ok(m.setAttackChoices('test-rifle', { shootingMode: 'INDIRECT' }));
    assert.equal(ok(m.fireWeapon('test-rifle', 'unit-2', dice(4).rng)).hits, 0);
});
test('visible Indirect weapon may use normal shooting and hit normally', () => {
    assert.equal(fire(abilityState([ability('INDIRECT_FIRE')])).result.hits, 1);
});
test('Indirect cannot reroll Hit dice even when the weapon grants a permission', () => {
    const s = abilityState([ability('INDIRECT_FIRE')]);
    patchWeapon(s, { rerollPermissions: [{ kind: 'HIT', source: 'test', scope: 'DIE' }] });
    const e = new GameEngine(s);
    ok(e.beginShooting('unit-1'));
    ok(e.setAttackChoices('test-rifle', { shootingMode: 'INDIRECT', rerolls: { HIT: 'ALL' } }));
    const rng = dice(1);
    assert.equal(ok(e.fireWeapon('test-rifle', 'unit-2', rng.rng)).hits, 0);
    assert.equal(rng.calls(), 1);
});
for (const type of ['PISTOL', 'CLOSE_QUARTERS'] as const)
    test(`${type} supports shooting while engaged without duplicating the rule`, () => {
        const s = abilityState([ability(type)]);
        s.units[1]!.models[0]!.position = { x: 4.5, y: 6 };
        assert.equal(fire(s).result.hits, 1);
    });
test('engaged Blast target is forbidden even for a Vehicle', () => {
    const s = abilityState([ability('BLAST')]);
    s.definitions = s.definitions.map((d, i) => i ? d : { ...d, keywords: ['VEHICLE'] });
    s.units[1]!.models[0]!.position = { x: 4.5, y: 6 };
    const e = new GameEngine(s);
    ok(e.beginShooting('unit-1'));
    reject(e, () => e.fireWeapon('test-rifle', 'unit-2', blank), 'NO_ELIGIBLE_FIRING_MODELS');
});
test('ordinary models choose Close-Quarters or other weapons, not both', () => {
    const s = abilityState([ability('CLOSE_QUARTERS')]);
    s.definitions = s.definitions.map((d, i) => i ? d : { ...d, weapons: [...d.weapons, { ...d.weapons[0]!, id: 'ordinary', weaponAbilities: [] }] });
    const { e } = fire(s);
    reject(e, () => e.fireWeapon('ordinary', 'unit-2', blank), 'NO_ELIGIBLE_FIRING_MODELS');
});
test('One Shot persists across turn transitions and detached JSON snapshots', () => {
    const { e } = fire(abilityState([ability('ONE_SHOT')]), [1]);
    ok(e.completeShooting());
    ok(e.tryNextTurn());
    ok(e.tryNextTurn());
    ok(e.tryNextPhase());
    ok(e.tryNextPhase());
    const restored = new GameEngine(JSON.parse(JSON.stringify(e.getState())));
    assert.ok(restored.getState().units[0]!.models[0]!.oneShotExpended?.includes('test-rifle'));
    assert.equal(restored.getRangedWeapons('unit-1').ok, false);
});
test('duplicate weapon choice required before any dice, then selected value drives resolution', () => {
    const s = abilityState([ability('SUSTAINED_HITS', { id: 'a', value: 1 }), ability('SUSTAINED_HITS', { id: 'b', value: 2 })]);
    const e = new GameEngine(s);
    ok(e.beginShooting('unit-1'));
    reject(e, () => e.fireWeapon('test-rifle', 'unit-2', blank), 'ABILITY_CHOICE_REQUIRED');
    ok(e.setAttackChoices('test-rifle', { abilities: { SUSTAINED_HITS: 'a' } }));
    assert.equal(ok(e.fireWeapon('test-rifle', 'unit-2', dice(6, 1, 1).rng)).hits, 2);
});
test('Hazardous rolls once per selected weapon/model after all weapons, not per attack', () => {
    const s = abilityState([ability('HAZARDOUS')]);
    patchWeapon(s, { attacks: { kind: 'fixed', value: 3 } });
    const { e } = fire(s, [1, 1, 1]);
    assert.equal(e.getState().units[0]!.models[0]!.alive, true);
    reject(e, () => e.completeShooting(), 'INVALID_CONFIGURATION');
    const rng = dice(2);
    ok(e.completeShooting(rng.rng));
    assert.equal(rng.calls(), 1);
    assert.equal(e.getState().units[0]!.models[0]!.woundsRemaining, 0);
    new GameEngine(e.getState());
});
test('Hazardous uses the same Feel No Pain mortal-wound resolver', () => {
    const s = abilityState([ability('HAZARDOUS')]);
    s.units[0]!.models[0]!.coreAbilities = [{ kind: 'FEEL_NO_PAIN', threshold: 5 }];
    const { e } = fire(s, [1]);
    ok(e.completeShooting(dice(1, 5).rng));
    assert.equal(e.getState().units[0]!.models[0]!.alive, true);
});
test('Lone Operative blocks shooting beyond configurable range, including Indirect, without limiting ordinary targets', () => {
    const s = abilityState([ability('INDIRECT_FIRE')]);
    s.units[1]!.models.forEach(m => m.coreAbilities = [{ kind: 'LONE_OPERATIVE' }]);
    const p = createVisibilityProvider(s);
    assert.equal(p.isUnitVisible(s.units[0]!.models[0]!, s.units[1]!), false);
    const e = new GameEngine(s);
    ok(e.beginShooting('unit-1'));
    ok(e.setAttackChoices('test-rifle', { shootingMode: 'INDIRECT' }));
    assert.deepEqual(ok(e.getLegalTargets('unit-1', 'test-rifle')), []);
    s.combatRules = { criticalHitThreshold: 6, criticalWoundThreshold: 6, loneOperativeDistance: 20 };
    assert.equal(fire(s).result.hits, 1);
});
test('duplicate Core abilities require a serializable player choice, not an automatic sum', () => {
    const s = abilityState();
    s.units[1]!.models[0]!.coreAbilities = [{ kind: 'FEEL_NO_PAIN', threshold: 4 }, { kind: 'FEEL_NO_PAIN', threshold: 5 }];
    const e = new GameEngine(s);
    assert.equal(e.getPendingCoreChoices().length, 1);
    reject(e, () => e.beginShooting('unit-1'), 'ABILITY_CHOICE_REQUIRED');
    ok(e.chooseCoreAbility(s.units[1]!.models[0]!.id, 'FEEL_NO_PAIN', 1));
    ok(e.beginShooting('unit-1'));
    const r = ok(e.fireWeapon('test-rifle', 'unit-2', dice(3, 4, 4).rng));
    assert.equal(r.totalDamage, 1);
    new GameEngine(e.getState());
});
function fight(extra = false) {
    const s = createCloseCombatTestMatch();
    s.phase = 'Fight';
    s.units[0]!.models.forEach(m => m.position.y = 8.5);
    s.units.forEach(u => u.models.slice(1).forEach(m => { m.alive = false; m.woundsRemaining = 0; }));
    const blade = s.definitions[0]!.weapons.find(w => w.kind === 'melee')!;
    s.definitions = s.definitions.map((d, i) => i ? d : { ...d, weapons: [{ ...blade, attacks: { kind: 'fixed', value: 1 } }, ...(extra ? [{ ...blade, id: 'extra', attacks: { kind: 'fixed' as const, value: 1 }, weaponAbilities: [ability('EXTRA_ATTACKS')] }] : [])] });
    const e = new GameEngine(s);
    ok(e.startFightPhase());
    ok(e.advanceFightStep());
    for (const u of s.units)
        ok(e.skipTacticalMove(u.id));
    ok(e.advanceFightStep());
    const id = nextFightSelection(e.getState())!.unitIds[0]!;
    return { e, s, blade: blade.id, id };
}
test('Extra Attacks can supplement the main weapon but cannot replace mandatory main attacks', () => {
    const { e, blade } = fight(true);
    ok(e.selectFightUnit('unit-1'));
    ok(e.meleeAttack('extra', 'unit-2', dice(1).rng));
    reject(e, () => e.completeFightUnit(), 'EXTRA_ATTACKS_PENDING');
    ok(e.meleeAttack(blade, 'unit-2', dice(1).rng));
    ok(e.completeFightUnit());
    new GameEngine(e.getState());
});
test('Extra Attacks cannot be skipped after using a regular melee weapon', () => {
    const { e, blade } = fight(true);
    ok(e.selectFightUnit('unit-1'));
    ok(e.meleeAttack(blade, 'unit-2', dice(1).rng));
    reject(e, () => e.completeFightUnit(), 'EXTRA_ATTACKS_PENDING');
    ok(e.meleeAttack('extra', 'unit-2', dice(1).rng));
    ok(e.completeFightUnit());
});
test('native Fights First uses the existing fight sequence controller', () => {
    const { s } = fight();
    s.units[1]!.models[0]!.coreAbilities = [{ kind: 'FIGHTS_FIRST' }];
    const e = new GameEngine(s);
    ok(e.startFightPhase());
    ok(e.advanceFightStep());
    for (const u of s.units)
        ok(e.skipTacticalMove(u.id));
    ok(e.advanceFightStep());
    assert.deepEqual(nextFightSelection(e.getState())?.unitIds, ['unit-2']);
});
test('typed Precision reuses attached-character allocation and unit keyword aggregation for Anti', () => {
    const s = field();
    s.phase = 'Shooting';
    s.turn = 2;
    s.activePlayerId = 'player-2';
    s.definitions = s.definitions.map(d => d.id === 'test-enemy' ? { ...d, weapons: d.weapons.map(w => ({ ...w, traits: [], weaponAbilities: [ability('PRECISION'), ability('ANTI', { keyword: 'PSYKER', threshold: 2 })] })) } : d);
    const e = new GameEngine(s);
    ok(e.beginShooting('enemy'));
    assert.ok(e.precisionTargets('enemy', 'test-carbine', 'attached').includes('leader:model:1'));
    assert.ok(resolvedAbilities(s, s.units.find(u => u.id === 'attached')!, s.definitions.find(d => d.id === 'test-enemy')!.weapons[0]!).some(a => a.type === 'ANTI'));
});
test('One Shot original weapon identity survives attached split and embarked snapshots', () => {
    const s = embarked(), u = s.units.find(u => u.id === 'attached')!, m = u.models.find(m => m.componentUnitId === 'leader')!;
    m.oneShotExpended = [s.definitions.find(d => d.id === m.sourceDefinitionId)!.weapons[0]!.id];
    u.models.filter(m => m.componentUnitId === 'bodyguard').forEach(m => { m.alive = false; m.woundsRemaining = 0; });
    processAttachmentCasualties(s);
    const e = new GameEngine(s), survivor = e.getState().units.find(u => u.id === 'leader')!;
    assert.equal(survivor.location, 'EMBARKED');
    assert.deepEqual(survivor.models[0]!.oneShotExpended, m.oneShotExpended);
    new GameEngine(JSON.parse(JSON.stringify(e.getState())));
});
test('Firing Deck excludes typed One Shot as well as legacy traits', () => {
    const s = embarked();
    s.definitions = s.definitions.map(d => d.id === 'test-bodyguard' ? { ...d, weapons: d.weapons.map(w => ({ ...w, weaponAbilities: [ability('ONE_SHOT')] })) } : d);
    const e = new GameEngine(s);
    assert.ok(e.getFiringDeckOptions('transport-b').every(o => !o.modelId.startsWith('bodyguard:')));
});
const reaction: StratagemDefinition = { id: 'test-reaction', name: 'Technical BS reaction', labels: [], cpCost: 0, timing: { phases: ['Shooting', 'Fight'], triggers: ['AFTER_HIT_ROLL', 'AFTER_WOUND_ROLL'], ownership: 'EITHER' }, target: { relation: 'FRIENDLY', count: 1 }, resolverId: 'APPLY_EFFECT', effect: { source: 'test-reaction', payload: { kind: 'MODIFIER', characteristic: 'BS', value: -1 }, expiry: 'END_OF_CURRENT_PHASE', stacking: 'STACK' } };
function reactionEngine() { const e = engine(abilityState(), { stratagems: { definitions: [reaction] } }); pass(e); ok(e.beginShooting('unit-1')); ok(e.selectShootingTarget('test-rifle', 'unit-2')); pass(e); return e; }
test('Hit/Wound reaction windows pause before future RNG; PASS then explicit resume', () => {
    const e = reactionEngine(), r = dice(3);
    assert.equal(ok(e.fireWeapon('test-rifle', 'unit-2', r.rng)).pending, true);
    assert.equal(r.calls(), 1);
    assert.equal(e.getState().flow?.window?.trigger, 'AFTER_HIT_ROLL');
    reject(e, () => e.resumeAttack(blank), 'TIMING_WINDOW_OPEN');
    pass(e);
    reject(e, () => e.completeShooting(), 'ATTACK_PENDING');
    assert.equal(ok(e.resumeAttack(dice(4).rng)).pending, true);
    assert.equal(e.getState().flow?.window?.trigger, 'AFTER_WOUND_ROLL');
    pass(e);
    assert.equal(ok(e.resumeAttack(blank)).totalDamage, 1);
    assert.equal(e.getState().attackJob, undefined);
});
test('paused snapshot resumes identically and cannot mutate engine through detached state', () => {
    const e = reactionEngine();
    ok(e.fireWeapon('test-rifle', 'unit-2', dice(3).rng));
    const snap = JSON.parse(JSON.stringify(e.getState()));
    const restored = new GameEngine(snap, { stratagems: { definitions: [reaction] } });
    snap.attackJob.current.hit.value = 1;
    for (const g of [e, restored]) {
        pass(g);
        ok(g.resumeAttack(dice(4).rng));
        pass(g);
        ok(g.resumeAttack(blank));
    }
    assert.deepEqual(e.getState(), restored.getState());
});
test('reaction modifier applied after Hit roll affects that pending attack', () => {
    const e = reactionEngine();
    ok(e.fireWeapon('test-rifle', 'unit-2', dice(2).rng));
    ok(e.useStratagem('test-reaction', 'player-1', ['unit-1']));
    pass(e);
    ok(e.resumeAttack(dice(4).rng));
    pass(e);
    const r = ok(e.resumeAttack(blank));
    assert.equal(r.hits, 1);
    assert.ok(r.attackRecords![0]!.modifiers.some(m => m.source === 'test-reaction' && m.amount === -1));
});
test('no legal roll reactions means no artificial pauses', () => {
    const e = engine(abilityState(), { stratagems: { definitions: [{ ...reaction, cpCost: 99 }] } });
    pass(e);
    ok(e.beginShooting('unit-1'));
    ok(e.selectShootingTarget('test-rifle', 'unit-2'));
    pass(e);
    assert.equal(ok(e.fireWeapon('test-rifle', 'unit-2', dice(3, 4).rng)).pending, undefined);
    assert.equal(e.getState().flow?.window, null);
});
test('corrupt pending cursor or die is rejected without replacing current state', () => {
    const e = reactionEngine();
    ok(e.fireWeapon('test-rifle', 'unit-2', dice(3).rng));
    const before = e.getState(), broken = e.getState();
    broken.attackJob!.index = 99;
    assert.throws(() => e.loadMatch(broken));
    assert.deepEqual(e.getState(), before);
    broken.attackJob!.index = 0;
    broken.attackJob!.current!.hit!.value = 9;
    assert.throws(() => e.loadMatch(broken));
});
test('melee uses the same resumable Hit/Wound pipeline and preserves snapshots', () => {
    const prepared = fight(), e = new GameEngine(prepared.e.getState(), { stratagems: { definitions: [reaction] } });
    ok(e.enableMatchFlow());
    pass(e);
    ok(e.selectFightUnit('unit-1'));
    assert.equal(ok(e.meleeAttack(prepared.blade, 'unit-2', dice(3).rng)).pending, true);
    new GameEngine(e.getState(), { stratagems: { definitions: [reaction] } });
    pass(e);
    assert.equal(ok(e.resumeAttack(dice(4).rng)).pending, true);
    pass(e);
    assert.equal(ok(e.resumeAttack(dice(1).rng)).pending, undefined);
    ok(e.completeFightUnit());
    new GameEngine(e.getState());
});
test('indirect shooting type remains fixed after using a weapon', () => {
    const s = abilityState([ability('INDIRECT_FIRE')]);
    s.definitions = s.definitions.map((d, i) => i ? d : { ...d, weapons: [...d.weapons, { ...d.weapons[0]!, id: 'second' }] });
    const e = new GameEngine(s);
    ok(e.beginShooting('unit-1'));
    ok(e.setAttackChoices('test-rifle', { shootingMode: 'INDIRECT' }));
    ok(e.fireWeapon('test-rifle', 'unit-2', dice(1).rng));
    reject(e, () => e.setAttackChoices('second', { shootingMode: 'NORMAL' }), 'IRREVERSIBLE_ACTION');
    assert.equal(ok(e.fireWeapon('second', 'unit-2', dice(3).rng)).hits, 0);
});
test('select-target model count drives Blast even after a reaction removes a model', () => {
    const s = abilityState([ability('BLAST')]), u = s.units[1]!;
    const original = u.models[0]!;
    u.models = Array.from({ length: 5 }, (_, i) => ({ ...original, id: `target-${i}`, position: { x: 3 + i * 1.5, y: 22 } }));
    s.definitions = s.definitions.map((d, i) => i ? { ...d, modelCount: 5 } : d);
    const r: StratagemDefinition = { ...reaction, id: 'casualty', timing: { ...reaction.timing, triggers: ['AFTER_TARGET_SELECTED'] }, target: { relation: 'FRIENDLY', count: 1, selectedTargetOnly: true }, resolverId: 'CASUALTY', effect: undefined };
    const e = engine(s, { stratagems: { definitions: [r], resolvers: { CASUALTY: (s, ids) => { const m = s.units.find(u => u.id === ids[0])!.models[4]!; m.alive = false; m.woundsRemaining = 0; return { ok: true, value: undefined }; } } } });
    pass(e);
    ok(e.beginShooting('unit-1'));
    ok(e.selectShootingTarget('test-rifle', 'unit-2'));
    ok(e.useStratagem('casualty', 'player-2', ['unit-2']));
    pass(e);
    assert.equal(ok(e.fireWeapon('test-rifle', 'unit-2', dice(1, 1).rng)).attacks, 2);
    new GameEngine(e.getState());
});
test('Lone Operative measures to the unit, including an obscured nearer member', () => {
    const s = abilityState();
    s.units[1]!.models.forEach(m => m.coreAbilities = [{kind:'LONE_OPERATIVE'}]);
    s.units[1]!.models[0]!.position = {x:s.units[0]!.models[0]!.position.x,y:s.units[0]!.models[0]!.position.y + 12};
    const e = new GameEngine(s, {visibility: (_a,b) => b.id !== 'unit-2:model:1'});
    ok(e.beginShooting('unit-1'));
    assert.equal(ok(e.fireWeapon('test-rifle','unit-2',dice(3,4).rng)).hits,1);
});
