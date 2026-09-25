import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../src/game/engine/GameEngine';
import { createProvingGroundMatch, PROVING_GROUND } from '../src/game/missions/provingGround';
import { instantiateMission, awardVictoryPoints, scoreBreakdown, synchronizeMission, shuffleTactical, drawTactical } from '../src/game/missions/MissionEngine';
import { calculateLevelOfControl, resolveObjectiveControl, secureObjective } from '../src/game/missions/objectives';
import { canStartMissionAction } from '../src/game/missions/actions';
import { modelDefinition } from '../src/game/attachments/queries';
import { command, nextPhase, ok, pass } from './flow.helpers';
import { createSeededRng } from '../src/game/utils/dice';
import type { GameState } from '../src/game/models';
function game() { const e = new GameEngine(createProvingGroundMatch()); ok(e.setupMission(PROVING_GROUND, 'player-2', { 'player-1': ['fixed-upload'], 'player-2': ['fixed-secure'] }, createSeededRng(9))); return e; }
function atShooting(e = game()) { nextPhase(e); nextPhase(e); return e; }
function inArea() { const s = createProvingGroundMatch(); s.units[0]!.models[0]!.position = { x: 21, y: 13 }; s.units[1]!.models[0]!.position = { x: 29, y: 19 }; return s; }
function missionState(s: GameState) { const e = new GameEngine(s); ok(e.setupMission(PROVING_GROUND, 'player-2')); return e.getState(); }
function snapshot(e: GameEngine) { return new GameEngine(JSON.parse(JSON.stringify(e.getState()))); }
function reject(e: GameEngine, action: () => { ok: boolean }, reason?: string) { const before = e.getState(), result = action(); assert.equal(result.ok, false); if (reason) assert.equal((result as {reason?:string}).reason, reason); assert.deepEqual(e.getState(), before); }

test('mission setup keeps attacker independent of first player, five terrain areas and detached snapshots', () => {
  const e = game(), s = e.getState(); assert.equal(s.activePlayerId, 'player-1'); assert.equal(s.mission!.attackerPlayerId, 'player-2'); assert.equal(s.mission!.objectives.length, 5);
  assert.equal(s.mission!.objectives.every(o => o.controllingPlayerId === null), true);
  assert.equal(s.mission!.definition.maximumBattleRounds, 5); assert.deepEqual(snapshot(e).getState(), s);
  s.mission!.objectives[0]!.controllingPlayerId = 'player-1'; assert.equal(e.getState().mission!.objectives[0]!.controllingPlayerId, null);
});
test('terrain objective membership uses existing base geometry and sums models, even at an edge', () => {
  const s = missionState(inArea()), o = s.mission!.objectives[1]!;
  assert.equal(calculateLevelOfControl(s, o, 'player-1'), 1);
  s.units[0]!.models[1]!.position = { x: 20, y: 12.5 }; assert.equal(calculateLevelOfControl(s, o, 'player-1'), 2);
  assert.equal(o.type, 'TERRAIN_OBJECTIVE'); assert.equal(o.terrainAreaId, 'light-area');
});
test('Battle-shock, modifiers, destroyed and embarked models change model OC without modifying definitions', () => {
  const s = missionState(inArea()), o = s.mission!.objectives[1]!;
  s.units[0]!.models[1]!.position = { x: 20, y: 12.5 };
  s.flow!.effects.push({ id:'effect-1', source:'test-oc', target:{unitId:'unit-1'}, payload:{kind:'MODIFIER',characteristic:'OC',value:2}, expiry:'END_OF_CURRENT_TURN',stacking:'STACK',active:true,expiryPlayerId:'player-1',createdAt:{round:1,turn:1,phaseIndex:1,playerId:'player-1',phase:'Command'} });
  assert.equal(calculateLevelOfControl(s,o,'player-1'),6); assert.equal(modelDefinition(s,s.units[0]!,s.units[0]!.models[0]!).stats.objectiveControl,1);
  s.units[0]!.models[1]!.alive=false; s.units[0]!.models[1]!.woundsRemaining=0; assert.equal(calculateLevelOfControl(s,o,'player-1'),3);
  s.units[0]!.state.battleShocked=true; assert.equal(calculateLevelOfControl(s,o,'player-1'),0);
  s.units[0]!.state.battleShocked=false; s.units[0]!.location='EMBARKED'; assert.equal(calculateLevelOfControl(s,o,'player-1'),0);
  s.units[0]!.location='BATTLEFIELD'; assert.equal(calculateLevelOfControl(s,o,'player-1'),3);
});
test('ties remove control; securing holds empty/tied objectives and breaks only at phase end', () => {
  const s = missionState(inArea()), o = s.mission!.objectives[1]!;
  resolveObjectiveControl(s,o,true); assert.equal(o.controllingPlayerId,'player-1');
  assert.equal(secureObjective(s,o.id,'player-1','test'),true); s.units[0]!.models[0]!.position={x:25,y:25};
  assert.equal(resolveObjectiveControl(s,o,true),'player-1');
  s.units[1]!.models[0]!.position={x:21,y:13}; assert.equal(resolveObjectiveControl(s,o,false),'player-1');
  assert.equal(resolveObjectiveControl(s,o,true),'player-2'); assert.equal(o.securedByPlayerId,null);
  assert.deepEqual(s.events.filter(x=>x.type==='flow'&&x.name==='OBJECTIVE_LOST').length,1);
  s.units[0]!.models[0]!.position={x:21,y:13}; assert.equal(resolveObjectiveControl(s,o,true),null);
  const changed=s.events.length; resolveObjectiveControl(s,o,true); assert.equal(s.events.length,changed);
});
test('Actions reject off-board, keywords, shock, OC zero, engagement, Advance, Fall Back and repeats', () => {
  const e = atShooting(), s=e.getState(), u=s.units[0]!, foe=s.units[1]!, id='TEST_DATA_UPLOAD';
  assert.equal(canStartMissionAction(s,u.id,id).ok,true);
  for(const [mutate,reason] of [
    [(x:GameState)=>{x.units[0]!.location='EMBARKED'},'NOT_ON_BATTLEFIELD'],
    [(x:GameState)=>{x.definitions=[{...x.definitions[0]!,keywords:['AIRCRAFT']},...x.definitions.slice(1)]},'ACTION_INELIGIBLE'],
    [(x:GameState)=>{x.definitions=[{...x.definitions[0]!,keywords:['FORTIFICATION']},...x.definitions.slice(1)]},'ACTION_INELIGIBLE'],
    [(x:GameState)=>{x.units[0]!.state.battleShocked=true},'ACTION_INELIGIBLE'],
    [(x:GameState)=>{x.definitions=[{...x.definitions[0]!,stats:{...x.definitions[0]!.stats,objectiveControl:0}},...x.definitions.slice(1)]},'ACTION_INELIGIBLE'],
    [(x:GameState)=>{x.units[1]!.models[0]!.position={x:25,y:5.5}},'ACTION_INELIGIBLE'],
    [(x:GameState)=>{x.units[0]!.state.hasAdvanced=true},'ACTION_INELIGIBLE'],
    [(x:GameState)=>{x.units[0]!.state.hasFallenBack=true},'ACTION_INELIGIBLE'],
  ] as const) {const v=structuredClone(s); mutate(v); assert.equal((canStartMissionAction(v,u.id,id) as {reason?:string}).reason,reason);}
  const titan=structuredClone(s); titan.definitions=[{...titan.definitions[0]!,keywords:['TITANIC']},...titan.definitions.slice(1)]; titan.units[1]!.models[0]!.position={x:25,y:5.5}; assert.equal(canStartMissionAction(titan,u.id,id).ok,true);
  assert.equal(foe.playerId,'player-2'); ok(e.startAction(u.id,id)); reject(e,()=>e.startAction(u.id,id),'ACTION_INELIGIBLE');
  reject(e,()=>e.beginShooting(u.id),'UNIT_NOT_ELIGIBLE'); nextPhase(e); reject(e,()=>e.declareCharge(u.id,()=>.5),'CHARGE_INELIGIBLE');
});
test('Actions interrupt after committed movement; staged and cancelled moves preserve the action', () => {
  const mission=structuredClone(PROVING_GROUND); mission.actions[1]!.starts='Movement';
  const e=new GameEngine(createProvingGroundMatch()); ok(e.setupMission(mission,'player-2')); nextPhase(e);
  ok(e.startAction('unit-1','TEST_DATA_UPLOAD'));
  ok(e.beginMovement('unit-1')); ok(e.moveModel('unit-1:model:1',{x:25.4,y:4.5}));
  assert.equal(e.getState().mission!.activeActions[0]!.state,'ACTIVE'); ok(e.cancelMovement());
  assert.equal(e.getState().mission!.activeActions[0]!.state,'ACTIVE');
  ok(e.beginMovement('unit-1')); ok(e.moveModel('unit-1:model:1',{x:25.4,y:4.5})); ok(e.completeMovement());
  assert.equal(e.getState().mission!.activeActions[0]!.state,'INTERRUPTED');
  assert.equal(e.getState().events.filter(x=>x.type==='flow' && x.name==='ACTION_INTERRUPTED').length,1);
  assert.deepEqual(snapshot(e).getState(),e.getState());
});
test('VP ledger clamps per-round, battle and total caps; asymmetry preserves per-player rules', () => {
  const s=game().getState(); assert.equal(awardVictoryPoints(s,'player-1',20,'PRIMARY','technical'),15);
  assert.equal(awardVictoryPoints(s,'player-1',20,'PRIMARY','technical'),0);
  s.round=2;s.turn=3; assert.equal(awardVictoryPoints(s,'player-1',15,'PRIMARY','technical'),15);
  s.round=3;s.turn=5; assert.equal(awardVictoryPoints(s,'player-1',20,'PRIMARY','technical'),15);
  s.round=4;s.turn=7; assert.equal(awardVictoryPoints(s,'player-1',15,'PRIMARY','technical'),0);
  assert.equal(awardVictoryPoints(s,'player-2',20,'SECONDARY','test'),15);
  assert.equal(scoreBreakdown(s,'player-1').primary,45); assert.equal(s.mission!.ledger.length,4);
  assert.equal(s.mission!.ledger[0]!.sourceId,'technical');
});
test('Fisher-Yates tactical order is deterministic across snapshots, and cards are retained or completed', () => {
  const a=game().getState(), b=game().getState(); assert.deepEqual(shuffleTactical(a,'player-1',createSeededRng(17)),shuffleTactical(b,'player-1',createSeededRng(17)));
  assert.deepEqual(a.mission!.tactical['player-1']!.deck,b.mission!.tactical['player-1']!.deck);
  assert.equal(drawTactical(a,'player-1').ok,true); const hand=[...a.mission!.tactical['player-1']!.hand]; synchronizeMission(a);
  assert.deepEqual(a.mission!.tactical['player-1']!.hand,hand);
});
test('failed mission configuration cannot partially mutate engine', () => {
  const e=new GameEngine(createProvingGroundMatch()), old=e.getState(); const bad=structuredClone(PROVING_GROUND);
  bad.objectives[0]!.terrainAreaId='missing'; reject(e,()=>e.setupMission(bad,'player-1'),'INVALID_CONFIGURATION'); assert.deepEqual(e.getState(),old);
});
test('Action completion stamps old turn, secures terrain, awards Fixed VP once, and leaves charging blocked', () => {
  const scenario=inArea(); scenario.units[0]!.models[0]!.position={x:21,y:13};
  const e=new GameEngine(scenario); ok(e.setupMission(PROVING_GROUND,'player-2',{'player-1':['fixed-secure'],'player-2':['fixed-upload']}));
  nextPhase(e); assert.equal(e.getObjectiveControl('site-2')!.owner,'player-1'); nextPhase(e);
  ok(e.startAction('unit-1','TEST_SECURE_SITE','site-2'));
  assert.equal(e.getState().mission!.activeActions[0]!.state,'ACTIVE');
  nextPhase(e); reject(e,()=>e.declareCharge('unit-1',()=>.5),'CHARGE_INELIGIBLE'); nextPhase(e); nextPhase(e);
  const s=e.getState(), action=s.mission!.activeActions[0]!;
  assert.equal(s.turn,2); assert.equal(action.state,'COMPLETED');
  assert.equal(s.mission!.objectives[1]!.securedByPlayerId,'player-1'); assert.equal(s.mission!.objectives[1]!.securedAtTurn,1);
  assert.equal(s.mission!.ledger.find(x=>x.sourceId==='fixed-secure')?.turn,1);
  assert.equal(s.events.filter(x=>x.type==='flow' && x.name==='ACTION_COMPLETED').length,1);
  assert.deepEqual(snapshot(e).getState(),s);
});
test('a mission completes five rounds with automatic result and reserve cleanup', () => {
  const e=game(); for(let i=0;i<50 && e.getState().status==='in-progress';i++) nextPhase(e);
  const s=e.getState(); assert.equal(s.status,'finished'); assert.equal(s.turn,10); assert.equal(s.round,5);
  assert.equal(s.mission!.matchResult?.endReason,'ROUND_LIMIT'); assert.equal(s.mission!.matchResult?.outcome,'DRAW');
  assert.equal(e.tryNextPhase().ok,false); assert.deepEqual(snapshot(e).getState(),s);
});
test('primary scoring is asymmetric and uses only active Command player; caps apply over turns', () => {
  const s=inArea(); const definition=structuredClone(PROVING_GROUND);
  definition.primary=[{playerId:'player-1',rules:[{id:'p1-rule',timing:'END_OF_COMMAND_PHASE',condition:{kind:'CONTROLLED_OBJECTIVES',minimum:1},reward:7}]},
    {playerId:'player-2',rules:[{id:'p2-rule',timing:'END_OF_COMMAND_PHASE',condition:{kind:'CONTROLLED_OBJECTIVES',minimum:1},reward:3}]}];
  const e=new GameEngine(s); ok(e.setupMission(definition,'player-2'));
  nextPhase(e); nextPhase(e); nextPhase(e); nextPhase(e); nextPhase(e);
  command(e); assert.equal(e.getState().mission!.ledger.find(x=>x.sourceId==='p2-rule')?.amount,3);
  assert.equal(e.getState().mission!.ledger.some(x=>x.sourceId==='p1-rule'),false);
});
test('a configured early mission rule ends the match and records a winner without kill-count tiebreaks', () => {
  const d=structuredClone(PROVING_GROUND); d.endConditions=[{kind:'EVENT_COUNT',event:'ACTION_COMPLETED',count:1}];
  const e=new GameEngine(inArea()); ok(e.setupMission(d,'player-2',{'player-1':['fixed-upload']}));
  nextPhase(e); nextPhase(e); ok(e.startAction('unit-1','TEST_DATA_UPLOAD'));
  nextPhase(e); nextPhase(e); nextPhase(e);
  const s=e.getState(); assert.equal(s.status,'finished'); assert.equal(s.mission!.matchResult?.endReason,'MISSION_RULE');
  assert.equal(s.mission!.matchResult?.winnerPlayerId,'player-1'); assert.deepEqual(snapshot(e).getState(),s);
});
