import assert from 'node:assert/strict';
import {AiTurnRunner} from './src/game/ai/AiTurnRunner.ts';
import {GameEngine} from './src/game/engine/GameEngine.ts';
import {createAeldariVsEmperorsChildrenMatch} from './src/game/content/presets.ts';
const seed=Number(process.argv[2]??1),start=performance.now();
const runner=new AiTurnRunner(new GameEngine(createAeldariVsEmperorsChildrenMatch(seed)),seed);
let lastProgress=start;
try {
  while(runner.engine.getState().status==='in-progress') {
    runner.step();
    if(runner.trace.length%100===0) {
      const s=runner.engine.getState();lastProgress=performance.now();
      console.log(JSON.stringify({seed,steps:runner.trace.length,seconds:Math.round((lastProgress-start)/1000),round:s.round,turn:s.turn,phase:s.phase,last:runner.trace.at(-1)?.chosen?.kind}));
    }
  }
  const s=runner.engine.getState();
  assert.equal(s.status,'finished');assert.ok(s.mission?.matchResult);
  assert.ok(['WIN','DRAW'].includes(s.mission.matchResult.outcome));
  assert.ok(s.mission.matchResult.completedBattleRounds<=5);
  assert.equal(s.movement,null);assert.equal(s.shooting,null);assert.equal(s.setup,null);
  assert.deepEqual(new GameEngine(JSON.parse(JSON.stringify(s))).getState(),s);
  console.log('RESULT',JSON.stringify({seed,seconds:Number(((performance.now()-start)/1000).toFixed(2)),steps:runner.trace.length,round:s.round,result:s.mission.matchResult,status:'PASS'}));
} catch(error) {
  console.error('FAIL',seed,error.stack,JSON.stringify(runner.trace.slice(-10)));process.exitCode=1;
}
