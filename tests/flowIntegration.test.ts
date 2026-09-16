import test from 'node:test';
import assert from 'node:assert/strict';
import { engine, ok, pass, nextPhase } from './flow.helpers';
import { createCloseCombatTestMatch } from '../src/game/data/closeCombatPrototype';
import { GameEngine } from '../src/game/engine/GameEngine';
import { battle } from './deployment.helpers';
import { nextFightSelection } from '../src/game/rules/FightSequenceController';
import { CloseCombatController } from '../src/game/engine/CloseCombatController';
import { terrainState, areaOnly } from './terrain.helpers';
import { modifierDelta } from '../src/game/effects/EffectEngine';

function resolveFight(e: GameEngine) {
  ok(e.startFightPhase()); ok(e.advanceFightStep());
  for (const u of new CloseCombatController(e.getState()).pileInUnits()) ok(e.skipTacticalMove(u.id));
  ok(e.advanceFightStep());
  while (nextFightSelection(e.getState())) {
    const selection = nextFightSelection(e.getState())!, id = selection.unitIds[0]!; ok(e.selectFightUnit(id));
    const weapon = id === 'unit-1' ? 'test-sword' : 'test-blade', target = id === 'unit-1' ? 'unit-2' : 'unit-1';
    ok(e.meleeAttack(weapon, target, () => 0)); ok(e.completeFightUnit());
    assert.equal(e.getState().flow!.window!.trigger, 'AFTER_UNIT_FOUGHT'); pass(e);
  }
  ok(e.advanceFightStep()); for (const u of new CloseCombatController(e.getState()).consolidateUnits()) ok(e.skipTacticalMove(u.id)); ok(e.advanceFightStep());
}
test('complete Command→Movement→Shooting→Charge→Fight→opponent Command through public API', () => {
  const e = engine(createCloseCombatTestMatch()); nextPhase(e);
  ok(e.beginMovement('unit-1')); for (const m of e.getState().units[0]!.models) ok(e.moveModel(m.id, { x: m.position.x, y: 5 })); ok(e.completeMovement()); nextPhase(e);
  ok(e.beginShooting('unit-1')); ok(e.selectShootingTarget('test-rifle', 'unit-2')); pass(e); ok(e.fireWeapon('test-rifle', 'unit-2', () => 0)); ok(e.completeShooting()); pass(e); nextPhase(e);
  ok(e.declareCharge('unit-1', () => .5)); ok(e.selectChargeTargets(['unit-2'])); for (const m of e.getState().units[0]!.models) ok(e.moveCombatModel(m.id, { x: m.position.x, y: 8.5 })); ok(e.completeCombatMove()); pass(e); nextPhase(e);
  assert.equal(e.tryNextPhase().ok, false); resolveFight(e); nextPhase(e);
  assert.equal(e.getState().activePlayerId, 'player-2'); assert.equal(e.getState().round, 1); assert.equal(e.getState().phase, 'Command'); assert.equal(e.getState().flow!.effects.some(x => x.active && x.payload.kind === 'FLAG' && x.payload.flag === 'FIGHTS_FIRST'), false);
  assert.deepEqual(new GameEngine(e.getState()).getState(), e.getState());
});
test('Deployment first-turn choice for player two is retained across a complete round', () => {
  const e = battle(); const s = e.getState(); s.deployment!.firstTurnPlayerId = 'player-2'; s.activePlayerId = 'player-2';
  const managed = engine(s); for (let i = 0; i < 5; i++) nextPhase(managed); assert.equal(managed.getState().activePlayerId, 'player-1'); assert.equal(managed.getState().round, 1);
  for (let i = 0; i < 5; i++) nextPhase(managed); assert.equal(managed.getState().activePlayerId, 'player-2'); assert.equal(managed.getState().round, 2); assert.deepEqual(new GameEngine(managed.getState()).getState(), managed.getState());
});
test('Reserves expire at existing round boundary under Match Flow', () => {
  const legacy = battle(['deploy-5']); const e = engine(legacy.getState()); for (let i = 0; i < 30; i++) nextPhase(e);
  assert.equal(e.getState().round, 4); assert.equal(e.getState().units.find(u => u.id === 'deploy-5')!.location, 'DESTROYED');
});
test('Terrain Cover and offensive BS effect share existing modifier resolution', () => {
  const s = terrainState(); s.phase = 'Shooting'; areaOnly(s, 'LIGHT', 18, 2, 4, 7); s.players[0].commandPoints = 1;
  const e = engine(s); ok(e.passTimingWindow('player-1')); ok(e.passTimingWindow('player-2')); ok(e.useStratagem('test-offensive', 'player-1', ['unit-1'])); pass(e);
  ok(e.beginShooting('unit-1')); ok(e.selectShootingTarget('test-rifle', 'unit-2')); pass(e); const result = ok(e.fireWeapon('test-rifle', 'unit-2', () => 0));
  assert.ok(result.attackModifiers!.every(m => m.effectiveSkill === m.baseSkill)); assert.ok(result.attackModifiers!.every(m => m.modifiers.some(x => x.source === 'COVER') && m.modifiers.some(x => x.source === 'TEMPORARY_EFFECT')));
});
test('WS and Hit/Wound modifiers reach shared melee resolution without altering profiles', () => {
  const s = createCloseCombatTestMatch(); s.phase = 'Fight'; s.units[0]!.models.forEach(m => m.position.y = 8.5); const e = engine(s); pass(e);
  for (const characteristic of ['WS', 'HIT_ROLL', 'WOUND_ROLL'] as const) ok(e.addTemporaryEffect({ source: characteristic, target: { unitId: 'unit-1' }, payload: { kind: 'MODIFIER', characteristic, value: characteristic === 'WS' ? -1 : 1 }, expiry: 'END_OF_CURRENT_PHASE', stacking: 'STACK' }));
  const base = e.getState().definitions; ok(e.startFightPhase()); ok(e.advanceFightStep()); ok(e.skipTacticalMove('unit-1')); ok(e.skipTacticalMove('unit-2')); ok(e.advanceFightStep()); ok(e.selectFightUnit('unit-1'));
  const values = [.17, .34, 0]; let i = 0; const result = ok(e.meleeAttack('test-sword', 'unit-2', () => values[i++ % 3]!)); assert.ok(result.hits > 0); assert.ok(result.wounds > 0); assert.ok(result.totalDamage > 0); assert.deepEqual(e.getState().definitions, base);
});
test('open movement blocks flow; cancel restores coordinates without erasing effects', () => {
  const e = engine(); nextPhase(e); ok(e.beginMovement('unit-1')); const before = e.getState().units; ok(e.moveModel('unit-1:model:1', { x: 4.5, y: 5 }));
  assert.equal(e.canAdvancePhase().allowed, false); assert.equal(e.tryNextPhase().ok, false); ok(e.cancelMovement()); assert.deepEqual(e.getState().units, before);
});
