import type { GameState } from '../models';
import type { AttackJob } from '../combat/types';
import { modelDefinition, unitKeywords } from '../attachments/queries';
import { applyEffect } from '../effects/EffectEngine';

/** Post-resolution hook shared by profile-based slowing effects; it runs only after a weapon has shot. */
export function applyShootingOnHitEffects(state: GameState, job: AttackJob): void {
  if (!state.flow || job.weapon.kind !== 'ranged' || !job.resolution.attackRecords?.some(r=>r.hitSucceeded)) return;
  const source=state.units.find(u=>u.id===job.attackerUnitId),target=state.units.find(u=>u.id===job.target.id);
  if (!source || !target?.models.some(m=>m.alive)) return;
  const hits=job.resolution.attackRecords.filter(r=>r.hitSucceeded).map(r=>source.models.find(m=>m.id===r.modelId)).filter(m=>m!==undefined);
  const bearerHas=(abilityId:string)=>hits.some(m=>modelDefinition(state,source,m).abilities.some(a=>a.id===abilityId));
  const rule=job.weapon.id.endsWith('doomweaver') && bearerHas('MONOFILAMENT_WEB') ? 'MONOFILAMENT_WEB'
    : job.weapon.id.endsWith('agonising-energies') && unitKeywords(state,target).includes('INFANTRY') && bearerHas('WRACKING_AGONIES') ? 'WRACKING_AGONIES' : null;
  if (!rule) return;
  for (const characteristic of ['MOVE','CHARGE_ROLL'] as const) applyEffect(state,{
    source:rule,target:{unitId:target.id},payload:{kind:'MODIFIER',characteristic,value:-2},
    expiry:'START_OF_NEXT_COMMAND_PHASE',expiryPlayerId:source.playerId,stacking:'REPLACE_SAME_SOURCE',
  });
}
