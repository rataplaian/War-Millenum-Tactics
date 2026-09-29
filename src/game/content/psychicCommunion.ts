import type { GameState, Unit } from '../models';
import { modelDefinition, modelKeywords } from '../attachments/queries';
import { onBattlefield } from '../reserves/location';
import { edgeDistance, EPSILON } from '../utils/geometry';

/** Freeze the Warlock's nearby Psykers when its unit is selected to shoot. */
export function psychicCommunionBonus(state:GameState,unit:Unit):number {
  if (!onBattlefield(unit)) return 0;
  const warlocks=unit.models.filter(m=>m.alive && modelDefinition(state,unit,m).abilities.some(a=>a.id==='PSYCHIC_COMMUNION'));
  return Math.max(0,...warlocks.map(warlock=>Math.min(2,state.units.filter(onBattlefield).flatMap(u=>u.models.filter(m=>
    m.alive && m.id!==warlock.id && u.playerId===unit.playerId &&
    modelKeywords(state,u,m).includes('AELDARI') && modelKeywords(state,u,m).includes('PSYKER') &&
    edgeDistance(warlock,m)<=6+EPSILON)).length)));
}
