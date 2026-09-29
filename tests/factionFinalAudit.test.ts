import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../src/game/engine/GameEngine';
import { createTestMatch } from '../src/game/data/prototype';
import { createCloseCombatTestMatch } from '../src/game/data/closeCombatPrototype';
import { createProvingGroundMatch, PROVING_GROUND } from '../src/game/missions/provingGround';
import { FACTION_STRATAGEMS } from '../src/game/content/factionStratagems';
import { createUnit } from '../src/game/engine/createUnit';
import { field } from './transports.helpers';
import { canDeclareCharge } from '../src/game/rules/closeCombat';
import { engine, ok, pass } from './flow.helpers';

function shield(onObjective=true) {
  const s=createProvingGroundMatch();s.phase='Shooting';s.stratagemDefinitions=[...FACTION_STRATAGEMS];
  s.players[1]!.factionId='AELDARI';s.armies[1]!.factionId='AELDARI';s.players[1]!.commandPoints=2;
  s.definitions=s.definitions.map((d,i)=>i===1?{...d,factionId:'AELDARI',keywords:['INFANTRY','AELDARI','GUARDIANS']}:d);
  s.definitions=s.definitions.map((d,i)=>i===0?{...d,weapons:d.weapons.map(w=>({...w,attacks:{kind:'fixed' as const,value:1}}))}:d);
  s.units[0]!.models.forEach((m,i)=>m.position={x:25+i*1.5,y:4});
  s.units[1]!.models.forEach((m,i)=>m.position={x:25+i*1.5,y:10});
  const mission=structuredClone(PROVING_GROUND);
  mission.objectives=[{id:'site',type:'MARKER_OBJECTIVE',position:{x:onObjective?25:5,y:10},markerRange:3}];
  const e=new GameEngine(s);ok(e.setupMission(mission,'player-1'));pass(e);
  ok(e.beginShooting('unit-1'));ok(e.selectShootingTarget('test-rifle','unit-2'));
  return e;
}
test('Shield Nodes requires an objective and modifies the real Wound roll, not the weapon',()=>{
  const e=shield(),base=e.getState().definitions[0]!.weapons;
  assert.equal(e.getState().flow?.window?.trigger,'AFTER_TARGET_SELECTED');
  ok(e.useStratagem('SHIELD_NODES','player-2',['unit-2']));
  assert.equal(e.getState().players[1]!.commandPoints,1);
  assert.deepEqual(new GameEngine(e.getState()).getState(),e.getState());
  pass(e);const attack=ok(e.fireWeapon('test-rifle','unit-2',()=>.5));
  assert.ok(attack.hits>0);assert.equal(attack.wounds,0);
  assert.ok(attack.attackRecords?.some(r=>r.modifiers.some(m=>m.source==='SHIELD_NODES')));
  assert.deepEqual(e.getState().definitions[0]!.weapons,base);
  const off=shield(false),before=off.getState();
  assert.equal(off.useStratagem('SHIELD_NODES','player-2',['unit-2']).ok,false);
  assert.deepEqual(off.getState(),before);
  pass(off);assert.ok(ok(off.fireWeapon('test-rifle','unit-2',()=>.5)).wounds>0);
});
function parry() {
  const s=createCloseCombatTestMatch();s.phase='Fight';s.stratagemDefinitions=[...FACTION_STRATAGEMS];
  s.players[1]!.commandPoints=2;s.definitions=s.definitions.map((d,i)=>i===1?{...d,keywords:['INFANTRY','EMPERORS_CHILDREN']}:d);
  s.units[0]!.models.forEach(m=>m.position.y=8.5);
  const e=engine(s);pass(e);ok(e.startFightPhase());ok(e.advanceFightStep());
  ok(e.skipTacticalMove('unit-1'));ok(e.skipTacticalMove('unit-2'));ok(e.advanceFightStep());
  ok(e.selectFightUnit('unit-1'));ok(e.selectMeleeTarget('test-sword','unit-2'));
  return e;
}
test('Deft Parry after melee target selection spends CP and penalizes actual Hit rolls',()=>{
  const e=parry(),weapons=e.getState().definitions[0]!.weapons;
  assert.equal(e.getState().flow?.window?.trigger,'AFTER_TARGET_SELECTED');
  ok(e.useStratagem('DEFT_PARRY','player-2',['unit-2']));
  assert.equal(e.getState().players[1]!.commandPoints,1);
  assert.deepEqual(new GameEngine(e.getState()).getState(),e.getState());
  pass(e);const attack=ok(e.meleeAttack('test-sword','unit-2',()=>.34));
  assert.equal(attack.hits,0);
  assert.deepEqual(e.getState().definitions[0]!.weapons,weapons);
  const other=parry();pass(other);
  assert.ok(ok(other.meleeAttack('test-sword','unit-2',()=>.34)).hits>0);
});
function spectacle(valid=true) {
  const s=createTestMatch();s.phase='Command';s.turn=2;s.activePlayerId='player-2';s.stratagemDefinitions=[...FACTION_STRATAGEMS];
  s.players[0]!.commandPoints=2;s.definitions=s.definitions.map((d,i)=>i===0?{...d,keywords:['INFANTRY','EMPERORS_CHILDREN']}:d);
  s.units[0]!.models.forEach((m,i)=>m.position={x:5+i*1.5,y:5});
  s.units[1]!.models.forEach((m,i)=>m.position={x:5+i*1.5,y:8});
  const outside=createUnit(s.definitions[1]!,'outside','player-2',[{x:25,y:17},{x:26.5,y:17},{x:28,y:17}]);
  s.units.push(outside);s.armies[1]!.unitIds.push('outside');
  const weaker=createUnit(s.definitions[1]!,'weaker','player-2',[{x:5,y:11},{x:6.5,y:11},{x:8,y:11}]);
  weaker.models.slice(1).forEach(m=>{m.alive=false;m.woundsRemaining=0;});
  s.units.push(weaker);s.armies[1]!.unitIds.push('weaker');
  if(valid)s.events=[{type:'combat-move-completed',kind:'charge',unitId:'unit-1',playerId:'player-1',sequence:1,turn:1,round:1},
    {type:'flow',name:'PHASE_STARTED',unitId:'',playerId:'player-1',detail:{phase:'Fight'},sequence:2,turn:1,round:1},
    {type:'flow',name:'UNIT_DESTROYED',unitId:'unit-2',playerId:'player-2',detail:{attackerUnitId:'unit-1'},sequence:3,turn:1,round:1}];
  const e=engine(s);return e;
}
test('Terrifying Spectacle tests nearby enemies, applies Half-strength penalty and suppresses later tests',()=>{
  const e=spectacle();while(e.getState().flow?.window?.trigger!=='AT_START_OF_COMMAND_PHASE')for(const p of e.getState().players)ok(e.passTimingWindow(p.id));
  assert.equal(e.getState().flow?.window?.trigger,'AT_START_OF_COMMAND_PHASE');
  const sequence=[.35,.35,.35,.35];let n=0;
  ok(e.useStratagem('TERRIFYING_SPECTACLE','player-1',['unit-1'],()=>sequence[n++]!));
  const state=e.getState();assert.equal(state.players[0]!.commandPoints,1);
  const results=state.events.filter(x=>x.type==='flow'&&x.name==='BATTLE_SHOCK_ROLL_RESOLVED');
  assert.deepEqual(results.map(x=>x.unitId).sort(),['unit-2','weaker']);
  assert.deepEqual(results.map(x=>x.type==='flow'&&x.detail.penalty).sort(),[0,1]);
  assert.equal(state.units.find(u=>u.id==='unit-2')?.state.battleShocked,false);
  assert.equal(state.units.find(u=>u.id==='weaker')?.state.battleShocked,true);
  assert.notEqual(state.units.find(u=>u.id==='outside')?.state.battleShocked,true);
  assert.deepEqual(state.flow?.battleShockResolvedPhase?.unitIds.sort(),['unit-2','weaker']);
  assert.deepEqual(new GameEngine(state).getState(),state);
  pass(e);ok(e.advanceCommandStep());pass(e);ok(e.advanceCommandStep());
  assert.equal(e.getState().flow?.commandStep,'BATTLE_SHOCK');
  assert.equal(e.getState().flow?.pending.some(p=>p.unitId==='weaker'),false);
  assert.equal(e.rollBattleShock('weaker',()=>{throw Error('no second roll');}).ok,false);
  const illegal=spectacle(false);while(illegal.getState().flow?.window?.trigger!=='AT_START_OF_COMMAND_PHASE')for(const p of illegal.getState().players)ok(illegal.passTimingWindow(p.id));const before=illegal.getState();
  assert.equal(illegal.useStratagem('TERRIFYING_SPECTACLE','player-1',['unit-1'],()=>.99).ok,false);
  assert.deepEqual(illegal.getState(),before);
});

test('debug faction choices return only current state IDs and do not mutate the match',()=>{
  const s=createTestMatch(),e=engine(s);const original=e.getState();
  const choices=e.getFactionDebugOptions();
  assert.deepEqual(choices,{euphoric:[],exquisite:false,patrons:null,crescendo:[],doomSiren:[]});
  assert.deepEqual(e.getState(),original);

});

test('catalogue audit enumerates twelve executable faction timings, targets and expiry',()=>{
  const ids=['WARDING_SALVOES','SHIELD_NODES','VAULS_VENGEANCE','TIME_TO_STRIKE','BLADES_OF_ASURYAN','COST_OF_VICTORY',
    'DEFT_PARRY','DEATH_ECSTASY','INCESSANT_VIOLENCE','CRUEL_BLADESMAN','TERRIFYING_SPECTACLE','CUT_DOWN_THE_WEAK'];
  assert.deepEqual(FACTION_STRATAGEMS.map(d=>d.id),ids);
  assert.deepEqual(FACTION_STRATAGEMS.map(d=>d.cpCost),[1,1,1,1,1,1,1,2,1,1,1,2]);
  for(const d of FACTION_STRATAGEMS) {
    assert.ok(d.timing.phases.length && d.timing.triggers.length && d.timing.ownership);
    assert.equal(d.target.count,1);
    assert.equal(d.target.relation,'FRIENDLY');
    assert.ok(d.resolverId);
    if(d.effect) assert.ok(['END_OF_CURRENT_PHASE','END_OF_CURRENT_TURN'].includes(d.effect.expiry));
  }
  assert.equal(FACTION_STRATAGEMS.find(d=>d.id==='VAULS_VENGEANCE')?.usageLimits?.perBattleRound,1);
  assert.equal(FACTION_STRATAGEMS.find(d=>d.id==='COST_OF_VICTORY')?.timing.ownership,'OPPONENT_TURN');
  assert.deepEqual(FACTION_STRATAGEMS.find(d=>d.id==='DEATH_ECSTASY')?.timing.triggers,['AFTER_TARGET_SELECTED']);
});

test('Warding Salvoes rerolls failed Wounds against an objective target through attack resolution',()=>{
  const s=createProvingGroundMatch();s.phase='Shooting';s.stratagemDefinitions=[...FACTION_STRATAGEMS];s.players[0]!.commandPoints=2;
  s.definitions=s.definitions.map((d,i)=>i===0?{...d,keywords:['INFANTRY','AELDARI','GUARDIANS'],weapons:d.weapons.map(w=>({...w,attacks:{kind:'fixed' as const,value:1}}))}:d);
  s.units[0]!.models.forEach((m,i)=>m.position={x:25+i*1.5,y:4});
  s.units[1]!.models.forEach((m,i)=>m.position={x:25+i*1.5,y:10});
  const mission=structuredClone(PROVING_GROUND);mission.objectives=[{id:'site',type:'MARKER_OBJECTIVE',position:{x:25,y:10},markerRange:3}];
  const e=new GameEngine(s);ok(e.setupMission(mission,'player-1'));
  while(e.getState().flow?.window?.trigger!=='START_OF_PHASE')for(const p of e.getState().players)ok(e.passTimingWindow(p.id));
  ok(e.useStratagem('WARDING_SALVOES','player-1',['unit-1']));pass(e);
  const rolls=[.7,.2,.9,.1],r=ok(e.beginShooting('unit-1'));void r;
  ok(e.selectShootingTarget('test-rifle','unit-2'));pass(e);
  let index=0;const attack=ok(e.fireWeapon('test-rifle','unit-2',()=>rolls[index++]??.9));
  assert.equal(attack.woundRolls[0],6);
  assert.ok(attack.wounds>0);
  assert.equal(index>=3,true);
});

test('Time to Strike keeps Advance shooting and charge eligibility through the turn',()=>{
  const s=createTestMatch();s.phase='Movement';s.stratagemDefinitions=[...FACTION_STRATAGEMS];s.players[0]!.commandPoints=2;
  s.definitions=s.definitions.map((d,i)=>i===0?{...d,keywords:['INFANTRY','AELDARI','GUARDIANS','STORM_GUARDIANS']}:d);
  const e=engine(s);while(e.getState().flow?.window?.trigger!=='START_OF_PHASE')for(const p of e.getState().players)ok(e.passTimingWindow(p.id));ok(e.useStratagem('TIME_TO_STRIKE','player-1',['unit-1']));pass(e);
  ok(e.beginMovement('unit-1','ADVANCE_MOVE'));assert.equal(e.getState().movement?.bonus,6);ok(e.completeMovement());
  assert.equal(e.getState().units[0]!.state.hasAdvanced,true);
  assert.equal(e.getState().players[0]!.commandPoints,1);
  assert.equal(e.getState().flow?.effects.some(effect=>effect.source==='TIME_TO_STRIKE'&&effect.expiry==='END_OF_CURRENT_TURN'&&effect.active),true);
  const charge=structuredClone(e.getState());charge.phase='Charge';
  assert.equal(canDeclareCharge(charge,'unit-1').ok,true);
  ok(e.tryNextPhase());pass(e);ok(e.tryNextPhase());pass(e);
  assert.equal(e.getState().phase,'Shooting');
  ok(e.beginShooting('unit-1'));
});

test('Death Ecstasy spends two CP at melee selection and resolves casualties after the attacker finishes',()=>{
  const e=parry();e.getState();
  ok(e.useStratagem('DEATH_ECSTASY','player-2',['unit-2']));
  assert.equal(e.getState().players[1]!.commandPoints,0);
  pass(e);let i=0;const dice=()=>[.99,.99,0][i++%3]!;
  ok(e.meleeAttack('test-sword','unit-2',dice));
  assert.ok(e.getState().fightOnDeath?.[0]?.modelIds.length);
  assert.equal(e.resolveFightOnDeath('unit-2','test-blade',()=>.99).ok,false);
  ok(e.completeFightUnit());pass(e);
  ok(e.resolveFightOnDeath('unit-2','test-blade',()=>.99));
  assert.equal(e.getState().fightOnDeath?.length,0);
  assert.deepEqual(new GameEngine(e.getState()).getState(),e.getState());
});

test('Cost of Victory restores only Guardian models inside an Attached unit',()=>{
  const s=field();s.phase='Fight';s.turn=2;s.activePlayerId='player-2';s.stratagemDefinitions=[...FACTION_STRATAGEMS];
  s.players[0]!.commandPoints=2;
  s.definitions=s.definitions.map(d=>['test-bodyguard','attached-definition:attached'].includes(d.id)?{...d,keywords:[...d.keywords,'AELDARI','GUARDIANS']}:d);
  const unit=s.units.find(u=>u.id==='attached')!;
  const body=unit.models.find(m=>m.componentUnitId==='bodyguard')!;
  const leader=unit.models.find(m=>m.componentUnitId==='leader')!;
  for(const model of [body,leader]){model.alive=false;model.woundsRemaining=0;}
  const e=engine(s);pass(e);ok(e.tryNextPhase());
  assert.equal(e.getState().flow?.window?.trigger,'END_OF_PHASE');
  ok(e.useStratagem('COST_OF_VICTORY','player-1',['attached']));
  const restored=e.getState().units.find(u=>u.id==='attached')!;
  assert.equal(restored.location,'STRATEGIC_RESERVES');
  assert.equal(restored.models.find(m=>m.id===body.id)?.alive,true);
  assert.equal(restored.models.find(m=>m.id===leader.id)?.alive,false);
});

test('Blades of Asuryan grants Pistol to a ranged weapon while engaged without changing its profile',()=>{
  const s=createTestMatch();s.phase='Shooting';s.stratagemDefinitions=[...FACTION_STRATAGEMS];s.players[0]!.commandPoints=2;
  s.definitions=s.definitions.map((d,i)=>i===0?{...d,keywords:['INFANTRY','AELDARI','DIRE_AVENGERS']}:d);
  s.units[1]!.models.forEach((m,i)=>m.position={x:4.5+i*1.5,y:6.5});
  const e=engine(s);
  while(e.getState().flow?.window?.trigger!=='START_OF_PHASE')for(const p of e.getState().players)ok(e.passTimingWindow(p.id));
  ok(e.useStratagem('BLADES_OF_ASURYAN','player-1',['unit-1']));pass(e);
  const weapon=e.getState().definitions[0]!.weapons[0]!;
  ok(e.beginShooting('unit-1'));ok(e.selectShootingTarget('test-rifle','unit-2'));pass(e);
  const result=ok(e.fireWeapon('test-rifle','unit-2',()=>.99));
  assert.ok(result.attackRecords?.length);
  assert.deepEqual(e.getState().definitions[0]!.weapons[0],weapon);
  assert.equal(e.getState().flow?.effects.find(x=>x.source==='BLADES_OF_ASURYAN')?.expiry,'END_OF_CURRENT_PHASE');
});

test('Cruel Bladesman improves melee AP in the shared Save pipeline only for a charging unit',()=>{
  function attempt(stratagem:boolean) {
    const s=createCloseCombatTestMatch();s.phase='Fight';s.units[0]!.models.forEach(m=>m.position.y=8.5);
    s.units[0]!.state.hasCharged=true;s.players[0]!.commandPoints=2;
    s.stratagemDefinitions=[...FACTION_STRATAGEMS];
    s.definitions=s.definitions.map((d,i)=>i===0?{...d,keywords:['INFANTRY','EMPERORS_CHILDREN']}:d);
    const e=engine(s);
    while(e.getState().flow?.window?.trigger!=='START_OF_PHASE')for(const p of e.getState().players)ok(e.passTimingWindow(p.id));
    if(stratagem)ok(e.useStratagem('CRUEL_BLADESMAN','player-1',['unit-1']));pass(e);
    ok(e.startFightPhase());ok(e.advanceFightStep());ok(e.skipTacticalMove('unit-1'));ok(e.skipTacticalMove('unit-2'));ok(e.advanceFightStep());
    ok(e.selectFightUnit('unit-1'));const weapon=e.getState().definitions[0]!.weapons.find(w=>w.id==='test-sword')!;
    const rolls=[.99,.99,.5];let n=0;
    const result=ok(e.meleeAttack('test-sword','unit-2',()=>rolls[n++%3]!));
    assert.deepEqual(e.getState().definitions[0]!.weapons.find(w=>w.id==='test-sword'),weapon);
    return result;
  }
  assert.equal(attempt(false).savesFailed,0);
  assert.ok(attempt(true).savesFailed>0);
});

test('post-shot debug choices list only living Infantry targets actually hit by this shooter',()=>{
  const s=createTestMatch();s.phase='Shooting';
  s.definitions=s.definitions.map((d,i)=>i===0?{...d,abilities:[{id:'TERRIFYING_CRESCENDO',name:'Crescendo',parameters:{}},{id:'DOOM_SIREN',name:'Doom Siren',parameters:{}}]}:d);
  const e=engine(s);pass(e);ok(e.beginShooting('unit-1'));ok(e.selectShootingTarget('test-rifle','unit-2'));pass(e);
  ok(e.fireWeapon('test-rifle','unit-2',()=>.99));ok(e.completeShooting());
  const choices=e.getFactionDebugOptions();
  assert.deepEqual(choices.crescendo,[{unitId:'unit-1',targetId:'unit-2'}]);
  assert.deepEqual(choices.doomSiren,[{unitId:'unit-1',targetId:'unit-2'}]);
  for(const pair of [...choices.crescendo,...choices.doomSiren]) {
    assert.ok(e.getState().units.some(u=>u.id===pair.unitId));
    assert.ok(e.getState().units.some(u=>u.id===pair.targetId));
  }
});
