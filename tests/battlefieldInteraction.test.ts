import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTestMatch } from '../src/game/data/prototype';
import { GameEngine } from '../src/game/engine/GameEngine';
import { getLegalActions } from '../src/game/actions/LegalActions';
import { PlaySession } from '../src/game/session/PlaySession';
import { radialCommands, movementEnvelope, weaponReach, shootingTargetIds, selectionPreview, menuPlacement } from '../src/ui/battlefieldInteraction';
import { shootingState } from './shooting.helpers';

function movementGame(){const s=createTestMatch();s.phase='Movement';s.units.forEach(u=>u.location='BATTLEFIELD');return new GameEngine(s);}
test('radial commands are a subset of existing legal decisions for the selected unit',()=>{
  const e=movementGame(),s=e.getState(),actions=getLegalActions(e,'player-1');
  const commands=radialCommands(actions,s,'unit-1');assert.ok(commands.some(c=>c.id==='MOVE'));
  for(const c of commands) for(const a of c.actions)assert.ok(actions.includes(a));
  assert.deepEqual(radialCommands(actions,s,'unit-2'),[]);assert.ok(!commands.some(c=>c.id==='SHOOT'));
});
test('absent commands cannot be made executable; session rejects fabricated actions',()=>{
  const session=new PlaySession(42);const before=session.getState();
  assert.deepEqual(radialCommands(session.getHumanActions(),before,'dark-reapers'),[]);
  assert.equal(session.submit({kind:'BEGIN_MOVE',unitId:'dark-reapers'}).ok,false);assert.deepEqual(session.getState(),before);
});
test('movement envelope uses catalog movement and engine transaction usage/bonus',()=>{
  const e=movementGame();assert.ok(e.beginMovement('unit-1').ok);const s=e.getState(),u=s.units[0]!,m=u.models[0]!;
  assert.equal(movementEnvelope(s,u,m),s.definitions[0]!.stats.movement);
  m.movementUsed=2;s.movement!.bonus=3;assert.equal(movementEnvelope(s,u,m),s.definitions[0]!.stats.movement+1);
  m.movementUsed=100;assert.equal(movementEnvelope(s,u,m),0);
});
test('range previews use real chosen ranged profiles and omit melee/unowned weapons',()=>{
  const s=shootingState(),u=s.units[0]!;
  const ranges=weaponReach(s,u);assert.ok(ranges.length);const profile=s.definitions[0]!.weapons.find(w=>w.id===ranges[0]!.id)!;assert.equal(ranges[0]!.range,profile.range);
  u.models.forEach(m=>m.weaponIds=[]);assert.deepEqual(weaponReach(s,u),[]);
});
test('passive shooting highlights match LegalActions after a detached begin, without mutation',()=>{
  const s=shootingState();s.units.forEach(u=>u.location='BATTLEFIELD');const e=new GameEngine(s),before=e.getState();
  const actions=getLegalActions(e,'player-1');const p=selectionPreview(e,'player-1','unit-1',actions);
  const probe=new GameEngine(before);assert.ok(probe.beginShooting('unit-1').ok);
  assert.deepEqual(shootingTargetIds(p.shooting),shootingTargetIds(getLegalActions(probe,'player-1')));
  assert.deepEqual(shootingTargetIds(p.shooting),['unit-2']);assert.deepEqual(e.getState(),before);
});
test('passive movement suggestions match engine-approved sample actions and preserve state',()=>{
  const e=movementGame(),before=e.getState();const p=selectionPreview(e,'player-1','unit-1',getLegalActions(e,'player-1'));
  const probe=new GameEngine(before);probe.beginMovement('unit-1');assert.ok(p.movement.length);
  for(const a of p.movement){assert.equal(a.kind,'MOVE_MODEL');if(a.kind==='MOVE_MODEL')assert.ok(probe.previewMove(a.modelId,a.target).ok);}
  assert.deepEqual(e.getState(),before);
});
test('radial bounds remain within phone/desktop viewport at every edge',()=>{
  for(const viewport of [{width:320,height:480},{width:1000,height:480}])for(const anchor of [{x:-100,y:-100},{x:0,y:0},{x:9000,y:9000}]){
    const p=menuPlacement(anchor,viewport);assert.ok(p.left>=0&&p.top>=0);assert.ok(p.left+220<=viewport.width&&p.top+180<=viewport.height);
  }
});
test('PLAY mutation entry points stay on PlaySession.submit; engine usage is read-only',()=>{
  const source=readFileSync('src/ui/PlayScreen.tsx','utf8');assert.match(source,/game\.submit\(action\)/);assert.match(source,/game\.submit\(pending\)/);
  assert.doesNotMatch(source,/engine\.(beginMovement|beginShooting|moveModel|fireWeapon|declareCharge)\(/);
  assert.doesNotMatch(readFileSync('src/ui/RadialActionMenu.tsx','utf8'),/GameEngine|performAction/);
});
