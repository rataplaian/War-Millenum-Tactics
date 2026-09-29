import test from 'node:test';
import assert from 'node:assert/strict';
import { field, ok } from './transports.helpers';
import { GameEngine } from '../src/game/engine/GameEngine';
import { pass } from './flow.helpers';
import { modelHasWeapon } from '../src/game/attachments/queries';

function combat(victim: 'bodyguard'|'leader'|'support', lastBodyguard=false, alreadyFought=false) {
  const s=field();s.phase='Fight';s.turn=2;s.activePlayerId='player-2';s.spatialRules.engagementDistance=2;
  const attached=s.units.find(u=>u.id==='attached')!,enemy=s.units.find(u=>u.id==='enemy')!;
  attached.state.hasFought=alreadyFought;
  attached.models.forEach((m,i)=>{m.position={x:10+i*1.5,y:10};if(lastBodyguard&&m.componentUnitId==='bodyguard'&&m.id!=='bodyguard:model:1'){m.alive=false;m.woundsRemaining=0;}});
  enemy.models.forEach((m,i)=>{m.position={x:10+i*1.5,y:11.5};if(i){m.alive=false;m.woundsRemaining=0;}});
  const victimModel=attached.models.find(m=>m.componentUnitId===victim&&m.alive)!;
  enemy.models[0]!.position={x:victimModel.position.x,y:11.5};
  s.units.filter(u=>!['attached','enemy'].includes(u.id)).forEach((u,i)=>u.models.forEach(m=>m.position={x:34+i*6,y:25}));
  s.definitions=s.definitions.map(d=>{
    if(d.id==='test-bodyguard')return {...d,weapons:[...d.weapons,{id:'body-sword',name:'Body sword',kind:'melee' as const,range:null,attacks:{kind:'fixed' as const,value:1},skill:3,strength:4,armourPenetration:0,damage:{kind:'fixed' as const,value:1},traits:[]}]};
    if(d.id==='test-leader'||d.id==='test-support')return {...d,weapons:[...d.weapons,{id:`${d.id}-sword`,name:'Source sword',kind:'melee' as const,range:null,attacks:{kind:'fixed' as const,value:1},skill:3,strength:4,armourPenetration:0,damage:{kind:'fixed' as const,value:1},traits:[]}]};
    if(d.id==='test-enemy')return {...d,weapons:d.weapons.map(w=>w.id==='test-blade'?{...w,attacks:{kind:'fixed' as const,value:1},damage:{kind:'fixed' as const,value:5},armourPenetration:-5}:w)};
    return d;
  });
  // The existing aggregate is created before this test adjusts its source definitions.
  const aggregate=s.definitions.find(d=>d.id==='attached-definition:attached')!;
  s.definitions=s.definitions.map(d=>d.id===aggregate.id?{...d,weapons:s.definitions.filter(x=>['test-bodyguard','test-leader','test-support'].includes(x.id)).flatMap(x=>x.weapons.map(w=>({...w,id:`${x.id==='test-bodyguard'?'bodyguard':x.id==='test-leader'?'leader':'support'}:${w.id}`})))}:d);
  const e=new GameEngine(s);ok(e.enableMatchFlow());pass(e);
  ok(e.addTemporaryEffect({source:'DEATH_ECSTASY',target:{unitId:'attached'},payload:{kind:'FLAG',flag:'FIGHT_ON_DEATH',value:true},expiry:'END_OF_CURRENT_PHASE',stacking:'REPLACE_SAME_SOURCE'}));
  ok(e.startFightPhase());ok(e.advanceFightStep());ok(e.skipTacticalMove('enemy'));ok(e.skipTacticalMove('attached'));ok(e.advanceFightStep());
  ok(e.selectFightUnit('enemy'));
  return {e,victimModelId:victimModel.id};
}

for(const victim of ['bodyguard','leader','support'] as const)test(`Death Ecstasy uses a slain ${victim} model's original weapon`,()=>{
  const {e,victimModelId}=combat(victim,victim==='bodyguard');
  const before=e.getState();assert.equal(e.meleeAttack('test-blade','attached',()=>.99,victim==='bodyguard'?undefined:victimModelId).ok,true);
  const pending=e.getState().fightOnDeath?.[0];assert.ok(pending?.modelIds.includes(victimModelId));
  assert.equal(e.getState().attachments?.[0]?.active,true);
  assert.deepEqual(new GameEngine(e.getState()).getState(),e.getState());
  pass(e);ok(e.completeFightUnit());pass(e);
  const sourceWeapon=victim==='bodyguard'?'bodyguard:body-sword':`${victim}:${victim==='leader'?'test-leader':'test-support'}-sword`;
  const otherWeapon=victim==='bodyguard'?'leader:test-leader-sword':'bodyguard:body-sword';
  const unit=e.getState().units.find(u=>u.id==='attached')!;
  assert.equal(modelHasWeapon(e.getState(),unit,unit.models.find(m=>m.id===victimModelId)!,sourceWeapon),true);
  assert.equal(e.resolveFightOnDeath('attached',otherWeapon,()=>.99).ok,false);
  assert.equal(e.getState().attachments?.[0]?.active,true);
  const result=ok(e.resolveFightOnDeath('attached',sourceWeapon,()=>.99));
  assert.deepEqual(result.eligibleFiringModelIds,[victimModelId]);
  assert.equal(e.getState().fightOnDeath?.length,0);
  if(victim==='bodyguard')assert.equal(e.getState().attachments?.[0]?.active,false,JSON.stringify(e.getState().attachments?.[0]));
  else assert.equal(e.getState().attachments?.[0]?.active,true);
  assert.deepEqual(new GameEngine(e.getState()).getState(),e.getState());
  assert.equal(before.units.find(u=>u.id==='attached')!.models.find(m=>m.id===victimModelId)!.alive,true);
});

test('a model in an Attached unit that already fought does not receive Fight on Death',()=>{
  const {e}=combat('bodyguard',false,true);
  ok(e.meleeAttack('test-blade','attached',()=>.99));
  assert.equal(e.getState().fightOnDeath?.length??0,0);
  assert.deepEqual(new GameEngine(e.getState()).getState(),e.getState());
});
