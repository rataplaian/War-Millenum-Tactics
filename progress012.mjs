import {AiTurnRunner} from './src/game/ai/AiTurnRunner.ts';
import {GameEngine} from './src/game/engine/GameEngine.ts';
import {createAeldariVsEmperorsChildrenMatch} from './src/game/content/presets.ts';
const runner=new AiTurnRunner(new GameEngine(createAeldariVsEmperorsChildrenMatch(1)),1);
try {while(runner.engine.getState().status==='in-progress') {runner.step();if(runner.trace.length%100===0){const s=runner.engine.getState(); console.log(runner.trace.length,s.round,s.turn,s.phase,s.events.length,runner.trace.at(-1)?.chosen?.kind);}} console.log('FINISHED',runner.trace.length,runner.engine.getState().mission?.matchResult);}
catch(e){console.error('FAIL',e.stack,JSON.stringify(runner.trace.slice(-8))); const state=runner.engine.getState(); console.error('INVALID',state.units.filter(u=>u.location&&u.location!=='DESTROYED'&&!u.models.some(m=>m.alive)).map(u=>[u.id,u.location]));process.exitCode=1;}
