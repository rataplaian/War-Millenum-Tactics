import { FactionContentRegistry } from './FactionContentRegistry';
import { AELDARI_DATASHEETS, EMPERORS_CHILDREN_DATASHEETS } from './factionDatasheets';
import { AELDARI_PRESET, EMPERORS_CHILDREN_PRESET } from './presets';
import { GUARDIAN_STRATAGEMS, PEERLESS_STRATAGEMS } from './factionStratagems';
import { VERIFIED_ENHANCEMENTS, VERIFIED_SOURCE_SNAPSHOT } from './verifiedEntries';
import type { FactionContent } from './types';

/** Only rules that currently have executable integration points belong here. */
const implemented = {
  GUIDE: 'GameEngine.useGuide',
  RUNES_OF_FORTUNE: 'rules.chargeAllowance',
  BLADESTORM: 'combat.buildAttackContext',
  ASPECT_SHRINE: 'GameEngine.spendAspectShrineToken',
  ASSURED_DESTRUCTION: 'content.factionAttackWeapon',
  PERFECTIONISTS: 'combat.buildAttackContext',
  OBSESSIVE_ANNUNCIATION: 'combat.buildAttackContext',
  WARPED_INTERFERENCE: 'terrain.benefitOfCover',
  WRACKING_AGONIES: 'content.applyShootingOnHitEffects',
  MONOFILAMENT_WEB: 'content.applyShootingOnHitEffects',
  DAMAGED_WAVE_SERPENT: 'combat.hitOutcome',
  DAMAGED_NIGHT_SPINNER: 'combat.hitOutcome',
  DAMAGED_LAND_RAIDER: 'combat.hitOutcome',
  WAVE_SERPENT_SHIELD: 'content.defensiveWoundPenalty',
  SERPENT_SHIELD: 'content.serpentShieldSave',
  CREWED_PLATFORM: 'content.removeUncrewedPlatform',
  INESCAPABLE_ACCURACY: 'combat.hitOutcome',
  ASSAULT_VEHICLE: 'transports.TransportController',
  ASSAULT_RAMP: 'transports.TransportController',
} as const;
type ImplementedAbilityId = keyof typeof implemented;
const abilities = (definitions: FactionContent['datasheets']) => [...new Set(definitions.flatMap(d=>d.abilities.map(a=>a.id)))]
  .filter((id):id is ImplementedAbilityId=>id in implemented).map(id=>({id,resolverId:implemented[id]}));

export const FACTION_CONTENT: readonly FactionContent[] = [
  {id:'AELDARI',name:'Aeldari',sources:VERIFIED_SOURCE_SNAPSHOT,armyRuleId:'BATTLE_FOCUS',datasheets:AELDARI_DATASHEETS,
    detachments:[{id:'GUARDIAN_BATTLEHOST',ruleId:'GUARDIAN_BATTLEHOST',detachmentPoints:2,forceDisposition:'TAKE_AND_HOLD',
      enhancements:[{id:'BREATH_OF_VAUL',points:VERIFIED_ENHANCEMENTS.BREATH_OF_VAUL.points}],stratagems:GUARDIAN_STRATAGEMS}],
    abilities:abilities(AELDARI_DATASHEETS)},
  {id:'EMPERORS_CHILDREN',name:"Emperor's Children",sources:VERIFIED_SOURCE_SNAPSHOT,armyRuleId:'THRILL_SEEKERS',datasheets:EMPERORS_CHILDREN_DATASHEETS,
    detachments:[{id:'PEERLESS_BLADESMEN',ruleId:'EXQUISITE_SWORDSMANSHIP',detachmentPoints:2,forceDisposition:'PRIORITY_ASSETS',
      enhancements:[{id:'FAULTLESS_OPPORTUNIST',points:VERIFIED_ENHANCEMENTS.FAULTLESS_OPPORTUNIST.points}],stratagems:PEERLESS_STRATAGEMS}],
    abilities:abilities(EMPERORS_CHILDREN_DATASHEETS)},
];

/** A registry entry is allowed only for a proven runtime rule, not for a name-only datasheet ability. */
export function createFactionContentRegistry():FactionContentRegistry {
  const registry=new FactionContentRegistry();
  registry.register(FACTION_CONTENT[0]!,[AELDARI_PRESET]);
  registry.register(FACTION_CONTENT[1]!,[EMPERORS_CHILDREN_PRESET]);
  return registry;
}
