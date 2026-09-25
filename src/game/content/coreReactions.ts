import type { StratagemDefinition, StratagemPolicies } from '../stratagems/types';
import { edgeDistance, EPSILON } from '../utils/geometry';
import { hasEnhancement } from './factionRules';
import { canDeclareCharge, emptyCloseCombat, enemies } from '../rules/closeCombat';
import { isUnitEngaged } from '../rules/spatial';
import { CloseCombatController } from '../engine/CloseCombatController';
import { unitKeywords } from '../attachments/queries';
import { failure } from '../rules/movement';

/** Core charge reaction: faction enhancements alter cost and usage, not charge geometry. */
export const HEROIC_INTERVENTION: StratagemDefinition={
  id:'HEROIC_INTERVENTION',name:'Heroic Intervention',labels:['STRATEGIC_PLOY'],cpCost:1,
  timing:{phases:['Charge'],triggers:['END_OF_PHASE'],ownership:'OPPONENT_TURN'},
  target:{relation:'FRIENDLY',count:1},conditions:['ON_BATTLEFIELD','ALIVE'],
  restrictions:['HEROIC_ELIGIBLE'],resolverId:'HEROIC_INTERVENTION',
};
export const CORE_REACTION_POLICIES:StratagemPolicies={
  cost:(s,d,_player,ids,mode)=>d.id==='HEROIC_INTERVENTION' ? d.cpCost+(mode==='INTO_THE_FRAY'?1:0)-
    (ids.some(id=>{const u=s.units.find(x=>x.id===id);return !!u&&hasEnhancement(s,u,'FAULTLESS_OPPORTUNIST');})?1:0) : d.cpCost,
  exemptPhaseUsage:(s,d,_player,ids)=>d.id==='HEROIC_INTERVENTION' && ids.some(id=>{const u=s.units.find(x=>x.id===id);return !!u&&hasEnhancement(s,u,'FAULTLESS_OPPORTUNIST');}),
  restrictions:{HEROIC_ELIGIBLE:(s,_player,ids)=>ids.every(id=>{
    const u=s.units.find(x=>x.id===id);if(!u || isUnitEngaged(s,u))return false;
    const keys=unitKeywords(s,u);if(keys.includes('VEHICLE')&&!keys.some(k=>k==='CHARACTER'||k==='WALKER'))return false;
    if(!enemies(s,u).some(enemy=>u.models.some(m=>m.alive&&enemy.models.some(n=>n.alive&&edgeDistance(m,n)<=12+EPSILON))))return false;
    const draft=JSON.parse(JSON.stringify(s));draft.closeCombat ??= emptyCloseCombat();draft.closeCombat.reaction={unitId:id,source:'HEROIC_INTERVENTION',mode:'LEAP_TO_DEFEND'};
    return canDeclareCharge(draft,id).ok;
  })},
  resolvers:{HEROIC_INTERVENTION:(s,ids,_d,rng,mode)=>{
    if(!rng || !['LEAP_TO_DEFEND','INTO_THE_FRAY'].includes(mode??''))return failure('INVALID_ABILITY_CHOICE');
    const id=ids[0]!;
    s.closeCombat ??= emptyCloseCombat();
    s.closeCombat.reaction={unitId:id,source:'HEROIC_INTERVENTION',mode:mode as 'LEAP_TO_DEFEND'|'INTO_THE_FRAY'};
    const roll=new CloseCombatController(s).declareCharge(id,rng);
    return roll.ok?{ok:true,value:undefined}:roll;
  }},
};
