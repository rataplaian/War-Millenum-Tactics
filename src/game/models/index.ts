export type FactionId = string;
export type PlayerId = string;
export type DeepReadonly<T> = { readonly [K in keyof T]: DeepReadonly<T[K]> };
/** Continuous inches; origin is the top-left, x right, y down. */
export interface Position { x: number; y: number }
export interface Battlefield { width: number; height: number }
/** Extend this discriminated union for hulls later. Radius is derived, never stored. */
export type BaseGeometry = { kind: 'circle'; diameterMm: number };
export interface Player { id: PlayerId; name: string; factionId: FactionId }
export interface Army { id: string; playerId: PlayerId; factionId: FactionId; unitIds: string[] }
export interface Model {
  id: string;
  unitId: string;
  woundsRemaining: number;
  position: Position;
  alive: boolean;
  base: BaseGeometry;
  movementUsed: number;
}
export type DiceValue = { kind: 'fixed'; value: number } | { kind: 'dice'; count: number; sides: 6; modifier: number };
export interface WeaponTrait { id: string; value?: number }
interface WeaponProfile {
  id: string; name: string; attacks: DiceValue; skill: number; strength: number;
  /** Signed save modifier, e.g. -1. */
  armourPenetration: number; damage: DiceValue; traits: WeaponTrait[];
}
export type Weapon = (WeaponProfile & { kind: 'ranged'; range: number }) | (WeaponProfile & { kind: 'melee'; range: null });
export interface Ability { id: string; name: string; parameters: Record<string, string | number | boolean> }
export interface UnitStats { movement: number; toughness: number; save: number; wounds: number; leadership: number; objectiveControl: number }
export type UnitDefinition = DeepReadonly<{
  id: string; name: string; factionId: FactionId; modelCount: number; stats: UnitStats;
  defaultBase: BaseGeometry;
  keywords: string[]; weapons: Weapon[]; abilities: Ability[]; placeholder: boolean;
}>;
export interface UnitState { hasMoved: boolean; hasShot: boolean; hasCharged: boolean; hasFought: boolean }
/** Mutable battle data only. Static characteristics resolve through definitionId. */
export interface Unit {
  id: string;
  definitionId: string;
  playerId: PlayerId;
  models: Model[];
  state: UnitState;
}
export interface CoherencyRule {
  maxEdgeDistance: number;
  /** Ascending minimum living model count, first band must start at 1. */
  sizeBands: { minModels: number; requiredNeighbours: number }[];
  requireConnected: boolean;
}
export interface SpatialRules { coherency: CoherencyRule; engagementDistance: number }
export interface MovementTransaction {
  unitId: string;
  originals: { modelId: string; position: Position; movementUsed: number }[];
}
interface EventContext { sequence: number; round: number; turn: number; playerId: string; unitId: string }
export type MovementEvent = EventContext & (
  { type: 'movement-started' } |
  { type: 'model-moved'; modelId: string; from: Position; to: Position; distance: number; totalUsed: number } |
  { type: 'movement-cancelled'; restored: { modelId: string; position: Position }[] } |
  { type: 'movement-completed' }
);
export const PHASES = ['Command', 'Movement', 'Shooting', 'Charge', 'Fight'] as const;
export type Phase = typeof PHASES[number];
export type GameStatus = 'in-progress' | 'finished';
export interface GameState {
  schemaVersion: 2;
  id: string;
  round: number;
  turn: number;
  activePlayerId: PlayerId;
  phase: Phase;
  players: [Player, Player];
  armies: Army[];
  definitions: readonly UnitDefinition[];
  units: Unit[];
  status: GameStatus;
  battlefield: Battlefield;
  spatialRules: SpatialRules;
  movement: MovementTransaction | null;
  events: MovementEvent[];
}
export type FailureReason = 'MATCH_FINISHED' | 'WRONG_PHASE' | 'UNIT_NOT_FOUND' | 'NOT_YOUR_UNIT' |
  'ALREADY_MOVED' | 'NO_LIVING_MODELS' | 'MOVEMENT_IN_PROGRESS' | 'NO_ACTIVE_MOVEMENT' |
  'MODEL_NOT_IN_UNIT' | 'MODEL_DEAD' | 'INVALID_POSITION' | 'EXCEEDS_ALLOWANCE' |
  'OUTSIDE_BATTLEFIELD' | 'BASE_OVERLAP' | 'UNIT_ENGAGED' | 'ENEMY_ENGAGEMENT' | 'INCOHERENT';
export interface CommandFailure {
  ok: false;
  reason: FailureReason;
  blockingModelId?: string;
  distance?: number;
  remaining?: number;
  modelIds?: string[];
}
export type CommandResult<T = undefined> = { ok: true; value: T } | CommandFailure;
