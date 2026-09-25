import type { Ability, DiceValue, UnitDefinition, Weapon } from '../models';
import { VERIFIED_MUSTER_ENTRIES } from './verifiedEntries';

/** Chosen 11e loadouts. Profiles, points and base diameters checked against the 11e catalogue on 2026-09-25. */
const fixed = (value: number): DiceValue => ({ kind: 'fixed', value });
const dice = (count: number, modifier = 0): DiceValue => ({ kind: 'dice', count, sides: 6, modifier });
const d3 = (): DiceValue => ({ kind: 'dice', count: 1, sides: 3, modifier: 0 });
const ranged = (id: string, range: number, attacks: DiceValue | number, skill: number, strength: number, ap: number, damage: DiceValue | number, abilities: (string | [string, number])[] = []): Weapon =>
  ({ id, name: id.replaceAll('-', ' '), kind: 'ranged', range, attacks: typeof attacks === 'number' ? fixed(attacks) : attacks, skill, strength, armourPenetration: ap, damage: typeof damage === 'number' ? fixed(damage) : damage, traits: [], weaponAbilities: abilities.map((a, i) => ({ id: `${id}:${i}`, type: (typeof a === 'string' ? a : a[0]) as 'ASSAULT', ...(typeof a === 'string' ? {} : { value: a[1] }) })) });
const melee = (id: string, attacks: number, skill: number, strength: number, ap: number, damage: DiceValue | number, abilities: (string | [string, number])[] = []): Weapon =>
  ({ id, name: id.replaceAll('-', ' '), kind: 'melee', range: null, attacks: fixed(attacks), skill, strength, armourPenetration: ap, damage: typeof damage === 'number' ? fixed(damage) : damage, traits: [], weaponAbilities: abilities.map((a, i) => ({ id: `${id}:${i}`, type: (typeof a === 'string' ? a : a[0]) as 'ASSAULT', ...(typeof a === 'string' ? {} : { value: a[1] }) })) });
const ability = (id: string, parameters: Ability['parameters'] = {}): Ability => ({ id, name: id.replaceAll('_', ' '), parameters });
type Profile = NonNullable<UnitDefinition['modelProfiles']>[number];
interface DefinitionInput { id: string; name: string; faction: 'AELDARI' | 'EMPERORS_CHILDREN'; movement: number; toughness: number; save: number; wounds: number; leadership: number; oc: number; base: number; keywords: string[]; weapons: Weapon[]; abilities?: Ability[]; core?: UnitDefinition['coreAbilities']; invulnerable?: number; profiles?: Profile[]; attachment?: UnitDefinition['attachment']; transport?: UnitDefinition['transport'] }
function define(input: DefinitionInput): UnitDefinition {
  const entry = VERIFIED_MUSTER_ENTRIES.find(e => e.id === input.id)!;
  if (!entry) throw Error(`Missing verified muster: ${input.id}`);
  return { id: input.id, name: input.name, factionId: input.faction, modelCount: entry.models, points: entry.points, placeholder: false,
    defaultBase: { kind: 'circle', diameterMm: input.base }, stats: { movement: input.movement, toughness: input.toughness, save: input.save, wounds: input.wounds, leadership: input.leadership, objectiveControl: input.oc },
    keywords: input.keywords, weapons: input.weapons, abilities: input.abilities ?? [], ...(input.core ? { coreAbilities: input.core } : {}),
    ...(input.invulnerable ? { invulnerableSave: input.invulnerable } : {}), ...(input.profiles ? { modelProfiles: input.profiles } : {}),
    ...(input.attachment ? { attachment: input.attachment } : {}), ...(input.transport ? { transport: input.transport } : {}) };
}
const A = 'AELDARI', E = 'EMPERORS_CHILDREN';
const catapult = ranged('twin-shuriken-catapult', 18, 2, 3, 4, -1, 1, ['ASSAULT', 'TWIN_LINKED']);
const shurikenPistol = ranged('shuriken-pistol', 12, 1, 3, 4, -1, 1, ['ASSAULT', 'PISTOL']);
const close = melee('close-combat-weapon', 2, 3, 3, 0, 1);
const boltPistol = ranged('bolt-pistol', 12, 1, 3, 4, 0, 1, ['PISTOL']);
const tracks = melee('armoured-tracks', 3, 4, 6, 0, 1);
export const AELDARI_DATASHEETS: readonly UnitDefinition[] = [
  define({ id: 'farseer', name: 'Farseer', faction: A, movement: 7, toughness: 3, save: 6, wounds: 4, leadership: 6, oc: 1, base: 25, invulnerable: 4, keywords: ['INFANTRY','CHARACTER','PSYKER','AELDARI','ASURYANI','FARSEER'],
    weapons: [ranged('eldritch-storm',24,dice(1),3,6,-2,3,['BLAST','PSYCHIC']),{...shurikenPistol,skill:2},melee('witchblade',2,2,3,0,2,['PSYCHIC'])],
    abilities: [ability('BRANCHING_FATES'),ability('GUIDE')], attachment: { role: 'LEADER', canLeadDatasheetIds: ['storm-guardians'] } }),
  define({ id: 'warlock', name: 'Warlock', faction: A, movement: 7, toughness: 3, save: 6, wounds: 2, leadership: 6, oc: 1, base: 32, invulnerable: 4, keywords: ['INFANTRY','CHARACTER','PSYKER','AELDARI','ASURYANI','WARLOCK'],
    weapons: [ranged('destructor',12,dice(1),3,5,-1,1,['TORRENT','PSYCHIC']),shurikenPistol,melee('witchblade',2,3,3,0,2,['PSYCHIC'])], abilities: [ability('RUNES_OF_FORTUNE'),ability('PSYCHIC_COMMUNION')],
    attachment: { role: 'SUPPORT', canLeadDatasheetIds: ['storm-guardians'] } }),
  define({ id: 'autarch', name: 'Autarch', faction: A, movement: 7, toughness: 3, save: 3, wounds: 4, leadership: 6, oc: 1, base: 32, invulnerable: 4, keywords: ['INFANTRY','CHARACTER','AELDARI','ASURYANI','AUTARCH'],
    weapons: [{...shurikenPistol,skill:2},melee('star-glaive',4,2,6,-3,3)], abilities: [ability('SUPERLATIVE_STRATEGIST'),ability('PATH_OF_COMMAND')], attachment: { role: 'LEADER', canLeadDatasheetIds: ['dire-avengers'] } }),
  define({ id: 'storm-guardians', name: 'Storm Guardians', faction: A, movement: 7, toughness: 3, save: 4, wounds: 1, leadership: 7, oc: 2, base: 28.5, keywords: ['INFANTRY','BATTLELINE','AELDARI','ASURYANI','GUARDIANS','STORM_GUARDIANS'],
    weapons: [shurikenPistol,close,ranged('guardian-flamer',12,dice(1),3,4,0,1,['TORRENT']),ranged('guardian-fusion-gun',12,1,3,8,-4,dice(1),[['MELTA',2]])], abilities: [ability('STORMBLADES'),ability('SERPENT_SHIELD'),ability('CREWED_PLATFORM')],
    profiles: [{ count: 6, weaponIds: ['shuriken-pistol','close-combat-weapon'] },
      { count: 2, weaponIds: ['guardian-flamer','close-combat-weapon'] }, { count: 2, weaponIds: ['guardian-fusion-gun','close-combat-weapon'] },
      { count: 1, base: { kind: 'circle', diameterMm: 40 }, stats: { wounds: 2, objectiveControl: 0 }, weaponIds: [], coreAbilities: [] }] }),
  define({ id: 'dire-avengers', name: 'Dire Avengers', faction: A, movement: 7, toughness: 3, save: 4, wounds: 1, leadership: 6, oc: 1, base: 28.5, invulnerable: 5, keywords: ['INFANTRY','AELDARI','ASURYANI','ASPECT_WARRIORS','DIRE_AVENGERS'],
    weapons: [ranged('avenger-shuriken-catapult',18,4,3,4,-1,1,['ASSAULT']),close], abilities: [ability('BLADESTORM'),ability('ASPECT_SHRINE')],
    profiles: [{ count: 9, weaponIds: ['avenger-shuriken-catapult','close-combat-weapon'] }, { count: 1, stats: { wounds: 2 }, weaponIds: ['avenger-shuriken-catapult','close-combat-weapon'] }] }),
  define({ id: 'fire-dragons', name: 'Fire Dragons', faction: A, movement: 7, toughness: 3, save: 3, wounds: 1, leadership: 6, oc: 1, base: 28.5, invulnerable: 5, keywords: ['INFANTRY','AELDARI','ASURYANI','ASPECT_WARRIORS','FIRE_DRAGONS'],
    weapons: [ranged('dragon-fusion-gun',12,1,3,9,-4,dice(1),['ASSAULT',['MELTA',3]]),ranged('exarch-dragon-fusion-gun',12,1,3,9,-4,dice(1),['ASSAULT',['MELTA',6]]),close], abilities: [ability('ASSURED_DESTRUCTION'),ability('ASPECT_SHRINE')],
    profiles: [{ count: 4, weaponIds: ['dragon-fusion-gun','close-combat-weapon'] }, { count: 1, stats: { wounds: 2 }, weaponIds: ['exarch-dragon-fusion-gun','close-combat-weapon'] }] }),
  define({ id: 'dark-reapers', name: 'Dark Reapers', faction: A, movement: 6, toughness: 3, save: 3, wounds: 1, leadership: 6, oc: 1, base: 28.5, invulnerable: 5, keywords: ['INFANTRY','AELDARI','ASURYANI','ASPECT_WARRIORS','DARK_REAPERS'],
    weapons: [ranged('reaper-launcher-starshot',48,1,3,10,-2,3,['IGNORES_COVER']),ranged('reaper-launcher-starswarm',48,2,3,5,-2,1,['IGNORES_COVER']),ranged('tempest-launcher',36,dice(2),3,4,-1,1,['BLAST','INDIRECT_FIRE']),close], abilities: [ability('INESCAPABLE_ACCURACY'),ability('ASPECT_SHRINE')],
    profiles: [{ count: 4, weaponIds: ['reaper-launcher-starshot','reaper-launcher-starswarm','close-combat-weapon'] }, { count: 1, stats: { wounds: 2 }, weaponIds: ['tempest-launcher','close-combat-weapon'] }] }),
  define({ id: 'rangers', name: 'Rangers', faction: A, movement: 7, toughness: 3, save: 5, wounds: 1, leadership: 7, oc: 1, base: 28.5, keywords: ['INFANTRY','AELDARI','ASURYANI','RANGERS'], core: [{kind:'INFILTRATORS'},{kind:'STEALTH'}],
    weapons: [ranged('ranger-long-rifle',36,1,3,4,-1,2,['HEAVY','PRECISION']),{...shurikenPistol,skill:2},melee('ranger-close-weapon',1,3,3,0,1)], abilities: [ability('PATH_OF_THE_OUTCAST')] }),
  define({ id: 'wave-serpent', name: 'Wave Serpent', faction: A, movement: 14, toughness: 9, save: 3, wounds: 13, leadership: 7, oc: 2, base: 60, invulnerable: 5, keywords: ['VEHICLE','FLY','AELDARI','ASURYANI','TRANSPORT','WAVE_SERPENT'],
    core: [{ kind:'DEADLY_DEMISE',damage:d3() }], weapons: [ranged('twin-shuriken-cannon',24,3,3,6,-1,2,['LETHAL_HITS']),catapult,melee('wraithbone-hull',3,4,6,0,1)], abilities: [ability('WAVE_SERPENT_SHIELD'),ability('DAMAGED_WAVE_SERPENT',{threshold:4})],
    transport: { maximumModels: 12, allowedKeywords:['ASURYANI'], excludedKeywords:['JUMP_PACK','YNNARI','VEHICLE'], modelCosts:[{keywords:['WRAITH_CONSTRUCT'],cost:2}] } }),
  define({ id: 'night-spinner', name: 'Night Spinner', faction: A, movement: 14, toughness: 9, save: 3, wounds: 12, leadership: 7, oc: 3, base: 60, keywords: ['VEHICLE','FLY','AELDARI','ASURYANI','NIGHT_SPINNER'],
    core:[{kind:'DEADLY_DEMISE',damage:d3()}], weapons:[ranged('doomweaver',48,dice(1,3),3,7,-1,2,['BLAST','INDIRECT_FIRE','TWIN_LINKED']),catapult,melee('wraithbone-hull',3,4,6,0,1)], abilities:[ability('MONOFILAMENT_WEB'),ability('DAMAGED_NIGHT_SPINNER',{threshold:4})] }),
];
export const EMPERORS_CHILDREN_DATASHEETS: readonly UnitDefinition[] = [
  define({ id:'lord-exultant',name:'Lord Exultant',faction:E,movement:7,toughness:4,save:3,wounds:5,leadership:6,oc:1,base:40,invulnerable:4,keywords:['INFANTRY','CHARACTER','EMPERORS_CHILDREN','LORD_EXULTANT'],
    weapons:[{...boltPistol,skill:2},ranged('plasma-pistol',12,1,2,7,-2,1,['PISTOL']),melee('phoenix-power-spear',5,2,7,-2,2,['LANCE'])],abilities:[ability('PERFECTIONISTS'),ability('EUPHORIC_STRIKES'),ability('LORD_HOST')],attachment:{role:'LEADER',canLeadDatasheetIds:['infractors','tormentors']} }),
  define({ id:'sorcerer',name:'Sorcerer',faction:E,movement:7,toughness:4,save:3,wounds:4,leadership:6,oc:1,base:40,keywords:['INFANTRY','CHARACTER','PSYKER','EMPERORS_CHILDREN'],
    weapons:[ranged('agonising-energies',18,dice(1),3,5,-1,3,['PSYCHIC']),boltPistol,melee('force-weapon',4,3,6,-2,3,['PSYCHIC'])],abilities:[ability('WARPED_INTERFERENCE'),ability('WRACKING_AGONIES')],attachment:{role:'LEADER',canLeadDatasheetIds:['infractors','tormentors','noise-marines']} }),
  define({ id:'lord-kakophonist',name:'Lord Kakophonist',faction:E,movement:6,toughness:5,save:2,wounds:6,leadership:6,oc:1,base:40,invulnerable:4,keywords:['INFANTRY','CHARACTER','EMPERORS_CHILDREN','LORD_KAKOPHONIST'],
    weapons:[ranged('screamer-pistol',12,3,2,5,-1,2,['IGNORES_COVER','PISTOL']),melee('power-sword',6,2,5,-2,1)],abilities:[ability('OBSESSIVE_ANNUNCIATION'),ability('DOOM_SIREN')],attachment:{role:'LEADER',canLeadDatasheetIds:['noise-marines']} }),
  define({ id:'infractors',name:'Infractors',faction:E,movement:7,toughness:4,save:3,wounds:2,leadership:6,oc:2,base:32,keywords:['INFANTRY','BATTLELINE','EMPERORS_CHILDREN','INFRACTORS'],core:[{kind:'SCOUTS',distance:6}],
    weapons:[boltPistol,melee('duelling-sabre',4,3,4,-1,1,['PRECISION']),melee('infractor-power-sword',4,3,5,-2,1,['PRECISION'])],abilities:[ability('EXCESSIVE_ASSAULT')],profiles:[{count:9,weaponIds:['bolt-pistol','duelling-sabre']},{count:1,weaponIds:['bolt-pistol','infractor-power-sword']}] }),
  define({ id:'tormentors',name:'Tormentors',faction:E,movement:7,toughness:4,save:3,wounds:2,leadership:6,oc:2,base:32,keywords:['INFANTRY','BATTLELINE','EMPERORS_CHILDREN','TORMENTORS'],core:[{kind:'INFILTRATORS'}],
    weapons:[boltPistol,ranged('boltgun',24,2,3,4,0,1,['PRECISION']),melee('tormentor-power-sword',4,3,5,-2,1),melee('tormentor-close-weapon',3,3,4,0,1)],abilities:[ability('OBJECTIVE_DEFILED')],profiles:[{count:4,weaponIds:['boltgun','tormentor-close-weapon']},{count:1,weaponIds:['bolt-pistol','tormentor-power-sword']}] }),
  define({ id:'noise-marines',name:'Noise Marines',faction:E,movement:6,toughness:5,save:3,wounds:2,leadership:6,oc:1,base:40,keywords:['INFANTRY','EMPERORS_CHILDREN','NOISE_MARINES'],
    weapons:[ranged('sonic-blaster',18,3,3,5,-1,2,['IGNORES_COVER']),ranged('blastmaster-single',18,3,3,10,-2,3,['IGNORES_COVER']),melee('noise-close-weapon',3,3,4,0,1)],abilities:[ability('TERRIFYING_CRESCENDO')],profiles:[{count:4,weaponIds:['sonic-blaster','noise-close-weapon']},{count:2,weaponIds:['blastmaster-single','noise-close-weapon']}] }),
  define({ id:'flawless-blades',name:'Flawless Blades',faction:E,movement:8,toughness:5,save:3,wounds:3,leadership:6,oc:1,base:40,invulnerable:5,keywords:['INFANTRY','EMPERORS_CHILDREN','FLAWLESS_BLADES'],
    weapons:[boltPistol,melee('blissblade',4,2,6,-3,2)],abilities:[ability('DAEMONIC_PATRONS')] }),
  define({ id:'chaos-rhino',name:'Chaos Rhino',faction:E,movement:12,toughness:9,save:3,wounds:10,leadership:6,oc:2,base:60,keywords:['VEHICLE','EMPERORS_CHILDREN','TRANSPORT','CHAOS_RHINO'],core:[{kind:'DEADLY_DEMISE',damage:d3()}],
    weapons:[ranged('combi-bolter',24,2,3,4,0,1,[['RAPID_FIRE',2]]),tracks],abilities:[ability('ASSAULT_VEHICLE')],transport:{maximumModels:12,allowedKeywords:['EMPERORS_CHILDREN'],excludedKeywords:['TERMINATOR','FLAWLESS_BLADES','VEHICLE'],firingDeck:2,afterAdvance:'SHOCK',dedicated:true} }),
  define({ id:'chaos-land-raider',name:'Chaos Land Raider',faction:E,movement:10,toughness:12,save:2,wounds:16,leadership:6,oc:5,base:90,keywords:['VEHICLE','EMPERORS_CHILDREN','TRANSPORT','CHAOS_LAND_RAIDER'],core:[{kind:'DEADLY_DEMISE',damage:dice(1)}],
    weapons:[ranged('soulshatter-lascannon',48,2,3,12,-3,dice(1,1)),ranged('twin-heavy-bolter',36,3,3,5,-1,2,[['SUSTAINED_HITS',1],'TWIN_LINKED']),melee('land-raider-tracks',6,4,8,0,1)],abilities:[ability('ASSAULT_RAMP'),ability('DAMAGED_LAND_RAIDER',{threshold:5})],transport:{maximumModels:14,allowedKeywords:['EMPERORS_CHILDREN'],excludedKeywords:['VEHICLE'],modelCosts:[{keywords:['TERMINATOR'],cost:2},{keywords:['FLAWLESS_BLADES'],cost:2}],afterNormalMove:'ASSAULT'} }),
];
