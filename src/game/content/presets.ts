import { GameEngine } from '../engine/GameEngine';
import { createUnit } from '../engine/createUnit';
import { createProvingGroundDeploymentMatch } from '../missions/provingGround';
import { createSeededRng } from '../utils/dice';
import type { PresetRoster } from './types';
import { VERIFIED_MUSTER_ENTRIES, VERIFIED_MUSTER_PLANS } from './verifiedEntries';
import { AELDARI_DATASHEETS, EMPERORS_CHILDREN_DATASHEETS } from './factionDatasheets';
import type { GameState } from '../models';
import { FACTION_STRATAGEMS } from './factionStratagems';

export const AELDARI_PRESET: PresetRoster = {
  id: 'aeldari-guardian-battlehost-1000', factionId: 'AELDARI', battleSize: 'INCURSION', pointsLimit: 1000,
  detachmentId: 'GUARDIAN_BATTLEHOST', detachmentPointsLimit: 2, forceDisposition: 'TAKE_AND_HOLD', warlordUnitId: 'farseer', enhancementLimit: 1,
  units: VERIFIED_MUSTER_ENTRIES.filter(e => e.factionId === 'AELDARI').map(e => ({ id: e.id, datasheetId: e.id, ...(e.id === 'farseer' ? { enhancementId: 'BREATH_OF_VAUL' } : {}) })),
  attachments: VERIFIED_MUSTER_PLANS[0]!.attachments, embarked: VERIFIED_MUSTER_PLANS[0]!.embarked,
};
export const EMPERORS_CHILDREN_PRESET: PresetRoster = {
  id: 'emperors-children-peerless-1000', factionId: 'EMPERORS_CHILDREN', battleSize: 'INCURSION', pointsLimit: 1000,
  detachmentId: 'PEERLESS_BLADESMEN', detachmentPointsLimit: 2, forceDisposition: 'PRIORITY_ASSETS', warlordUnitId: 'lord-exultant', enhancementLimit: 1,
  units: VERIFIED_MUSTER_ENTRIES.filter(e => e.factionId === 'EMPERORS_CHILDREN').map(e => ({ id: e.id, datasheetId: e.id, ...(e.id === 'lord-exultant' ? { enhancementId: 'FAULTLESS_OPPORTUNIST' } : {}) })),
  attachments: VERIFIED_MUSTER_PLANS[1]!.attachments, embarked: VERIFIED_MUSTER_PLANS[1]!.embarked,
};
/** Deterministic construction; the returned snapshot is at PRE_BATTLE, ready for Task 006 deployment. */
export function createAeldariVsEmperorsChildrenMatch(seed: number): GameState {
  if (!Number.isSafeInteger(seed)) throw new Error('Seed must be an integer');
  const { state, definition } = createProvingGroundDeploymentMatch();
  state.id = `aeldari-vs-emperors-children:${seed}`;
  state.players[0] = { id: 'player-1', name: 'Aeldari', factionId: 'AELDARI', forceDisposition: 'TAKE_AND_HOLD', commandPoints: 0 };
  state.players[1] = { id: 'player-2', name: "Emperor's Children", factionId: 'EMPERORS_CHILDREN', forceDisposition: 'PRIORITY_ASSETS', commandPoints: 0 };
  state.definitions = [...AELDARI_DATASHEETS, ...EMPERORS_CHILDREN_DATASHEETS];
  state.factionRuleIds = { [state.players[0].id]: ['BATTLE_FOCUS','GUARDIAN_BATTLEHOST'], [state.players[1].id]: ['THRILL_SEEKERS','EXQUISITE_SWORDSMANSHIP'] };
  state.stratagemDefinitions = [...FACTION_STRATAGEMS];
  state.battleFocus = { battleSize: 'INCURSION', round: 0, tokens: {}, usedByPhase: {}, manoeuvresByPhase: {} };
  state.units = state.definitions.map((d, i) => ({ ...createUnit(d, d.id, i < AELDARI_DATASHEETS.length ? state.players[0].id : state.players[1].id,
    Array.from({length:d.modelCount}, () => ({x:0,y:0,z:0}))), location: 'RESERVES' as const }));
  state.armies = state.players.map(p => ({ id: `army:${p.id}`, playerId: p.id, factionId: p.factionId,
    unitIds: state.units.filter(u => u.playerId === p.id).map(u => u.id) }));
  state.deployment!.pointsLimit = 1000;
  const engine = GameEngine.create(state);
  const assigned = engine.configureAttachments([AELDARI_PRESET, EMPERORS_CHILDREN_PRESET].flatMap(r => r.attachments.map(a => ({...a,leaderIds:[...(a.leaderIds??[])],supportIds:[...(a.supportIds??[])]}))));
  if (!assigned.ok) throw new Error(`Invalid attachments: ${assigned.reason}`);
  const entered = engine.advancePreBattle();
  if (!entered.ok) throw new Error(`Invalid deployment setup: ${entered.reason}`);
  for (const roster of [AELDARI_PRESET, EMPERORS_CHILDREN_PRESET]) {
    for (const passenger of roster.embarked) for (const id of passenger.passengerIds) {
      const result = engine.startEmbarked(id, passenger.transportId);
      if (!result.ok) throw new Error(`Invalid transport manifest: ${id} ${result.reason}`);
    }
  }
  const mission = engine.setupMission(definition, state.players[0].id, {}, createSeededRng(seed));
  if (!mission.ok) throw new Error(`Invalid Proving Ground mission: ${mission.reason}`);
  return engine.getState();
}
