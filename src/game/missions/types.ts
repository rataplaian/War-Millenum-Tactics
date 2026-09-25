import type { Phase, Position } from '../models';
import type { FlowEventName } from '../flow/types';
export type ScoringWindow = 'START_OF_COMMAND_PHASE' | 'END_OF_COMMAND_PHASE' | 'END_OF_PHASE' | 'END_OF_TURN' | 'END_OF_BATTLE_ROUND' | 'END_OF_BATTLE';
export type ForceDisposition = 'TAKE_AND_HOLD' | 'PURGE_THE_FOE' | 'DISRUPTION' | 'RECONNAISSANCE' | 'PRIORITY_ASSETS';
export interface ObjectiveDefinition { id: string; type: 'TERRAIN_OBJECTIVE' | 'MARKER_OBJECTIVE'; terrainAreaId?: string; position?: Position; markerRange?: number; metadata?: Record<string, string | number | boolean> }
export interface ObjectiveState extends ObjectiveDefinition { controllingPlayerId: string | null; securedByPlayerId: string | null; securedAtRound?: number; securedAtTurn?: number; securedSource?: string }
export type ScoreCondition = { kind: 'CONTROLLED_OBJECTIVES'; minimum: number } | { kind: 'EVENT'; name: FlowEventName | 'model-destroyed' | 'melee-attack-resolved' | 'weapon-fired'; ownUnit?: boolean } | { kind: 'ACTION_COMPLETED'; actionId: string };
export interface ScoringRule { id: string; timing: ScoringWindow; condition: ScoreCondition; reward: number; eligiblePlayer?: 'ACTIVE' | 'BOTH'; /** Repeated control counts only when explicitly enabled. */ repeat?: 'EACH_WINDOW' | 'ONCE_PER_TURN' | 'ONCE_PER_ROUND' | 'ONCE_PER_BATTLE' }
export interface SecondaryDefinition { id: string; name: string; mode: 'FIXED' | 'TACTICAL'; rule: ScoringRule; discardOnComplete: boolean; canRetain: boolean; actionId?: string }
export interface ActionDefinition { id: string; name: string; starts: Phase; completes: ScoringWindow; allowedKeywords?: string[]; requiresObjective?: boolean; requiresControl?: boolean; useLimit: { scope: 'TURN' | 'BATTLE'; count: number }; effect: { kind: 'SECURE_OBJECTIVE' | 'MISSION_PROGRESS' | 'AWARD_VP'; amount?: number }; metadata?: Record<string, string | number | boolean> }
export interface MissionModifier { id: string; metadata?: Record<string, string | number | boolean> }
export interface MissionDefinition {
  id: string; name: string; battlefield: { width: number; height: number }; deployment: { attackerZoneId?: string; defenderZoneId?: string };
  objectives: ObjectiveDefinition[]; actions: ActionDefinition[];
  primary: { playerId?: string; rules: ScoringRule[] }[];
  secondaries: SecondaryDefinition[];
  secondaryPolicy: { fixedCount: number; tacticalHandSize: number; retainUncompleted: boolean; drawTiming: ScoringWindow };
  caps: { primaryPerRound: number; primaryTotal: number; secondaryPerRound: number; secondaryTotal: number; total?: number };
  maximumBattleRounds: number; endConditions?: { kind: 'EVENT_COUNT'; event: FlowEventName; count: number }[];
  missionRules?: string[]; twist?: MissionModifier;
}
export interface ActiveAction { actionId: string; unitId: string; playerId: string; objectiveId?: string; startedAt: { round: number; turn: number; phase: Phase }; completesAt: ScoringWindow; state: 'ACTIVE' | 'COMPLETED' | 'INTERRUPTED' | 'FAILED'; source: string; reason?: string }
export interface VictoryPointEntry { id: number; playerId: string; amount: number; sourceType: 'PRIMARY' | 'SECONDARY' | 'OTHER'; sourceId: string; round: number; turn: number; phase: Phase; eventSequence?: number }
export interface MatchResult { scores: { playerId: string; primary: number; secondary: number; other: number; total: number }[]; winnerPlayerId: string | null; outcome: 'WIN' | 'DRAW'; endReason: string; completedBattleRounds: number }
export type MissionSetupStep = 'MUSTER' | 'DETERMINE_MISSION' | 'DETERMINE_DEPLOYMENT' | 'CREATE_BATTLEFIELD' | 'ATTACKER_DEFENDER' | 'SELECT_SECONDARIES' | 'DECLARE_FORMATIONS' | 'DEPLOYMENT' | 'PRE_BATTLE' | 'BATTLE';
export interface MissionState {
  definition: MissionDefinition; setupStep: MissionSetupStep; attackerPlayerId: string; defenderPlayerId: string;
  objectives: ObjectiveState[]; activeActions: ActiveAction[]; actionUses: { actionId: string; playerId: string; turn: number }[];
  primaryProgress: Record<string, Record<string, number>>; secondaryProgress: Record<string, Record<string, number>>;
  fixed: Record<string, string[]>; tactical: Record<string, { deck: string[]; hand: string[]; completed: string[]; discarded: string[]; retained: string[] }>;
  ledger: VictoryPointEntry[]; initialEventSequence: number; lastEventSequence: number; scoredWindows: string[];
  completedObjectives: string[]; currentMissionRules: string[]; matchResult: MatchResult | null;
}
