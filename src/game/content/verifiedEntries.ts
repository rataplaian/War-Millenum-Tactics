/**
 * Sourced muster facts, deliberately separate from runnable UnitDefinition data.
 * A points entry alone does not establish a playable datasheet or implemented ability.
 * Datasheet sources use only the 11th-edition Wahapedia mirror, checked 2026-09-25.
 * New Recruit 11e provides an independent roster and enhancement cross-check.
 * GW's newer faction-pack errata take precedence wherever they differ.
 */
import type { RulesSourceSnapshot } from './types';

export const VERIFIED_SOURCE_SNAPSHOT: RulesSourceSnapshot = {
  edition: 11,
  snapshotDate: '2026-09-25',
  factionPackVersion: 'Aeldari v1.3; Emperor\'s Children v1.2',
  munitorumUpdateDate: '2026-09-02',
  rulesUpdateVersion: '11th-edition public Core Rules; check newer updates per entry',
  notes: 'Points reconciled with current Wahapedia 11e datasheets (September MFM changes); official MFM interactive entries unavailable (HTTP 403). GW faction-pack errata override secondary entries.',
  references: [
    'https://assets.warhammer-community.com/eng_01-06_warhammer40k_new40k_core_rules-was6fbu1ix-hfewhmxyiy.pdf',
    'https://assets.warhammer-community.com/eng_09-06_warhammer40000_faction_pack_aeldari-glkjirbhiw-9udkry7xbr.pdf',
    'https://assets.warhammer-community.com/eng_10-06_warhammer40000_faction_pack_emperor_s_children-fffbpc3gn0-mesp5k6khu.pdf',
    'https://mfm.warhammer-community.com/en/',
  ],
};

export interface VerifiedMusterEntry {
  readonly id: string;
  readonly factionId: 'AELDARI' | 'EMPERORS_CHILDREN';
  readonly name: string;
  readonly models: number;
  readonly points: number;
  readonly source: string;
  readonly adjustment?: string;
}

const wiki = 'https://www.newrecruit.eu/wiki/wh40k-11e/warhammer-40%2C000-11th-edition/';
const aeldari = `${wiki}xenos---aeldari/`;
const emperorsChildren = `${wiki}chaos---emperor%27s-children/`;

export const VERIFIED_MUSTER_ENTRIES: readonly VerifiedMusterEntry[] = [
  { id: 'farseer', factionId: 'AELDARI', name: 'Farseer', models: 1, points: 65, source: `https://wahapedia.ru/wh40k11ed/factions/aeldari/Farseer` },
  { id: 'warlock', factionId: 'AELDARI', name: 'Warlock', models: 1, points: 40, source: `https://wahapedia.ru/wh40k11ed/factions/aeldari/Warlock` },
  { id: 'autarch', factionId: 'AELDARI', name: 'Autarch', models: 1, points: 75, source: `https://wahapedia.ru/wh40k11ed/factions/aeldari/Autarch` },
  { id: 'storm-guardians', factionId: 'AELDARI', name: 'Storm Guardians', models: 11, points: 100, source: `https://wahapedia.ru/wh40k11ed/factions/aeldari/Storm-Guardians`, adjustment: '10 Guardians and 1 Serpent’s Scale Platform; model characteristics differ.' },
  { id: 'dire-avengers', factionId: 'AELDARI', name: 'Dire Avengers', models: 10, points: 140, source: `https://wahapedia.ru/wh40k11ed/factions/aeldari/Dire-Avengers`, adjustment: 'Restored the requested 10 models: the updated 11e point prices now keep the complete roster within 1,000.' },
  { id: 'fire-dragons', factionId: 'AELDARI', name: 'Fire Dragons', models: 5, points: 120, source: `https://wahapedia.ru/wh40k11ed/factions/aeldari/Fire-Dragons` },
  { id: 'dark-reapers', factionId: 'AELDARI', name: 'Dark Reapers', models: 5, points: 95, source: `https://wahapedia.ru/wh40k11ed/factions/aeldari/Dark-Reapers` },
  { id: 'rangers', factionId: 'AELDARI', name: 'Rangers', models: 5, points: 60, source: `https://wahapedia.ru/wh40k11ed/factions/aeldari/Rangers` },
  { id: 'wave-serpent', factionId: 'AELDARI', name: 'Wave Serpent', models: 1, points: 115, source: `https://wahapedia.ru/wh40k11ed/factions/aeldari/Wave-Serpent` },
  { id: 'night-spinner', factionId: 'AELDARI', name: 'Night Spinner', models: 1, points: 170, source: `https://wahapedia.ru/wh40k11ed/factions/aeldari/Night-Spinner` },
  { id: 'lord-exultant', factionId: 'EMPERORS_CHILDREN', name: 'Lord Exultant', models: 1, points: 90, source: `https://wahapedia.ru/wh40k11ed/factions/emperor-s-children/Lord-Exultant` },
  { id: 'sorcerer', factionId: 'EMPERORS_CHILDREN', name: 'Sorcerer', models: 1, points: 55, source: `https://wahapedia.ru/wh40k11ed/factions/emperor-s-children/Sorcerer` },
  { id: 'lord-kakophonist', factionId: 'EMPERORS_CHILDREN', name: 'Lord Kakophonist', models: 1, points: 70, source: `https://wahapedia.ru/wh40k11ed/factions/emperor-s-children/Lord-Kakophonist` },
  { id: 'infractors', factionId: 'EMPERORS_CHILDREN', name: 'Infractors', models: 10, points: 160, source: `https://wahapedia.ru/wh40k11ed/factions/emperor-s-children/Infractors`, adjustment: 'Ten-model price, not the five-model base price of 85 points.' },
  { id: 'tormentors', factionId: 'EMPERORS_CHILDREN', name: 'Tormentors', models: 5, points: 80, source: `https://wahapedia.ru/wh40k11ed/factions/emperor-s-children/Tormentors` },
  { id: 'noise-marines', factionId: 'EMPERORS_CHILDREN', name: 'Noise Marines', models: 6, points: 145, source: `https://wahapedia.ru/wh40k11ed/factions/emperor-s-children/Noise-Marines` },
  { id: 'flawless-blades', factionId: 'EMPERORS_CHILDREN', name: 'Flawless Blades', models: 3, points: 95, source: `https://wahapedia.ru/wh40k11ed/factions/emperor-s-children/Flawless-Blades` },
  { id: 'chaos-rhino', factionId: 'EMPERORS_CHILDREN', name: 'Chaos Rhino', models: 1, points: 70, source: `https://wahapedia.ru/wh40k11ed/factions/emperor-s-children/Chaos-Rhino` },
  { id: 'chaos-land-raider', factionId: 'EMPERORS_CHILDREN', name: 'Chaos Land Raider', models: 1, points: 220, source: `https://wahapedia.ru/wh40k11ed/factions/emperor-s-children/Chaos-Land-Raider` },
];

export const VERIFIED_ENHANCEMENTS = {
  BREATH_OF_VAUL: { points: 10, source: `${wiki}aeldari---aeldari-library/b142-6aad-160a-75d0/breath-of-vaul` },
  FAULTLESS_OPPORTUNIST: { points: 15, source: `https://wahapedia.ru/wh40k11ed/factions/emperor-s-children/FaultlessOpportunist` },
} as const;

export function verifiedMusterPoints(factionId: VerifiedMusterEntry['factionId']): number {
  return VERIFIED_MUSTER_ENTRIES.filter(entry => entry.factionId === factionId)
    .reduce((total, entry) => total + entry.points, 0);
}

/** Proposed IDs and manifests. They become PresetRosters only when all definitions/resolvers exist. */
export interface VerifiedMusterPlan {
  readonly factionId: VerifiedMusterEntry['factionId'];
  readonly detachment: string;
  readonly forceDisposition: 'TAKE_AND_HOLD' | 'PRIORITY_ASSETS';
  readonly detachmentPoints: 2;
  readonly warlordId: string;
  readonly enhancement?: keyof typeof VERIFIED_ENHANCEMENTS;
  readonly attachments: readonly { id: string; bodyguardId: string; leaderIds: readonly string[]; supportIds?: readonly string[] }[];
  readonly embarked: readonly { transportId: string; passengerIds: readonly string[] }[];
}

export const VERIFIED_MUSTER_PLANS: readonly VerifiedMusterPlan[] = [
  { factionId: 'AELDARI', detachment: 'GUARDIAN_BATTLEHOST', forceDisposition: 'TAKE_AND_HOLD', detachmentPoints: 2,
    warlordId: 'farseer', enhancement: 'BREATH_OF_VAUL', attachments: [
      { id: 'storm-council', bodyguardId: 'storm-guardians', leaderIds: ['farseer'], supportIds: ['warlock'] },
      { id: 'avenger-command', bodyguardId: 'dire-avengers', leaderIds: ['autarch'] },
    ], embarked: [{ transportId: 'wave-serpent', passengerIds: ['fire-dragons', 'rangers'] }] },
  { factionId: 'EMPERORS_CHILDREN', detachment: 'PEERLESS_BLADESMEN', forceDisposition: 'PRIORITY_ASSETS', detachmentPoints: 2,
    warlordId: 'lord-exultant', enhancement: 'FAULTLESS_OPPORTUNIST', attachments: [
      { id: 'infractor-command', bodyguardId: 'infractors', leaderIds: ['lord-exultant'] },
      { id: 'tormentor-command', bodyguardId: 'tormentors', leaderIds: ['sorcerer'] },
      { id: 'noise-command', bodyguardId: 'noise-marines', leaderIds: ['lord-kakophonist'] },
    ], embarked: [
      { transportId: 'chaos-rhino', passengerIds: ['infractor-command'] },
      { transportId: 'chaos-land-raider', passengerIds: ['tormentor-command', 'flawless-blades'] },
    ] },
];
