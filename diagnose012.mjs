import {AiTurnRunner} from './src/game/ai/AiTurnRunner.ts';
import {GameEngine} from './src/game/engine/GameEngine.ts';
import {createAeldariVsEmperorsChildrenMatch} from './src/game/content/presets.ts';
import {passWindow} from './src/game/flow/TimingWindows.ts';
import {synchronizeMission} from './src/game/missions/MissionEngine.ts';
const seed=Number(process.argv[2]??1), runner=new AiTurnRunner(new GameEngine(createAeldariVsEmperorsChildrenMatch(seed)),seed);
try {runner.run();console.log('FINISHED',seed,runner.trace.length,runner.engine.getState().mission?.matchResult);}
catch(e){const s=runner.engine.getState();const draft=structuredClone(s);for(const p of draft.players)if(draft.flow?.window&&!draft.flow.window.passedPlayerIds.includes(p.id)){passWindow(draft,p.id);break;}synchronizeMission(draft);console.error('DRAFT',draft.turn,draft.round,draft.status,draft.mission?.activeActions.map(a=>[a.actionId,a.unitId,a.playerId,a.startedAt,a.completesAt,a.state,draft.units.some(u=>u.id===a.unitId&&u.playerId===a.playerId)]));console.error('FAIL',seed,e.stack,'step',runner.trace.length,'round',s.round,'turn',s.turn,'phase',s.phase,'window',s.flow?.window,'activeActions',s.mission?.activeActions.filter(x=>x.state==='ACTIVE'),'recent',JSON.stringify(runner.trace.slice(-10)));process.exitCode=1;}
