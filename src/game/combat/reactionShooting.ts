import type { GameState, CommandResult, WeaponResolution } from '../models';
import type { RandomSource } from '../utils/dice';
import { validateShootingTarget } from '../rules/shootingTargets';
import { failure } from '../rules/movement';
import { createVisibilityProvider } from '../terrain/visibility';
import { rangedLoadout } from '../transports/FiringDeck';
import { createAttackJob, runAttackJob } from './AttackPipeline';
import { definitionFor } from '../rules/movement';
import { factionAttackWeapon } from '../content/attackAbilities';
import { flowEvent } from '../flow/events';
import { shootingModifiers } from '../terrain/attackModifiers';
import type { AttackChoices } from '../abilities/types';
import { validAttackChoices } from '../abilities/validation';
import { resolvedAbilities } from '../abilities/registry';
import { weaponInstanceId } from '../abilities/registry';
import { processAttachmentCasualties } from '../attachments/AttachmentController';
import { detectDestroyedTransports } from '../transports/TransportController';
import { normalizeDestroyed } from '../reserves/location';
import { queueDestructions } from './destruction';
import { recordTerrainChanges } from '../terrain/events';
import { applyShootingOnHitEffects } from '../content/onHitEffects';

/** A virtual Shooting-phase view for a locked, out-of-phase reaction. The real phase and player stay intact. */
export function reactionShootingView(s:GameState):GameState {
  const tx=s.reactionShooting;if(!tx)throw Error('No reaction Shooting transaction');
  const playerId=s.units.find(u=>u.id===tx.unitId)!.playerId;
  const view:GameState=JSON.parse(JSON.stringify(s));
  view.phase='Shooting';view.activePlayerId=playerId;
  if(view.flow){view.flow.window=null;view.flow.queuedWindows=[];view.flow.boundary='NONE';}
  view.shooting={unitId:tx.unitId,firedWeaponIds:[...tx.firedWeaponIds],hasRolled:false};
  view.units.find(u=>u.id===tx.unitId)!.state.hasShot=false;
  return view;
}
export function fireReactionWeapon(s:GameState,weaponId:string,rng:RandomSource,choices:AttackChoices={}):CommandResult<WeaponResolution> {
  const tx=s.reactionShooting;
  if(!tx||!rng)return failure('INVALID_CONFIGURATION');
  if(tx.firedWeaponIds.includes(weaponId))return failure('WEAPON_ALREADY_FIRED');
  const view=reactionShootingView(s),shooter=view.units.find(u=>u.id===tx.unitId)!,target=view.units.find(u=>u.id===tx.targetUnitId);
  if(!target?.models.some(m=>m.alive))return failure('INVALID_TARGET');
  const weapon=rangedLoadout(view,shooter).find(w=>w.id===weaponId);
  if(!weapon)return failure('WEAPON_NOT_FOUND');
  const profile=factionAttackWeapon(view,shooter,weapon,target);
  if(!validAttackChoices(profile,choices))return failure('INVALID_ABILITY_CHOICE');
  try { resolvedAbilities(view,target,weapon,choices); } catch { return failure('ABILITY_CHOICE_REQUIRED'); }
  view.shooting!.shootingMode=choices.shootingMode;
  const provider=createVisibilityProvider(view),legal=validateShootingTarget(view,tx.unitId,weaponId,tx.targetUnitId,provider);
  if(!legal.ok)return legal;
  const modifiers=shooter.models.filter(m=>legal.value.eligibleFiringModelIds.includes(m.id)).map(m=>shootingModifiers(view,m,target,weapon.skill,provider,weapon,choices));
  const job=createAttackJob(profile,legal.value.eligibleFiringModelIds,target,definitionFor(view,target),rng,modifiers,view,undefined,choices,provider);
  const before:GameState=JSON.parse(JSON.stringify(s));
  for(const model of s.units.find(u=>u.id===tx.unitId)!.models.filter(m=>legal.value.eligibleFiringModelIds.includes(m.id))) {
    if(job.contexts.find(c=>c.attackerModelId===model.id)!.abilities.some(a=>a.type==='ONE_SHOT')){
      model.oneShotExpended ??=[];
      model.oneShotExpended.push(weaponInstanceId(s,s.units.find(u=>u.id===tx.unitId)!,model,weapon));
    }
  }
  runAttackJob(job,rng,view);
  tx.hazardousCount=(tx.hazardousCount??0)+job.contexts.filter(c=>c.abilities.some(a=>a.type==='HAZARDOUS')).length;
  s.units=s.units.map(u=>u.id===target.id?job.target:u);
  tx.firedWeaponIds.push(weaponId);
  s.units.find(u=>u.id===tx.unitId)!.lastRangedAttackTurnIndex=s.turn;
  s.events.push({type:'weapon-fired',unitId:tx.unitId,resolution:job.resolution,
    sequence:s.events.length+1,round:s.round,turn:s.turn,playerId:shooter.playerId});
  for(const m of job.resolution.attackModifiers??[])for(const modifier of m.modifiers.filter(x=>x.source!=='TEMPORARY_EFFECT'))
    s.events.push({type:modifier.source==='COVER'?'cover-applied':'plunging-fire-applied',unitId:tx.unitId,modelId:m.modelId,targetUnitId:job.target.id,effectiveSkill:m.effectiveSkill,sequence:s.events.length+1,round:s.round,turn:s.turn,playerId:shooter.playerId});
  for(const damage of job.resolution.damageResults)s.events.push({type:'model-damaged',unitId:tx.unitId,targetUnitId:job.target.id,weaponId:weapon.id,damage,sequence:s.events.length+1,round:s.round,turn:s.turn,playerId:shooter.playerId});
  for(const modelId of job.resolution.destroyedModelIds)s.events.push({type:'model-destroyed',unitId:tx.unitId,targetUnitId:job.target.id,weaponId:weapon.id,modelId,sequence:s.events.length+1,round:s.round,turn:s.turn,playerId:shooter.playerId});
  applyShootingOnHitEffects(s,job);
  queueDestructions(before,s,tx.unitId);
  processAttachmentCasualties(s,tx.unitId);
  detectDestroyedTransports(s);normalizeDestroyed(s);recordTerrainChanges(before,s);
  flowEvent(s,'REACTION_WEAPON_FIRED',{source:tx.source,weaponId,targetUnitId:tx.targetUnitId,hits:job.resolution.hits},tx.unitId,shooter.playerId);
  return {ok:true,value:job.resolution};
}
