import type { StratagemDefinition, StratagemPolicies } from '../stratagems/types';
import type { CommandResult, GameState, Unit } from '../models';
import { failure } from '../rules/movement';
import { applyEffect } from '../effects/EffectEngine';
import { modelWithinObjective } from '../missions/objectives';
import { moveUnitToReserves } from '../reserves/ReserveController';
import { modelDefinition, unitKeywords } from '../attachments/queries';
import { isUnitEngaged } from '../rules/spatial';
import { edgeDistance, EPSILON } from '../utils/geometry';
import { flowEvent } from '../flow/events';
import { isBelowHalfStrength, resolveBattleShockRoll } from '../command/BattleShock';
import { canDeclareCharge, emptyCloseCombat } from '../rules/closeCombat';
import { CloseCombatController } from '../engine/CloseCombatController';

const timing=(phases:StratagemDefinition['timing']['phases'], triggers:StratagemDefinition['timing']['triggers'],ownership:StratagemDefinition['timing']['ownership']):StratagemDefinition['timing']=>({phases,triggers,ownership});
const friendly={relation:'FRIENDLY' as const,count:1};
const guardian={...friendly,keywords:['AELDARI']};
const peerless={...friendly,keywords:['EMPERORS_CHILDREN']};
const living=(s:GameState,id:string)=>s.units.find(u=>u.id===id)!;
const withinObjective=(s:GameState,u:Unit)=>!!s.mission?.objectives.some(o=>u.models.some(m=>m.alive&&modelWithinObjective(s,m,o)));
const effect=(s:GameState,id:string,source:string,flag:string,expiry:'END_OF_CURRENT_TURN'|'END_OF_CURRENT_PHASE'='END_OF_CURRENT_PHASE')=>applyEffect(s,{source,target:{unitId:id},payload:{kind:'FLAG',flag,value:true},expiry,stacking:'REPLACE_SAME_SOURCE'});
/** IDs, costs, targets and windows checked against 11e faction-pack entries; no lore text is embedded. */
export const GUARDIAN_STRATAGEMS: readonly StratagemDefinition[]=[
  {id:'WARDING_SALVOES',name:'Warding Salvoes',labels:['BATTLE_TACTIC'],cpCost:1,timing:timing(['Shooting','Fight'],['START_OF_PHASE'],'YOUR_TURN'),target:{...guardian,keywordAny:['DIRE_AVENGERS','GUARDIANS']},conditions:['ON_BATTLEFIELD','ALIVE'],restrictions:['NOT_SELECTED'],resolverId:'WARDING_SALVOES'},
  {id:'SHIELD_NODES',name:'Shield Nodes',labels:['BATTLE_TACTIC'],cpCost:1,timing:timing(['Shooting','Fight'],['AFTER_TARGET_SELECTED'],'OPPONENT_TURN'),target:{...guardian,selectedTargetOnly:true,keywordAny:['DIRE_AVENGERS','GUARDIANS']},conditions:['ON_BATTLEFIELD','ALIVE'],restrictions:['OBJECTIVE_RANGE'],resolverId:'SHIELD_NODES'},
  {id:'VAULS_VENGEANCE',name:"Vaul's Vengeance",labels:['BATTLE_TACTIC'],cpCost:1,timing:timing(['Shooting','Fight'],['AFTER_ENEMY_DESTROYED'],'OPPONENT_TURN'),target:{...guardian,keywords:['WAR_WALKERS']},conditions:['ON_BATTLEFIELD','ALIVE'],usageLimits:{perBattleRound:1},resolverId:'VAULS_VENGEANCE'},
  {id:'TIME_TO_STRIKE',name:'Time to Strike',labels:['STRATEGIC_PLOY'],cpCost:1,timing:timing(['Movement'],['START_OF_PHASE'],'YOUR_TURN'),target:{...guardian,keywords:['STORM_GUARDIANS']},conditions:['ON_BATTLEFIELD','ALIVE'],restrictions:['NOT_MOVED'],resolverId:'TIME_TO_STRIKE'},
  {id:'BLADES_OF_ASURYAN',name:'Blades of Asuryan',labels:['BATTLE_TACTIC'],cpCost:1,timing:timing(['Shooting'],['START_OF_PHASE'],'YOUR_TURN'),target:{...guardian,keywordAny:['DIRE_AVENGERS','GUARDIANS']},conditions:['ON_BATTLEFIELD','ALIVE','NOT_SHOT'],resolverId:'APPLY_EFFECT',effect:{source:'BLADES_OF_ASURYAN',payload:{kind:'FLAG',flag:'RANGED_PISTOL',value:true},expiry:'END_OF_CURRENT_PHASE',stacking:'REPLACE_SAME_SOURCE'}},
  {id:'COST_OF_VICTORY',name:'Cost of Victory',labels:['STRATEGIC_PLOY'],cpCost:1,timing:timing(['Fight'],['END_OF_PHASE'],'OPPONENT_TURN'),target:{...guardian,keywords:['GUARDIANS']},conditions:['ON_BATTLEFIELD','ALIVE'],restrictions:['NOT_ENGAGED'],resolverId:'COST_OF_VICTORY'},
];
export const PEERLESS_STRATAGEMS: readonly StratagemDefinition[]=[
  {id:'DEFT_PARRY',name:'Deft Parry',labels:['BATTLE_TACTIC'],cpCost:1,timing:timing(['Fight'],['AFTER_TARGET_SELECTED'],'OPPONENT_TURN'),target:{...peerless,selectedTargetOnly:true},conditions:['ON_BATTLEFIELD','ALIVE'],resolverId:'APPLY_EFFECT',effect:{source:'DEFT_PARRY',payload:{kind:'FLAG',flag:'DEFENDER_HIT_PENALTY',value:true},expiry:'END_OF_CURRENT_PHASE',stacking:'REPLACE_SAME_SOURCE'}},
  {id:'DEATH_ECSTASY',name:'Death Ecstasy',labels:['STRATEGIC_PLOY'],cpCost:2,timing:timing(['Fight'],['AFTER_TARGET_SELECTED'],'OPPONENT_TURN'),target:{...peerless,selectedTargetOnly:true},conditions:['ON_BATTLEFIELD','ALIVE'],resolverId:'APPLY_EFFECT',effect:{source:'DEATH_ECSTASY',payload:{kind:'FLAG',flag:'FIGHT_ON_DEATH',value:true},expiry:'END_OF_CURRENT_PHASE',stacking:'REPLACE_SAME_SOURCE'}},
  {id:'INCESSANT_VIOLENCE',name:'Incessant Violence',labels:['BATTLE_TACTIC'],cpCost:1,timing:timing(['Fight'],['BEFORE_CONSOLIDATE'],'EITHER'),target:peerless,conditions:['ON_BATTLEFIELD','ALIVE'],restrictions:['WINDOW_UNIT'],resolverId:'APPLY_EFFECT',effect:{source:'INCESSANT_VIOLENCE',payload:{kind:'FLAG',flag:'EXTENDED_ENGAGING_CONSOLIDATE',value:true},expiry:'END_OF_CURRENT_PHASE',stacking:'REPLACE_SAME_SOURCE'}},
  {id:'CRUEL_BLADESMAN',name:'Cruel Bladesman',labels:['BATTLE_TACTIC'],cpCost:1,timing:timing(['Fight'],['START_OF_PHASE'],'YOUR_TURN'),target:peerless,conditions:['ON_BATTLEFIELD','ALIVE'],restrictions:['CHARGED_NOT_FOUGHT'],resolverId:'APPLY_EFFECT',effect:{source:'CRUEL_BLADESMAN',payload:{kind:'FLAG',flag:'MELEE_AP_BONUS',value:true},expiry:'END_OF_CURRENT_PHASE',stacking:'REPLACE_SAME_SOURCE'}},
  {id:'TERRIFYING_SPECTACLE',name:'Terrifying Spectacle',labels:['STRATEGIC_PLOY'],cpCost:1,timing:timing(['Command'],['AT_START_OF_COMMAND_PHASE','START_OF_PHASE'],'OPPONENT_TURN'),target:peerless,conditions:['ON_BATTLEFIELD','ALIVE'],restrictions:['PREVIOUS_CHARGE_KILL'],resolverId:'TERRIFYING_SPECTACLE'},
  {id:'CUT_DOWN_THE_WEAK',name:'Cut Down the Weak',labels:['STRATEGIC_PLOY'],cpCost:2,timing:timing(['Movement'],['AFTER_ENEMY_FALL_BACK'],'OPPONENT_TURN'),target:peerless,conditions:['ON_BATTLEFIELD','ALIVE'],restrictions:['CHARGE_REACTION_ELIGIBLE'],resolverId:'CUT_DOWN_THE_WEAK'},
];
export const FACTION_STRATAGEMS=[...GUARDIAN_STRATAGEMS,...PEERLESS_STRATAGEMS] as const;
export const FACTION_STRATAGEM_POLICIES:StratagemPolicies={definitions:FACTION_STRATAGEMS,
  restrictions:{
    NOT_SELECTED:(s,_p,ids)=>ids.every(id=>{const u=living(s,id);return s.phase==='Shooting'?!u.selectedToShootAt||u.selectedToShootAt.turn!==s.turn:!u.state.hasFought&&!s.closeCombat?.fight?.selected;}),
    OBJECTIVE_RANGE:(s,_p,ids)=>ids.every(id=>withinObjective(s,living(s,id))),
    NOT_MOVED:(s,_p,ids)=>ids.every(id=>!living(s,id).state.hasMoved&&!s.movement),
    NOT_ENGAGED:(s,_p,ids)=>ids.every(id=>!isUnitEngaged(s,living(s,id))),
    WINDOW_UNIT:(s,_p,ids)=>ids.every(id=>s.flow?.window?.unitId===id),
    CHARGED_NOT_FOUGHT:(s,_p,ids)=>ids.every(id=>living(s,id).state.hasCharged&&!living(s,id).state.hasFought),
    PREVIOUS_CHARGE_KILL:(s,_p,ids)=>ids.every(id=>s.events.some(e=>e.type==='combat-move-completed'&&e.kind==='charge'&&e.unitId===id&&e.turn===s.turn-1)&&s.events.some(e=>e.type==='flow'&&e.name==='UNIT_DESTROYED'&&e.turn===s.turn-1&&e.detail.attackerUnitId===id)),
    CHARGE_REACTION_ELIGIBLE:(s,_p,ids)=>ids.every(id=>{const u=living(s,id),fallen=s.units.find(x=>x.id===s.flow?.window?.unitId);if(!fallen || unitKeywords(s,u).includes('VEHICLE')&&!unitKeywords(s,u).includes('WALKER') || !u.models.some(m=>m.alive&&fallen.models.some(n=>n.alive&&edgeDistance(m,n)<=6+EPSILON)))return false;
      const draft:GameState=JSON.parse(JSON.stringify(s));draft.closeCombat ??= emptyCloseCombat();draft.closeCombat.reaction={unitId:id,targetUnitId:fallen.id};return canDeclareCharge(draft,id).ok;}),
  },
  resolvers:{
    WARDING_SALVOES:(s,ids)=>{effect(s,ids[0]!,'WARDING_SALVOES','OBJECTIVE_WOUND_REROLL');return {ok:true,value:undefined};},
    SHIELD_NODES:(s,ids)=>{effect(s,ids[0]!,'SHIELD_NODES','DEFENDER_WOUND_PENALTY');return {ok:true,value:undefined};},
    TIME_TO_STRIKE:(s,ids)=>{effect(s,ids[0]!,'TIME_TO_STRIKE','FIXED_ADVANCE_SIX');effect(s,ids[0]!,'TIME_TO_STRIKE','AFTER_ADVANCE_SHOOT_CHARGE','END_OF_CURRENT_TURN');return {ok:true,value:undefined};},
    COST_OF_VICTORY:(s,ids)=>{const id=ids[0]!,u=living(s,id),result=moveUnitToReserves(s,id,'COST_OF_VICTORY');if(!result.ok)return result;
      const restored:string[]=[];for(const m of u.models) if(!m.alive && modelDefinition(s,u,m).keywords.some(k=>k.toUpperCase()==='GUARDIANS')){m.woundsRemaining=m.stats?.wounds??modelDefinition(s,u,m).stats.wounds;m.alive=true;restored.push(m.id);}
      flowEvent(s,'MODELS_RESTORED',{modelIds:restored},id,u.playerId);return {ok:true,value:undefined};},
    CUT_DOWN_THE_WEAK:(s,ids,_d,rng)=>{if(!rng || !s.flow?.window?.unitId)return failure('INVALID_CONFIGURATION');
      const id=ids[0]!,targetUnitId=s.flow.window.unitId;
      s.closeCombat ??= emptyCloseCombat();s.closeCombat.reaction={unitId:id,targetUnitId};
      const charge=new CloseCombatController(s).declareCharge(id,rng);
      return charge.ok ? {ok:true,value:undefined} : charge;},
    TERRIFYING_SPECTACLE:(s,ids,_d,rng)=>{if(!rng)return failure('INVALID_CONFIGURATION');const u=living(s,ids[0]!),outcomes=[];
      for(const enemy of s.units.filter(v=>v.playerId!==u.playerId&&v.models.some(m=>m.alive&&u.models.some(n=>n.alive&&edgeDistance(m,n)<=6+EPSILON)))){
        const roll=resolveBattleShockRoll(s,enemy,rng),penalty=isBelowHalfStrength(s,enemy)?1:0,lead=Math.min(...enemy.models.filter(m=>m.alive).map(m=>m.leadership??modelDefinition(s,enemy,m).stats.leadership));
        enemy.state.battleShocked=roll.total-penalty<lead;
        s.flow!.pending=s.flow!.pending.filter(p=>p.kind!=='BATTLE_SHOCK'||p.unitId!==enemy.id);
        outcomes.push(enemy.id);flowEvent(s,'BATTLE_SHOCK_ROLL_RESOLVED',{rolls:roll.rolls,total:roll.total,penalty,success:!enemy.state.battleShocked,source:'TERRIFYING_SPECTACLE'},enemy.id,enemy.playerId);
      }return {ok:true,value:undefined};},
  },
};
