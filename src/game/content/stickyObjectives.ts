import type { GameState } from '../models';
import { sourceAbilities } from '../attachments/queries';
import { onBattlefield } from '../reserves/location';
import { modelWithinObjective, resolveObjectiveControl, secureObjective } from '../missions/objectives';

/** Shared end-of-Command ability resolver. Secured control is maintained by Task 010. */
export function secureFactionObjectives(state:GameState):string[] {
  const secured:string[]=[];
  const eligible=state.units.filter(u=>u.playerId===state.activePlayerId && onBattlefield(u)).flatMap(unit=>
    sourceAbilities(state,unit).filter(entry=>
      (entry.ability.id==='STORMBLADES'||entry.ability.id==='OBJECTIVE_DEFILED') &&
      unit.models.some(m=>m.alive && (m.componentUnitId??unit.id)===entry.sourceUnitId))
      .map(source=>({unit,source})));
  if(!eligible.length) return secured;
  for(const objective of state.mission?.objectives ?? []) {
    resolveObjectiveControl(state,objective);
    if(objective.controllingPlayerId!==state.activePlayerId) continue;
    for(const {unit,source} of eligible) {
      if(!unit.models.some(m=>m.alive && modelWithinObjective(state,m,objective))) continue;
      if(secureObjective(state,objective.id,unit.playerId,source.ability.id)) secured.push(objective.id);
      break;
    }
  }
  return secured;
}
