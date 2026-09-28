import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../src/game/engine/GameEngine';
import { createUnit } from '../src/game/engine/createUnit';
import { AELDARI_DATASHEETS, EMPERORS_CHILDREN_DATASHEETS } from '../src/game/content/factionDatasheets';
import { AELDARI_PRESET, EMPERORS_CHILDREN_PRESET, createAeldariVsEmperorsChildrenMatch } from '../src/game/content/presets';
import { VERIFIED_MUSTER_ENTRIES } from '../src/game/content/verifiedEntries';
import { createAttackJob, runAttackJob } from '../src/game/combat/AttackPipeline';
import { createTestMatch } from '../src/game/data/prototype';
import { factionAttackWeapon } from '../src/game/content/attackAbilities';
import { expireEffects } from '../src/game/effects/EffectEngine';
import { effectiveCharacteristic } from '../src/game/effects/EffectEngine';
import { chargeAllowance } from '../src/game/rules/closeCombat';
import { createFactionContentRegistry, FACTION_CONTENT } from '../src/game/content/registry';
import { validatePresetRoster } from '../src/game/content/validatePresetRoster';
import { shootingModifiers } from '../src/game/terrain/attackModifiers';
import { createVisibilityProvider } from '../src/game/terrain/visibility';
import { serpentShieldSave } from '../src/game/content/defensiveAbilities';
import { secureFactionObjectives } from '../src/game/content/stickyObjectives';
import { CommandController } from '../src/game/command/CommandController';
import { psychicCommunionBonus } from '../src/game/content/psychicCommunion';
import { validAttackChoices } from '../src/game/abilities/validation';
import { abilitiesFor, allHave, scoutDistance } from '../src/game/deployment/abilities';
import { postShotHitTargets } from '../src/game/content/postShooting';
import { resolveBattleShockRoll } from '../src/game/command/BattleShock';

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
test('Farseer storm rolls D3 damage and both Witchblades critically wound Infantry on 2+', () => {
  const farseer=AELDARI_DATASHEETS.find(d=>d.id==='farseer')!;
  const warlock=AELDARI_DATASHEETS.find(d=>d.id==='warlock')!;
  assert.deepEqual(farseer.weapons.find(w=>w.id==='eldritch-storm')?.damage,{kind:'dice',count:1,sides:3,modifier:0});
  for(const d of [farseer,warlock]) assert.deepEqual(d.weapons.find(w=>w.id==='witchblade')?.weaponAbilities?.find(a=>a.type==='ANTI'),
    {id:'witchblade:anti-infantry',type:'ANTI',keyword:'INFANTRY',threshold:2});
  const s=createTestMatch();
  const bearer=createUnit(farseer,'unit-1','player-1',[{x:4,y:4}]);
  s.definitions=[farseer,s.definitions[1]!];s.units[0]=bearer;
  const target=s.units[1]!, weapon=farseer.weapons.find(w=>w.id==='witchblade')!;
  const job=createAttackJob(weapon,[bearer.models[0]!.id],target,s.definitions[1]!,()=>.17,[],s);
  runAttackJob(job,()=>.17,s);
  assert.equal(job.resolution.attackRecords?.[0]?.criticalWound,true);
  assert.deepEqual(weapon,farseer.weapons.find(w=>w.id==='witchblade'));
});
test('Assured Destruction grants optional rerolls only versus Monster or Vehicle without mutating the datasheet', () => {
  const s=createTestMatch(), dragon=AELDARI_DATASHEETS.find(d=>d.id==='fire-dragons')!;
  s.definitions=[dragon,s.definitions[1]!];
  const unit=createUnit(dragon,'unit-1','player-1',Array.from({length:5},(_,i)=>({x:4+i*1.5,y:5})));
  s.units[0]=unit;
  const base=dragon.weapons.find(w=>w.id==='dragon-fusion-gun')!;
  const infantry=factionAttackWeapon(s,unit,base,s.units[1]!);
  assert.equal(infantry,base);
  s.definitions=s.definitions.map((d,i)=>i===1?{...d,keywords:['VEHICLE']}:d);
  const attack=factionAttackWeapon(s,unit,base,s.units[1]!);
  assert.deepEqual(attack.rerollPermissions?.map(p=>p.kind),['HIT','WOUND','DAMAGE']);
  assert.equal(base.rerollPermissions,undefined);
  const target=s.units[1]!;
  const rolls=[0,.8,.8,.8,.8,.8,.8];let index=0;
  const job=createAttackJob(attack,[unit.models[0]!.id],target,s.definitions[1]!,()=>rolls[index++]??.8,[],s,undefined,{rerolls:{HIT:'FAILED'}});
  runAttackJob(job,()=>rolls[index++]??.8,s);
  assert.equal(job.resolution.attackRecords?.[0]?.hit?.wasRerolled,true);
  assert.equal(job.resolution.attackRecords?.[0]?.hit?.rerollSource,'ASSURED_DESTRUCTION');
});
test('an invalid Assured Destruction target rejects the selected reroll before any attack or state change', async () => {
  const {engine,ok,pass}=await import('./flow.helpers');
  const s=createTestMatch(),dragons=AELDARI_DATASHEETS.find(d=>d.id==='fire-dragons')!;
  s.phase='Shooting';s.definitions=[dragons,s.definitions[1]!];
  s.players[0]!.factionId=dragons.factionId;s.armies[0]!.factionId=dragons.factionId;
  s.units[0]=createUnit(dragons,'unit-1','player-1',Array.from({length:5},(_,i)=>({x:4+i*1.5,y:5})));
  s.units[1]!.models.forEach((m,i)=>m.position={x:4+i*1.5,y:11});
  const e=engine(s);pass(e);
  ok(e.beginShooting('unit-1'));
  ok(e.setAttackChoices('dragon-fusion-gun',{rerolls:{HIT:'FAILED'}}));
  const before=e.getState();let called=false;
  const rejected=e.selectShootingTarget('dragon-fusion-gun','unit-2');
  assert.equal(rejected.ok,false);
  assert.equal(called,false);
  assert.deepEqual(e.getState(),before);
  const target=before.definitions.find(d=>d.id===before.units[1]!.definitionId)!;
  before.definitions=before.definitions.map(d=>d.id===target.id?{...d,keywords:['VEHICLE']}:d);
  const eligible=new GameEngine(before);
  pass(eligible);
  ok(eligible.selectShootingTarget('dragon-fusion-gun','unit-2'));pass(eligible);
  ok(eligible.fireWeapon('dragon-fusion-gun','unit-2',()=>{called=true;return .99;}));
  assert.equal(called,true);
});
test('Rangers use their 5+ invulnerable save against ranged attacks only', () => {
  const s=createTestMatch(),rangers=AELDARI_DATASHEETS.find(d=>d.id==='rangers')!;
  s.definitions=[s.definitions[0]!,rangers];
  const target=createUnit(rangers,'unit-2','player-2',Array.from({length:5},(_,i)=>({x:3+i*1.5,y:12})));
  s.units[1]=target;
  const base=s.definitions[0]!.weapons[0]!;
  const ranged={...base,attacks:{kind:'fixed' as const,value:1},strength:10,armourPenetration:-3};
  const shot=createAttackJob(ranged,[s.units[0]!.models[0]!.id],target,rangers,()=>.75,[],s);
  runAttackJob(shot,()=>.75,s);
  assert.equal(shot.resolution.saveResults[0]?.selected,'INVULNERABLE');
  assert.equal(shot.resolution.saveResults[0]?.saved,true);
  const sword={...ranged,kind:'melee' as const,range:null};
  const strike=createAttackJob(sword,[s.units[0]!.models[0]!.id],target,rangers,()=>.75,[],s);
  runAttackJob(strike,()=>.75,s);
  assert.equal(strike.resolution.saveResults[0]?.selected,'ARMOUR');
  assert.equal(strike.resolution.saveResults[0]?.saved,false);
});
test('Emperor’s Children chosen leader weapons preserve D3 damage and the default Lord loadout', () => {
  const sorcerer=EMPERORS_CHILDREN_DATASHEETS.find(d=>d.id==='sorcerer')!;
  for(const id of ['agonising-energies','force-weapon']) assert.deepEqual(sorcerer.weapons.find(w=>w.id===id)?.damage,
    {kind:'dice',count:1,sides:3,modifier:0});
  const exultant=EMPERORS_CHILDREN_DATASHEETS.find(d=>d.id==='lord-exultant')!;
  assert.deepEqual(exultant.weapons.map(w=>w.id),['bolt-pistol','plasma-pistol','phoenix-power-spear','lord-close-combat-weapon']);
  assert.ok(exultant.keywords.includes('SLAANESH'));
});
test('Chaos Land Raider carries two separately targetable lascannons with matching profiles',()=>{
  const d=EMPERORS_CHILDREN_DATASHEETS.find(x=>x.id==='chaos-land-raider')!;
  const guns=d.weapons.filter(w=>w.id.startsWith('soulshatter-lascannon'));
  assert.deepEqual(guns.map(w=>w.id),['soulshatter-lascannon','soulshatter-lascannon-2']);
  assert.equal(guns[0]?.name,guns[1]?.name);
  assert.deepEqual(guns[0]?.attacks,{kind:'fixed',value:2});
  assert.deepEqual(guns[1]?.damage,{kind:'dice',count:1,sides:6,modifier:1});
});
test('attached leaders grant Perfectionists and Obsessive Annunciation only while leading', () => {
  const s=createAeldariVsEmperorsChildrenMatch(4);
  const target=s.units.find(u=>u.id==='storm-council')!,infractors=s.units.find(u=>u.id==='infractor-command')!,noise=s.units.find(u=>u.id==='noise-command')!;
  for(const unit of [target,infractors,noise]) unit.location='BATTLEFIELD';
  target.models.forEach((m,i)=>m.position={x:10+i,y:15});
  infractors.models.forEach((m,i)=>m.position={x:10+i,y:13});
  noise.models.forEach((m,i)=>m.position={x:10+i,y:9});
  const weapon=(u:typeof infractors,id:string)=>s.definitions.find(d=>d.id===u.definitionId)!.weapons.find(w=>w.id===id)!;
  const targetDefinition=s.definitions.find(d=>d.id===target.definitionId)!;
  const melee=weapon(infractors,'infractors:duelling-sabre'),infantry=infractors.models.find(m=>m.sourceDefinitionId==='infractors')!;
  const first=createAttackJob(melee,[infantry.id],target,targetDefinition,()=>.99,[],s);
  assert.equal(first.contexts[0]!.abilities.some(a=>a.type==='LETHAL_HITS'&&a.source==='PERFECTIONISTS'),true);
  runAttackJob(first,()=>.99,s);
  assert.equal(first.resolution.attackRecords?.[0]?.automaticallyWoundedFromCriticalHit,true);
  const sonic=weapon(noise,'noise-marines:sonic-blaster'),marine=noise.models.find(m=>m.sourceDefinitionId==='noise-marines')!;
  const second=createAttackJob(sonic,[marine.id],target,targetDefinition,()=>.99,[],s);
  assert.equal(second.contexts[0]!.abilities.some(a=>a.type==='SUSTAINED_HITS'&&a.source==='OBSESSIVE_ANNUNCIATION'),true);
  runAttackJob(second,()=>.99,s);
  assert.equal(second.resolution.attackRecords?.[0]?.generatedAdditionalHits,1);
  const kakophonist=noise.models.find(m=>m.sourceDefinitionId==='lord-kakophonist')!;
  kakophonist.alive=false;kakophonist.woundsRemaining=0;
  const without=createAttackJob(sonic,[marine.id],target,targetDefinition,()=>.99,[],s);
  assert.equal(without.contexts[0]!.abilities.some(a=>a.source==='OBSESSIVE_ANNUNCIATION'),false);
});
test('Guide selects a visible target only at Movement end and improves allied Aeldari Hit rolls until next Command', async () => {
  const {engine,ok,pass}=await import('./flow.helpers');
  const s=createTestMatch(),farseer={...AELDARI_DATASHEETS.find(d=>d.id==='farseer')!,attachment:undefined};
  s.phase='Movement';s.definitions=[farseer,s.definitions[1]!];
  s.players[0]!.factionId=farseer.factionId;s.armies[0]!.factionId=farseer.factionId;
  s.units[0]=createUnit(farseer,'unit-1','player-1',[{x:4,y:4}]);
  s.units[1]!.models.forEach((m,i)=>m.position={x:4+i*1.5,y:10});
  const e=engine(s);pass(e);
  const before=e.getState();assert.equal(e.useGuide('unit-1','unit-2').ok,false);assert.deepEqual(e.getState(),before);
  ok(e.tryNextPhase());
  ok(e.useGuide('unit-1','unit-2'));
  const guided=e.getState();
  assert.equal(guided.flow?.effects.some(x=>x.source==='GUIDE:player-1'&&x.target.unitId==='unit-2'&&x.active),true);
  assert.equal(e.useGuide('unit-1','unit-2').ok,false);
  assert.deepEqual(new GameEngine(guided).getState(),guided);
  const weapon=farseer.weapons.find(w=>w.id==='eldritch-storm')!,unit=guided.units[0]!,target=guided.units[1]!;
  const job=createAttackJob(weapon,[unit.models[0]!.id],target,guided.definitions[1]!,()=>.01,[],guided);
  runAttackJob(job,()=>.2,guided);
  assert.equal(job.resolution.attackRecords?.[0]?.modifiers.some(m=>m.source==='GUIDE'),true);
  assert.equal(job.resolution.attackRecords?.[0]?.hitSucceeded,true);
  guided.turn=3;guided.activePlayerId='player-1';expireEffects(guided,'COMMAND_START');
  assert.equal(guided.flow?.effects.find(x=>x.source==='GUIDE:player-1')?.active,false);
});
test('the live content registry resolves nineteen selected profiles and reports unfinished rules explicitly',()=>{
  const registry=createFactionContentRegistry();
  for(const definition of [...AELDARI_DATASHEETS,...EMPERORS_CHILDREN_DATASHEETS]) {
    assert.equal(registry.datasheet(definition.id)?.id,definition.id);
    for(const weapon of definition.weapons) assert.equal(registry.weapon(definition.id,weapon.id)?.id,weapon.id);
  }
  assert.equal(registry.enhancement('BREATH_OF_VAUL')?.points,10);
  assert.equal(registry.enhancement('FAULTLESS_OPPORTUNIST')?.points,15);
  assert.equal(registry.stratagem('DEATH_ECSTASY')?.cpCost,2);
  assert.equal(registry.ability('GUIDE')?.resolverId,'GameEngine.useGuide');
  assert.equal(registry.preset(AELDARI_PRESET.id)?.id,AELDARI_PRESET.id);
  for(const [content,preset] of [[FACTION_CONTENT[0]!,AELDARI_PRESET],[FACTION_CONTENT[1]!,EMPERORS_CHILDREN_PRESET]] as const){
    const result=validatePresetRoster(content,preset);
    assert.equal(result.valid,false);
    assert.ok(result.errors.some(error=>error.startsWith('Unregistered ability:')));
  }
});
test('Warped Interference grants Cover while the Sorcerer leads, and stops when the leader dies',()=>{
  const s=createAeldariVsEmperorsChildrenMatch(7);
  const defender=s.units.find(u=>u.id==='tormentor-command')!,attacker=s.units.find(u=>u.id==='storm-council')!;
  defender.location='BATTLEFIELD';attacker.location='BATTLEFIELD';
  defender.models.forEach((m,i)=>m.position={x:7+i,y:10});
  const model=attacker.models.find(m=>m.sourceDefinitionId==='farseer')!;model.position={x:7,y:5};
  const weapon=s.definitions.find(d=>d.id===attacker.definitionId)!.weapons.find(w=>w.id==='farseer:eldritch-storm')!;
  if(weapon.kind!=='ranged')assert.fail('expected ranged weapon');
  const covered=shootingModifiers(s,model,defender,weapon.skill,createVisibilityProvider(s),weapon);
  assert.equal(covered.modifiers.some(m=>m.source==='COVER'),true);
  const sorcerer=defender.models.find(m=>m.sourceDefinitionId==='sorcerer')!;
  sorcerer.alive=false;sorcerer.woundsRemaining=0;
  const exposed=shootingModifiers(s,model,defender,weapon.skill,createVisibilityProvider(s),weapon);
  assert.equal(exposed.modifiers.some(m=>m.source==='COVER'),false);
});
test('Doomweaver and Sorcerer witchfire hits apply the same temporary Move and Charge penalties',async()=>{
  const {engine,ok,pass}=await import('./flow.helpers');
  for(const [definitionId,weaponId] of [['night-spinner','doomweaver'],['sorcerer','agonising-energies']] as const){
    const raw=[...AELDARI_DATASHEETS,...EMPERORS_CHILDREN_DATASHEETS].find(d=>d.id===definitionId)!;
    const definition={...raw,attachment:undefined},s=createTestMatch();
    s.phase='Shooting';s.definitions=[definition,s.definitions[1]!];
    s.players[0]!.factionId=definition.factionId;s.armies[0]!.factionId=definition.factionId;
    s.units[0]=createUnit(definition,'unit-1','player-1',[{x:5,y:5}]);
    s.units[1]!.models.forEach((m,i)=>m.position={x:5+i*1.5,y:10});
    const e=engine(s);pass(e);
    ok(e.beginShooting('unit-1'));ok(e.selectShootingTarget(weaponId,'unit-2'));pass(e);
    ok(e.fireWeapon(weaponId,'unit-2',()=>.6));
    const after=e.getState();
    assert.equal(effectiveCharacteristic(after,'unit-2','MOVE',6),4,definitionId);
    assert.equal(chargeAllowance(after,7,[],'unit-2'),5,definitionId);
    assert.deepEqual(new GameEngine(after).getState(),after);
    after.turn=3;after.activePlayerId='player-1';expireEffects(after,'COMMAND_START');
    assert.equal(effectiveCharacteristic(after,'unit-2','MOVE',6),6);
    assert.equal(chargeAllowance(after,7,[],'unit-2'),7);
  }
});
test('a missed Doomweaver and a Sorcerer hit on a Vehicle leave movement unaffected',async()=>{
  const {engine,ok,pass}=await import('./flow.helpers');
  for(const id of ['night-spinner','sorcerer'] as const){
    const source=[...AELDARI_DATASHEETS,...EMPERORS_CHILDREN_DATASHEETS].find(d=>d.id===id)!,definition={...source,attachment:undefined},s=createTestMatch();
    s.phase='Shooting';s.definitions=[definition,{...s.definitions[1]!,keywords:id==='sorcerer'?['VEHICLE']:['INFANTRY']}];
    s.players[0]!.factionId=definition.factionId;s.armies[0]!.factionId=definition.factionId;
    s.units[0]=createUnit(definition,'unit-1','player-1',[{x:5,y:5}]);s.units[1]!.models.forEach((m,i)=>m.position={x:5+i*1.5,y:10});
    const e=engine(s);pass(e);
    const weapon=id==='sorcerer'?'agonising-energies':'doomweaver';
    ok(e.beginShooting('unit-1'));ok(e.selectShootingTarget(weapon,'unit-2'));pass(e);
    ok(e.fireWeapon(weapon,'unit-2',id==='sorcerer'?()=>.6:()=>.01));
    assert.equal(effectiveCharacteristic(e.getState(),'unit-2','MOVE',6),6);
    assert.equal(chargeAllowance(e.getState(),7,[],'unit-2'),7);
  }
});
test('Damaged vehicle Hit penalties use each datasheet threshold without changing the weapon profile',()=>{
  for(const [id,weaponId,threshold] of [['wave-serpent','twin-shuriken-cannon',4],['night-spinner','doomweaver',4],['chaos-land-raider','soulshatter-lascannon',5]] as const){
    const s=createTestMatch(),definition=[...AELDARI_DATASHEETS,...EMPERORS_CHILDREN_DATASHEETS].find(d=>d.id===id)!;
    const u=createUnit(definition,'unit-1','player-1',[{x:4,y:4}]);
    s.units[0]=u;s.definitions=[definition,s.definitions[1]!];s.units[1]!.models.forEach((m,i)=>m.position={x:4+i*1.5,y:10});
    const w=definition.weapons.find(x=>x.id===weaponId)!;
    const resolution=(remaining:number)=>{
      u.models[0]!.woundsRemaining=remaining;
      const job=createAttackJob(w,[u.models[0]!.id],s.units[1]!,s.definitions[1]!,()=>.34,[],s);
      runAttackJob(job,()=>.34,s);
      return job.resolution.attackRecords![0]!;
    };
    assert.equal(resolution(threshold+1).hitSucceeded,true,id);
    const damaged=resolution(threshold);
    assert.equal(damaged.hitSucceeded,false,id);
    assert.equal(damaged.modifiers.some(m=>m.source==='DAMAGED'&&m.amount===-1),true,id);
    assert.equal(w.skill,3,id);
  }
});
test('Wave Serpent Shield penalizes strong ranged wounds only, without changing weapons or saves',()=>{
  const s=createTestMatch(),serpent=AELDARI_DATASHEETS.find(d=>d.id==='wave-serpent')!;
  const target=createUnit(serpent,'unit-2','player-2',[{x:4,y:10}]);
  s.definitions=[s.definitions[0]!,serpent];s.units[1]=target;
  const base=s.definitions[0]!.weapons[0]!;
  const strong={...base,attacks:{kind:'fixed' as const,value:1},strength:13,armourPenetration:0,damage:{kind:'fixed' as const,value:1}};
  const resolve=(weapon:typeof strong,roll=.34)=>{
    const job=createAttackJob(weapon,[s.units[0]!.models[0]!.id],target,serpent,()=>roll,[],s);
    runAttackJob(job,()=>roll,s);
    return job.resolution.attackRecords![0]!;
  };
  assert.equal(resolve(strong).woundSucceeded,false);
  assert.equal(resolve(strong).modifiers.some(m=>m.source==='WAVE_SERPENT_SHIELD'&&m.amount===1),true);
  assert.equal(resolve({...strong,strength:11},.5).woundSucceeded,true);
  assert.equal(resolve({...strong,kind:'melee',range:null}).woundSucceeded,true);
  assert.equal(strong.strength,13);
  assert.equal(base.strength,s.definitions[0]!.weapons[0]!.strength);
});
test('Storm Guardian platform grants 5+ invulnerable saves then dies when the final Guardian falls',()=>{
  const s=createTestMatch(),storm=AELDARI_DATASHEETS.find(d=>d.id==='storm-guardians')!;
  const target=createUnit(storm,'unit-2','player-2',Array.from({length:11},(_,i)=>({x:4+i*1.5,y:10})));
  s.definitions=[s.definitions[0]!,storm];s.units[1]=target;
  assert.equal(target.models.filter(m=>m.profileRole==='STORM_GUARDIAN').length,10);
  assert.equal(serpentShieldSave(target),5);
  for(const model of target.models.slice(0,9)){model.alive=false;model.woundsRemaining=0;}
  const base=s.definitions[0]!.weapons[0]!;
  const shot={...base,attacks:{kind:'fixed' as const,value:1},strength:10,armourPenetration:-4,damage:{kind:'fixed' as const,value:1}};
  const job=createAttackJob(shot,[s.units[0]!.models[0]!.id],target,storm,()=>.5,[],s);
  runAttackJob(job,()=>.5,s);
  assert.equal(job.resolution.saveResults[0]?.selected,'INVULNERABLE');
  assert.equal(job.resolution.saveResults[0]?.saved,false);
  assert.deepEqual(job.resolution.destroyedModelIds.sort(),[target.models[9]!.id,target.models[10]!.id].sort());
  assert.equal(job.target.models.at(-1)?.alive,false);
  assert.equal(serpentShieldSave(job.target),undefined);
  assert.equal(target.models.at(-1)?.alive,true); // detached attack job leaves source state untouched until commit
});
test('Dark Reapers selectively ignore Ballistic Skill and Hit modifiers on ranged attacks only',async()=>{
  const {engine,ok}=await import('./flow.helpers');
  const s=createTestMatch(),reapers=AELDARI_DATASHEETS.find(d=>d.id==='dark-reapers')!;
  s.definitions=[reapers,s.definitions[1]!];s.units[0]=createUnit(reapers,'unit-1','player-1',Array.from({length:5},(_,i)=>({x:4+i*1.5,y:4})));
  s.players[0]!.factionId=reapers.factionId;s.armies[0]!.factionId=reapers.factionId;
  const e=engine(s);const unit=e.getState().units[0]!,weapon=reapers.weapons.find(w=>w.id==='reaper-launcher-starshot')!;
  for(const [source,characteristic,value] of [['test-bs','BS',1],['test-hit','HIT_ROLL',-1]] as const)
    ok(e.addTemporaryEffect({source,target:{unitId:'unit-1'},payload:{kind:'MODIFIER',characteristic,value},expiry:'END_OF_CURRENT_PHASE',stacking:'STACK'}));
  const state=e.getState(),target=state.units[1]!,definition=state.definitions[1]!;
  const resolve=(choices:Parameters<typeof createAttackJob>[8])=>{
    const job=createAttackJob(weapon,[unit.models[0]!.id],target,definition,()=>.34,[],state,undefined,choices);
    runAttackJob(job,()=>.34,state);return job.resolution.attackRecords![0]!;
  };
  assert.equal(resolve({}).hitSucceeded,false);
  assert.equal(resolve({ignoredAccuracyModifiers:{bs:['test-bs']}}).hitSucceeded,false);
  const clean=resolve({ignoredAccuracyModifiers:{bs:['test-bs'],hit:['test-hit']}});
  assert.equal(clean.hitSucceeded,true);
  assert.equal(clean.modifiers.some(m=>m.source==='test-bs'||m.source==='test-hit'),false);
  assert.equal(reapers.weapons.find(w=>w.id===weapon.id)?.skill,3);
  const other={...state,definitions:[{...reapers,abilities:[]},definition]};
  const plain=createAttackJob(weapon,[unit.models[0]!.id],target,definition,()=>.34,[],other,undefined,{ignoredAccuracyModifiers:{bs:['test-bs'],hit:['test-hit']}});
  runAttackJob(plain,()=>.34,other);
  assert.equal(plain.resolution.attackRecords?.[0]?.hitSucceeded,false);
  const snapshot=e.getState();assert.deepEqual(new GameEngine(snapshot).getState(),snapshot);
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
test('Stormblades and Objective Defiled secure controlled objectives via the shared Command resolver',()=>{
  for(const [unitId,playerId,source] of [['storm-council','player-1','STORMBLADES'],['tormentor-command','player-2','OBJECTIVE_DEFILED']] as const){
    const s=createAeldariVsEmperorsChildrenMatch(9),unit=s.units.find(u=>u.id===unitId)!;
    s.activePlayerId=playerId;unit.location='BATTLEFIELD';
    unit.models.forEach((m,i)=>m.position={x:3+(i%7)*2,y:3+Math.floor(i/7)*2});unit.models[0]!.position={x:16,y:19};
    s.phase='Command';s.flow!.commandStep='END_OF_COMMAND_PHASE';s.flow!.missionHookStarted=true;
    assert.equal(new CommandController(s).advance().ok,true);
    const objective=s.mission!.objectives.find(o=>o.id==='site-2')!;
    assert.equal(objective.securedByPlayerId,playerId);
    assert.equal(objective.securedSource,source);
    assert.equal(secureFactionObjectives(s).length,0);
    assert.equal(JSON.parse(JSON.stringify(s)).mission.objectives.find((o:{id:string})=>o.id==='site-2')?.securedByPlayerId,playerId);
  }
});
test('Psychic Communion freezes 0–2 other battlefield Aeldari Psykers on selection and buffs Destructor only',async()=>{
  const {engine,ok,pass}=await import('./flow.helpers');
  const warlock={...AELDARI_DATASHEETS.find(d=>d.id==='warlock')!,attachment:undefined},farseer={...AELDARI_DATASHEETS.find(d=>d.id==='farseer')!,attachment:undefined};
  for(let count=0;count<=3;count++){
    const s=createTestMatch();s.phase='Shooting';s.definitions=[warlock,s.definitions[1]!,farseer];
    s.units[0]=createUnit(warlock,'unit-1','player-1',[{x:5,y:5}]);
    s.players[0]!.factionId=warlock.factionId;s.armies[0]!.factionId=warlock.factionId;
    for(let i=0;i<count;i++) {const u=createUnit(farseer,`seer-${i}`,'player-1',[{x:6.5+i*1.5,y:5}]);u.location='BATTLEFIELD';s.units.push(u);s.armies[0]!.unitIds.push(u.id);}
    const distant=createUnit(farseer,'reserve-seer','player-1',[{x:5,y:5}]);distant.location='RESERVES';s.units.push(distant);s.armies[0]!.unitIds.push(distant.id);
    assert.equal(psychicCommunionBonus(s,s.units[0]!),Math.min(2,count));
    const e=engine(s);pass(e);ok(e.beginShooting('unit-1'));
    const state=e.getState(),view=factionAttackWeapon(state,state.units[0]!,warlock.weapons.find(w=>w.id==='destructor')!);
    assert.equal(state.shooting?.psychicCommunionBonus,Math.min(2,count));
    assert.equal(view.strength,5+Math.min(2,count));
    assert.deepEqual(view.attacks,{kind:'dice',count:1,sides:6,modifier:Math.min(2,count)});
    assert.equal(warlock.weapons.find(w=>w.id==='destructor')?.strength,5);
    assert.equal(factionAttackWeapon(state,state.units[0]!,warlock.weapons.find(w=>w.id==='shuriken-pistol')!).strength,4);
    assert.deepEqual(new GameEngine(state).getState(),state);
  }
});
test('Excessive Assault rerolls wound ones and permits any wound reroll only near an objective',()=>{
  const s=createAeldariVsEmperorsChildrenMatch(12),infractors=s.units.find(u=>u.id==='infractor-command')!,target=s.units.find(u=>u.id==='storm-council')!;
  infractors.location='BATTLEFIELD';target.location='BATTLEFIELD';
  const weapon=s.definitions.find(d=>d.id===infractors.definitionId)!.weapons.find(w=>w.id==='infractors:duelling-sabre')!;
  const definition=s.definitions.find(d=>d.id===target.definitionId)!;
  const model=infractors.models.find(m=>m.sourceDefinitionId==='infractors')!;
  const roll=(attack:typeof weapon,first:number,choices:Parameters<typeof createAttackJob>[8]={})=>{
    const seq=[.5,first,.9,.01];let index=0;
    const rng=()=>seq[index++]??.5;
    const job=createAttackJob(attack,[model.id],target,definition,rng,[],s,undefined,choices);
    runAttackJob(job,rng,s);return job.resolution.attackRecords![0]!;
  };
  target.models.forEach(m=>m.position={x:30,y:25});
  const ordinary=factionAttackWeapon(s,infractors,weapon,target);
  assert.equal(ordinary.rerollPermissions?.find(p=>p.kind==='WOUND')?.source,'EXCESSIVE_ASSAULT');
  assert.equal(roll(ordinary,.01).wound?.wasRerolled,true);
  assert.equal(roll(ordinary,.18).wound?.wasRerolled,false);
  assert.equal(validAttackChoices(ordinary,{rerolls:{WOUND:'ALL'}}),false);
  target.models[0]!.position={x:16,y:19};
  const objective=factionAttackWeapon(s,infractors,weapon,target);
  assert.equal(validAttackChoices(objective,{rerolls:{WOUND:'ALL'}}),true);
  assert.equal(roll(objective,.18,{rerolls:{WOUND:'ALL'}}).wound?.wasRerolled,true);
  assert.equal(weapon.rerollPermissions,undefined);
});
test('Lord Host grants only its bearer Scouts and Infiltrators inside a Battleline attachment',()=>{
  const s=createAeldariVsEmperorsChildrenMatch(13),infractors=s.units.find(u=>u.id==='infractor-command')!,lord=infractors.models.find(m=>m.sourceDefinitionId==='lord-exultant')!;
  assert.equal(abilitiesFor(s,infractors,lord).some(a=>a.kind==='SCOUTS'&&a.distance===6),true);
  assert.equal(abilitiesFor(s,infractors,lord).some(a=>a.kind==='INFILTRATORS'),true);
  assert.equal(allHave(s,infractors,'SCOUTS'),true);
  assert.equal(scoutDistance(s,infractors),6);
  assert.equal(allHave(s,infractors,'INFILTRATORS'),false);
  const tormentors=s.units.find(u=>u.id==='tormentor-command')!,record=s.attachments!.find(a=>a.id===tormentors.id)!;
  record.components.find(c=>c.role==='LEADER')!.original.definitionId='lord-exultant';
  const original=tormentors.models.find(m=>m.sourceDefinitionId==='sorcerer')!;
  original.sourceDefinitionId='lord-exultant';original.componentUnitId=record.components.find(c=>c.role==='LEADER')!.original.id;
  assert.equal(allHave(s,tormentors,'INFILTRATORS'),true);
  assert.equal(allHave(s,tormentors,'SCOUTS'),false);
  record.active=false;
  assert.equal(abilitiesFor(s,tormentors,original).some(a=>a.kind==='SCOUTS'),false);
});
test('Euphoric Strikes is optional, model scoped, once per battle and expires after Fight',async()=>{
  const {engine,ok}=await import('./flow.helpers');
  const raw=EMPERORS_CHILDREN_DATASHEETS.find(d=>d.id==='lord-exultant')!,lord={...raw,attachment:undefined},s=createTestMatch();
  s.phase='Fight';s.definitions=[lord,s.definitions[1]!];s.players[0]!.factionId=lord.factionId;s.armies[0]!.factionId=lord.factionId;
  s.units[0]=createUnit(lord,'unit-1','player-1',[{x:4.5,y:4.5}]);
  const initial=engine(s).getState();
  initial.flow!.window={id:'window-1',trigger:'START_OF_PHASE',playerId:'player-1',passedPlayerIds:[]};
  const e=new GameEngine(initial),original=e.getState(),modelId=original.units[0]!.models[0]!.id;
  assert.equal(effectiveCharacteristic(original,'unit-1','ATTACKS',5,modelId),5);
  ok(e.activateEuphoricStrikes('unit-1'));
  const active=e.getState();
  assert.equal(effectiveCharacteristic(active,'unit-1','ATTACKS',5,modelId),8);
  assert.equal(effectiveCharacteristic(active,'unit-1','AP',-2,modelId),-3);
  assert.equal(effectiveCharacteristic(active,'unit-1','ATTACKS',5),5);
  assert.equal(e.activateEuphoricStrikes('unit-1').ok,false);
  assert.deepEqual(new GameEngine(active).getState(),active);
  expireEffects(active,'PHASE_END');
  assert.equal(effectiveCharacteristic(active,'unit-1','ATTACKS',5,modelId),5);
  assert.equal(new GameEngine(active).activateEuphoricStrikes('unit-1').ok,false);
  assert.equal(lord.weapons.find(w=>w.id==='phoenix-power-spear')?.attacks.kind,'fixed');
});
test('Terrifying Crescendo selects one hit target after Shooting and expires at the next own Shooting start',async()=>{
  const {engine,ok,pass}=await import('./flow.helpers');
  const noise=EMPERORS_CHILDREN_DATASHEETS.find(d=>d.id==='noise-marines')!,s=createTestMatch();
  s.phase='Shooting';s.definitions=[noise,s.definitions[1]!];s.players[0]!.factionId=noise.factionId;s.armies[0]!.factionId=noise.factionId;
  s.definitions=[noise,{...s.definitions[1]!,stats:{...s.definitions[1]!.stats,leadership:8}}];
  s.units[0]=createUnit(noise,'unit-1','player-1',Array.from({length:6},(_,i)=>({x:4+i*2,y:5})));
  s.units[1]!.models.forEach((m,i)=>m.position={x:4+i*1.5,y:10});
  const e=engine(s);pass(e);ok(e.beginShooting('unit-1'));ok(e.selectShootingTarget('sonic-blaster','unit-2'));pass(e);
  ok(e.fireWeapon('sonic-blaster','unit-2',()=>.55));ok(e.completeShooting());
  assert.deepEqual(postShotHitTargets(e.getState(),e.getState().units[0]!).map(u=>u.id),['unit-2']);
  assert.equal(e.useTerrifyingCrescendo('unit-1','unit-1').ok,false);
  ok(e.useTerrifyingCrescendo('unit-1','unit-2'));
  const after=e.getState();assert.equal(effectiveCharacteristic(after,'unit-2','LEADERSHIP',8),9);
  assert.equal(resolveBattleShockRoll(after,after.units[1]!,()=>.5).success,false);
  assert.equal(e.useTerrifyingCrescendo('unit-1','unit-2').ok,false);
  assert.deepEqual(new GameEngine(after).getState(),after);
  after.turn=2;after.activePlayerId='player-2';expireEffects(after,'SHOOTING_START');
  assert.equal(effectiveCharacteristic(after,'unit-2','LEADERSHIP',8),9);
  after.turn=3;after.activePlayerId='player-1';expireEffects(after,'SHOOTING_START');
  assert.equal(effectiveCharacteristic(after,'unit-2','LEADERSHIP',8),8);
  assert.equal(resolveBattleShockRoll(after,after.units[1]!,()=>.5).success,true);
});
test('an attached Character left without Storm Guardians cannot secure an objective through Stormblades',()=>{
  const s=createAeldariVsEmperorsChildrenMatch(8),unit=s.units.find(u=>u.id==='storm-council')!;
  unit.location='BATTLEFIELD';unit.models.filter(m=>m.componentUnitId==='storm-guardians').forEach(m=>{m.alive=false;m.woundsRemaining=0;});
  unit.models.find(m=>m.sourceDefinitionId==='farseer')!.position={x:16,y:19};
  assert.deepEqual(secureFactionObjectives(s),[]);
  assert.equal(s.mission!.objectives.find(o=>o.id==='site-2')?.securedByPlayerId,null);
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
