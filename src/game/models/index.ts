export type FactionId = string;
export type PlayerId = string;
export type DeepReadonly<T> = { readonly [K in keyof T]: DeepReadonly<T[K]> };
/** Continuous inches; origin is the top-left, x right, y down. */
export interface Position { x: number; y: number }
export interface LosBlocker {
  id: string;
  kind: 'rectangle';
  position: Position;
  width: number;
  height: number;
  opaque: boolean;
}
export interface Battlefield { width: number; height: number; losBlockers: LosBlocker[] }
export type BattlefieldDimensions = Pick<Battlefield, 'width' | 'height'>;
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
  schemaVersion: 3;
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
  shooting: ShootingTransaction | null;
  events: GameEvent[];
}
export type FailureReason = 'MATCH_FINISHED' | 'WRONG_PHASE' | 'UNIT_NOT_FOUND' | 'NOT_YOUR_UNIT' |
  'ALREADY_MOVED' | 'NO_LIVING_MODELS' | 'MOVEMENT_IN_PROGRESS' | 'NO_ACTIVE_MOVEMENT' |
  'MODEL_NOT_IN_UNIT' | 'MODEL_DEAD' | 'INVALID_POSITION' | 'EXCEEDS_ALLOWANCE' |
  'OUTSIDE_BATTLEFIELD' | 'BASE_OVERLAP' | 'UNIT_ENGAGED' | 'ENEMY_ENGAGEMENT' | 'INCOHERENT' |
  'SHOOTING_IN_PROGRESS' | 'NO_ACTIVE_SHOOTING' | 'ALREADY_SHOT' | 'NO_RANGED_WEAPONS' |
  'WEAPON_NOT_FOUND' | 'WEAPON_NOT_RANGED' | 'WEAPON_ALREADY_FIRED' | 'TARGET_NOT_FOUND' |
  'TARGET_NOT_ENEMY' | 'TARGET_DESTROYED' | 'TARGET_OUT_OF_RANGE' | 'TARGET_NOT_VISIBLE' |
  'NO_ELIGIBLE_FIRING_MODELS' | 'SHOOTING_ALREADY_RESOLVED';
export interface CommandFailure {
  ok: false;
  reason: FailureReason;
  blockingModelId?: string;
  distance?: number;
  remaining?: number;
  modelIds?: string[];
}
export type CommandResult<T = undefined> = { ok: true; value: T } | CommandFailure;

export type RangedWeapon = DeepReadonly<Extract<Weapon, { kind: 'ranged' }>>;
export interface ShootingTransaction {
  unitId: string;
  firedWeaponIds: string[];
  hasRolled: boolean;
}
export interface DiceResolution { value: number; rolls: number[] }
export interface SaveResult { required: number; roll: number | null; saved: boolean }
export interface DamageResult {
  modelId: string;
  resolved: DiceResolution;
  woundsBefore: number;
  woundsAfter: number;
  applied: number;
  excess: number;
  destroyed: boolean;
}
export interface WeaponResolution {
  weaponId: string;
  targetUnitId: string;
  eligibleFiringModelIds: string[];
  attackCounts: { modelId: string; resolved: DiceResolution }[];
  attacks: number;
  hitRolls: number[];
  hits: number;
  woundTarget: number;
  woundRolls: number[];
  wounds: number;
  saveResults: SaveResult[];
  savesFailed: number;
  damageResults: DamageResult[];
  totalDamage: number;
  destroyedModelIds: string[];
}
export type ShootingEvent = EventContext & (
  { type: 'shooting-started' } |
  { type: 'weapon-fired'; resolution: WeaponResolution } |
  { type: 'model-damaged'; targetUnitId: string; weaponId: string; damage: DamageResult } |
  { type: 'model-destroyed'; targetUnitId: string; weaponId: string; modelId: string } |
  { type: 'shooting-cancelled' } |
  { type: 'shooting-completed' }
);
export type GameEvent = MovementEvent | ShootingEvent;
export interface LegalTarget {
  targetUnitId: string;
  eligibleFiringModelIds: string[];
  /** Closest living pair, in inches, whether or not that pair is visible. */
  nearestDistance: number;
}
