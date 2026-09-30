import { GameEngine } from '../engine/GameEngine';
import { createAeldariVsEmperorsChildrenMatch } from '../content/presets';
import { createSeededRng } from '../utils/dice';
import type { CommandResult, GameState } from '../models';
import { getLegalActions, performAction, type LegalAction } from '../actions/LegalActions';
import { AiTurnRunner, type AiStallError } from '../ai/AiTurnRunner';
import type { AiDecisionTrace } from '../ai/AiController';

export type PlayerControl = 'HUMAN' | 'AI';
export type SessionStatus = 'HUMAN_DECISION' | 'AI_DECISION' | 'FINISHED';

/** Orchestration and turn ownership only. Every game mutation goes through GameEngine. */
export class PlaySession {
  readonly engine: GameEngine;
  readonly humanPlayerId: string;
  readonly aiPlayerId: string;
  readonly runner: AiTurnRunner;
  private readonly humanRng;
  constructor(seed: number, humanFaction: 'AELDARI' | 'EMPERORS_CHILDREN' = 'AELDARI', snapshot?: GameState) {
    this.engine=new GameEngine(snapshot??createAeldariVsEmperorsChildrenMatch(seed));
    const state=this.engine.getState();
    this.humanPlayerId=state.players.find(p=>p.factionId===humanFaction)!.id;
    this.aiPlayerId=state.players.find(p=>p.id!==this.humanPlayerId)!.id;
    this.runner=new AiTurnRunner(this.engine,seed);
    this.humanRng=createSeededRng((seed^0x5eeda11)>>>0);
  }
  getState() {return this.engine.getState();}
  get status(): SessionStatus {
    if(this.getState().status==='finished')return 'FINISHED';
    const actor=this.runner.nextActorId();
    if(actor===this.humanPlayerId)return 'HUMAN_DECISION';
    if(actor===this.aiPlayerId)return 'AI_DECISION';
    return getLegalActions(this.engine,this.humanPlayerId).length?'HUMAN_DECISION':'AI_DECISION';
  }
  getHumanActions() {return this.status==='HUMAN_DECISION'?getLegalActions(this.engine,this.humanPlayerId):[];}
  submit(action: LegalAction): CommandResult<unknown> {
    if(this.status!=='HUMAN_DECISION')return {ok:false,reason:'NOT_YOUR_UNIT'};
    const legal=this.getHumanActions();
    // Positions outside the bounded suggestions remain available to a human via engine preview.
    const custom=action.kind==='MOVE_MODEL'?this.engine.previewMove(action.modelId,action.target).ok:
      action.kind==='COMBAT_MOVE_MODEL'?this.engine.previewCombatMove(action.modelId,action.target).ok:false;
    if(!custom&&!legal.some(choice=>JSON.stringify(choice)===JSON.stringify(action)))return {ok:false,reason:'UNIT_NOT_ELIGIBLE'};
    return performAction(this.engine,action,this.humanRng);
  }
  /** Small chunks keep React Native responsive; call again while AI_DECISION. */
  advanceAi(maxDecisions=8): {status: SessionStatus; trace: AiDecisionTrace[]} {
    const trace:AiDecisionTrace[]=[];
    for(let i=0;i<maxDecisions&&this.status==='AI_DECISION';i++)trace.push(this.runner.step());
    return {status:this.status,trace};
  }
}
