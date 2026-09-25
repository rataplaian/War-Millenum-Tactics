import { createDeploymentTestMatch } from '../data/deploymentPrototype';
import { createTerrainTestMatch } from '../data/terrainPrototype';
import { rectangle } from '../terrain/geometry';
import type { MissionDefinition } from './types';
/** Invented demonstration mission. Scores and cards are technical fixtures, not official mission data. */
export const PROVING_GROUND: MissionDefinition = {
  id: 'PROVING_GROUND', name: 'Proving Ground', battlefield: { width: 40, height: 30 }, deployment: { attackerZoneId: 'near', defenderZoneId: 'far' },
  objectives: ['ruin-area', 'light-area', 'exposed-area', 'north-area', 'south-area'].map((terrainAreaId, i) => ({ id: `site-${i + 1}`, type: 'TERRAIN_OBJECTIVE', terrainAreaId })),
  actions: [
    { id: 'TEST_SECURE_SITE', name: 'Test Secure Site', starts: 'Shooting', completes: 'END_OF_TURN', allowedKeywords: ['INFANTRY'], requiresObjective: true, requiresControl: true, useLimit: { scope: 'TURN', count: 1 }, effect: { kind: 'SECURE_OBJECTIVE' } },
    { id: 'TEST_DATA_UPLOAD', name: 'Test Data Upload', starts: 'Shooting', completes: 'END_OF_TURN', useLimit: { scope: 'TURN', count: 2 }, effect: { kind: 'MISSION_PROGRESS', amount: 1 } },
  ],
  primary: [{ rules: [{ id: 'hold-ground', timing: 'END_OF_COMMAND_PHASE', condition: { kind: 'CONTROLLED_OBJECTIVES', minimum: 1 }, reward: 5, repeat: 'ONCE_PER_TURN' },
    { id: 'hold-two', timing: 'END_OF_COMMAND_PHASE', condition: { kind: 'CONTROLLED_OBJECTIVES', minimum: 2 }, reward: 5, repeat: 'ONCE_PER_TURN' }] }],
  secondaries: [
    { id: 'fixed-upload', name: 'Upload proof', mode: 'FIXED', rule: { id: 'fixed-upload', timing: 'END_OF_TURN', condition: { kind: 'ACTION_COMPLETED', actionId: 'TEST_DATA_UPLOAD' }, reward: 5 }, discardOnComplete: false, canRetain: true, actionId: 'TEST_DATA_UPLOAD' },
    { id: 'fixed-secure', name: 'Secure a site', mode: 'FIXED', rule: { id: 'fixed-secure', timing: 'END_OF_TURN', condition: { kind: 'ACTION_COMPLETED', actionId: 'TEST_SECURE_SITE' }, reward: 5 }, discardOnComplete: false, canRetain: true, actionId: 'TEST_SECURE_SITE' },
    { id: 'tactical-hold', name: 'Hold one site', mode: 'TACTICAL', rule: { id: 'tactical-hold', timing: 'END_OF_TURN', condition: { kind: 'CONTROLLED_OBJECTIVES', minimum: 1 }, reward: 5 }, discardOnComplete: true, canRetain: true },
    { id: 'tactical-two', name: 'Hold two sites', mode: 'TACTICAL', rule: { id: 'tactical-two', timing: 'END_OF_TURN', condition: { kind: 'CONTROLLED_OBJECTIVES', minimum: 2 }, reward: 5 }, discardOnComplete: true, canRetain: true },
    { id: 'tactical-upload', name: 'Complete data upload', mode: 'TACTICAL', rule: { id: 'tactical-upload', timing: 'END_OF_TURN', condition: { kind: 'ACTION_COMPLETED', actionId: 'TEST_DATA_UPLOAD' }, reward: 5 }, discardOnComplete: true, canRetain: true, actionId: 'TEST_DATA_UPLOAD' },
    { id: 'tactical-loss', name: 'Witness an enemy loss', mode: 'TACTICAL', rule: { id: 'tactical-loss', timing: 'END_OF_TURN', condition: { kind: 'EVENT', name: 'UNIT_DESTROYED', ownUnit: false }, reward: 5 }, discardOnComplete: true, canRetain: true },
  ],
  secondaryPolicy: { fixedCount: 2, tacticalHandSize: 2, retainUncompleted: true, drawTiming: 'START_OF_COMMAND_PHASE' },
  caps: { primaryPerRound: 15, primaryTotal: 45, secondaryPerRound: 15, secondaryTotal: 45 }, maximumBattleRounds: 5,
};
export function createProvingGroundMatch() {
  const s = createTerrainTestMatch('CLEAR'); s.id = 'proving-ground';
  s.battlefield.terrain!.areas.push({ id: 'north-area', footprint: rectangle(26, 17, 5, 4), featureIds: [], metadata: { label: 'North site' } },
    { id: 'south-area', footprint: rectangle(30, 23, 5, 4), featureIds: [], metadata: { label: 'South site' } });
  return s;
}
/** Same mission definition attached to the real Task 006 deployment transaction. */
export function createProvingGroundDeploymentMatch() {
  const s = createDeploymentTestMatch();
  for (const [id, x, y] of [['ruin-area', 5, 10], ['light-area', 14, 17], ['exposed-area', 29, 15], ['north-area', 8, 22], ['south-area', 36, 22]] as const)
    s.battlefield.terrain!.areas.push({ id, footprint: rectangle(x, y, 4, 4), featureIds: [], metadata: { label: id } });
  return { state: s, definition: { ...PROVING_GROUND, battlefield: { width: 48, height: 36 } } };
}
