import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../src/game/engine/GameEngine';
import { PROVING_GROUND, createProvingGroundMatch, createProvingGroundDeploymentMatch } from '../src/game/missions/provingGround';
import { calculateLevelOfControl, resolveObjectiveControl } from '../src/game/missions/objectives';
import { canStartMissionAction, interruptActionsOnCommit } from '../src/game/missions/actions';
import { rectangle } from '../src/game/terrain/geometry';
import { createSeededRng } from '../src/game/utils/dice';
import { command, nextPhase, ok, pass } from './flow.helpers';
import { deployAll } from './deployment.helpers';
import { field } from './transports.helpers';
import { processAttachmentCasualties } from '../src/game/attachments/AttachmentController';
import type { GameState } from '../src/game/models';
function configured(state = createProvingGroundMatch()) {const e=new GameEngine(state);ok(e.setupMission(PROVING_GROUND,'player-2',{},createSeededRng(11)));return e;}
function validate(e:GameEngine){assert.deepEqual(new GameEngine(JSON.parse(JSON.stringify(e.getState()))).getState(),e.getState());}

test('mission plus existing deployment controller reaches battle with attacker independent of first turn',()=>{
 const {state,definition}=createProvingGroundDeploymentMatch(),e=new GameEngine(state);ok(e.setupMission(definition,'player-2'));
 assert.equal(e.getState().mission!.setupStep,'DECLARE_FORMATIONS');ok(e.advancePreBattle());
 for(const id of ['deploy-4','deploy-10'])ok(e.chooseDeploymentAbility(id,'SCOUTS'));
 deployAll(e);assert.equal(e.getState().mission!.setupStep,'DEPLOYMENT');ok(e.advancePreBattle());assert.equal(e.getState().mission!.setupStep,'PRE_BATTLE');
 while(e.getDeploymentOptions().scoutUnitIds.length)ok(e.skipScout(e.getDeploymentOptions().scoutUnitIds[0]!));
 ok(e.advancePreBattle());const end=e.getState();assert.equal(end.mission!.setupStep,'BATTLE');assert.equal(end.mission!.attackerPlayerId,'player-2');
 assert.equal(end.activePlayerId,'player-1');assert.equal(end.mission!.objectives.length,5);nextPhase(e);validate(e);
});
test('active action ends when unit leaves battlefield via existing reserves command',()=>{
 const e=configured();nextPhase(e);nextPhase(e);ok(e.startAction('unit-1','TEST_DATA_UPLOAD'));
 ok(e.moveUnitToGenericReserves('unit-1','technical relocation'));
 assert.equal(e.getState().mission!.activeActions[0]!.state,'INTERRUPTED');
 assert.equal(e.getState().mission!.activeActions[0]!.reason,'LEFT_BATTLEFIELD');validate(e);
});
for(const kind of ['pile-in','consolidate'] as const)test(`${kind} movement does not interrupt an otherwise active action`,()=>{
 const e=configured();nextPhase(e);nextPhase(e);ok(e.startAction('unit-1','TEST_DATA_UPLOAD'));
 const before=e.getState(),after=structuredClone(before);after.units[0]!.models[0]!.position.x+=0.1;
 after.events.push({type:'combat-move-completed',kind,unitId:'unit-1',playerId:'player-1',round:after.round,turn:after.turn,sequence:after.events.length+1});
 interruptActionsOnCommit(before,after);assert.equal(after.mission!.activeActions[0]!.state,'ACTIVE');
});
test('attached model OC is summed once and remains correct after component split',()=>{
 const s=field();s.battlefield.terrain={areas:[{id:'test-area',footprint:rectangle(4,25,14,3),featureIds:[],metadata:{}}],features:[]};
 const mission=structuredClone(PROVING_GROUND);mission.battlefield={width:48,height:36};mission.objectives=[{id:'attached-site',type:'TERRAIN_OBJECTIVE',terrainAreaId:'test-area'}];
 const e=new GameEngine(s);ok(e.setupMission(mission,'player-2'));const state=e.getState(),u=state.units.find(u=>u.id==='attached')!;
 const o=state.mission!.objectives[0]!;
 assert.equal(u.models.length,7);assert.equal(calculateLevelOfControl(state,o,'player-1'),7);
 // Destroy five Bodyguard models and let the existing attachment controller split survivors.
 for(const m of u.models.filter(m=>m.componentUnitId==='bodyguard')){m.alive=false;m.woundsRemaining=0;}
 processAttachmentCasualties(state);assert.equal(calculateLevelOfControl(state,o,'player-1'),2);
 assert.equal(state.units.filter(x=>x.playerId==='player-1'&&x.models.some(m=>m.alive&&m.position.y===26)).flatMap(x=>x.models.filter(m=>m.alive)).length>=2,true);
 new GameEngine(state);
});
test('transport contributes its OC; embarked passenger does not, and disembarked passenger does',()=>{
 const s=field();s.battlefield.terrain={areas:[{id:'test-area',footprint:rectangle(4,25,14,3),featureIds:[],metadata:{}}],features:[]};
 const mission=structuredClone(PROVING_GROUND);mission.battlefield={width:48,height:36};mission.objectives=[{id:'transport-site',type:'TERRAIN_OBJECTIVE',terrainAreaId:'test-area'}];
 const u=s.units.find(x=>x.id==='attached')!,transport=s.units.find(x=>x.id==='transport-b')!;
 transport.models[0]!.position={x:17,y:26};
 const e=new GameEngine(s);ok(e.setupMission(mission,'player-2'));const state=e.getState(),o=state.mission!.objectives[0]!;
 const total=calculateLevelOfControl(state,o,'player-1');assert.ok(total>7);
 const passenger=state.units.find(x=>x.id===u.id)!;passenger.location='EMBARKED';passenger.embarked={transportId:transport.id,preBattle:false,embarkedAtTurn:1,embarkedAtPhase:'Movement'};
 assert.equal(calculateLevelOfControl(state,o,'player-1'),total-7);
 passenger.location='BATTLEFIELD';delete passenger.embarked;assert.equal(calculateLevelOfControl(state,o,'player-1'),total);
});
test('tactical card completes and exits hand; retained uncompleted card persists',()=>{
 const d=structuredClone(PROVING_GROUND);d.secondaries=d.secondaries.filter(x=>x.id==='tactical-hold'||x.id==='tactical-two');d.secondaryPolicy.tacticalHandSize=2;
 const s=createProvingGroundMatch();s.units[0]!.models[0]!.position={x:21,y:13};const e=new GameEngine(s);ok(e.setupMission(d,'player-2',{},createSeededRng(5)));
 assert.equal(e.getState().mission!.tactical['player-1']!.hand.length,2);
 for(let i=0;i<5;i++)nextPhase(e);
 const h=e.getState().mission!.tactical['player-1']!;
 assert.ok(h.completed.includes('tactical-hold'));assert.ok(h.hand.includes('tactical-two'));assert.ok(h.retained.includes('tactical-two'));
 assert.equal(e.getState().mission!.ledger.some(x=>x.sourceId==='tactical-hold'),true);validate(e);
});
test('mission final winner can be either player or a draw using ledger only',()=>{
 for(const [p1,p2,expected] of [[5,0,'player-1'],[0,8,'player-2'],[8,8,null]] as const){
  const e=configured();pass(e);if(p1)ok(e.awardMissionPoints('player-1',p1,'OTHER','test-p1'));
  if(p2)ok(e.awardMissionPoints('player-2',p2,'OTHER','test-p2'));
  ok(e.finishBattle());const m=e.getState().mission!;assert.equal(m.matchResult?.winnerPlayerId,expected);
  assert.equal(m.matchResult?.outcome,expected?'WIN':'DRAW');validate(e);
 }
});
test('custom reserve end policy is respected on early finish',()=>{
 const s=createProvingGroundMatch();s.units[0]!.location='STRATEGIC_RESERVES';s.units[0]!.reserve={initial:true,repositioned:false,reason:'fixture',enteredTurn:1,ingressCount:0};
 const e=new GameEngine(s,{reserves:{shouldDestroyAtEnd:()=>false}});ok(e.setupMission(PROVING_GROUND,'player-2'));pass(e);ok(e.finishBattle());
 assert.equal(e.getState().units[0]!.location,'STRATEGIC_RESERVES');validate(e);
});
test('Mission Action points are applied only at completion with serializable provenance',()=>{
 const s=createProvingGroundMatch(),d=structuredClone(PROVING_GROUND);d.actions[1]!.effect={kind:'AWARD_VP',amount:4};
 const e=new GameEngine(s);ok(e.setupMission(d,'player-2'));nextPhase(e);nextPhase(e);ok(e.startAction('unit-1','TEST_DATA_UPLOAD'));
 assert.equal(e.getState().mission!.ledger.length,0);
 for(let i=0;i<3;i++)nextPhase(e);
 const entries=e.getState().mission!.ledger.filter(x=>x.sourceId==='TEST_DATA_UPLOAD');assert.equal(entries.length,1);
 assert.equal(entries[0]!.amount,4);assert.equal(entries[0]!.sourceType,'OTHER');validate(e);
});
test('a Battle-shock event can feed mission scoring without Battle-shock logic in MissionEngine',()=>{
 const state=createProvingGroundMatch(),d=structuredClone(PROVING_GROUND);
 state.units[0]!.state.battleShocked=true;
 d.primary=[{playerId:'player-1',rules:[{id:'test-resilience',timing:'END_OF_PHASE',condition:{kind:'EVENT',name:'BATTLE_SHOCK_APPLIED',ownUnit:true},reward:4}]}];
 const e=new GameEngine(state);ok(e.setupMission(d,'player-2'));
 pass(e);ok(e.advanceCommandStep());ok(e.advanceCommandStep());ok(e.rollBattleShock('unit-1',()=>0));pass(e);
 ok(e.advanceCommandStep());pass(e);ok(e.advanceCommandStep());pass(e);ok(e.advanceCommandStep());pass(e);
 nextPhase(e);assert.equal(e.getState().mission!.ledger.find(x=>x.sourceId==='test-resilience')?.amount,4);validate(e);
});
test('destroying an enemy unit emits one unit event and scores an event-based mission rule',()=>{
 const state=createProvingGroundMatch(),d=structuredClone(PROVING_GROUND);
 d.primary=[{playerId:'player-1',rules:[{id:'eliminate-enemy',timing:'END_OF_PHASE',condition:{kind:'EVENT',name:'UNIT_DESTROYED',ownUnit:false},reward:5}]}];
 const attacker=state.definitions[0]!;
 state.definitions=[{...attacker,weapons:attacker.weapons.map(w=>({...w,strength:12,armourPenetration:-5,damage:{kind:'fixed' as const,value:10}}))},...state.definitions.slice(1)];
 const e=new GameEngine(state);ok(e.setupMission(d,'player-2'));nextPhase(e);nextPhase(e);
 ok(e.beginShooting('unit-1'));ok(e.selectShootingTarget('test-rifle','unit-2'));pass(e);
 ok(e.fireWeapon('test-rifle','unit-2',()=>.99));
 const deaths=e.getState().events.filter(x=>x.type==='flow'&&x.name==='UNIT_DESTROYED');
 assert.equal(deaths.length,1);assert.equal(deaths[0]!.playerId,'player-2');
 ok(e.completeShooting());nextPhase(e);
 assert.equal(e.getState().mission!.ledger.filter(x=>x.sourceId==='eliminate-enemy').reduce((sum,x)=>sum+x.amount,0),5);
 validate(e);
});
test('secure action fails without scoring if the opponent takes the site before completion',()=>{
 const state=createProvingGroundMatch();state.units[0]!.models[0]!.position={x:21,y:13};
 const e=new GameEngine(state);ok(e.setupMission(PROVING_GROUND,'player-2',{'player-1':['fixed-secure']}));
 nextPhase(e);nextPhase(e);ok(e.startAction('unit-1','TEST_SECURE_SITE','site-2'));
 const snapshot=e.getState();snapshot.units[1]!.models[0]!.position={x:21,y:16.9};snapshot.units[1]!.models[1]!.position={x:22.4,y:18.4};
 e.loadMatch(snapshot);for(let i=0;i<3;i++)nextPhase(e);
 assert.equal(e.getState().mission!.activeActions[0]!.state,'FAILED');
 assert.equal(e.getState().mission!.objectives[1]!.securedByPlayerId,null);
 assert.equal(e.getState().mission!.ledger.some(x=>x.sourceId==='fixed-secure'),false);validate(e);
});
test('TITANIC exemption permits shooting during an action while charging remains forbidden',()=>{
 const state=createProvingGroundMatch();state.definitions=[{...state.definitions[0]!,keywords:['TITANIC']},...state.definitions.slice(1)];
 const e=configured(state);nextPhase(e);nextPhase(e);ok(e.startAction('unit-1','TEST_DATA_UPLOAD'));
 ok(e.beginShooting('unit-1'));ok(e.cancelShooting());nextPhase(e);
 assert.equal(e.declareCharge('unit-1',()=>.5).ok,false);validate(e);
});
test('mission snapshot validation rejects invalid ownership, duplicate deck card and false result',()=>{
 const e=configured(),original=e.getState();
 const corrupt=(modify:(s:GameState)=>void)=>{const s=structuredClone(original);modify(s);assert.throws(()=>new GameEngine(s),/Invalid mission snapshot/);};
 corrupt(s=>{s.mission!.objectives[0]!.controllingPlayerId='ghost';});
 corrupt(s=>{const h=s.mission!.tactical['player-1']!;h.deck.push(h.hand[0]!);});
 corrupt(s=>{s.mission!.matchResult={scores:[],winnerPlayerId:null,outcome:'DRAW',endReason:'invalid',completedBattleRounds:0};});
 validate(e);
});
test('invalid Tactical RNG does not commit a partial deck',()=>{
 const e=configured(),before=e.getState();
 assert.equal(e.shuffleTactical('player-1',()=>0).ok,false);assert.deepEqual(e.getState(),before);
 const x=new GameEngine(createProvingGroundMatch());ok(x.setupMission(PROVING_GROUND,'player-2'));const unchanged=x.getState();
 assert.throws(()=>x.shuffleTactical('player-1',()=>Number.NaN));assert.deepEqual(x.getState(),unchanged);
});
