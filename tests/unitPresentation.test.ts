import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createAeldariVsEmperorsChildrenMatch } from '../src/game/content/presets';
import { createUnit } from '../src/game/engine/createUnit';
import { AELDARI_DATASHEETS, EMPERORS_CHILDREN_DATASHEETS } from '../src/game/content/factionDatasheets';
import { modelDefinitionId, UNIT_VISUALS, visualModels } from '../src/ui/unitPresentation';
import { actionUnitId, actionTargets, actionPosition, commandPrompt, commandName, actionDetail } from '../src/ui/playCommands';

test('all 19 datasheets have existing token art and visual categories',()=>{
  for(const d of [...AELDARI_DATASHEETS,...EMPERORS_CHILDREN_DATASHEETS]) {
    assert.ok(UNIT_VISUALS[d.id]);assert.ok(existsSync(`assets/tokens/${UNIT_VISUALS[d.id]!.token}.jpg`));assert.ok(UNIT_VISUALS[d.id]!.category);
  }
});
test('five and ten model squads remain five and ten visual model instances',()=>{
  const s=createAeldariVsEmperorsChildrenMatch(42);
  for(const count of [5,10]){
    const d={...AELDARI_DATASHEETS.find(d=>d.id==='rangers')!,modelCount:count};
    const u=createUnit(d,'visual-test','player-1',Array.from({length:count},(_,i)=>({x:i,y:2,z:0})));
    assert.equal(visualModels(s,u).length,count);assert.equal(new Set(visualModels(s,u).map(v=>v.model.id)).size,count);
    u.models[0]!.alive=false;assert.equal(visualModels(s,u).length,count-1);
  }
});
test('attached leaders retain their original portrait alongside bodyguards',()=>{
  const s=createAeldariVsEmperorsChildrenMatch(42);const u=s.units.find(u=>u.id==='storm-council')!;
  assert.equal(modelDefinitionId(s,u),'storm-guardians');
  const ids=new Set(u.models.map(m=>modelDefinitionId(s,u,m)));
  assert.ok(ids.has('farseer'));assert.ok(ids.has('warlock'));assert.ok(ids.has('storm-guardians'));
});
test('vehicles remain a single authoritative large base',()=>{
  const s=createAeldariVsEmperorsChildrenMatch(42);const u=s.units.find(u=>u.id==='chaos-land-raider')!;
  assert.equal(visualModels(s,u).length,1);assert.equal(u.models[0]!.base.diameterMm,90);
});
test('setup visual preview uses staged coordinates and never mutates positions',()=>{
  const s=createAeldariVsEmperorsChildrenMatch(42);const u=s.units.find(u=>u.id==='dark-reapers')!;const m=u.models[0]!;
  const original={...m.position};s.setup={unitId:u.id,positions:{[m.id]:{x:10,y:10,z:0}}} as typeof s.setup;
  assert.equal(visualModels(s,u)[0]!.position.x,10);assert.deepEqual(m.position,original);
});
test('shooting and model commands resolve ownership from current transactions',()=>{
  const s=createAeldariVsEmperorsChildrenMatch(42);const u=s.units.find(u=>u.id==='dark-reapers')!;
  assert.equal(actionUnitId({kind:'MOVE_MODEL',modelId:u.models[0]!.id,target:{x:2,y:2}},s),u.id);
  s.shooting={unitId:u.id} as typeof s.shooting;
  assert.equal(actionUnitId({kind:'SELECT_SHOOTING_TARGET',weaponId:'reaper-launcher-starshot',targetId:'chaos-rhino'},s),u.id);
});
test('legal actions drive target and destination highlighting without rules duplication',()=>{
  assert.deepEqual(actionTargets({kind:'SELECT_CHARGE_TARGETS',targetIds:['one','two']}),['one','two']);
  assert.deepEqual(actionPosition({kind:'DEPLOY_FORMATION',formation:{m:{x:4,y:5,z:0}}}),{x:4,y:5,z:0});
  assert.equal(commandPrompt([{kind:'MOVE_MODEL',modelId:'m',target:{x:4,y:5}}],null),'Select a model to move');
  assert.match(commandPrompt([{kind:'SELECT_MELEE_TARGET',weaponId:'w',targetId:'e'}],null),/Choose target/);
});
test('human labels name weapons and targets instead of internal identifiers',()=>{
  const s=createAeldariVsEmperorsChildrenMatch(42);const a={kind:'SELECT_SHOOTING_TARGET' as const,weaponId:'reaper-launcher-starshot',targetId:'chaos-rhino'};
  assert.equal(commandName(a),'Choose shooting target');assert.match(actionDetail(a,s),/Chaos Rhino/);
});
