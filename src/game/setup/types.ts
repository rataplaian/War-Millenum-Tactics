import type { MovementTransaction, Polygon, Position } from '../models';
export type CoreAbility = { kind: 'INFILTRATORS' | 'DEEP_STRIKE' } | { kind: 'SCOUTS'; distance: number };
export type UnitLocation = 'BATTLEFIELD' | 'STRATEGIC_RESERVES' | 'RESERVES' | 'DESTROYED';
export type DeploymentAbilityChoice = 'SCOUTS' | 'INFILTRATORS';
export type IngressMethod = 'STRATEGIC_EDGE' | 'DEEP_STRIKE';
export type MoveType = 'NORMAL_MOVE' | 'INGRESS_MOVE' | 'SCOUT_MOVE';
export interface DeploymentZone { id: string; playerId: string; footprint: Polygon; metadata: Record<string, string | number | boolean> }
export interface ReserveRules {
  strategicReservePointsLimitRatio: number; standardIngressMinimumRound: number;
  ingressEdgeDistance: number; enemySetupDistance: number; infiltratorZoneDistance: number;
  scoutEnemyDistance: number; enemyZoneAllowedRound: number; reserveExpirationRound: number;
}
export interface ReserveRecord { initial: boolean; repositioned: boolean; reason: string; enteredTurn: number; ingressCount: number; transportHasIngressed?: boolean }
export interface ArrivalRecord { method: 'STRATEGIC_RESERVES' | 'DEEP_STRIKE' | 'REPOSITION'; turn: number; ingressMethod: IngressMethod }
export interface DeploymentState {
  stage: 'PRE_BATTLE' | 'DECLARE_BATTLE_FORMATIONS' | 'DEPLOY_ARMIES' | 'PRE_BATTLE_RULES' | 'BATTLE_STARTED';
  zones: DeploymentZone[]; pointsLimit: number; rules: ReserveRules;
  firstDeploymentPlayerId: string; nextPlayerId: string; firstTurnPlayerId: string | null;
  deployed: string[]; scoutDone: string[]; choices: Record<string, DeploymentAbilityChoice>;
  initialReserveIds: string[];
}
export type Formation = Record<string, Position>;
export interface SetupTransaction {
  unitId: string; kind: 'DEPLOYMENT' | 'INGRESS_MOVE' | 'SCOUT_SETUP';
  mode: 'NORMAL' | 'INFILTRATORS' | IngressMethod; positions: Formation;
}
export interface ScoutMoveTransaction extends MovementTransaction { kind: 'SCOUT_MOVE'; allowance: number; used: Record<string, number> }
export interface SetupConstraints { ownZone?: boolean; enemyDistance?: number; enemyZoneDistance?: number; excludeEnemyZone?: boolean; edgeDistance?: number }
export type SetupEventType = 'unit-placed-in-strategic-reserves' | 'unit-deployed' | 'unit-deployed-using-infiltrators' |
  'deployment-choice-selected' | 'scout-move-started' | 'scout-model-moved' | 'scout-move-completed' | 'scout-move-cancelled' | 'scout-skipped' |
  'unit-selected-for-ingress' | 'ingress-started' | 'ingress-completed' | 'unit-deep-struck' | 'unit-repositioned-to-reserves' |
  'reserve-unit-destroyed' | 'setup-started' | 'setup-cancelled';
export const SETUP_EVENT_TYPES: readonly SetupEventType[] = ['unit-placed-in-strategic-reserves', 'unit-deployed', 'unit-deployed-using-infiltrators', 'deployment-choice-selected', 'scout-move-started', 'scout-model-moved', 'scout-move-completed', 'scout-move-cancelled', 'scout-skipped', 'unit-selected-for-ingress', 'ingress-started', 'ingress-completed', 'unit-deep-struck', 'unit-repositioned-to-reserves', 'reserve-unit-destroyed', 'setup-started', 'setup-cancelled'];
