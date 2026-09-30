import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../src/game/engine/GameEngine';
import { createAeldariVsEmperorsChildrenMatch } from '../src/game/content/presets';
import { getLegalActions, performAction } from '../src/game/actions/LegalActions';
import { PlaySession } from '../src/game/session/PlaySession';
import { runMatchToCompletion } from '../src/game/ai/AiTurnRunner';

test('legal actions are serializable, detached and dispatched through GameEngine', () => {
  const engine=new GameEngine(createAeldariVsEmperorsChildrenMatch(9));
  const before=engine.getState();
  const actions=getLegalActions(engine,'player-1');
  assert.deepEqual(JSON.parse(JSON.stringify(actions)),actions);
  assert.equal(actions[0]?.kind,'SET_FIRST_TURN');
  assert.deepEqual(engine.getState(),before);
  assert.equal(performAction(engine,actions[0]!,()=>0.5).ok,true);
  assert.equal(engine.getState().deployment?.firstTurnPlayerId,'player-1');
});

for(const side of ['AELDARI','EMPERORS_CHILDREN'] as const) test(`Human ${side} and AI handoff obey turn ownership`,()=>{
  const session=new PlaySession(13,side);
  assert.equal(session.getState().status,'in-progress');
  if(session.status==='AI_DECISION') session.advanceAi(4);
  assert.equal(session.status,'HUMAN_DECISION');
  const first=session.getHumanActions()[0]!;
  assert.ok(first);
  const before=session.getState();
  assert.equal(session.submit(first).ok,true);
  assert.notDeepEqual(session.getState(),before);
  assert.equal(session.submit({kind:'FIRE_WEAPON',weaponId:'invalid',targetId:'invalid'}).ok,false);
});

test('single seeded match completes every round, scores VP and validates snapshot',()=>{
  const {state,steps}=runMatchToCompletion(1);
  assert.equal(state.status,'finished');
  assert.equal(state.mission?.matchResult?.completedBattleRounds,5);
  assert.ok(state.mission!.matchResult!.scores.some(score=>score.total>0));
  assert.ok(steps>0&&steps<25000);
  assert.equal(state.movement,null);
  assert.equal(state.shooting,null);
  assert.deepEqual(new GameEngine(JSON.parse(JSON.stringify(state))).getState(),state);
});

test('multi-seed AI-vs-AI stability and deterministic result',()=>{
  for(const seed of [2,3,42,99]) {
    const {state,steps}=runMatchToCompletion(seed);
    assert.equal(state.status,'finished',`seed ${seed}, steps ${steps}`);
    assert.ok(state.mission?.matchResult);
    assert.ok(['WIN','DRAW'].includes(state.mission!.matchResult!.outcome));
    assert.equal(state.movement,null);
    assert.equal(state.shooting,null);
    assert.equal(state.setup,null);
    assert.deepEqual(new GameEngine(state).getState(),state);
  }
  const a=runMatchToCompletion(7),b=runMatchToCompletion(7);
  assert.deepEqual(a.state.mission?.matchResult,b.state.mission?.matchResult);
  assert.equal(a.steps,b.steps);
});
