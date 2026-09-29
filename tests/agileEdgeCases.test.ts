import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../src/game/engine/GameEngine';
import { createTestMatch } from '../src/game/data/prototype';
import { engine, nextPhase, ok, pass } from './flow.helpers';
import { battle } from './deployment.helpers';
import { effectiveCharacteristic, effectiveFlag } from '../src/game/effects/EffectEngine';
import { createCloseCombatTestMatch } from '../src/game/data/closeCombatPrototype';

function focus(phase:'Movement'|'Shooting'|'Charge'|'Fight'='Movement',turn=1) {
  const s=createTestMatch();s.phase=phase;s.turn=turn;s.activePlayerId=s.players[(turn-1)%2]!.id;
  s.factionRuleIds={'player-1':['BATTLE_FOCUS']};
  s.battleFocus={battleSize:'STRIKE_FORCE',round:0,tokens:{},usedByPhase:{},manoeuvresByPhase:{}};
  const e=engine(s);pass(e);return e;
}
test('Swift repeats on another unit but neither a cancelled move nor illegal retry refunds or doubles tokens',()=>{
  const e=focus(),s=e.getState();
  // An additional friendly test unit uses the same fixture definition and independent movement state.
  const second={...s.units[0]!,id:'second',models:s.units[0]!.models.map(m=>({...m,id:`second:${m.id}`,unitId:'second',position:{x:m.position.x,y:9}}))};
  const initial=JSON.parse(JSON.stringify(s));initial.units.push(second);initial.armies[0].unitIds.push('second');
  const game=new GameEngine(initial);
  ok(game.useAgileManoeuvre('SWIFT_AS_THE_WIND','unit-1','MOVE','ADVANCE_MOVE'));
  assert.equal(effectiveCharacteristic(game.getState(),'unit-1','MOVE',7),9);
  const left=game.getState().battleFocus!.tokens['player-1'];
  const snapshot=game.getState();assert.equal(game.useAgileManoeuvre('SWIFT_AS_THE_WIND','unit-1','MOVE','NORMAL_MOVE').ok,false);
  assert.deepEqual(game.getState(),snapshot);
  ok(game.beginMovement('unit-1'));ok(game.cancelMovement());
  assert.equal(game.getState().battleFocus!.tokens['player-1'],left);
  ok(game.useAgileManoeuvre('SWIFT_AS_THE_WIND','second','MOVE','FALL_BACK_MOVE'));
  assert.equal(game.getState().battleFocus!.tokens['player-1'],left!-1);
});
test('Flitting Shadows accepts a move, charge and selected reserve setup, but rejects a spurious setup',()=>{
  const moving=focus();ok(moving.useAgileManoeuvre('FLITTING_SHADOWS','unit-1','MOVE','NORMAL_MOVE'));
  assert.equal(effectiveFlag(moving.getState(),'unit-1','NO_OVERWATCH'),true);
  const charge=focus('Charge');ok(charge.useAgileManoeuvre('FLITTING_SHADOWS','unit-1','CHARGE'));
  const invalid=focus();const before=invalid.getState();assert.equal(invalid.useAgileManoeuvre('FLITTING_SHADOWS','unit-1','SETUP').ok,false);assert.deepEqual(invalid.getState(),before);
  const ingress=battle(['deploy-1'],s=>{s.factionRuleIds={'player-1':['BATTLE_FOCUS']};s.battleFocus={battleSize:'INCURSION',round:0,tokens:{},usedByPhase:{},manoeuvresByPhase:{}};});
  ok(ingress.enableMatchFlow());pass(ingress);
  while(ingress.getState().round<2 || ingress.getState().phase!=='Movement') nextPhase(ingress);
  ok(ingress.beginIngress('deploy-1','STRATEGIC_EDGE'));
  ok(ingress.useAgileManoeuvre('FLITTING_SHADOWS','deploy-1','SETUP'));
  assert.equal(effectiveFlag(ingress.getState(),'deploy-1','NO_OVERWATCH'),true);
  assert.deepEqual(new GameEngine(ingress.getState()).getState(),ingress.getState());
});
test('Star Engines requires a Vehicle selected to Advance and keeps catalogue weapons immutable',()=>{
  const e=focus();const noVehicle=e.getState();assert.equal(e.useAgileManoeuvre('STAR_ENGINES','unit-1','MOVE','ADVANCE_MOVE').ok,false);assert.deepEqual(e.getState(),noVehicle);
  const s=JSON.parse(JSON.stringify(noVehicle));s.definitions[0].keywords.push('VEHICLE');const vehicle=new GameEngine(s);
  assert.equal(vehicle.useAgileManoeuvre('STAR_ENGINES','unit-1','MOVE','NORMAL_MOVE').ok,false);
  const weapon=vehicle.getState().definitions[0]!.weapons[0];
  ok(vehicle.useAgileManoeuvre('STAR_ENGINES','unit-1','MOVE','ADVANCE_MOVE'));
  assert.equal(effectiveFlag(vehicle.getState(),'unit-1','RANGED_ASSAULT'),true);
  assert.deepEqual(vehicle.getState().definitions[0]!.weapons[0],weapon);
});
function sudden() {
  const s=createCloseCombatTestMatch();s.phase='Fight';s.units[0]!.state.hasCharged=true;
  s.units[1]!.models.forEach(m=>m.position.y=9.3);
  s.factionRuleIds={'player-1':['BATTLE_FOCUS']};s.battleFocus={battleSize:'INCURSION',round:0,tokens:{},usedByPhase:{},manoeuvresByPhase:{}};
  const e=engine(s);pass(e);ok(e.startFightPhase());ok(e.advanceFightStep());ok(e.skipTacticalMove('unit-1'));ok(e.advanceFightStep());ok(e.selectFightUnit('unit-1'));
  ok(e.useAgileManoeuvre('SUDDEN_STRIKE','unit-1','FIGHT'));return e;
}
test('Sudden Strike grants six inches for an Overrun pile-in and a later Consolidation',()=>{
  const pile=sudden();ok(pile.beginOverrun(['unit-2']));assert.equal(pile.getState().closeCombat?.move?.allowance,6);
  const e=sudden();ok(e.completeFightUnit());pass(e);ok(e.advanceFightStep());ok(e.beginConsolidation('unit-1',['unit-2']));
  assert.equal(e.getState().closeCombat?.move?.allowance,6);
});
test('Opportunity Seized uses the specific phase-start enemy and rejects late, distant and Titanic candidates without dice',()=>{
  const s=createTestMatch();s.phase='Movement';s.turn=2;s.activePlayerId='player-2';
  s.factionRuleIds={'player-1':['BATTLE_FOCUS']};s.battleFocus={battleSize:'STRIKE_FORCE',round:0,tokens:{},usedByPhase:{},manoeuvresByPhase:{}};
  s.units[1]!.models.forEach((m,i)=>m.position={x:4.5+i*1.5,y:6.2});
  const e=engine(s);pass(e);ok(e.beginMovement('unit-2','FALL_BACK_MOVE',()=>.99));
  for(const m of e.getState().units[1]!.models)ok(e.moveModel(m.id,{x:m.position.x,y:11}));
  ok(e.completeMovement());assert.equal(e.getState().flow?.window?.trigger,'AFTER_ENEMY_FALL_BACK');
  const baseline=e.getState(),late=JSON.parse(JSON.stringify(baseline));late.factionHistory.engagedAtPhaseStart['unit-1']=[];
  const lateGame=new GameEngine(late);let calls=0;
  assert.equal(lateGame.useAgileManoeuvre('OPPORTUNITY_SEIZED','unit-1','ENEMY_FALL_BACK',undefined,()=>{calls++;return 0;}).ok,false);
  assert.equal(calls,0);assert.deepEqual(lateGame.getState(),late);
  const titanic=JSON.parse(JSON.stringify(baseline));titanic.definitions[0].keywords.push('TITANIC');
  const titanicGame=new GameEngine(titanic);assert.equal(titanicGame.useAgileManoeuvre('OPPORTUNITY_SEIZED','unit-1','ENEMY_FALL_BACK',undefined,()=>{calls++;return 0;}).ok,false);
  assert.equal(calls,0);assert.deepEqual(titanicGame.getState(),titanic);
});
test('Fade Back requires a hit from the exact enemy shooter and keeps the D6+1 reaction deterministic',()=>{
  function shot(hit:boolean){
    const e=focus('Shooting',2);ok(e.beginShooting('unit-2'));ok(e.selectShootingTarget('test-carbine','unit-1'));pass(e);
    let n=0;ok(e.fireWeapon('test-carbine','unit-1',()=>hit?[.99,.99,.6][n++%3]!:.01));
    pass(e);ok(e.completeShooting());return e;
  }
  const missed=shot(false),before=missed.getState();let count=0;
  assert.equal(missed.useAgileManoeuvre('FADE_BACK','unit-1','AFTER_ENEMY_SHOT',undefined,()=>{count++;return 0;}).ok,false);
  assert.equal(count,0);assert.deepEqual(missed.getState(),before);
  const hit=shot(true);assert.equal(hit.getState().flow?.window?.trigger,'AFTER_UNIT_SHOT');
  ok(hit.useAgileManoeuvre('FADE_BACK','unit-1','AFTER_ENEMY_SHOT',undefined,()=>0));
  assert.equal(hit.getState().reactionMove?.allowance,2);
  assert.deepEqual(new GameEngine(hit.getState()).getState(),hit.getState());
});
