import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../src/game/engine/GameEngine';
import { field, ok } from './transports.helpers';
import { processAttachmentCasualties } from '../src/game/attachments/AttachmentController';
import { PROVING_GROUND } from '../src/game/missions/provingGround';
import { AiTurnRunner } from '../src/game/ai/AiTurnRunner';
import { PlaySession } from '../src/game/session/PlaySession';
import { createCloseCombatTestMatch } from '../src/game/data/closeCombatPrototype';
import { getLegalActions } from '../src/game/actions/LegalActions';
import { rectangle } from '../src/game/terrain/geometry';
import { pass } from './flow.helpers';

for(const kind of ['mission history','model effect'] as const) test(`Task 012 split snapshot preserves ${kind}`,()=>{
  const state=field();state.battlefield.terrain={areas:[{id:'test-area',footprint:rectangle(4,25,14,3),featureIds:[],metadata:{}}],features:[]};
  const mission=structuredClone(PROVING_GROUND);mission.battlefield={width:48,height:36};mission.objectives=[{id:'test-site',type:'TERRAIN_OBJECTIVE',terrainAreaId:'test-area'}];
  const e=new GameEngine(state);ok(e.setupMission(mission,'player-2'));
  const s=e.getState(),u=s.units.find(u=>u.id==='attached')!;
  if(kind==='mission history') {
    const action=s.mission!.definition.actions[0]!;
    s.mission!.activeActions.push({actionId:action.id,unitId:u.id,playerId:u.playerId,startedAt:{round:s.round,turn:s.turn,phase:s.phase},completesAt:action.completes,state:'COMPLETED',source:'checkpoint'});
  } else s.flow!.effects.push({id:`effect-${s.flow!.nextEffectId++}`,source:'checkpoint',target:{unitId:u.id,modelId:u.models[0]!.id},payload:{kind:'MODIFIER',characteristic:'SAVE',value:-1},createdAt:{round:s.round,turn:s.turn,phaseIndex:s.flow!.phaseIndex,playerId:u.playerId,phase:s.phase},expiry:'END_OF_CURRENT_PHASE',expiryPlayerId:u.playerId,stacking:'STACK',active:false});
  u.models.filter(m=>m.componentUnitId==='bodyguard').forEach(m=>{m.alive=false;m.woundsRemaining=0;});
  processAttachmentCasualties(s);
  assert.equal(s.units.some(u=>u.id==='attached'),false);
  assert.deepEqual(new GameEngine(JSON.parse(JSON.stringify(s))).getState(),s);
});
test('Task 012 charge suggestions do not require Battle Focus tokens',()=>{
  const s=createCloseCombatTestMatch();s.phase='Charge';s.units.forEach(u=>u.location='BATTLEFIELD');
  const e=new GameEngine(s);ok(e.enableMatchFlow());pass(e);
  assert.ok(getLegalActions(e,s.activePlayerId).some(a=>a.kind==='DECLARE_CHARGE'));
});
for(const human of ['AELDARI','EMPERORS_CHILDREN'] as const)test(`Task 012 ${human} reaction ownership interrupts the other controller`,()=>{
  const s=field();s.players[0].factionId='AELDARI';s.players[1].factionId='EMPERORS_CHILDREN';s.armies.forEach(a=>a.factionId=s.players.find(p=>p.id===a.playerId)!.factionId);s.definitions=s.definitions.map(d=>({...d,factionId:d.factionId==='aeldari'?'AELDARI':'EMPERORS_CHILDREN'}));
  const e=new GameEngine(s);ok(e.enableMatchFlow());
  const session=new PlaySession(13,human,e.getState());
  const humanFirst=session.status==='HUMAN_DECISION';
  if(humanFirst) {assert.equal(session.advanceAi(1).trace.length,0);ok(session.submit({kind:'PASS_WINDOW',playerId:session.humanPlayerId}));assert.equal(session.status,'AI_DECISION');session.advanceAi(1);}
  else {session.advanceAi(1);assert.equal(session.status,'HUMAN_DECISION');assert.equal(session.advanceAi(1).trace.length,0);}
});

test('Task 012 combat suggestions exclude zero-distance moves',()=>{
  const s=createCloseCombatTestMatch();s.phase='Charge';s.units.forEach(u=>u.location='BATTLEFIELD');
  const e=new GameEngine(s);ok(e.enableMatchFlow());pass(e);
  ok(e.declareCharge('unit-1',()=>.99));pass(e);ok(e.selectChargeTargets(['unit-2']));
  const state=e.getState();
  for(const action of getLegalActions(e,'player-1')) if(action.kind==='COMBAT_MOVE_MODEL') {
    const model=state.units.flatMap(u=>u.models).find(m=>m.id===action.modelId)!;
    assert.ok(Math.hypot(action.target.x-model.position.x,action.target.y-model.position.y)>0.01);
  }
});

test('Task 012 independent Pile In skips count as progress',()=>{
  const s=field();s.phase='Fight';s.spatialRules.engagementDistance=2;
  const friendly=s.units.filter(u=>u.playerId==='player-1');
  friendly.forEach((u,i)=>u.models.forEach((m,j)=>m.position={x:5+i*10+j*1.5,y:10}));
  const enemy=s.units.find(u=>u.playerId==='player-2')!;
  enemy.models.forEach((m,i)=>m.position={x:[5,15,25,28,31][i]!,y:12.2});
  const e=new GameEngine(s);ok(e.enableMatchFlow());pass(e);ok(e.startFightPhase());ok(e.advanceFightStep());
  const runner=new AiTurnRunner(e,2);
  for(let i=0;i<4;i++)assert.equal(runner.step().chosen?.kind,'SKIP_TACTICAL_MOVE');
  assert.equal(e.getState().closeCombat!.fight!.pileInDone.length,4);
});
