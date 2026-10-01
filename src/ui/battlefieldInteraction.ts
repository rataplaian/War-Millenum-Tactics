import { GameEngine } from '../game/engine/GameEngine';
import { getLegalActions, type LegalAction } from '../game/actions/LegalActions';
import { modelDefinition, modelHasWeapon } from '../game/attachments/queries';
import { effectiveCharacteristic } from '../game/effects/EffectEngine';
import { movementAbilities } from '../game/abilities/movement';
import type { GameState, Model, Unit } from '../game/models';
import { baseRadius } from '../game/utils/geometry';
import { actionUnitId, actionTargets } from './playCommands';

export type RadialCommand = 'MOVE' | 'SHOOT' | 'CHARGE' | 'FIGHT' | 'INFO' | 'BACK';
const radialKinds: Record<Exclude<RadialCommand,'INFO'|'BACK'>, LegalAction['kind'][]> = {
  MOVE:['BEGIN_MOVE','MOVE_MODEL','COMBAT_MOVE_MODEL','REACTION_MOVE_MODEL'],
  SHOOT:['BEGIN_SHOOTING','SELECT_SHOOTING_TARGET','FIRE_WEAPON'],
  CHARGE:['DECLARE_CHARGE','SELECT_CHARGE_TARGETS'],
  FIGHT:['SELECT_FIGHT_UNIT','SELECT_MELEE_TARGET','MELEE_ATTACK','BEGIN_PILE_IN'],
};
/** Only existing decisions can become executable radial commands. INFO is read-only. */
export function radialCommands(actions: LegalAction[], state: GameState, unitId: string) {
  const own=actions.filter(a=>actionUnitId(a,state)===unitId);
  return (Object.keys(radialKinds) as Exclude<RadialCommand,'INFO'|'BACK'>[]).flatMap(id=>{
    const choices=own.filter(a=>radialKinds[id].includes(a.kind));
    return choices.length?[{id,actions:choices}]:[];
  });
}
export function movementEnvelope(s: GameState,u: Unit,m: Model): number {
  if(s.closeCombat?.move?.unitId===u.id) return Math.max(0,s.closeCombat.move.allowance-(s.closeCombat.move.used[m.id]??0));
  if(s.reactionMove?.unitId===u.id) return Math.max(0,s.reactionMove.allowance-(s.reactionMove.used[m.id]??0));
  const bonus=s.movement?.unitId===u.id?s.movement.bonus??0:0;
  return Math.max(0,effectiveCharacteristic(s,u.id,'MOVE',modelDefinition(s,u,m).stats.movement,m.id)+bonus-movementAbilities(s,m).penalty-(s.movement?.unitId===u.id?m.movementUsed:0));
}
/** Actual chosen profiles, including attached characters. Range is informational, not LOS. */
export function weaponReach(s: GameState,u: Unit,model?:Model) {
  const weapons=s.definitions.find(d=>d.id===u.definitionId)?.weapons??[];
  return weapons.filter(w=>w.kind==='ranged'&&(model?[model]:u.models).some(m=>m.alive&&modelHasWeapon(s,u,m,w.id)))
    .map(w=>({id:w.id,name:w.name,range:w.range as number}));
}
export function shootingTargetIds(actions: LegalAction[]) {
  return [...new Set(actions.filter(a=>a.kind==='SELECT_SHOOTING_TARGET'||a.kind==='FIRE_WEAPON').flatMap(actionTargets))];
}
/** Read-only previews on detached snapshots. No command here changes the live engine. */
export function selectionPreview(engine: GameEngine, playerId: string, unitId: string, actions: LegalAction[]) {
  const s=engine.getState();
  let movement=actions.filter(a=>['MOVE_MODEL','COMBAT_MOVE_MODEL','REACTION_MOVE_MODEL'].includes(a.kind)&&actionUnitId(a,s)===unitId);
  let shooting=actions.filter(a=>['SELECT_SHOOTING_TARGET','FIRE_WEAPON'].includes(a.kind)&&actionUnitId(a,s)===unitId);
  if(actions.some(a=>a.kind==='BEGIN_MOVE'&&a.unitId===unitId)) {
    const probe=new GameEngine(s);
    if(probe.beginMovement(unitId).ok) movement=getLegalActions(probe,playerId).filter(a=>a.kind==='MOVE_MODEL');
  }
  if(actions.some(a=>a.kind==='BEGIN_SHOOTING'&&a.unitId===unitId)) {
    const probe=new GameEngine(s);
    if(probe.beginShooting(unitId).ok) shooting=getLegalActions(probe,playerId).filter(a=>a.kind==='SELECT_SHOOTING_TARGET'||a.kind==='FIRE_WEAPON');
  }
  return {movement,shooting};
}
export interface ScreenBounds {left:number;top:number;right:number;bottom:number}
export function unitScreenBounds(unit:Unit,scale:number,pan:{x:number;y:number}):ScreenBounds {
  const models=unit.models.filter(m=>m.alive);
  return {left:Math.min(...models.map(m=>(m.position.x-baseRadius(m.base))*scale-pan.x)),
    right:Math.max(...models.map(m=>(m.position.x+baseRadius(m.base))*scale-pan.x)),
    top:Math.min(...models.map(m=>(m.position.y-baseRadius(m.base))*scale-pan.y)),
    bottom:Math.max(...models.map(m=>(m.position.y+baseRadius(m.base))*scale-pan.y))};
}
export function menuPlacement(anchor:{x:number;y:number},viewport:{width:number;height:number},size={width:220,height:180},avoid?:ScreenBounds) {
  const p={left:Math.max(0,Math.min(anchor.x-size.width/2,viewport.width-size.width)),top:Math.max(0,Math.min(anchor.y-size.height/2,viewport.height-size.height))};
  if(avoid&&p.left<avoid.right&&p.left+size.width>avoid.left&&p.top<avoid.bottom&&p.top+size.height>avoid.top){
    if(avoid.bottom+8+size.height<=viewport.height)p.top=Math.max(0,avoid.bottom+8);
    else if(avoid.top-8-size.height>=0)p.top=Math.min(viewport.height-size.height,avoid.top-8-size.height);
    else if(avoid.right+8+size.width<=viewport.width)p.left=Math.max(0,avoid.right+8);
    else if(avoid.left-8-size.width>=0)p.left=Math.min(viewport.width-size.width,avoid.left-8-size.width);
  }
  return p;
}
