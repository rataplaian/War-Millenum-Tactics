import assert from 'node:assert/strict';
import test from 'node:test';
import { GameEngine } from '../src/game/engine/GameEngine';
import { createCloseCombatTestMatch } from '../src/game/data/closeCombatPrototype';
import { createTestMatch } from '../src/game/data/prototype';
import { createUnit } from '../src/game/engine/createUnit';
import type { CommandResult, FailureReason, GameState } from '../src/game/models';
import { canDeclareCharge, emptyCloseCombat, getModelsEligibleToFight } from '../src/game/rules/closeCombat';
import { nextFightSelection } from '../src/game/rules/FightSequenceController';
import { baseRadius } from '../src/game/utils/geometry';
import { dice } from './shooting.helpers';
const ok = (result: CommandResult<unknown>) => assert.equal(result.ok, true, JSON.stringify(result));
function rejected(game: GameEngine, action: () => CommandResult<unknown>, reason: FailureReason) {
  const before = game.getState(); assert.deepEqual(action(), { ok: false, reason }); assert.deepEqual(game.getState(), before);
}
function chargeGame(edit?: (s: GameState) => void) { const state = createCloseCombatTestMatch(); state.phase = 'Charge'; edit?.(state); return GameEngine.create(state); }
function charged() {
  const game = chargeGame(); ok(game.declareCharge('unit-1', dice(3, 3).rng)); ok(game.selectChargeTargets(['unit-2']));
  for (const m of game.getState().units[0]!.models) ok(game.moveCombatModel(m.id, { x: m.position.x, y: 8.5 }));
  ok(game.completeCombatMove()); return game;
}
function startFight(game: GameEngine) { if (game.getState().phase !== 'Fight') ok(game.tryNextPhase()); ok(game.startFightPhase()); ok(game.advanceFightStep()); }
function skipPileIns(game: GameEngine) {
  for (const unit of game.getState().units) if (unit.models.some(m => m.alive)) ok(game.skipTacticalMove(unit.id));
  ok(game.advanceFightStep());
}
function oneModel(state: GameState) { for (const unit of state.units) for (const m of unit.models.slice(1)) { m.alive = false; m.woundsRemaining = 0; } }
function engagedGame(edit?: (s: GameState) => void) {
  const state = createCloseCombatTestMatch(); state.phase = 'Fight';
  state.units[0]!.models.forEach(m => { m.position.y = 8.5; }); edit?.(state);
  return GameEngine.create(state);
}
function addEnemy(state: GameState, id = 'unit-3', x = 9, y = 10.5) {
  const unit = createUnit(state.definitions[1]!, id, 'player-2', [{ x, y }, { x: x + 1.5, y }, { x: x + 3, y }]);
  state.units.push(unit); state.armies[1]!.unitIds.push(id); return unit;
}

test('charge eligibility: correct phase, owner and normal states', () => {
  assert.equal(canDeclareCharge(createTestMatch(), 'unit-1').ok, false);
  const game = chargeGame(); rejected(game, () => game.declareCharge('unit-2', dice(6, 6).rng), 'NOT_YOUR_UNIT');
  for (const flag of ['hasAdvanced', 'hasFallenBack'] as const) {
    const blocked = chargeGame(s => { s.units[0]!.state[flag] = true; });
    rejected(blocked, () => blocked.declareCharge('unit-1', dice(6, 6).rng), 'CHARGE_INELIGIBLE');
  }
  const engaged = chargeGame(s => { s.units[0]!.models.forEach(m => { m.position.y = 8.5; }); });
  rejected(engaged, () => engaged.declareCharge('unit-1', dice(6, 6).rng), 'CHARGE_INELIGIBLE');
});
test('generic charge exception is injected, not a faction special case', () => {
  const state = createCloseCombatTestMatch(); state.phase = 'Charge'; state.units[0]!.state.hasAdvanced = true;
  const game = GameEngine.create(state, { chargeExceptions: () => ({ afterAdvance: true }) }); ok(game.declareCharge('unit-1', dice(3, 3).rng));
});
test('charge roll consumes exactly two controlled D6 and records them', () => {
  const game = chargeGame(), rng = dice(2, 5); assert.deepEqual(game.declareCharge('unit-1', rng.rng), { ok: true, value: 7 });
  assert.equal(rng.calls(), 2); const event = game.getState().events[1]; assert.equal(event?.type, 'charge-rolled');
  if (event?.type === 'charge-rolled') assert.deepEqual(event.rolls, [2, 5]);
});
test('broken charge RNG throws without partial state mutation', () => {
  const game = chargeGame(), before = game.getState(); assert.throws(() => game.declareCharge('unit-1', dice(3).rng)); assert.deepEqual(game.getState(), before);
});
test('target selection requires a prior roll and a nonempty unique target set', () => {
  const game = chargeGame(); rejected(game, () => game.selectChargeTargets(['unit-2']), 'NO_CHARGE');
  assert.deepEqual(game.getLegalChargeTargets(), []); ok(game.declareCharge('unit-1', dice(3, 3).rng));
  rejected(game, () => game.selectChargeTargets([]), 'TARGETS_REQUIRED');
  rejected(game, () => game.selectChargeTargets(['unit-2', 'unit-2']), 'TARGETS_REQUIRED');
  rejected(game, () => game.selectChargeTargets(['unit-1']), 'UNREACHABLE_TARGET');
});
test('targets beyond 12 inches are rejected even with the maximum roll', () => {
  const game = chargeGame(s => { s.units[1]!.models.forEach(m => { m.position.y = 20; }); });
  ok(game.declareCharge('unit-1', dice(6, 6).rng)); assert.deepEqual(game.getLegalChargeTargets(), []);
  rejected(game, () => game.selectChargeTargets(['unit-2']), 'UNREACHABLE_TARGET');
});
test('target outside rolled distance is rejected even if its engagement could be reached', () => {
  const game = chargeGame(); ok(game.declareCharge('unit-1', dice(2, 2).rng)); assert.deepEqual(game.getLegalChargeTargets(), []);
});
test('successful charge engages selected unit and grants a temporary Fights First effect', () => {
  const game = charged(), state = game.getState(); assert.equal(state.units[0]!.state.hasCharged, true);
  assert.deepEqual(state.closeCombat!.effects, [{ unitId: 'unit-1', kind: 'FIGHTS_FIRST', expiresAt: 'END_OF_TURN', turn: 1 }]);
  assert.equal(state.closeCombat!.charge, null); assert.equal(state.closeCombat!.move, null);
});
test('multiple charge targets are supported and checked together', () => {
  const game = chargeGame(s => { addEnemy(s); }); ok(game.declareCharge('unit-1', dice(3, 3).rng));
  assert.equal(game.getLegalChargeTargets().length, 2); ok(game.selectChargeTargets(['unit-2', 'unit-3']));
  for (const m of game.getState().units[0]!.models) ok(game.moveCombatModel(m.id, { x: m.position.x, y: 8.5 }));
  ok(game.completeCombatMove());
});
test('charge may not end engaged with an unselected enemy', () => {
  const game = chargeGame(s => { addEnemy(s); }); ok(game.declareCharge('unit-1', dice(3, 3).rng)); ok(game.selectChargeTargets(['unit-2']));
  for (const m of game.getState().units[0]!.models) ok(game.moveCombatModel(m.id, { x: m.position.x, y: 8.5 }));
  rejected(game, () => game.completeCombatMove(), 'INVALID_FINAL_ENGAGEMENT');
});
test('charge rejects unfinished engagement and enforces the closest available one-inch endpoint', () => {
  const game = chargeGame(); ok(game.declareCharge('unit-1', dice(3, 3).rng)); ok(game.selectChargeTargets(['unit-2']));
  for (const m of game.getState().units[0]!.models) ok(game.moveCombatModel(m.id, { x: m.position.x, y: 7.5 }));
  rejected(game, () => game.completeCombatMove(), 'MUST_ENGAGE');
});
test('incoherent charge formation cannot be committed', () => {
  const game = chargeGame(); ok(game.declareCharge('unit-1', dice(6, 6).rng)); ok(game.selectChargeTargets(['unit-2']));
  for (const [i, m] of game.getState().units[0]!.models.entries()) ok(game.moveCombatModel(m.id, { x: m.position.x, y: i ? 8.5 : 15 }));
  const before = game.getState(), result = game.completeCombatMove(); assert.equal(result.ok, false); if (!result.ok) assert.equal(result.reason, 'INCOHERENT'); assert.deepEqual(game.getState(), before);
});
test('charge movement cumulatively consumes its own allowance, without normal movement usage', () => {
  const game = chargeGame(); ok(game.declareCharge('unit-1', dice(3, 3).rng)); ok(game.selectChargeTargets(['unit-2']));
  const id = game.getState().units[0]!.models[0]!.id;
  ok(game.moveCombatModel(id, { x: 4.5, y: 6.5 })); ok(game.moveCombatModel(id, { x: 4.5, y: 8.5 }));
  assert.equal(game.getState().closeCombat!.move!.used[id], 4); assert.equal(game.getState().units[0]!.models[0]!.movementUsed, 0);
  const before = game.getState(); const result = game.moveCombatModel(id, { x: 4.5, y: 12 }); assert.equal(result.ok, false); assert.deepEqual(game.getState(), before);
});
test('charge cancellation is forbidden after dice, but failure restores positions without refund', () => {
  const game = chargeGame(), before = game.getState().units; ok(game.declareCharge('unit-1', dice(3, 3).rng));
  rejected(game, () => game.cancelCombatMove(), 'IRREVERSIBLE_ACTION'); ok(game.selectChargeTargets(['unit-2']));
  ok(game.moveCombatModel('unit-1:model:1', { x: 4.5, y: 8.5 })); rejected(game, () => game.cancelCombatMove(), 'IRREVERSIBLE_ACTION');
  ok(game.failCharge()); assert.deepEqual(game.getState().units, before);
  rejected(game, () => game.declareCharge('unit-1', dice(6, 6).rng), 'ALREADY_DECLARED');
});
test('normal Movement and phase progression cannot bypass a combat transaction', () => {
  const game = chargeGame(); ok(game.declareCharge('unit-1', dice(3, 3).rng));
  rejected(game, () => game.tryNextPhase(), 'COMBAT_IN_PROGRESS'); rejected(game, () => game.beginMovement('unit-1'), 'WRONG_PHASE');
});
test('pile-ins occur before attacks, active player then opponent', () => {
  const game = charged(); startFight(game);
  rejected(game, () => game.beginPileIn('unit-2'), 'WRONG_FIGHT_PLAYER'); rejected(game, () => game.selectFightUnit('unit-1'), 'WRONG_FIGHT_STEP');
  ok(game.skipTacticalMove('unit-1')); ok(game.beginPileIn('unit-2')); ok(game.completeCombatMove()); ok(game.advanceFightStep());
});
test('pile-in limit is inclusive at three inches and rejects longer movement', () => {
  const game = engagedGame(s => { oneModel(s); s.units[0]!.state.hasCharged = true; s.units[0]!.models[0]!.position.y = 6.5; }); startFight(game);
  ok(game.beginPileIn('unit-1', ['unit-2']));
  const before = game.getState(); assert.equal(game.moveCombatModel('unit-1:model:1', { x: 4.5, y: 9.6 }).ok, false); assert.deepEqual(game.getState(), before);
  // Move diagonally to end exactly three inches from the start, without overlapping.
  ok(game.moveCombatModel('unit-1:model:1', { x: 4.5 + Math.sqrt(5), y: 8.5 })); ok(game.completeCombatMove());
});
test('pile-in must approach the closest target', () => {
  const game = engagedGame(); startFight(game); ok(game.beginPileIn('unit-1'));
  rejected(game, () => game.moveCombatModel('unit-1:model:1', { x: 4.5, y: 8 }), 'NOT_CLOSER');
});
test('a base-contact model cannot pile in', () => {
  const game = engagedGame(s => { oneModel(s); s.units[0]!.models[0]!.position.y = 10.5 - baseRadius(s.units[0]!.models[0]!.base) - baseRadius(s.units[1]!.models[0]!.base); });
  startFight(game); ok(game.beginPileIn('unit-1')); rejected(game, () => game.moveCombatModel('unit-1:model:1', { x: 4.6, y: 9.3 }), 'BASE_CONTACT_LOCKED');
});
test('cancelling pile-in restores exact positions and usage and permits another attempt', () => {
  const game = engagedGame(); startFight(game); const units = game.getState().units;
  ok(game.beginPileIn('unit-1')); ok(game.moveCombatModel('unit-1:model:1', { x: 4.5, y: 9 })); ok(game.cancelCombatMove());
  assert.deepEqual(game.getState().units, units); ok(game.beginPileIn('unit-1')); ok(game.completeCombatMove());
});
test('per-model melee eligibility excludes unengaged models even in an engaged unit', () => {
  const state = createCloseCombatTestMatch(); state.units[0]!.models[0]!.position.y = 8.5;
  assert.deepEqual(getModelsEligibleToFight(state, state.units[0]!).map(m => m.id), ['unit-1:model:1']);
});
test('Fights First active player selects first and remaining combat retains alternation', () => {
  const game = charged(); startFight(game); skipPileIns(game);
  assert.deepEqual(nextFightSelection(game.getState()), { category: 'FIGHTS_FIRST', playerId: 'player-1', unitIds: ['unit-1'] });
  rejected(game, () => game.selectFightUnit('unit-2'), 'UNIT_NOT_ELIGIBLE'); ok(game.selectFightUnit('unit-1')); ok(game.completeFightUnit());
  assert.deepEqual(nextFightSelection(game.getState()), { category: 'REMAINING_COMBATS', playerId: 'player-2', unitIds: ['unit-2'] });
});
test('FightSequenceController skips empty sides and supports non-charge Fights First', () => {
  const game = engagedGame(); startFight(game); skipPileIns(game); const state = game.getState();
  state.closeCombat!.effects.push({ unitId: 'unit-2', kind: 'FIGHTS_FIRST', expiresAt: 'END_OF_TURN', turn: 1 });
  assert.equal(nextFightSelection(state)?.playerId, 'player-2'); assert.equal(nextFightSelection(state)?.category, 'FIGHTS_FIRST');
});
test('melee reuses hit/wound/save/damage allocation and removes casualties', () => {
  const game = engagedGame(s => { oneModel(s); }); startFight(game); skipPileIns(game); ok(game.selectFightUnit('unit-1'));
  const rng = dice(6, 6, 1, 6, 6, 1); const result = game.meleeAttack('test-sword', 'unit-2', rng.rng); ok(result);
  if (result.ok) { assert.equal(result.value.hits, 2); assert.equal(result.value.wounds, 2); assert.equal(result.value.totalDamage, 2); assert.deepEqual(result.value.destroyedModelIds, ['unit-2:model:1']); }
  assert.equal(rng.calls(), 6); assert.equal(game.getState().units[1]!.models[0]!.alive, false);
  assert.equal(game.getState().events.at(-1)?.type, 'melee-attack-resolved');
});
test('a model cannot attack twice or use both melee profiles in one activation', () => {
  const game = engagedGame(); startFight(game); skipPileIns(game); ok(game.selectFightUnit('unit-1'));
  ok(game.meleeAttack('test-sword', 'unit-2', () => 0)); rejected(game, () => game.meleeAttack('test-sword', 'unit-2', () => 0), 'NO_ELIGIBLE_FIGHTERS');
});
test('illegal melee commands do not consume RNG or change state', () => {
  const game = engagedGame(); startFight(game); skipPileIns(game); ok(game.selectFightUnit('unit-1')); const rng = dice();
  rejected(game, () => game.meleeAttack('test-rifle', 'unit-2', rng.rng), 'WEAPON_NOT_MELEE'); rejected(game, () => game.meleeAttack('test-sword', 'unit-1', rng.rng), 'TARGET_NOT_ENEMY'); assert.equal(rng.calls(), 0);
});
test('opponent attack events carry actual acting player and reload correctly', () => {
  const game = engagedGame(); startFight(game); skipPileIns(game); ok(game.selectFightUnit('unit-1')); ok(game.completeFightUnit()); ok(game.selectFightUnit('unit-2'));
  ok(game.meleeAttack('test-blade', 'unit-1', () => 0)); assert.equal(game.getState().events.at(-1)!.playerId, 'player-2');
  assert.deepEqual(GameEngine.create(game.getState()).getState(), game.getState());
});
test('Overrun retains eligibility after the original enemy is destroyed', () => {
  const game = engagedGame(s => {
    oneModel(s); const extra = addEnemy(s, 'unit-3', 4.5, 12.5); extra.playerId = 'player-1';
    s.armies[1]!.unitIds = s.armies[1]!.unitIds.filter(id => id !== extra.id); s.armies[0]!.unitIds.push(extra.id);
    // Match the allied definition/faction while retaining a nearby living model.
    extra.definitionId = s.definitions[0]!.id; extra.models.forEach((m, i) => { m.base = { ...s.definitions[0]!.defaultBase }; m.woundsRemaining = i ? 0 : 1; m.alive = i === 0; });
  });
  startFight(game); ok(game.skipTacticalMove('unit-1')); ok(game.skipTacticalMove('unit-3')); ok(game.skipTacticalMove('unit-2')); ok(game.advanceFightStep());
  ok(game.selectFightUnit('unit-1')); ok(game.meleeAttack('test-sword', 'unit-2', dice(6, 6, 1, 6, 6, 1).rng)); ok(game.completeFightUnit());
  assert.deepEqual(nextFightSelection(game.getState())?.unitIds, ['unit-3']); ok(game.selectFightUnit('unit-3'));
  // No surviving targets: it retains an activation and can finish without attacks.
  rejected(game, () => game.beginOverrun(['unit-2']), 'UNREACHABLE_TARGET'); ok(game.completeFightUnit());
});
test('consolidation is resolved only after all fights and can be cancelled', () => {
  const game = engagedGame(); startFight(game); skipPileIns(game);
  rejected(game, () => game.beginConsolidation('unit-1'), 'WRONG_FIGHT_STEP');
  for (const id of ['unit-1', 'unit-2']) { ok(game.selectFightUnit(id)); ok(game.completeFightUnit()); }
  ok(game.advanceFightStep()); const units = game.getState().units;
  rejected(game, () => game.beginConsolidation('unit-2'), 'WRONG_FIGHT_PLAYER'); ok(game.beginConsolidation('unit-1'));
  ok(game.moveCombatModel('unit-1:model:1', { x: 4.5, y: 9 })); ok(game.cancelCombatMove()); assert.deepEqual(game.getState().units, units);
  ok(game.beginConsolidation('unit-1')); ok(game.completeCombatMove()); ok(game.skipTacticalMove('unit-2')); ok(game.advanceFightStep()); ok(game.tryNextPhase()); assert.equal(game.getState().phase, 'Command');
});
test('Fights First and declaration bookkeeping expire on the next turn', () => {
  const game = charged(); startFight(game); skipPileIns(game);
  for (const id of ['unit-1', 'unit-2']) { ok(game.selectFightUnit(id)); ok(game.completeFightUnit()); }
  ok(game.advanceFightStep()); ok(game.skipTacticalMove('unit-1')); ok(game.skipTacticalMove('unit-2')); ok(game.advanceFightStep()); ok(game.tryNextPhase());
  assert.equal(game.getState().closeCombat, undefined); assert.equal(game.getState().units[0]!.state.hasCharged, false);
});
test('Task 003 snapshots remain compatible; new open charge/move snapshots round-trip', () => {
  assert.deepEqual(GameEngine.create(createTestMatch()).getState(), createTestMatch());
  const game = chargeGame(); ok(game.declareCharge('unit-1', dice(3, 3).rng)); assert.deepEqual(GameEngine.create(game.getState()).getState(), game.getState());
  ok(game.selectChargeTargets(['unit-2'])); ok(game.moveCombatModel('unit-1:model:1', { x: 4.5, y: 8.5 }));
  const resumed = GameEngine.create(game.getState()); assert.deepEqual(resumed.getState(), game.getState()); ok(resumed.failCharge());
});
test('corrupted combat snapshots are rejected atomically', () => {
  const game = chargeGame(); ok(game.declareCharge('unit-1', dice(3, 3).rng)); const before = game.getState(), corrupt = game.getState();
  corrupt.closeCombat!.charge!.distance = 99; assert.throws(() => game.loadMatch(corrupt), /close combat snapshot/); assert.deepEqual(game.getState(), before);
});
test('detached combat state cannot mutate engine events, effects or positions', () => {
  const game = charged(), before = game.getState(), snapshot = game.getState(); snapshot.closeCombat!.effects[0]!.turn = 99; snapshot.units[0]!.models[0]!.position.x = 99; snapshot.events.length = 0;
  assert.deepEqual(game.getState(), before);
});
test('identical command and RNG streams produce identical complete combat state', () => { assert.deepEqual(charged().getState(), charged().getState()); });

test('Overrun can perform its additional pile-in and then attack a new enemy', () => {
  const state = createCloseCombatTestMatch(); state.phase = 'Fight'; oneModel(state);
  state.units[0]!.models[0]!.position.y = 7;
  state.closeCombat = emptyCloseCombat();
  state.closeCombat.fight = { step: 'FIGHT', category: 'REMAINING_COMBATS', nextPlayerId: 'player-1', pileInDone: ['unit-1', 'unit-2'],
    eligibleAtFightStart: ['unit-1'], engagedAtFightStart: ['unit-1'], fought: [], consolidateDone: [], selected: null };
  const game = GameEngine.create(state); ok(game.selectFightUnit('unit-1')); ok(game.beginOverrun(['unit-2']));
  ok(game.moveCombatModel('unit-1:model:1', { x: 4.5, y: 8.5 })); ok(game.completeCombatMove());
  rejected(game, () => game.beginOverrun(['unit-2']), 'UNIT_NOT_ELIGIBLE');
  ok(game.meleeAttack('test-sword', 'unit-2', () => 0)); assert.ok(game.getState().events.some(e => e.type === 'overrun-fight'));
});
test('consolidation into a fresh enemy creates a fight opportunity before phase completion', () => {
  const state = createCloseCombatTestMatch(); state.phase = 'Fight'; oneModel(state); state.units[0]!.models[0]!.position.y = 7;
  state.closeCombat = emptyCloseCombat(); state.units[0]!.state.hasFought = true;
  state.closeCombat.fight = { step: 'CONSOLIDATE', category: 'REMAINING_COMBATS', nextPlayerId: 'player-2', pileInDone: [], eligibleAtFightStart: ['unit-1'], engagedAtFightStart: ['unit-1'], fought: ['unit-1'], consolidateDone: [], selected: null };
  const game = GameEngine.create(state); ok(game.beginConsolidation('unit-1', ['unit-2']));
  ok(game.moveCombatModel('unit-1:model:1', { x: 4.5, y: 8.5 })); ok(game.completeCombatMove());
  assert.equal(game.getState().closeCombat!.fight!.step, 'FIGHT'); assert.deepEqual(nextFightSelection(game.getState())?.unitIds, ['unit-2']);
  ok(game.selectFightUnit('unit-2')); ok(game.meleeAttack('test-blade', 'unit-1', () => 0)); ok(game.completeFightUnit());
  ok(game.advanceFightStep()); ok(game.skipTacticalMove('unit-2')); ok(game.advanceFightStep()); ok(game.tryNextPhase());
});
test('combat endpoint validation rejects collision, bounds and enemy model control without mutation', () => {
  const game = chargeGame(); ok(game.declareCharge('unit-1', dice(6, 6).rng)); ok(game.selectChargeTargets(['unit-2']));
  for (const position of [{ x: 4.5, y: 10.5 }, { x: 0, y: 4.5 }]) {
    const before = game.getState(); assert.equal(game.moveCombatModel('unit-1:model:1', position).ok, false); assert.deepEqual(game.getState(), before);
  }
  rejected(game, () => game.moveCombatModel('unit-2:model:1', { x: 4.5, y: 8.5 }), 'MODEL_NOT_IN_UNIT');
});
test('unreachable formation is absent from legal charge targets', () => {
  const game = chargeGame(s => {
    // A wide incoherent source cannot bring both ends together in a two-inch charge.
    s.spatialRules.engagementDistance = 1;
    oneModel(s); s.units[0]!.models[0]!.position.y = 7.5;
    s.units[0]!.models[2]!.alive = true; s.units[0]!.models[2]!.woundsRemaining = 1; s.units[0]!.models[2]!.position.x = 25;
  });
  ok(game.declareCharge('unit-1', dice(1, 1).rng)); assert.deepEqual(game.getLegalChargeTargets(), []);
});
test('full debug sequence requires no manual engine state changes', () => {
  const game = GameEngine.create(createCloseCombatTestMatch());
  ok(game.tryNextPhase()); ok(game.beginMovement('unit-1')); ok(game.completeMovement());
  ok(game.tryNextPhase()); ok(game.beginShooting('unit-1')); ok(game.fireWeapon('test-rifle', 'unit-2', () => 0)); ok(game.completeShooting());
  ok(game.tryNextPhase()); ok(game.declareCharge('unit-1', dice(3, 3).rng)); ok(game.selectChargeTargets(['unit-2']));
  for (const m of game.getState().units[0]!.models) ok(game.moveCombatModel(m.id, { x: m.position.x, y: 8.5 }));
  ok(game.completeCombatMove()); startFight(game); skipPileIns(game);
  for (const [unit, weapon, target] of [['unit-1', 'test-sword', 'unit-2'], ['unit-2', 'test-blade', 'unit-1']]) {
    ok(game.selectFightUnit(unit!)); ok(game.meleeAttack(weapon!, target!, () => 0)); ok(game.completeFightUnit());
  }
  ok(game.advanceFightStep());
  for (const unit of ['unit-1', 'unit-2']) { ok(game.beginConsolidation(unit)); ok(game.completeCombatMove()); }
  ok(game.advanceFightStep()); ok(game.tryNextPhase()); assert.equal(game.getState().turn, 2);
});

test('fight selection can be cancelled before dice, but not after attacks', () => {
  const game = engagedGame(); startFight(game); skipPileIns(game); const selection = nextFightSelection(game.getState());
  ok(game.selectFightUnit('unit-1')); ok(game.cancelFightUnit()); assert.deepEqual(nextFightSelection(game.getState()), selection);
  ok(game.selectFightUnit('unit-1')); ok(game.meleeAttack('test-sword', 'unit-2', () => 0)); rejected(game, () => game.cancelFightUnit(), 'IRREVERSIBLE_ACTION');
});
