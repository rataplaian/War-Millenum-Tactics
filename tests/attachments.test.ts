import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../src/game/engine/GameEngine';
import { createTransportTestMatch } from '../src/game/data/transportPrototype';
import { attackToughness, modelKeywords, unitKeywords, sourceAbilities } from '../src/game/attachments/queries';
import { allocationGroups, allocationModel } from '../src/game/attachments/AllocationGroups';
import { processAttachmentCasualties, finishAttacker } from '../src/game/attachments/AttachmentController';
import { attached, field, ok, no } from './transports.helpers';
test('attachment retains seven model identities and original source definitions', () => {
 const e = attached(), s = e.getState(), u = s.units.find(u => u.id === 'attached')!;
 assert.equal(u.models.length, 7); assert.equal(s.units.length, 4); assert.equal(s.attachments![0]!.components.length, 3);
 assert.ok(unitKeywords(s,u).includes('PSYKER')); assert.ok(!modelKeywords(s,u,u.models[0]!).includes('PSYKER'));
 assert.equal(attackToughness(s,u),3); assert.deepEqual(new GameEngine(s).getState(),s);
});
test('standalone Support blocks roster progression', () => { const e = new GameEngine(createTransportTestMatch()); no(e.advancePreBattle(),'SUPPORT_REQUIRES_BODYGUARD'); });
test('illegal attachment leaves state exactly unchanged', () => { const e = new GameEngine(createTransportTestMatch()), before=e.getState(); no(e.configureAttachments([{id:'bad',bodyguardId:'transport-a',leaderIds:['leader']}]),'INVALID_ATTACHMENT'); assert.deepEqual(e.getState(),before); });
test('default role limits reject duplicate Leaders', () => { const e = new GameEngine(createTransportTestMatch()); no(e.configureAttachments([{id:'bad',bodyguardId:'bodyguard',leaderIds:['leader','support']}]),'INVALID_ATTACHMENT'); });
test('allocation groups keep individual characters and prioritize wounded noncharacters', () => { const s=field(),u=s.units.find(u=>u.id==='attached')!; assert.equal(allocationGroups(s,u).length,3); assert.equal(allocationModel(s,u)!.componentUnitId,'bodyguard'); });
test('bodyguard death changes toughness immediately but defers split through attacker completion', () => {
 const s=field(),u=s.units.find(u=>u.id==='attached')!; u.models.filter(m=>m.componentUnitId==='bodyguard').forEach(m=>{m.alive=false;m.woundsRemaining=0;});
 processAttachmentCasualties(s,'enemy'); assert.equal(attackToughness(s,u),5); assert.ok(s.units.includes(u));
 finishAttacker(s,'enemy'); assert.ok(!s.units.some(x=>x.id==='attached')); assert.equal(s.units.find(x=>x.id==='leader')!.models[0]!.woundsRemaining,3); new GameEngine(s);
});
test('dead source ability persists only until attacking unit finishes', () => { const s=field(),u=s.units.find(u=>u.id==='attached')!,m=u.models.find(m=>m.componentUnitId==='leader')!; m.alive=false;m.woundsRemaining=0;processAttachmentCasualties(s,'enemy');assert.equal(sourceAbilities(s,u).length,1);finishAttacker(s,'enemy');assert.equal(sourceAbilities(s,u).length,0); });
test('while-leading ability remains with surviving separated leader', () => {const s=field(),u=s.units.find(u=>u.id==='attached')!;u.models.filter(m=>m.componentUnitId==='bodyguard').forEach(m=>{m.alive=false;m.woundsRemaining=0;});processAttachmentCasualties(s);assert.equal(sourceAbilities(s,s.units.find(x=>x.id==='leader')!).length,1);});
