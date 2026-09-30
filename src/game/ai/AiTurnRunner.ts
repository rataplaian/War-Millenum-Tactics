import { GameEngine } from '../engine/GameEngine';
import { createAeldariVsEmperorsChildrenMatch } from '../content/presets';
import { createSeededRng } from '../utils/dice';
import { AiController, type AiDecisionTrace } from './AiController';
import { CloseCombatController } from '../engine/CloseCombatController';
import { nextFightSelection } from '../rules/FightSequenceController';
import type { GameState } from '../models';

export class AiStallError extends Error {
  constructor(message: string, readonly trace: AiDecisionTrace[]) { super(message); }
}
/** One bounded decision at a time, so the same loop works for tests and mobile scheduling. */
export class AiTurnRunner {
  readonly trace: AiDecisionTrace[]=[];
  private readonly controllers: Record<string,AiController>;
  private readonly repeated=new Map<string,number>();
  constructor(readonly engine: GameEngine, seed: number, readonly maxSteps=25000) {
    const players=engine.getState().players;
    this.controllers=Object.fromEntries(players.map((p,i)=>[p.id,new AiController(p.id,createSeededRng((seed+i*7919)>>>0))]));
  }
  nextActorId(snapshot?:GameState): string | undefined {
    const s=snapshot??this.engine.getState();
    return s.deployment?.stage==='DEPLOY_ARMIES'?this.engine.getDeploymentOptions().nextPlayerId??s.activePlayerId:
      s.deployment?.stage==='PRE_BATTLE_RULES'?s.units.find(u=>u.id===this.engine.getDeploymentOptions().scoutUnitIds[0])?.playerId??s.activePlayerId:
      s.flow?.window?s.players.find(p=>!s.flow!.window!.passedPlayerIds.includes(p.id))?.id??s.activePlayerId:
      s.fightOnDeath?.[0]?.defenderUnitId?s.units.find(u=>u.id===s.fightOnDeath![0]!.defenderUnitId)?.playerId:
      s.reactionShooting?.unitId?s.units.find(u=>u.id===s.reactionShooting!.unitId)!.playerId:
      s.shooting?.unitId?s.units.find(u=>u.id===s.shooting!.unitId)!.playerId:
      s.transportState?.destroyed[0]?.remainingPassengerIds[0]?s.units.find(u=>u.id===s.transportState!.destroyed[0]!.remainingPassengerIds[0])!.playerId:
      s.setup?.unitId?s.units.find(u=>u.id===s.setup!.unitId)!.playerId:
      s.reactionMove?.unitId?s.units.find(u=>u.id===s.reactionMove!.unitId)!.playerId:
      s.closeCombat?.move?.unitId?s.units.find(u=>u.id===s.closeCombat!.move!.unitId)!.playerId:
      s.closeCombat?.fight?.selected?.unitId?s.units.find(u=>u.id===s.closeCombat!.fight!.selected!.unitId)!.playerId:
      s.phase==='Fight'&&s.closeCombat?.fight?.step==='PILE_IN'?new CloseCombatController(s).pileInUnits()[0]?.playerId??s.activePlayerId:
      s.phase==='Fight'&&s.closeCombat?.fight?.step==='CONSOLIDATE'?new CloseCombatController(s).consolidateUnits()[0]?.playerId??s.activePlayerId:
      s.phase==='Fight'&&s.closeCombat?.fight?.step==='FIGHT'?nextFightSelection(s)?.playerId??s.activePlayerId:s.activePlayerId;
  }
  step(): AiDecisionTrace {
    const s=this.engine.getState(),playerId=this.nextActorId(s);
    const candidates=playerId?[playerId]:s.players.map(p=>p.id);
    const chosen=candidates.map(id=>this.controllers[id]!.choose(this.engine,s)).find(x=>x.action);
    const trace=chosen?.action?this.controllers[chosen.trace.playerId]!.execute(this.engine,chosen):
      {phase:s.phase,step:s.closeCombat?.fight?.step??s.flow?.commandStep??s.deployment?.stage??'PHASE',playerId:playerId??'',considered:[],failure:'NO_LEGAL_ACTION'};
    this.trace.push(trace);
    if(this.trace.length>this.maxSteps)throw new AiStallError(`AI step budget ${this.maxSteps} exceeded`,this.trace.slice(-30));
    if(trace.failure)throw new AiStallError(`${trace.failure} at ${trace.step} (${trace.phase})`,this.trace.slice(-30));
    const next=this.engine.getState();
    const key=`${next.round}:${next.turn}:${next.phase}:${next.deployment?.stage}:${next.flow?.phaseIndex}:${next.flow?.commandStep}:${next.flow?.window?.id}:${next.movement?.unitId}:${next.shooting?.unitId}:${next.closeCombat?.fight?.step}:${next.closeCombat?.fight?.selected?.unitId}:${next.events.length}`;
    const count=(this.repeated.get(key)??0)+1;this.repeated.set(key,count);
    if(count>3)throw new AiStallError(`Repeated state ${key}`,this.trace.slice(-30));
    return trace;
  }
  run() {
    while(this.engine.getState().status==='in-progress')this.step();
    return {state:this.engine.getState(),steps:this.trace.length,trace:this.trace};
  }
}
export function runMatchToCompletion(seed:number) {
  return new AiTurnRunner(new GameEngine(createAeldariVsEmperorsChildrenMatch(seed)),seed).run();
}
