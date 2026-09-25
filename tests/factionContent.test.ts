import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../src/game/engine/GameEngine';
import { createUnit } from '../src/game/engine/createUnit';
import { AELDARI_DATASHEETS, EMPERORS_CHILDREN_DATASHEETS } from '../src/game/content/factionDatasheets';
import { AELDARI_PRESET, EMPERORS_CHILDREN_PRESET, createAeldariVsEmperorsChildrenMatch } from '../src/game/content/presets';
import { VERIFIED_MUSTER_ENTRIES } from '../src/game/content/verifiedEntries';
import { createAttackJob, runAttackJob } from '../src/game/combat/AttackPipeline';
import { createTestMatch } from '../src/game/data/prototype';

test('exactly nineteen sourced datasheets have selectable equipment and matching fixed prices', () => {
  const catalog = [...AELDARI_DATASHEETS,...EMPERORS_CHILDREN_DATASHEETS];
  assert.equal(catalog.length,19);
  assert.deepEqual(catalog.map(d=>d.id),VERIFIED_MUSTER_ENTRIES.map(e=>e.id));
  for (const d of catalog) {
    assert.equal(d.placeholder,false,d.id);
    assert.equal(d.points,VERIFIED_MUSTER_ENTRIES.find(e=>e.id===d.id)!.points);
    assert.ok(d.weapons.length>0,d.id);
    assert.ok(d.abilities.length>0,d.id);
    const u=createUnit(d,d.id,'player-1',Array.from({length:d.modelCount},(_,i)=>({x:i,y:1})));
    assert.equal(u.models.length,d.modelCount);
    assert.ok(u.models.every(m=>m.weaponIds===undefined || m.weaponIds.every(id=>d.weapons.some(w=>w.id===id))));
  }
});
test('mixed squads expose independent weapon, wounds, base and objective control',()=>{
  const storm=AELDARI_DATASHEETS.find(d=>d.id==='storm-guardians')!;
  const u=createUnit(storm,'storm','p',Array.from({length:11},(_,i)=>({x:i,y:0})));
  assert.deepEqual(u.models.filter(m=>m.weaponIds?.includes('guardian-fusion-gun')).length,2);
  assert.deepEqual(u.models.at(-1)?.stats?.objectiveControl,0);
  assert.deepEqual(u.models.at(-1)?.base.diameterMm,40);
  assert.equal(u.models.at(-1)?.woundsRemaining,2);
  const dragons=createUnit(AELDARI_DATASHEETS.find(d=>d.id==='fire-dragons')!,'dragons','p',Array.from({length:5},(_,i)=>({x:i,y:0})));
  assert.equal(dragons.models.at(-1)?.woundsRemaining,2);
  assert.equal(dragons.models.filter(m=>m.weaponIds?.includes('exarch-dragon-fusion-gun')).length,1);
});
test('Bladestorm is resolved from the bearer datasheet at half range without editing weapon data',()=>{
  const s=createTestMatch();
  const d=AELDARI_DATASHEETS.find(d=>d.id==='dire-avengers')!;
  const unit=createUnit(d,'unit-1','player-1',Array.from({length:10},(_,i)=>({x:3+i*1.5,y:3})));
  s.definitions=[d,s.definitions[1]!];s.units[0]=unit;
  const target=s.units[1]!;
  target.models.forEach((m,i)=>m.position={x:3+i*1.5,y:9});
  const w=d.weapons.find(w=>w.id==='avenger-shuriken-catapult')!;
  const close=createAttackJob(w,[unit.models[0]!.id],target,s.definitions.find(x=>x.id===target.definitionId)!,()=>.99,[],s);
  assert.equal(close.contexts[0]!.abilities.some(a=>a.source==='BLADESTORM' && a.type==='SUSTAINED_HITS' && a.value===1),true);
  target.models.forEach(m=>m.position={x:m.position.x,y:15});
  const far=createAttackJob(w,[unit.models[0]!.id],target,s.definitions.find(x=>x.id===target.definitionId)!,()=>.99,[],s);
  assert.equal(far.contexts[0]!.abilities.some(a=>a.source==='BLADESTORM'),false);
  assert.equal(w.weaponAbilities?.some(a=>a.type==='SUSTAINED_HITS'),false);
});
test('Guardian Battlehost objective bonus uses original model keywords on an Attached unit',()=>{
  const s=createAeldariVsEmperorsChildrenMatch(42);
  const guardian=s.units.find(u=>u.id==='storm-council')!,enemy=s.units.find(u=>u.id==='noise-command')!;
  guardian.location='BATTLEFIELD';enemy.location='BATTLEFIELD';
  const body=guardian.models.find(m=>m.sourceDefinitionId==='storm-guardians')!,seer=guardian.models.find(m=>m.sourceDefinitionId==='farseer')!;
  body.position={x:6,y:11};seer.position={x:20,y:3};
  enemy.models.forEach((m,i)=>m.position={x:30+i*1.5,y:30});
  const attachedWeapons=s.definitions.find(d=>d.id===guardian.definitionId)!.weapons;
  const weapon=attachedWeapons.find(w=>w.id==='storm-guardians:shuriken-pistol')!;
  const targetDefinition=s.definitions.find(d=>d.id===enemy.definitionId)!;
  const bodyJob=createAttackJob(weapon,[body.id],enemy,targetDefinition,()=>0,[],s);
  runAttackJob(bodyJob,()=>0,s);
  assert.equal(bodyJob.resolution.attackRecords?.[0]?.modifiers.some(m=>m.source==='DEFEND_AT_ALL_COSTS'),true);
  const seerWeapon=attachedWeapons.find(w=>w.id==='farseer:shuriken-pistol')!;
  const seerJob=createAttackJob(seerWeapon,[seer.id],enemy,targetDefinition,()=>0,[],s);
  runAttackJob(seerJob,()=>0,s);
  assert.equal(seerJob.resolution.attackRecords?.[0]?.modifiers.some(m=>m.source==='DEFEND_AT_ALL_COSTS'),false);
});
test('Incursion rosters total 990 and 1000 including enhancement',()=>{
  assert.equal(AELDARI_PRESET.units.length,10);
  assert.equal(EMPERORS_CHILDREN_PRESET.units.length,9);
  assert.equal(AELDARI_PRESET.units.find(u=>u.enhancementId)?.id,'farseer');
});
test('seeded match is stable, detached and ready for deployment with attached passengers',()=>{
  const a=createAeldariVsEmperorsChildrenMatch(42),b=createAeldariVsEmperorsChildrenMatch(42);
  assert.deepEqual(a,b);
  assert.equal(a.deployment?.stage,'DECLARE_BATTLE_FORMATIONS');
  assert.equal(a.mission?.definition.id,'PROVING_GROUND');
  assert.equal(a.units.find(u=>u.id==='infractor-command')?.location,'EMBARKED');
  assert.equal(a.units.find(u=>u.id==='flawless-blades')?.embarked?.transportId,'chaos-land-raider');
  assert.equal(a.attachments?.length,5);
  const engine=GameEngine.create(a);
  const snapshot=engine.getState();snapshot.units[0]!.models[0]!.woundsRemaining=0;
  assert.notEqual(engine.getState().units[0]!.models[0]!.woundsRemaining,0);
  engine.loadMatch(JSON.parse(JSON.stringify(a)));
  assert.deepEqual(engine.getState(),a);
});

test('universal Shock and Assault disembark permissions use transport data', async()=>{
  const { embarked, ok }=await import('./transports.helpers');
  const shock=embarked(),rhino=shock.units.find(u=>u.id==='transport-b')!;
  (shock.definitions.find(d=>d.id===rhino.definitionId)!.transport as {afterAdvance?:string}).afterAdvance='SHOCK';
  rhino.state.hasAdvanced=true;
  const a=new GameEngine(shock);
  assert.equal(ok(a.getDisembarkMode('attached')).mode,'SHOCK');
  ok(a.beginDisembark('attached'));
  assert.equal(a.getState().transportState?.disembark?.mode,'SHOCK');
  const assault=embarked(),raider=assault.units.find(u=>u.id==='transport-b')!;
  (assault.definitions.find(d=>d.id===raider.definitionId)!.transport as {afterNormalMove?:string}).afterNormalMove='ASSAULT';
  raider.lastMove={kind:'NORMAL_MOVE',turn:1,phase:'Movement'};
  const b=new GameEngine(assault);
  assert.equal(ok(b.getDisembarkMode('attached')).mode,'ASSAULT');
  ok(b.beginDisembark('attached'));
  assert.equal(b.getState().transportState?.disembark?.mode,'ASSAULT');
});

test('Aspect Shrine substitutes one paused die without changing weapon or consuming another token',async()=>{
  const { createTestMatch }=await import('../src/game/data/prototype');
  const { engine, ok, pass }=await import('./flow.helpers');
  const s=createTestMatch();s.phase='Shooting';
  const d={...s.definitions[0]!,modelCount:5,abilities:[{id:'ASPECT_SHRINE',name:'Aspect Shrine',parameters:{}}]};
  s.definitions=[d,s.definitions[1]!];
  s.units[0]=createUnit(d,'unit-1','player-1',Array.from({length:5},(_,i)=>({x:4+i*1.5,y:4.5})));
  const e=engine(s);pass(e);
  assert.equal(e.getState().units[0]?.resourceCounters?.ASPECT_SHRINE,1);
  ok(e.beginShooting('unit-1'));ok(e.selectShootingTarget('test-rifle','unit-2'));pass(e);
  const before=e.getState().definitions[0]!.weapons[0]!;
  ok(e.fireWeapon('test-rifle','unit-2',()=>.01));
  assert.equal(e.getState().flow?.window?.trigger,'AFTER_HIT_ROLL');
  ok(e.spendAspectShrineToken());
  assert.equal(e.getState().units[0]?.resourceCounters?.ASPECT_SHRINE,0);
  assert.equal(e.getState().attackJob?.current?.hit?.value,6);
  assert.equal(e.spendAspectShrineToken().ok,false);
  assert.deepEqual(new GameEngine(e.getState()).getState(),e.getState());
  assert.deepEqual(e.getState().definitions[0]!.weapons[0],before);
});

test('Battle Focus Incursion tokens gate movement buff and one manoeuvre per unit per phase', async()=>{
  const { createTestMatch }=await import('../src/game/data/prototype');
  const { engine, ok, pass }=await import('./flow.helpers');
  const s=createTestMatch();s.phase='Movement';
  s.factionRuleIds={'player-1':['BATTLE_FOCUS']};
  s.battleFocus={battleSize:'INCURSION',round:0,tokens:{},usedByPhase:{},manoeuvresByPhase:{}};
  const e=engine(s);pass(e);
  assert.equal(e.getState().battleFocus?.tokens['player-1'],2);
  ok(e.useAgileManoeuvre('SWIFT_AS_THE_WIND','unit-1','MOVE','NORMAL_MOVE'));
  assert.equal(e.getState().battleFocus?.tokens['player-1'],1);
  assert.equal(e.useAgileManoeuvre('FLITTING_SHADOWS','unit-1','MOVE').ok,false);
  ok(e.beginMovement('unit-1'));
  const original=e.getState().units[0]!.models[0]!.position;
  ok(e.moveModel('unit-1:model:1',{x:original.x,y:original.y+8}));
  ok(e.cancelMovement());
  assert.deepEqual(e.getState().units[0]!.models[0]!.position,original);
  assert.equal(e.getState().battleFocus?.tokens['player-1'],1);
  assert.deepEqual(new GameEngine(e.getState()).getState(),e.getState());
});

test('Opportunity Seized reaction rolls D6+1 and moves using the same spatial validators',async()=>{
  const {createTestMatch}=await import('../src/game/data/prototype');
  const {engine,ok,pass}=await import('./flow.helpers');
  const s=createTestMatch();s.turn=2;s.activePlayerId='player-2';s.phase='Movement';
  s.factionRuleIds={'player-1':['BATTLE_FOCUS']};
  s.battleFocus={battleSize:'INCURSION',round:0,tokens:{},usedByPhase:{},manoeuvresByPhase:{}};
  s.units[1]!.models.forEach((m,i)=>m.position={x:4.5+i*1.5,y:6.2});
  const e=engine(s);pass(e);
  ok(e.beginMovement('unit-2','FALL_BACK_MOVE',()=>.99));
  for(const m of e.getState().units[1]!.models) ok(e.moveModel(m.id,{x:m.position.x,y:11}));
  ok(e.completeMovement());
  assert.equal(e.getState().flow?.window?.trigger,'AFTER_ENEMY_FALL_BACK');
  ok(e.useAgileManoeuvre('OPPORTUNITY_SEIZED','unit-1','ENEMY_FALL_BACK',undefined,()=>0));
  assert.equal(e.getState().reactionMove?.allowance,2);
  const before=e.getState();
  assert.equal(e.moveReactionModel('unit-1:model:1',{x:-4,y:4}).ok,false);
  assert.deepEqual(e.getState(),before);
  for(const m of e.getState().units[0]!.models) ok(e.moveReactionModel(m.id,{x:m.position.x,y:m.position.y+2}));
  ok(e.completeReactionMove());
  assert.equal(e.getState().reactionMove,null);
  assert.deepEqual(new GameEngine(e.getState()).getState(),e.getState());
});
