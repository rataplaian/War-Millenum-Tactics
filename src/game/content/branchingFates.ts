import type { GameState } from '../models';
import type { AttackJob } from '../combat/types';
import { attachmentFor, modelKeywords, sourceAbilities } from '../attachments/queries';

export function branchingFatesStamp(s:GameState,sourceUnitId:string):string {
  return `BRANCHING_FATES:${s.flow?.phaseIndex??`${s.turn}:${s.phase}`}:${sourceUnitId}`;
}
/** The original Farseer must still lead; a detached or slain source grants no substitution. */
export function branchingFatesSource(s:GameState,job:AttackJob):string|undefined {
  const u=s.units.find(x=>x.id===job.attackerUnitId),m=u?.models.find(x=>x.id===job.current?.modelId);
  if(!u || !m?.alive || modelKeywords(s,u,m).includes('SUPPORT_WEAPON') || !attachmentFor(s,u.id))return;
  return sourceAbilities(s,u).find(x=>x.ability.id==='BRANCHING_FATES' && x.modelIds.some(id=>u.models.some(y=>y.id===id&&y.alive)) &&
    !s.flow?.resolvedAbilities.includes(branchingFatesStamp(s,x.sourceUnitId)))?.sourceUnitId;
}
