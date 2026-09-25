/**
 * Sourced muster facts, deliberately separate from runnable UnitDefinition data.
 * A points entry alone does not establish a playable datasheet or implemented ability.
 * The source pages below are the 11th-edition New Recruit catalogue, checked 2026-09-25.
 * GW's newer faction-pack errata take precedence wherever they differ.
 */
import type { RulesSourceSnapshot } from './types';

export const VERIFIED_SOURCE_SNAPSHOT: RulesSourceSnapshot = {
  edition: 11,
  snapshotDate: '2026-09-25',
  factionPackVersion: 'Aeldari v1.0; Emperor\'s Children v1.0',
  munitorumUpdateDate: '2026-09-02',
  rulesUpdateVersion: '11th-edition public Core Rules; check newer updates per entry',
  notes: 'Points transcribed from New Recruit 11e; official MFM interactive entries unavailable (HTTP 403). GW faction-pack errata override secondary entries.',
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
  { id: 'farseer', factionId: 'AELDARI', name: 'Farseer', models: 1, points: 65, source: `${aeldari}bc16-e600-5fe4-92e8/farseer` },
  { id: 'warlock', factionId: 'AELDARI', name: 'Warlock', models: 1, points: 45, source: `${aeldari}a502-4dbe-d0c6-69fd/warlock` },
  { id: 'autarch', factionId: 'AELDARI', name: 'Autarch', models: 1, points: 75, source: `${aeldari}acc4-30c4-39c0-71e/autarch` },
  { id: 'storm-guardians', factionId: 'AELDARI', name: 'Storm Guardians', models: 11, points: 110, source: `${aeldari}a203-f251-2149-a253/storm-guardians`, adjustment: '10 Guardians and 1 Serpent’s Scale Platform; model characteristics differ.' },
  { id: 'dire-avengers', factionId: 'AELDARI', name: 'Dire Avengers', models: 5, points: 75, source: `${aeldari}a5e0-9c61-f07d-467b/dire-avengers`, adjustment: 'Reduced from the requested 10 models (150 points) to remain under 1,000 points.' },
  { id: 'fire-dragons', factionId: 'AELDARI', name: 'Fire Dragons', models: 5, points: 120, source: `${aeldari}5e87-dba1-7036-de2a/fire-dragons` },
  { id: 'dark-reapers', factionId: 'AELDARI', name: 'Dark Reapers', models: 5, points: 100, source: `${aeldari}9392-ba80-6ec0-fba0/dark-reapers` },
  { id: 'rangers', factionId: 'AELDARI', name: 'Rangers', models: 5, points: 60, source: `${aeldari}6080-9e99-1811-9186/rangers` },
  { id: 'wave-serpent', factionId: 'AELDARI', name: 'Wave Serpent', models: 1, points: 115, source: `${aeldari}c302-5769-871e-853b/wave-serpent` },
  { id: 'night-spinner', factionId: 'AELDARI', name: 'Night Spinner', models: 1, points: 170, source: `${aeldari}e98c-b305-1b4b-f54/night-spinner` },
  { id: 'lord-exultant', factionId: 'EMPERORS_CHILDREN', name: 'Lord Exultant', models: 1, points: 80, source: `${emperorsChildren}c2cc-c272-6138-673b/lord-exultant` },
  { id: 'sorcerer', factionId: 'EMPERORS_CHILDREN', name: 'Sorcerer', models: 1, points: 55, source: `${emperorsChildren}b6e8-a3d7-e4e4-ffc2/sorcerer` },
  { id: 'lord-kakophonist', factionId: 'EMPERORS_CHILDREN', name: 'Lord Kakophonist', models: 1, points: 70, source: `${emperorsChildren}3144-df82-3e22-2ab1/lord-kakophonist` },
  { id: 'infractors', factionId: 'EMPERORS_CHILDREN', name: 'Infractors', models: 10, points: 160, source: `${emperorsChildren}1167-1f78-feed-c6ca/infractors`, adjustment: 'Ten-model price, not the five-model base price of 85 points.' },
  { id: 'tormentors', factionId: 'EMPERORS_CHILDREN', name: 'Tormentors', models: 5, points: 80, source: `${emperorsChildren}fa28-2905-8989-8a2b/tormentors` },
  { id: 'noise-marines', factionId: 'EMPERORS_CHILDREN', name: 'Noise Marines', models: 6, points: 145, source: `${emperorsChildren}382e-7f67-4810-beef/noise-marines` },
  { id: 'flawless-blades', factionId: 'EMPERORS_CHILDREN', name: 'Flawless Blades', models: 3, points: 95, source: `${emperorsChildren}9f04-d6da-3dff-4d23/flawless-blades` },
  { id: 'chaos-rhino', factionId: 'EMPERORS_CHILDREN', name: 'Chaos Rhino', models: 1, points: 70, source: `${emperorsChildren}8359-7588-cbb4-d9fb/chaos-rhino` },
  { id: 'chaos-land-raider', factionId: 'EMPERORS_CHILDREN', name: 'Chaos Land Raider', models: 1, points: 220, source: `${emperorsChildren}ff50-aaa8-e1f0-0dbc/chaos-land-raider` },
];

export const VERIFIED_ENHANCEMENTS = {
  BREATH_OF_VAUL: { points: 10, source: `${wiki}aeldari---aeldari-library/b142-6aad-160a-75d0/breath-of-vaul` },
  FAULTLESS_OPPORTUNIST: { points: 15, source: `${emperorsChildren}ff3a-6be4-e450-7902/faultless-opportunist` },
} as const;

export function verifiedMusterPoints(factionId: VerifiedMusterEntry['factionId']): number {
  return VERIFIED_MUSTER_ENTRIES.filter(entry => entry.factionId === factionId)
    .reduce((total, entry) => total + entry.points, 0);
}
