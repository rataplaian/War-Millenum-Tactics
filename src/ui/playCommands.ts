import type { LegalAction } from '../game/actions/LegalActions';
import type { GameState, Position } from '../game/models';
import { unitName } from './unitPresentation';

const names: Partial<Record<LegalAction['kind'],string>> = {
  ADVANCE_PRE_BATTLE:'Continue setup', SET_FIRST_TURN:'Choose first player', BEGIN_DEPLOYMENT:'Deploy unit', DEPLOY_FORMATION:'Place formation',
  BEGIN_MOVE:'Move unit', MOVE_MODEL:'Move model', COMPLETE_MOVE:'Complete unit move', CANCEL_MOVE:'Cancel unit move',
  BEGIN_SHOOTING:'Shoot', SELECT_SHOOTING_TARGET:'Choose shooting target', FIRE_WEAPON:'Fire weapon', COMPLETE_SHOOTING:'Finish shooting',
  DECLARE_CHARGE:'Roll charge', SELECT_CHARGE_TARGETS:'Choose charge target', COMBAT_MOVE_MODEL:'Move combat model', COMPLETE_COMBAT_MOVE:'Complete combat move',
  FAIL_CHARGE:'End failed charge', BEGIN_PILE_IN:'Pile in', BEGIN_CONSOLIDATION:'Consolidate', SELECT_FIGHT_UNIT:'Fight with unit',
  SELECT_MELEE_TARGET:'Choose melee target', MELEE_ATTACK:'Resolve melee attacks', COMPLETE_FIGHT:'Finish fighting',
  ADVANCE_PHASE:'End phase', ADVANCE_COMMAND_STEP:'Continue command phase', PASS_WINDOW:'Pass reaction',
  ROLL_BATTLE_SHOCK:'Roll Battle-shock', START_FIGHT:'Start fight phase', ADVANCE_FIGHT_STEP:'Continue fight phase',
  BEGIN_DISEMBARK:'Disembark', DISEMBARK:'Place disembarking unit', INGRESS_FORMATION:'Place reserve formation',
  REACTION_MOVE_MODEL:'Move reaction model', COMPLETE_REACTION_MOVE:'Complete reaction move', SKIP_TACTICAL_MOVE:'Stay in place',
};
export function commandName(a: LegalAction): string {
  if('id' in a && ['USE_STRATAGEM','USE_FACTION_ABILITY','AGILE_MANOEUVRE'].includes(a.kind))return a.id.replaceAll('_',' ');
  return names[a.kind]??a.kind.toLowerCase().replaceAll('_',' ');
}
export function commandKey(a: LegalAction): string {
  return a.kind+('id' in a?`:${a.id}`:'');
}
export function actionUnitId(a: LegalAction, s: GameState): string|undefined {
  if('unitId' in a)return a.unitId;
  if('modelId' in a)return s.units.find(u=>u.models.some(m=>m.id===a.modelId))?.id;
  if('formation' in a)return s.setup?.unitId;
  if('weaponId' in a)return s.shooting?.unitId??s.reactionShooting?.unitId??s.closeCombat?.fight?.selected?.unitId;
  if(a.kind==='SELECT_CHARGE_TARGETS')return s.closeCombat?.charge?.unitId;
  return undefined;
}
export function actionTargets(a: LegalAction): string[] {
  if('targetId' in a && a.targetId)return [a.targetId];
  if('targetIds' in a)return a.targetIds;
  if('targets' in a)return a.targets;
  return [];
}
export function actionPosition(a: LegalAction): Position|undefined {
  if('target' in a)return a.target;
  if('formation' in a)return Object.values(a.formation)[0];
  return undefined;
}
export function actionDetail(a: LegalAction, s: GameState): string {
  const parts:string[]=[];
  if('weaponId' in a)parts.push(s.definitions.flatMap(d=>d.weapons).find(w=>w.id===a.weaponId)?.name??a.weaponId);
  const targets=actionTargets(a); if(targets.length)parts.push(targets.map(id=>unitName(s,id)).join(', '));
  if('modelId' in a){const u=s.units.find(u=>u.models.some(m=>m.id===a.modelId));parts.push(`Model ${(u?.models.findIndex(m=>m.id===a.modelId)??0)+1}`);}
  const p=actionPosition(a);if(p)parts.push(`(${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z??0}) inches`);
  if('playerId' in a)parts.push(s.players.find(p=>p.id===a.playerId)?.name??a.playerId);
  if('actionId' in a)parts.push(a.actionId.replaceAll('_',' '));
  return parts.join(' · ')||commandName(a);
}
export function commandPrompt(options: LegalAction[], selectedModel: string|null): string {
  if(!options.length)return 'Choose an action';
  if(options.some(a=>['MOVE_MODEL','COMBAT_MOVE_MODEL','REACTION_MOVE_MODEL'].includes(a.kind)))return selectedModel?'Choose destination — green dots are legal suggestions':'Select a model to move';
  if(options.some(a=>'formation' in a))return 'Choose destination — tap a green formation marker';
  if(options.some(a=>actionTargets(a).length))return 'Choose target — green rings mark legal targets';
  return 'Choose an option, then confirm';
}
