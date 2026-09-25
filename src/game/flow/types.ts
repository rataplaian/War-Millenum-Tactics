import type { GameState, Phase, CommandResult } from '../models';
import type { Effect } from '../effects/types';
export const COMMAND_STEPS = ['START_OF_COMMAND_PHASE', 'GAIN_CORE_CP', 'BATTLE_SHOCK', 'COMMAND_ABILITIES', 'END_OF_COMMAND_PHASE'] as const;
export type CommandStep = typeof COMMAND_STEPS[number];
export type Trigger = 'START_OF_PHASE' | 'END_OF_PHASE' | 'START_OF_TURN' | 'END_OF_TURN' |
  'AT_START_OF_COMMAND_PHASE' | 'AT_END_OF_COMMAND_PHASE' | 'AFTER_ENEMY_FALL_BACK' | 'AFTER_ENEMY_DESTROYED' | 'BEFORE_CONSOLIDATE' | 'AFTER_TARGET_SELECTED' | 'AFTER_HIT_ROLL' |
  'AFTER_WOUND_ROLL' | 'AFTER_UNIT_SHOT' | 'AFTER_CHARGE_MOVE' | 'AFTER_UNIT_FOUGHT' | 'AFTER_BATTLE_SHOCK_FAILED';
export interface TimingWindow { id: string; trigger: Trigger; playerId: string; unitId?: string; targetUnitId?: string; passedPlayerIds: string[] }
export interface PendingResolution { id: string; kind: 'BATTLE_SHOCK' | 'ABILITY' | 'MISSION_HOOK' | 'RULE'; unitId?: string; resolverId?: string; label: string }
export interface FlowRules { maximumBattleRounds: number; maxExtraCpPerBattleRound: number }
export interface MatchFlowState {
  firstPlayerId: string; phaseIndex: number; commandStep: CommandStep | null;
  rules: FlowRules; pending: PendingResolution[]; window: TimingWindow | null; queuedWindows: TimingWindow[];
  boundary: 'NONE' | 'PHASE_END' | 'TURN_END'; started: boolean; missionHookStarted: boolean;
  resolvedAbilities: string[];
  effects: Effect[]; nextEffectId: number; nextWindowId: number;
  usage: { stratagemId: string; playerId: string; targetIds: string[]; phaseIndex: number; turn: number; round: number }[];
}
export type FlowEventName = 'UNIT_DESTROYED' | 'OBJECTIVE_CONTROL_CHANGED' | 'OBJECTIVE_SECURED' | 'OBJECTIVE_LOST' | 'OBJECTIVE_CONTESTED' | 'ACTION_STARTED' | 'ACTION_INTERRUPTED' | 'ACTION_COMPLETED' | 'ACTION_FAILED' | 'VICTORY_POINTS_AWARDED' | 'TACTICAL_DRAWN' | 'TACTICAL_DISCARDED' | 'MISSION_BATTLE_ENDED' | 'MORTAL_WOUNDS_RESOLVED' | 'AFTER_HIT_ROLL' | 'AFTER_WOUND_ROLL' | 'DEADLY_DEMISE_ROLLED' | 'SUPER_HEAVY_WALKER_TEST' | 'UNIT_EMBARKED' | 'DISEMBARK_CANCELLED' | 'DISEMBARK_STARTED' | 'DISEMBARK_COMPLETED' | 'COMBAT_DISEMBARK' | 'EMERGENCY_DISEMBARK_STARTED' | 'EMERGENCY_DISEMBARK_COMPLETED' | 'TRANSPORT_PASSENGER_DESTROYED' | 'FIRING_DECK_SELECTED' | 'ATTACHED_UNIT_FORMED' | 'ATTACHED_COMPONENT_DESTROYED' | 'ATTACHED_UNIT_SPLIT' | 'LEADER_SEPARATED' | 'SUPPORT_SEPARATED' | 'HAZARD_ROLLED' | 'TRANSPORT_DESTROYED' | 'ADVANCE_ROLLED' | 'BATTLE_ROUND_STARTED' | 'BATTLE_ROUND_ENDED' | 'TURN_STARTED' | 'TURN_ENDED' |
  'PHASE_STARTED' | 'PHASE_ENDED' | 'COMMAND_STEP_STARTED' | 'COMMAND_STEP_COMPLETED' | 'CORE_CP_GAINED' |
  'OTHER_CP_GAINED' | 'CP_SPENT' | 'BATTLE_SHOCK_ROLL_STARTED' | 'BATTLE_SHOCK_ROLL_RESOLVED' |
  'BATTLE_SHOCK_APPLIED' | 'BATTLE_SHOCK_CLEARED' | 'TIMING_WINDOW_OPENED' | 'TIMING_WINDOW_CLOSED' |
  'STRATAGEM_USED' | 'MODELS_RESTORED' | 'FIGHT_ON_DEATH_RESOLVED' | 'AGILE_MANOEUVRE_USED' | 'REACTION_MODEL_MOVED' | 'REACTION_MOVE_COMPLETED' | 'TEMPORARY_EFFECT_APPLIED' | 'TEMPORARY_EFFECT_EXPIRED' | 'COMMAND_ABILITY_RESOLVED' | 'MANDATORY_RESOLUTION_COMPLETED';
export interface FlowEvent { type: 'flow'; name: FlowEventName; sequence: number; round: number; turn: number; playerId: string; unitId: string; detail: Record<string, string | number | boolean | string[] | number[]> }
/** Executable policies are application code; snapshots store only stable resolver IDs. */
export interface CommandAbility {
  id: string; step: CommandStep | 'MISSION_HOOK'; mandatory: boolean;
  eligible: (state: Readonly<GameState>) => boolean;
  resolve: (state: GameState) => CommandResult;
}
export interface FlowPolicies { abilities?: readonly CommandAbility[]; blockers?: (state: Readonly<GameState>) => string[] }
export interface FlowStamp { round: number; turn: number; phaseIndex: number; playerId: string; phase: Phase }
