import { GameEngine } from '../engine/GameEngine';
import type { GameState } from '../models';
import type { RandomSource } from '../utils/dice';
import { getLegalActions, performAction, type LegalAction } from '../actions/LegalActions';
import { expectedDamage } from './AiEvaluator';

export type AiDifficulty = 'STANDARD';
export interface AiDecisionTrace { phase: string; step: string; playerId: string; considered: string[]; chosen?: LegalAction; score?: number; failure?: string }

/** Greedy, bounded policy over engine-authorized actions. Never writes GameState. */
export class AiController {
  readonly difficulty: AiDifficulty = 'STANDARD';
  private readonly abandonedMoves=new Set<string>();
  constructor(readonly playerId: string, private readonly rng: RandomSource) {}
  private score(action: LegalAction, state: GameState): number {
    switch(action.kind) {
      case 'DEPLOY_FORMATION': case 'INGRESS_FORMATION': {
        const positions=Object.values(action.formation);
        const centre=positions.reduce((n,p)=>n+p.x,0)/positions.length;
        const advance=positions.reduce((n,p)=>n+Math.abs(p.y-state.battlefield.height/2),0)/positions.length;
        return 100-Math.abs(centre-state.battlefield.width/2)*0.15-advance*2;
      }
      case 'START_ACTION': return action.actionId==='TEST_DATA_UPLOAD'?90:80;
      case 'FIRE_WEAPON': case 'MELEE_ATTACK': case 'SELECT_SHOOTING_TARGET': case 'SELECT_MELEE_TARGET': {
        const source=state.shooting?.unitId??state.closeCombat?.fight?.selected?.unitId;
        const attacker=state.units.find(u=>u.id===source),target=state.units.find(u=>u.id===action.targetId);
        const weapon=state.definitions.find(d=>d.id===attacker?.definitionId)?.weapons.find(w=>w.id===action.weaponId);
        return 70+(attacker&&target&&weapon?Math.min(12,expectedDamage(state,attacker,target,weapon)):0);
      }
      case 'BEGIN_SHOOTING': return 65;
      case 'SELECT_CHARGE_TARGETS': return 62;
      case 'DECLARE_CHARGE': return 60;
      case 'BEGIN_MOVE': return 55;
      case 'MOVE_MODEL': {
        const tx=state.movement!,unit=state.units.find(u=>u.id===tx.unitId)!,model=unit.models.find(m=>m.id===action.modelId)!;
        const original=tx.originals.find(m=>m.modelId===model.id)!;
        if(Math.hypot(model.position.x-original.position.x,model.position.y-original.position.y)>0.01)return -10;
        const desired=state.mission?.objectives.filter(o=>o.controllingPlayerId!==unit.playerId).map(o=>state.battlefield.terrain?.areas.find(a=>a.id===o.terrainAreaId))
          .filter((area):area is NonNullable<typeof area>=>!!area).map(area=>({x:area.footprint.vertices.reduce((n,p)=>n+p.x,0)/area.footprint.vertices.length,
            y:area.footprint.vertices.reduce((n,p)=>n+p.y,0)/area.footprint.vertices.length}))??[];
        const improvement=Math.max(0,...desired.map(p=>Math.hypot(model.position.x-p.x,model.position.y-p.y)-Math.hypot(action.target.x-p.x,action.target.y-p.y)));
        return 50+improvement;
      }
      case 'COMPLETE_MOVE': return 40;
      case 'CANCEL_MOVE': return -30;
      case 'COMBAT_MOVE_MODEL': return 51;
      case 'COMPLETE_COMBAT_MOVE': return 60;
      case 'FAIL_CHARGE': return -20;
      case 'COMPLETE_SHOOTING': case 'COMPLETE_FIGHT': return 20;
      case 'ADVANCE_PHASE': return 0;
      case 'USE_STRATAGEM': return ['SHIELD_NODES','DEFT_PARRY','WARDING_SALVOES','BLADES_OF_ASURYAN','CRUEL_BLADESMAN'].includes(action.id)?12:-5;
      case 'AGILE_MANOEUVRE': return action.id==='SWIFT_AS_THE_WIND'?56:action.id==='SUDDEN_STRIKE'?75:-5;
      case 'USE_FACTION_ABILITY': return 75;
      case 'PASS_WINDOW': return 1;
      default: return 30;
    }
  }
  choose(engine: GameEngine, snapshot?:GameState): {action: LegalAction | null; trace: AiDecisionTrace} {
    const state=snapshot??engine.getState(), legal=getLegalActions(engine,this.playerId,state).filter(action=>
      action.kind!=='BEGIN_MOVE'||!this.abandonedMoves.has(`${state.flow?.phaseIndex}:${action.unitId}`));
    const ranked=legal.map(action=>({action,score:this.score(action,state)})).sort((a,b)=>b.score-a.score);
    const best=ranked[0];
    return {action:best?.action??null,trace:{phase:state.phase,step:state.deployment?.stage==='BATTLE_STARTED'?(state.flow?.commandStep??state.closeCombat?.fight?.step??'PHASE'):state.deployment?.stage??'PRE_BATTLE',
      playerId:this.playerId,considered:[...new Set(legal.map(a=>a.kind))],chosen:best?.action,score:best?.score}};
  }
  execute(engine: GameEngine, decision = this.choose(engine)): AiDecisionTrace {
    const {action,trace}=decision;
    if(!action) return {...trace,failure:'NO_LEGAL_ACTION'};
    const result=performAction(engine,action,this.rng);
    if(result.ok && action.kind==='CANCEL_MOVE') this.abandonedMoves.add(`${engine.getState().flow?.phaseIndex}:${engine.getState().events.at(-1)?.unitId}`);
    return result.ok?trace:{...trace,failure:result.reason};
  }
}
