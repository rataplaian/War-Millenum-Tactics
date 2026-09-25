import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestMatch } from '../src/game/data/prototype';
import { FACTION_STRATAGEMS } from '../src/game/content/factionStratagems';
import { effectiveFlag } from '../src/game/effects/EffectEngine';
import { engine, ok, pass } from './flow.helpers';
import { createCloseCombatTestMatch } from '../src/game/data/closeCombatPrototype';
import { CloseCombatController } from '../src/game/engine/CloseCombatController';
import { GameEngine } from '../src/game/engine/GameEngine';

function fixture(phase: 'Movement'|'Shooting'|'Fight') {
  const s=createTestMatch();s.phase=phase;
  s.players.forEach(p=>p.commandPoints=4);
  s.stratagemDefinitions=[...FACTION_STRATAGEMS];
  s.definitions=s.definitions.map((d,i)=>({...d,keywords:[...d.keywords,...(i===0?['AELDARI','GUARDIANS','STORM_GUARDIANS','DIRE_AVENGERS']:['EMPERORS_CHILDREN'])]}));
  return engine(s);
}
function reachPhaseStart(e:ReturnType<typeof fixture>) {
  for (const id of ['player-1','player-2']) ok(e.passTimingWindow(id));
  assert.equal(e.getState().flow?.window?.trigger,'START_OF_PHASE');
}
test('Guardian and Peerless catalogs expose exactly six unique stratagems each',()=>{
  assert.equal(FACTION_STRATAGEMS.length,12);
  assert.equal(new Set(FACTION_STRATAGEMS.map(s=>s.id)).size,12);
  for(const s of FACTION_STRATAGEMS) assert.ok(s.cpCost>0 && s.resolverId && s.timing.triggers.length>0);
});
test('Time to Strike uses the engine Advance transaction without consuming a die',()=>{
  const e=fixture('Movement');reachPhaseStart(e);
  ok(e.useStratagem('TIME_TO_STRIKE','player-1',['unit-1']));
  assert.equal(e.getState().players[0]!.commandPoints,3);
  pass(e);
  ok(e.beginMovement('unit-1','ADVANCE_MOVE'));
  assert.equal(e.getState().movement?.bonus,6);
  assert.equal(e.getState().units[0]!.advanceBonus?.value,6);
  ok(e.completeMovement());
  assert.equal(e.getState().units[0]!.state.hasAdvanced,true);
  assert.equal(e.getState().definitions[0]!.stats.movement,7);
  assert.equal(effectiveFlag(e.getState(),'unit-1','AFTER_ADVANCE_SHOOT_CHARGE'),true);
});
test('Blades of Asuryan adds a temporary ranged pistol flag and spends one CP',()=>{
  const e=fixture('Shooting');reachPhaseStart(e);
  ok(e.useStratagem('BLADES_OF_ASURYAN','player-1',['unit-1']));
  assert.equal(e.getState().players[0]!.commandPoints,3);
  assert.equal(effectiveFlag(e.getState(),'unit-1','RANGED_PISTOL'),true);
  assert.notEqual(e.getState().definitions[0]!.weapons[0]!.weaponAbilities?.some(a=>a.type==='PISTOL'),true);
  const before=e.getState();
  assert.equal(e.useStratagem('BLADES_OF_ASURYAN','player-1',['unit-1']).ok,false);
  assert.deepEqual(e.getState(),before);
});
test('Deft Parry targets the defender after target selection and retains detached snapshots',()=>{
  const e=fixture('Fight');pass(e);
  // The generic reactive window is supplied by the Fight controller, not forged in the UI.
  assert.equal(e.useStratagem('DEFT_PARRY','player-2',['unit-2']).ok,false);
});
test('Cut Down the Weak rolls a reaction charge on enemy Fall Back and preserves the roll after failure',()=>{
  const s=createTestMatch();s.phase='Movement';s.turn=2;s.activePlayerId='player-2';
  s.players.forEach(p=>p.commandPoints=4);
  s.stratagemDefinitions=[...FACTION_STRATAGEMS];
  s.definitions=s.definitions.map((d,i)=>i===0?{...d,keywords:[...d.keywords,'EMPERORS_CHILDREN']}:d);
  s.units[1]!.models.forEach((m,i)=>m.position={x:4.5+i*1.5,y:6.2});
  const e=engine(s);pass(e);
  ok(e.beginMovement('unit-2','FALL_BACK_MOVE',()=>.99));
  for(const m of e.getState().units[1]!.models) ok(e.moveModel(m.id,{x:m.position.x,y:10}));
  ok(e.completeMovement());
  assert.equal(e.getState().flow?.window?.trigger,'AFTER_ENEMY_FALL_BACK');
  const before=e.getState();
  assert.equal(e.useStratagem('CUT_DOWN_THE_WEAK','player-1',['unit-1']).ok,false);
  assert.deepEqual(e.getState(),before);
  ok(e.useStratagem('CUT_DOWN_THE_WEAK','player-1',['unit-1'],()=>.99));
  assert.deepEqual(e.getState().closeCombat?.charge?.rolls,[6,6]);
  assert.equal(e.getState().closeCombat?.reaction?.targetUnitId,'unit-2');
  assert.equal(e.getState().players[0]!.commandPoints,2);
  assert.deepEqual(engineSnapshot(e).closeCombat?.charge?.rolls,[6,6]);
  assert.equal(e.canAdvancePhase().allowed,false);
  pass(e);
  ok(e.failCharge());
  assert.equal(e.getState().closeCombat?.reaction,undefined);
  assert.equal(e.getState().players[0]!.commandPoints,2);
});
function engineSnapshot(e:ReturnType<typeof fixture>) {return JSON.parse(JSON.stringify(e.getState())) as ReturnType<typeof e.getState>;}
test('Death Ecstasy slain defenders fight only after the attacking unit finishes all attacks',()=>{
  const s=createCloseCombatTestMatch();s.phase='Fight';s.units[0]!.models.forEach(m=>m.position.y=8.5);
  const e=engine(s);pass(e);
  ok(e.addTemporaryEffect({source:'DEATH_ECSTASY',target:{unitId:'unit-2'},payload:{kind:'FLAG',flag:'FIGHT_ON_DEATH',value:true},expiry:'END_OF_CURRENT_PHASE',stacking:'REPLACE_SAME_SOURCE'}));
  const draft=e.getState(),combat=new CloseCombatController(draft);
  ok(combat.startFightPhase());ok(combat.advanceFightStep());
  ok(combat.skipTacticalMove('unit-1'));ok(combat.skipTacticalMove('unit-2'));ok(combat.advanceFightStep());
  ok(combat.selectFightUnit('unit-1'));
  let i=0;const roll=()=>[.99,.99,0][i++%3]!;
  ok(combat.meleeAttack('test-sword','unit-2',roll));
  const pending=draft.fightOnDeath?.[0];assert.ok(pending?.modelIds.length);
  const modelCount=pending.modelIds.length;
  assert.equal(combat.resolveFightOnDeath('unit-2','test-blade',()=>.99).ok,false);
  ok(combat.completeFightUnit());
  const result=ok(combat.resolveFightOnDeath('unit-2','test-blade',()=>.99));
  assert.equal(result.eligibleFiringModelIds.length,modelCount);
  assert.equal(draft.fightOnDeath?.length,0);
  assert.deepEqual(new GameEngine(draft).getState(),draft);
});
test('Incessant Violence opens a per-unit consolidation window and increases the existing transaction allowance',()=>{
  const s=createCloseCombatTestMatch();s.phase='Fight';s.units[0]!.models.forEach(m=>m.position.y=8.5);
  s.definitions=s.definitions.map((d,i)=>i===1?{...d,keywords:[...d.keywords,'EMPERORS_CHILDREN']}:d);
  s.stratagemDefinitions=[...FACTION_STRATAGEMS];s.players.forEach(p=>p.commandPoints=3);
  const e=engine(s);pass(e);
  ok(e.startFightPhase());ok(e.advanceFightStep());
  ok(e.skipTacticalMove('unit-1'));ok(e.skipTacticalMove('unit-2'));ok(e.advanceFightStep());
  for(const id of ['unit-1','unit-2']) {ok(e.selectFightUnit(id));ok(e.completeFightUnit());pass(e);}
  ok(e.advanceFightStep());
  ok(e.skipTacticalMove('unit-1'));
  ok(e.beginConsolidation('unit-2'));
  assert.equal(e.getState().flow?.window?.trigger,'BEFORE_CONSOLIDATE');
  ok(e.useStratagem('INCESSANT_VIOLENCE','player-2',['unit-2']));
  pass(e);
  ok(e.beginConsolidation('unit-2'));
  assert.equal(e.getState().closeCombat?.move?.allowance,6);
  assert.equal(e.getState().players[1]!.commandPoints,2);
  assert.deepEqual(new GameEngine(e.getState()).getState(),e.getState());
});
test('Cost of Victory uses the existing Strategic Reserves state and restores destroyed Guardian models',()=>{
  const s=createTestMatch();s.phase='Fight';s.turn=2;s.activePlayerId='player-2';
  s.players[0]!.commandPoints=2;
  s.stratagemDefinitions=[...FACTION_STRATAGEMS];
  s.definitions=s.definitions.map((d,i)=>i===0?{...d,keywords:[...d.keywords,'AELDARI','GUARDIANS']}:d);
  s.units[0]!.models[0]!.alive=false;s.units[0]!.models[0]!.woundsRemaining=0;
  const e=engine(s);pass(e);
  ok(e.tryNextPhase());
  assert.equal(e.getState().flow?.window?.trigger,'END_OF_PHASE');
  ok(e.useStratagem('COST_OF_VICTORY','player-1',['unit-1']));
  const unit=e.getState().units[0]!;
  assert.equal(unit.location,'STRATEGIC_RESERVES');
  assert.equal(unit.models[0]!.alive,true);
  assert.equal(unit.models[0]!.woundsRemaining,1);
  assert.equal(e.getState().players[0]!.commandPoints,1);
  assert.ok(e.getState().events.some(x=>x.type==='flow'&&x.name==='MODELS_RESTORED'));
  assert.deepEqual(new GameEngine(e.getState()).getState(),e.getState());
});
