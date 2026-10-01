import type { GameState,Unit,DiceValue,GameEvent } from '../game/models';
import type { LegalAction } from '../game/actions/LegalActions';
import { modelHasWeapon } from '../game/attachments/queries';
export function diceLabel(d:DiceValue):string {return d.kind==='fixed'?String(d.value):`${d.count}D${d.sides}${d.modifier?`${d.modifier>0?'+':''}${d.modifier}`:''}`;}
export function chosenWeapons(s:GameState,u:Unit){return (s.definitions.find(d=>d.id===u.definitionId)?.weapons??[]).filter(w=>u.models.some(m=>m.alive&&modelHasWeapon(s,u,m,w.id)));}
export function weaponProfile(s:GameState,id:string){return s.definitions.flatMap(d=>d.weapons).find(w=>w.id===id)??s.shooting?.firingDeck?.find(w=>w.borrowed.id===id)?.borrowed;}
export function weaponChoices(actions:LegalAction[]){return [...new Set(actions.filter(a=>['SELECT_SHOOTING_TARGET','FIRE_WEAPON','SELECT_MELEE_TARGET','MELEE_ATTACK'].includes(a.kind)).flatMap(a=>'weaponId' in a?[a.weaponId]:[]))];}
export function actionsForWeapon(actions:LegalAction[],id:string|null){return id?actions.filter(a=>'weaponId' in a&&a.weaponId===id):[];}
export function completedCombat(events:GameEvent[]){return events.filter((e):e is Extract<GameEvent,{type:'weapon-fired'|'melee-attack-resolved'}>=>e.type==='weapon-fired'||e.type==='melee-attack-resolved').filter(e=>!e.resolution.pending);}
