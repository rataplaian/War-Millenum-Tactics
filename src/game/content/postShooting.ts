import type { GameState, Unit } from '../models';
import { unitKeywords } from '../attachments/queries';

/** Only targets actually hit in this unit's most recently completed Shooting action. */
export function postShotHitTargets(state:GameState,unit:Unit,requiredKeyword?:string):Unit[] {
  const start=state.events.reduce((latest,e,index)=>e.type==='shooting-started'&&e.unitId===unit.id&&e.turn===state.turn?index:latest,-1);
  if(start<0 || !state.events.slice(start+1).some(e=>e.type==='shooting-completed'&&e.unitId===unit.id&&e.turn===state.turn))return [];
  const ids=new Set(state.events.slice(start+1).filter(e=>e.type==='weapon-fired'&&e.unitId===unit.id&&e.turn===state.turn&&e.resolution.hits>0).map(e=>e.type==='weapon-fired'?e.resolution.targetUnitId:''));
  return state.units.filter(target=>ids.has(target.id)&&target.playerId!==unit.playerId&&target.models.some(m=>m.alive)&&
    (!requiredKeyword||unitKeywords(state,target).includes(requiredKeyword)));
}
