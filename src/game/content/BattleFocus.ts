import { applyEffect } from '../effects/EffectEngine';
import type { CommandResult, GameState, Unit } from '../models';
import { onBattlefield } from '../reserves/location';
import { failure } from '../rules/movement';
import { hasFactionRule } from './factionRules';
import { flowEvent } from '../flow/events';
import { rollD6, type RandomSource } from '../utils/dice';
import { canUseSuperlativeStrategist, rollStrategistDie } from './strategist';

export const AGILE_MANOEUVRES = ['SWIFT_AS_THE_WIND','FLITTING_SHADOWS','STAR_ENGINES','SUDDEN_STRIKE','OPPORTUNITY_SEIZED','FADE_BACK'] as const;
export type AgileManoeuvre = typeof AGILE_MANOEUVRES[number];
const tokens = { INCURSION:2, STRIKE_FORCE:4, ONSLAUGHT:6 } as const;
export function resetBattleFocus(s: GameState): void {
  if (!s.battleFocus) return;
  s.battleFocus.round=s.round;
  s.battleFocus.tokens=Object.fromEntries(s.players.map(p=>[p.id,s.units.some(u=>u.playerId===p.id && hasFactionRule(s,u,'BATTLE_FOCUS')) ? tokens[s.battleFocus!.battleSize] : 0]));
  s.battleFocus.usedByPhase={};s.battleFocus.manoeuvresByPhase={};
}
/** One token and one manoeuvre per unit per phase; only Swift may repeat on different units. */
export function useAgileManoeuvre(s:GameState,id:AgileManoeuvre,unitId:string, trigger: 'MOVE'|'SETUP'|'CHARGE'|'FIGHT'|'ENEMY_FALL_BACK'|'AFTER_ENEMY_SHOT', moveType?: 'NORMAL_MOVE'|'ADVANCE_MOVE'|'FALL_BACK_MOVE', rng?:RandomSource, reroll=false): CommandResult {
  const focus=s.battleFocus,u=s.units.find(x=>x.id===unitId);
  const incomingSetup=id==='FLITTING_SHADOWS' && trigger==='SETUP' && s.phase==='Movement' && s.setup?.unitId===unitId && s.setup.kind==='INGRESS_MOVE';
  if (!focus || !u || !hasFactionRule(s,u,'BATTLE_FOCUS') || (!onBattlefield(u) && !incomingSetup) || !u.models.some(m=>m.alive)) return failure('UNIT_NOT_ELIGIBLE');
  if (trigger==='MOVE' && (s.movement || u.state.hasMoved)) return failure('MOVEMENT_IN_PROGRESS');
  if (!AGILE_MANOEUVRES.includes(id) || focus.round!==s.round || (focus.tokens[u.playerId]??0)<1) return failure('UNIT_NOT_ELIGIBLE');
  if (u.state.battleShocked) return failure('BATTLE_SHOCKED');
  const key=String(s.flow?.phaseIndex??s.phase);
  if (focus.usedByPhase[key]?.includes(unitId) || (id!=='SWIFT_AS_THE_WIND' && focus.manoeuvresByPhase[key]?.includes(id))) return failure('USAGE_LIMIT');
  const ownTurn=u.playerId===s.activePlayerId;
  if (id==='SWIFT_AS_THE_WIND' && !(ownTurn && s.phase==='Movement' && trigger==='MOVE' && !!moveType)) return failure('WRONG_TIMING');
  if (id==='FLITTING_SHADOWS' && !(ownTurn && (s.phase==='Movement' && (trigger==='MOVE' && !!moveType && !s.movement && !u.state.hasMoved || incomingSetup) || s.phase==='Charge' && trigger==='CHARGE' && !s.closeCombat?.charge && !s.closeCombat?.declared.includes(unitId)))) return failure('WRONG_TIMING');
  if (id==='STAR_ENGINES' && !(ownTurn && s.phase==='Movement' && trigger==='MOVE' && moveType==='ADVANCE_MOVE' && s.definitions.find(d=>d.id===u.definitionId)?.keywords.includes('VEHICLE'))) return failure('WRONG_TIMING');
  if (id==='SUDDEN_STRIKE' && !(ownTurn && s.phase==='Fight' && trigger==='FIGHT' && s.closeCombat?.fight?.selected?.unitId===unitId)) return failure('WRONG_TIMING');
  if (id==='OPPORTUNITY_SEIZED' && !(s.phase==='Movement' && !ownTurn && trigger==='ENEMY_FALL_BACK' && s.flow?.window?.trigger==='AFTER_ENEMY_FALL_BACK')) return failure('WRONG_TIMING');
  if (id==='FADE_BACK' && !(s.phase==='Shooting' && !ownTurn && trigger==='AFTER_ENEMY_SHOT' && s.flow?.window?.trigger==='AFTER_UNIT_SHOT')) return failure('WRONG_TIMING');
  if (id==='OPPORTUNITY_SEIZED') {
    const fallen=s.flow?.window?.unitId;
    if(!fallen || !(s.factionHistory?.engagedAtPhaseStart?.[unitId]??[]).includes(fallen)) return failure('UNIT_NOT_ELIGIBLE');
  }
  if (id==='FADE_BACK') {
    const attacker=s.flow?.window?.unitId;
    const from=[...s.events].reverse().find(e=>e.type==='shooting-started' && e.unitId===attacker)?.sequence??0;
    if(!attacker || !s.events.some(e=>e.sequence>from && e.type==='weapon-fired' && e.unitId===attacker && e.resolution.targetUnitId===unitId && e.resolution.hits>0)) return failure('UNIT_NOT_ELIGIBLE');
  }
  if (reroll && (!(id==='FADE_BACK'||id==='OPPORTUNITY_SEIZED') || !canUseSuperlativeStrategist(s,u))) return failure('INVALID_ABILITY_CHOICE');
  if(id==='FADE_BACK'||id==='OPPORTUNITY_SEIZED') {
    if (s.reactionMove || s.movement || s.shooting || s.closeCombat?.move || s.definitions.find(d=>d.id===u.definitionId)?.keywords.includes('TITANIC')) return failure('UNIT_NOT_ELIGIBLE');
    if (!rng) return failure('INVALID_CONFIGURATION');
  }
  if (id==='SWIFT_AS_THE_WIND') applyEffect(s,{source:id,target:{unitId},payload:{kind:'MODIFIER',characteristic:'MOVE',value:2},expiry:'END_OF_CURRENT_PHASE',stacking:'NON_STACKING'});
  if (id==='FLITTING_SHADOWS') applyEffect(s,{source:id,target:{unitId},payload:{kind:'FLAG',flag:'NO_OVERWATCH',value:true},expiry:'END_OF_CURRENT_TURN',stacking:'NON_STACKING'});
  if (id==='STAR_ENGINES') applyEffect(s,{source:id,target:{unitId},payload:{kind:'FLAG',flag:'RANGED_ASSAULT',value:true},expiry:'END_OF_CURRENT_TURN',stacking:'NON_STACKING'});
  if (id==='SUDDEN_STRIKE') applyEffect(s,{source:id,target:{unitId},payload:{kind:'FLAG',flag:'EXTENDED_TACTICAL_MOVE',value:true},expiry:'END_OF_CURRENT_PHASE',stacking:'NON_STACKING'});
  if(id==='FADE_BACK'||id==='OPPORTUNITY_SEIZED') {
    const die=reroll ? rollStrategistDie(rng!,true) : undefined;
    const roll=die?.value ?? rollD6(rng!);
    s.reactionMove={unitId,source:id,allowance:roll+1,originals:u.models.map(m=>({modelId:m.id,position:{...m.position}})),used:{}};
    flowEvent(s,'AGILE_MANOEUVRE_USED',{manoeuvre:id,roll,allowance:roll+1,...(die?{initial:die.initial,rerolled:die.wasRerolled,source:'SUPERLATIVE_STRATEGIST'}:{})},unitId,u.playerId);
  } else flowEvent(s,'AGILE_MANOEUVRE_USED',{manoeuvre:id},unitId,u.playerId);
  focus.tokens[u.playerId] = focus.tokens[u.playerId]! - 1; (focus.usedByPhase[key]??=[]).push(unitId);(focus.manoeuvresByPhase[key]??=[]).push(id);
  return {ok:true,value:undefined};
}
