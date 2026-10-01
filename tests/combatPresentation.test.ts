import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestMatch } from '../src/game/data/prototype';
import { shootingState } from './shooting.helpers';
import { GameEngine } from '../src/game/engine/GameEngine';
import { getLegalActions } from '../src/game/actions/LegalActions';
import { weaponChoices,actionsForWeapon,chosenWeapons,weaponProfile,diceLabel,completedCombat } from '../src/ui/combatPresentation';
import { menuPlacement,radialCommands } from '../src/ui/battlefieldInteraction';
test('weapon picker and target highlights are restricted to engine LegalActions for that weapon',()=>{
 const e=new GameEngine(shootingState());assert.ok(e.beginShooting('unit-1').ok);const actions=getLegalActions(e,'player-1');const ids=weaponChoices(actions);assert.ok(ids.length);
 for(const id of ids){const chosen=actionsForWeapon(actions,id);assert.ok(chosen.length);assert.ok(chosen.every(a=>'weaponId' in a&&a.weaponId===id));}
 assert.deepEqual(actionsForWeapon(actions,'missing'),[]);assert.deepEqual(actionsForWeapon(actions,null),[]);
});
test('enemy inspection has no executable radial command and does not change the engine',()=>{
 const e=new GameEngine(shootingState()),s=e.getState();const before=JSON.stringify(s);assert.deepEqual(radialCommands(getLegalActions(e,'player-1'),s,'unit-2'),[]);assert.ok(chosenWeapons(s,s.units[1]!));assert.equal(JSON.stringify(e.getState()),before);
});
test('actual mixed loadout profiles and dice values remain immutable presentation data',()=>{
 const s=shootingState(),u=s.units[0]!,weapons=chosenWeapons(s,u);assert.ok(weapons.length);assert.equal(weaponProfile(s,weapons[0]!.id)?.name,weapons[0]!.name);
 assert.equal(diceLabel({kind:'dice',count:2,sides:6,modifier:1}),'2D6+1');assert.equal(diceLabel({kind:'fixed',value:3}),'3');
 u.models.forEach(m=>m.weaponIds=[]);assert.deepEqual(chosenWeapons(s,u),[]);
});
test('combat feedback uses completed authoritative resolution events only',()=>{
 const s=createTestMatch();assert.deepEqual(completedCombat(s.events),[]);
 const e=new GameEngine(shootingState());e.beginShooting('unit-1');assert.ok(e.fireWeapon('test-rifle','unit-2',()=>0.5).ok);const report=completedCombat(e.getState().events).at(-1)!;assert.equal(report.type,'weapon-fired');assert.ok(report.resolution.attacks>0);assert.equal(report.resolution.targetUnitId,'unit-2');
});
test('menu avoids covering a selected squad at the top and bottom of a phone viewport',()=>{
 const viewport={width:390,height:480};const top={left:8,top:8,right:80,bottom:65};const p=menuPlacement({x:30,y:30},viewport,undefined,top);assert.ok(p.top>=top.bottom);
 const bottom={left:20,top:400,right:100,bottom:470};const q=menuPlacement({x:40,y:450},viewport,undefined,bottom);assert.ok(q.top+180<=bottom.top);
});
