import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../src/game/engine/GameEngine';
import { terrainState, feature } from './terrain.helpers';
import { ok } from './flow.helpers';
import { dice, reject } from './shooting.helpers';
import { abilityState, patchWeapon } from './abilities.helpers';
import { queueDestructions, resolveDestructions } from '../src/game/combat/destruction';
import { embarked } from './transports.helpers';
import { detectDestroyedTransports } from '../src/game/transports/TransportController';
function flyer(hover: boolean) {
    const s = terrainState(['FLY', 'VEHICLE']);
    s.phase = 'Movement';
    feature(s, 'DENSE', 8, 3, 4, 4, 4);
    s.definitions = s.definitions.map(d => ({ ...d, stats: { ...d.stats, movement: 6 }, coreAbilities: hover ? [{ kind: 'HOVER' }] : [] }));
    return s;
}
test('taking to the skies charges horizontal distance only, with a two-inch allowance penalty', () => {
    const e = new GameEngine(flyer(false));
    ok(e.beginMovement('unit-1', 'NORMAL_MOVE', undefined, { takingToSkies: true }));
    const preview = e.previewMove('unit-1:model:1', { x: 9, y: 5, z: 4 });
    assert.equal(preview.ok, false);
    if (!preview.ok)
        assert.equal(preview.reason, 'EXCEEDS_ALLOWANCE');
});
test('Hover removes the sky allowance penalty without bypassing final placement or snapshot checks', () => {
    const e = new GameEngine(flyer(true));
    ok(e.beginMovement('unit-1', 'NORMAL_MOVE', undefined, { takingToSkies: true }));
    const move = ok(e.moveModel('unit-1:model:1', { x: 9, y: 5, z: 4 }));
    assert.equal(move.distance, 5);
    assert.equal(move.totalUsed, 5);
    new GameEngine(JSON.parse(JSON.stringify(e.getState())));
    ok(e.completeMovement());
    assert.equal(e.getState().units[0]!.models[0]!.position.z, 4);
});
test('Hover still needs Fly and sky choice, and cannot end inside a dense wall', () => {
    const e = new GameEngine(flyer(true));
    ok(e.beginMovement('unit-1'));
    reject(e, () => e.moveModel('unit-1:model:1', { x: 9, y: 5, z: 4 }), 'EXCEEDS_ALLOWANCE');
    ok(e.cancelMovement());
    ok(e.beginMovement('unit-1', 'NORMAL_MOVE', undefined, { takingToSkies: true }));
    reject(e, () => e.moveModel('unit-1:model:1', { x: 9, y: 5, z: 0 }), 'TERRAIN_BLOCKED');
    const s = terrainState(['VEHICLE']);
    s.phase = 'Movement';
    const no = new GameEngine(s);
    reject(no, () => no.beginMovement('unit-1', 'NORMAL_MOVE', undefined, { takingToSkies: true }), 'INVALID_ABILITY_CHOICE');
});
test('sky movement can cancel exactly and does not leak a permanent keyword or effect', () => {
    const e = new GameEngine(flyer(true)), before = e.getState().units[0]!.models[0]!.position;
    ok(e.beginMovement('unit-1', 'NORMAL_MOVE', undefined, { takingToSkies: true }));
    ok(e.moveModel('unit-1:model:1', { x: 9, y: 5, z: 4 }));
    ok(e.cancelMovement());
    assert.deepEqual(e.getState().units[0]!.models[0]!.position, before);
    assert.equal(e.getState().movement, null);
});
function walker(height = 4) {
    const s = terrainState(['VEHICLE']);
    s.phase = 'Movement';
    feature(s, 'DENSE', 7, 3, 1, 4, height);
    s.definitions = s.definitions.map(d => ({ ...d, stats: { ...d.stats, movement: 10 }, coreAbilities: [{ kind: 'SUPER_HEAVY_WALKER' }] }));
    return s;
}
test('Super-heavy Walker passes dense sections up to four inches but not higher', () => {
    const e = new GameEngine(walker());
    ok(e.beginMovement('unit-1'));
    ok(e.moveModel('unit-1:model:1', { x: 10, y: 5 }));
    ok(e.completeMovement());
    const high = new GameEngine(walker(4.01));
    ok(high.beginMovement('unit-1'));
    reject(high, () => high.moveModel('unit-1:model:1', { x: 10, y: 5 }), 'TERRAIN_BLOCKED');
});
test('Super-heavy Walker optional MOBILE crosses higher dense sections then tests Battle-shock once', () => {
    const e = new GameEngine(walker(5));
    ok(e.beginMovement('unit-1', 'NORMAL_MOVE', undefined, { mobile: true }));
    ok(e.moveModel('unit-1:model:1', { x: 10, y: 5 }));
    reject(e, () => e.completeMovement(), 'INVALID_CONFIGURATION');
    const r = dice(1);
    ok(e.completeMovement(undefined, r.rng));
    assert.equal(r.calls(), 1);
    assert.equal(e.getState().units[0]!.state.battleShocked, true);
    assert.ok(!e.getState().definitions[0]!.keywords.includes('MOBILE'));
    new GameEngine(e.getState());
});
test('Super-heavy Walker cannot cross TITANIC models, but may cross other models', () => {
    const s = walker();
    s.battlefield.terrain = { areas: [], features: [] };
    s.units[1]!.models[0]!.position = { x: 7, y: 5 };
    const e = new GameEngine(s);
    ok(e.beginMovement('unit-1'));
    ok(e.moveModel('unit-1:model:1', { x: 11, y: 5 }));
    s.definitions = s.definitions.map((d, i) => i ? { ...d, keywords: ['TITANIC', 'VEHICLE'] } : d);
    const t = new GameEngine(s);
    ok(t.beginMovement('unit-1'));
    reject(t, () => t.moveModel('unit-1:model:1', { x: 11, y: 5 }), 'BASE_OVERLAP');
});
test('MOBILE selection is not permitted for units without Walker or during charge', () => {
    const s = terrainState();
    s.phase = 'Movement';
    const e = new GameEngine(s);
    reject(e, () => e.beginMovement('unit-1', 'NORMAL_MOVE', undefined, { mobile: true }), 'INVALID_ABILITY_CHOICE');
    s.phase = 'Charge';
    const c = new GameEngine(s);
    reject(c, () => c.declareCharge('unit-1', dice().rng, { mobile: true }), 'INVALID_ABILITY_CHOICE');
});
test('Deadly Demise waits until the attacking unit finishes all weapons', () => {
    const s = abilityState();
    s.units[1]!.models.forEach(m => m.coreAbilities = [{ kind: 'DEADLY_DEMISE', damage: { kind: 'fixed', value: 1 } }]);
    patchWeapon(s, { damage: { kind: 'fixed', value: 2 } });
    const e = new GameEngine(s);
    ok(e.beginShooting('unit-1'));
    ok(e.fireWeapon('test-rifle', 'unit-2', dice(3, 4).rng));
    assert.equal(e.getState().destructionQueue![0]!.resolved, false);
    assert.ok(!e.getState().events.some(e => e.type === 'flow' && e.name === 'DEADLY_DEMISE_ROLLED'));
    new GameEngine(e.getState());
    ok(e.completeShooting(dice(6).rng));
    assert.equal(e.getState().destructionQueue![0]!.resolved, true);
    assert.equal(e.getState().units[1]!.models[1]!.woundsRemaining, 1);
    new GameEngine(e.getState());
});
test('Deadly Demise chain is iterative, each destroyed model triggers at most once', () => {
    const s = abilityState();
    s.units[1]!.models.forEach(m => { m.woundsRemaining = 1; m.coreAbilities = [{ kind: 'DEADLY_DEMISE', damage: { kind: 'fixed', value: 1 } }]; });
    const before = JSON.parse(JSON.stringify(s));
    s.units[1]!.models[0]!.alive = false;
    s.units[1]!.models[0]!.woundsRemaining = 0;
    queueDestructions(before, s);
    const r = dice(6, 6, 6);
    resolveDestructions(s, r.rng);
    assert.equal(r.calls(), 3);
    assert.equal(s.destructionQueue!.length, 3);
    assert.ok(s.destructionQueue!.every(q => q.resolved));
    resolveDestructions(s, dice().rng);
});
test('Deadly Demise dice are rolled separately for every nearby unit and no distant unit', () => {
    const s = abilityState();
    s.units[0]!.models[0]!.position = { x: 8, y: 20 };
    s.units[1]!.models[0]!.coreAbilities = [{ kind: 'DEADLY_DEMISE', damage: { kind: 'dice', count: 1, sides: 3, modifier: 0 } }];
    const before = JSON.parse(JSON.stringify(s));
    s.units[1]!.models[0]!.alive = false;
    s.units[1]!.models[0]!.woundsRemaining = 0;
    queueDestructions(before, s);
    const r = dice(6, 1, 3);
    resolveDestructions(s, r.rng);
    assert.equal(r.calls(), 3);
    const events = s.events.filter(e => e.type === 'flow' && e.name === 'MORTAL_WOUNDS_RESOLVED');
    assert.equal(events.length, 2);
});
test('destroyed transport resolves emergency passengers before its Deadly Demise', () => {
    const s = embarked(), t = s.units.find(u => u.id === 'transport-b')!;
    t.models[0]!.coreAbilities = [{ kind: 'DEADLY_DEMISE', damage: { kind: 'fixed', value: 1 } }];
    const before = JSON.parse(JSON.stringify(s));
    t.models[0]!.alive = false;
    t.models[0]!.woundsRemaining = 0;
    queueDestructions(before, s);
    detectDestroyedTransports(s);
    resolveDestructions(s, dice().rng);
    assert.equal(s.destructionQueue![0]!.resolved, false);
    const e = new GameEngine(s);
    ok(e.beginDisembark('attached', () => .9));
    ok(e.resolveEmergencyDisembark());
    ok(e.resolveDestructionEffects(dice(6).rng));
    assert.equal(e.getState().destructionQueue![0]!.resolved, true);
    const events = e.getState().events;
    assert.ok(events.findIndex(e => e.type === 'flow' && e.name === 'EMERGENCY_DISEMBARK_COMPLETED') < events.findIndex(e => e.type === 'flow' && e.name === 'DEADLY_DEMISE_ROLLED'));
    new GameEngine(e.getState());
});
test('failed completion RNG leaves both casualty queue and shooting transaction unchanged', () => {
    const s = abilityState();
    s.units[1]!.models[0]!.coreAbilities = [{ kind: 'DEADLY_DEMISE', damage: { kind: 'fixed', value: 1 } }];
    patchWeapon(s, { damage: { kind: 'fixed', value: 2 } });
    const e = new GameEngine(s);
    ok(e.beginShooting('unit-1'));
    ok(e.fireWeapon('test-rifle', 'unit-2', dice(3, 4).rng));
    const before = e.getState();
    assert.throws(() => e.completeShooting(dice().rng));
    assert.deepEqual(e.getState(), before);
});
test('schema 3 rejects invalid ability thresholds and permits unchanged legacy snapshots', () => {
    new GameEngine(abilityState());
    const s = abilityState();
    s.units[0]!.models[0]!.coreAbilities = [{ kind: 'FEEL_NO_PAIN', threshold: 0 }];
    assert.throws(() => new GameEngine(s), /Feel No Pain/);
});
test('Walker completion RNG failure cannot partly commit movement or shock', () => {
    const e = new GameEngine(walker());
    ok(e.beginMovement('unit-1', 'NORMAL_MOVE', undefined, { mobile: true }));
    const before = e.getState();
    assert.throws(() => e.completeMovement(undefined, dice().rng));
    assert.deepEqual(e.getState(), before);
});
test('Hover also preserves charge allowance through the shared combat terrain path', () => {
    for (const hover of [false, true]) {
        const s = flyer(hover);
        s.phase = 'Charge';
        s.battlefield.terrain = { areas: [], features: [] };
        s.units[1]!.models[0]!.position = { x: 11, y: 5 };
        const e = new GameEngine(s);
        ok(e.declareCharge('unit-1', dice(3, 3).rng, { takingToSkies: true }));
        if (hover) {
            ok(e.selectChargeTargets(['unit-2']));
            ok(e.moveCombatModel('unit-1:model:1', { x: 9.5, y: 5 }));
            ok(e.completeCombatMove());
        }
        else
            assert.equal(e.selectChargeTargets(['unit-2']).ok, false);
        new GameEngine(JSON.parse(JSON.stringify(e.getState())));
    }
});
test('a lethal Fall Back Hazard triggers Deadly Demise through the same destruction queue', () => {
    const s = terrainState(); s.phase = 'Movement';
    s.units[0]!.state.battleShocked = true;
    const source = s.units[0]!.models[0]!;
    source.coreAbilities = [{kind:'DEADLY_DEMISE',damage:{kind:'fixed',value:1}}];
    s.units[1]!.models[0]!.position = {x:6,y:5};
    const e = new GameEngine(s);
    ok(e.beginMovement('unit-1','FALL_BACK_MOVE',dice(1,6).rng));
    assert.equal(e.getState().units[0]!.models[0]!.alive,false);
    assert.equal(e.getState().units[1]!.models[0]!.woundsRemaining,1);
    assert.equal(e.getState().movement,null);
    new GameEngine(e.getState());
});
