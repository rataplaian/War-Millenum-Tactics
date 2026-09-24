import type { RerollPermission, DieResolution } from '../combat/dice';
import type { MovementAbilityChoices } from '../abilities/movement';
import type { WeaponAbilityDefinition, AttackChoices } from '../abilities/types';
import type { AttackRecord, AttackJob } from '../combat/types';
import type { AttachmentDefinition, AttachmentRecord } from '../attachments/types';
import type { TransportCapacityDefinition, EmbarkedState, TransportState, FiringDeckSelection } from '../transports/types';
import type { EffectPayload } from '../effects/types';
import type { MatchFlowState, FlowEvent } from '../flow/types';
import type { CoreAbility, UnitLocation, ReserveRecord, ArrivalRecord, DeploymentState, SetupTransaction, ScoutMoveTransaction, SetupEventType } from '../setup/types';
export type FactionId = string;
export type PlayerId = string;
export type DeepReadonly<T> = { readonly [K in keyof T]: DeepReadonly<T[K]> };
/** Continuous inches; origin is the top-left, x right, y down. */
export interface Position { x: number; y: number; /** Legacy omission means ground level. */ z?: number }
export interface Position3 extends Position { z: number }
export interface LosBlocker {
  id: string;
  kind: 'rectangle';
  position: Position;
  width: number;
  height: number;
  opaque: boolean;
}
export interface Battlefield { width: number; height: number; losBlockers: LosBlocker[]; terrain?: TerrainData }
export type BattlefieldDimensions = Pick<Battlefield, 'width' | 'height'>;
/** Extend this discriminated union for hulls later. Radius is derived, never stored. */
export type BaseGeometry = { kind: 'circle'; diameterMm: number };
export interface Player { id: PlayerId; name: string; factionId: FactionId; commandPoints?: number; extraCpGainedThisBattleRound?: number }
export interface Army { id: string; playerId: PlayerId; factionId: FactionId; unitIds: string[] }
export interface Model {
  oneShotExpended?: string[];
  coreAbilityChoices?: Record<string, number>;
  abilities?: Ability[];
  toughness?: number;
  sourceDefinitionId?: string;
  componentUnitId?: string;
  id: string;
  unitId: string;
  woundsRemaining: number;
  position: Position;
  alive: boolean;
  base: BaseGeometry;
  movementUsed: number;
  leadership?: number;
  coreAbilities?: CoreAbility[];
  volume?: { kind: 'cylinder'; height: number };
}
export type DiceValue = { kind: 'fixed'; value: number } | { kind: 'dice'; count: number; sides: 3 | 6; modifier: number };
export interface WeaponTrait { id: string; value?: number }
interface WeaponProfile {
  rerollPermissions?: RerollPermission[];
  weaponAbilities?: WeaponAbilityDefinition[];
  id: string; name: string; attacks: DiceValue; skill: number; strength: number;
  /** Signed save modifier, e.g. -1. */
  armourPenetration: number; damage: DiceValue; traits: WeaponTrait[];
}
export type Weapon = (WeaponProfile & { kind: 'ranged'; range: number }) | (WeaponProfile & { kind: 'melee'; range: null });
export interface Ability { scope?: 'UNIT' | 'MODEL'; effect?: EffectPayload; whileLeading?: boolean; whileEmbarked?: boolean; viaFiringDeck?: boolean; id: string; name: string; parameters: Record<string, string | number | boolean> }
export interface UnitStats { movement: number; toughness: number; save: number; wounds: number; leadership: number; objectiveControl: number }
export type UnitDefinition = DeepReadonly<{
  id: string; name: string; factionId: FactionId; modelCount: number; stats: UnitStats;
  attachment?: AttachmentDefinition; transport?: TransportCapacityDefinition; invulnerableSave?: number;
  points?: number; coreAbilities?: CoreAbility[];
  defaultBase: BaseGeometry;
  keywords: string[]; weapons: Weapon[]; abilities: Ability[]; placeholder: boolean;
}>;
export interface UnitState { battleShocked?: boolean; hasAdvanced?: boolean; hasFallenBack?: boolean; hasMoved: boolean; hasShot: boolean; hasCharged: boolean; hasFought: boolean }
/** Mutable battle data only. Static characteristics resolve through definitionId. */
export interface Unit {
  advanceBonus?: { turn: number; value: number };
  startedBattleAttached?: boolean;
  embarked?: EmbarkedState;
  setupAtTurn?: number;
  lastMove?: { kind: 'NORMAL_MOVE' | 'ADVANCE_MOVE' | 'FALL_BACK_MOVE' | 'INGRESS_MOVE' | 'DISEMBARK_MOVE'; turn: number; phase: Phase };
  cannotChargeUntilTurn?: number;
  cannotShootUntilTurn?: number;
  selectedToShootAt?: { turn: number; phase: Phase };
  id: string;
  definitionId: string;
  playerId: PlayerId;
  models: Model[];
  state: UnitState;
  /** Absolute player-turn index; deliberately not reset with action flags. */
  lastRangedAttackTurnIndex?: number;
  location?: UnitLocation;
  reserve?: ReserveRecord;
  arrival?: ArrivalRecord;
  moveLock?: { kind: 'UNTIL_NEXT_CHARGE'; turn: number };
}
export interface CoherencyRule {
  maxEdgeDistance: number;
  /** Ascending minimum living model count, first band must start at 1. */
  sizeBands: { minModels: number; requiredNeighbours: number }[];
  requireConnected: boolean;
}
export interface SpatialRules { coherency: CoherencyRule; engagementDistance: number }
export interface MovementTransaction {
  abilityChoices?: MovementAbilityChoices;
  moveType?: 'NORMAL_MOVE' | 'ADVANCE_MOVE' | 'FALL_BACK_MOVE';
  bonus?: number;
  irreversible?: boolean;
  desperate?: boolean;
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
  combatRules?: { criticalHitThreshold: number; criticalWoundThreshold: number; loneOperativeDistance: number };
  attackJob?: AttackJob;
  destructionQueue?: { model: Model; unitId: string; resolved: boolean; waitForAttackerId?: string }[];
  attachments?: AttachmentRecord[];
  transportState?: TransportState;
  flow?: MatchFlowState;
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
  /** Optional for loading unmodified Task 003 snapshots. */
  closeCombat?: CloseCombatState;
  deployment?: DeploymentState;
  setup?: SetupTransaction | null;
  scout?: ScoutMoveTransaction | null;
}
export type FailureReason = 'ATTACK_PENDING' | 'NO_PENDING_ATTACK' | 'EXTRA_ATTACKS_PENDING' | 'INVALID_ABILITY_CHOICE' | 'INVALID_ATTACHMENT' | 'SUPPORT_REQUIRES_BODYGUARD' | 'NOT_TRANSPORT' | 'INVALID_PASSENGER' | 'TRANSPORT_CAPACITY' | 'TOO_FAR_FROM_TRANSPORT' | 'SET_UP_THIS_TURN' | 'NOT_EMBARKED' | 'DISEMBARK_NOT_ALLOWED' | 'DISEMBARK_IN_PROGRESS' | 'NO_DISEMBARK' | 'PLACEMENT_SEARCH_LIMIT' | 'TACTICAL_MOVE_REQUIRED' | 'FIRING_DECK_LIMIT' | 'ONE_SHOT_FORBIDDEN' | 'PRECISION_TARGET_INVALID' | 'INSUFFICIENT_CP' | 'TIMING_WINDOW_OPEN' | 'NO_TIMING_WINDOW' | 'INVALID_PLAYER' | 'PENDING_RESOLUTION' | 'WRONG_COMMAND_STEP' | 'MISSING_RESOLVER' | 'FLOW_ALREADY_ENABLED' | 'FLOW_REQUIRED' | 'PHASE_BLOCKED' | 'STRATAGEM_NOT_FOUND' | 'WRONG_TIMING' | 'INVALID_TARGET' | 'BATTLE_SHOCKED' | 'USAGE_LIMIT' | 'TARGET_SELECTION_REQUIRED' | 'TARGET_SELECTION_LOCKED' | 'MATCH_FINISHED' | 'WRONG_PHASE' | 'UNIT_NOT_FOUND' | 'NOT_YOUR_UNIT' |
  'ALREADY_MOVED' | 'NO_LIVING_MODELS' | 'MOVEMENT_IN_PROGRESS' | 'NO_ACTIVE_MOVEMENT' |
  'MODEL_NOT_IN_UNIT' | 'MODEL_DEAD' | 'INVALID_POSITION' | 'EXCEEDS_ALLOWANCE' |
  'OUTSIDE_BATTLEFIELD' | 'BASE_OVERLAP' | 'UNIT_ENGAGED' | 'ENEMY_ENGAGEMENT' | 'INCOHERENT' |
  'SHOOTING_IN_PROGRESS' | 'NO_ACTIVE_SHOOTING' | 'ALREADY_SHOT' | 'NO_RANGED_WEAPONS' |
  'WEAPON_NOT_FOUND' | 'WEAPON_NOT_RANGED' | 'WEAPON_ALREADY_FIRED' | 'TARGET_NOT_FOUND' |
  'TARGET_NOT_ENEMY' | 'TARGET_DESTROYED' | 'TARGET_OUT_OF_RANGE' | 'TARGET_NOT_VISIBLE' |
  'NO_ELIGIBLE_FIRING_MODELS' | 'SHOOTING_ALREADY_RESOLVED' |
  'COMBAT_IN_PROGRESS' | 'CHARGE_INELIGIBLE' | 'ALREADY_DECLARED' | 'NO_CHARGE' | 'TARGETS_REQUIRED' |
  'UNREACHABLE_TARGET' | 'IRREVERSIBLE_ACTION' | 'NO_COMBAT_MOVE' | 'NOT_CLOSER' | 'MUST_ENGAGE' |
  'BASE_CONTACT_LOCKED' | 'INVALID_FINAL_ENGAGEMENT' | 'WRONG_FIGHT_STEP' | 'WRONG_FIGHT_PLAYER' |
  'UNIT_NOT_ELIGIBLE' | 'NO_FIGHT_SELECTED' | 'WEAPON_NOT_MELEE' | 'NO_ELIGIBLE_FIGHTERS' | 'TERRAIN_BLOCKED' | 'UNSUPPORTED_SURFACE' | 'SURFACE_NOT_ALLOWED' | 'BASE_OVERHANG' | 'INVALID_MOVEMENT_PATH' | 'CLIMB_TOO_FAR' | 'INVALID_TERRAIN' | 'PRE_BATTLE' | 'WRONG_PRE_BATTLE_STEP' | 'SETUP_IN_PROGRESS' | 'NO_SETUP' | 'NOT_ON_BATTLEFIELD' | 'NOT_IN_RESERVES' | 'WRONG_DEPLOYMENT_PLAYER' | 'ALREADY_DEPLOYED' | 'OUTSIDE_DEPLOYMENT_ZONE' | 'TOO_CLOSE_TO_ENEMY' | 'TOO_CLOSE_TO_ENEMY_ZONE' | 'ENEMY_DEPLOYMENT_ZONE' | 'NOT_WITHIN_EDGE' | 'INCOMPLETE_FORMATION' | 'ABILITY_REQUIRED' | 'ABILITY_CHOICE_REQUIRED' | 'INCOMPATIBLE_ABILITY' | 'RESERVE_POINTS_LIMIT' | 'FORTIFICATION_FORBIDDEN' | 'INGRESS_TOO_EARLY' | 'ARRIVAL_MOVE_LOCK' | 'FIRST_TURN_REQUIRED' | 'SCOUTS_PENDING' | 'NO_SCOUT_MOVE' | 'INVALID_CONFIGURATION';
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
  shootingMode?: 'NORMAL' | 'INDIRECT';
  attackChoices?: Record<string, AttackChoices>;
  hazardousCount?: number;
  firingDeck?: FiringDeckSelection[];
  unitId: string;
  selectedTarget?: { weaponId: string; targetUnitId: string; modelCount?: number; distances?: Record<string, number> };
  firedWeaponIds: string[];
  hasRolled: boolean;
}
export interface DiceResolution { value: number; rolls: number[]; dice?: DieResolution[] }
export interface SaveResult {
  selected?: 'ARMOUR' | 'INVULNERABLE'; die?: import('../combat/dice').DieResolution; required: number; roll: number | null; saved: boolean }
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
  attackRecords?: AttackRecord[];
  pending?: boolean;
  weaponId: string;
  targetUnitId: string;
  eligibleFiringModelIds: string[];
  attackCounts: { modelId: string; resolved: DiceResolution }[];
  attacks: number;
  attackModifiers?: ModelAttackModifiers[];
  hitRolls: number[];
  hits: number;
  woundTarget: number;
  woundRolls: number[];
  wounds: number;
  saveResults: SaveResult[];
  woundTargets?: number[];
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
export type GameEvent = FlowEvent | MovementEvent | ShootingEvent | CloseCombatEvent | TerrainEvent | (EventContext & { type: SetupEventType; method?: string; modelId?: string; reason?: string });
export interface LegalTarget {
  targetUnitId: string;
  eligibleFiringModelIds: string[];
  /** Closest living pair, in inches, whether or not that pair is visible. */
  nearestDistance: number;
}

export type CombatMoveKind = 'charge' | 'pile-in' | 'overrun' | 'consolidate';
/** Legacy schema-3 charge effect; migrated when Match Flow is enabled. */
export interface LegacyCombatEffect { unitId: string; kind: 'FIGHTS_FIRST'; expiresAt: 'END_OF_TURN'; turn: number }
export interface CombatMove extends MovementTransaction {
  kind: CombatMoveKind;
  targetIds: string[];
  allowance: number;
  used: Record<string, number>;
}
export interface ChargeAction { abilityChoices?: MovementAbilityChoices; unitId: string; rolls: number[]; distance: number; targetIds: string[] }
export type FightStep = 'START' | 'PILE_IN' | 'FIGHT' | 'CONSOLIDATE' | 'END';
export interface FightPhaseState {
  step: FightStep;
  category: 'FIGHTS_FIRST' | 'REMAINING_COMBATS';
  nextPlayerId: string;
  pileInDone: string[];
  eligibleAtFightStart: string[];
  engagedAtFightStart: string[];
  fought: string[];
  consolidateDone: string[];
  selected: { attackChoices?: Record<string, AttackChoices>; hazardousCount?: number; extraWeaponsUsed?: string[]; unitId: string; usedModelIds: string[]; hasRolled: boolean; overrunDone: boolean; previousPlayerId?: string; previousCategory?: 'FIGHTS_FIRST' | 'REMAINING_COMBATS' } | null;
}
export interface CloseCombatState {
  charge: ChargeAction | null;
  move: CombatMove | null;
  declared: string[];
  effects: LegacyCombatEffect[];
  fight: FightPhaseState | null;
}
export type CloseCombatEvent = EventContext & (
  { type: 'charge-declared' } |
  { type: 'charge-rolled'; rolls: number[]; distance: number } |
  { type: 'charge-target-selected'; targetIds: string[] } |
  { type: 'charge-failed' } |
  { type: 'combat-move-started'; kind: CombatMoveKind; targetIds: string[] } |
  { type: 'combat-model-moved'; kind: CombatMoveKind; modelId: string; from: Position; to: Position; distance: number; totalUsed: number } |
  { type: 'combat-move-completed' | 'combat-move-cancelled'; kind: CombatMoveKind } |
  { type: 'fight-unit-selected' | 'fight-unit-completed' | 'fight-unit-cancelled' | 'overrun-fight' } |
  { type: 'melee-attack-started'; weaponId: string; targetUnitId: string } |
  { type: 'melee-attack-resolved'; resolution: WeaponResolution }
);


/** Simple polygon, no holes, world inches. */
export interface Polygon { vertices: Position[] }
export type TerrainCategory = 'EXPOSED' | 'LIGHT' | 'DENSE';
export interface TerrainArea {
  id: string; footprint: Polygon; featureIds: string[];
  metadata: Record<string, string | number | boolean>;
}
export interface TerrainPrism { footprint: Polygon; minZ: number; maxZ: number }
export interface TerrainSurface { id: string; footprint: Polygon; z: number; stable: boolean }
export interface TerrainFeature {
  id: string; terrainAreaId: string; footprint: Polygon; height: number;
  category: TerrainCategory;
  /** Solid sections and opening volumes allow low walls, floors and windows. */
  sections: TerrainPrism[]; openings: TerrainPrism[]; surfaces: TerrainSurface[];
}
export interface TerrainRules {
  detectionRange: number; solidHeight: number; stepOverHeight: number; climbProximity: number;
  plungingHeight: number; toweringRange: number;
}
export interface TerrainData { areas: TerrainArea[]; features: TerrainFeature[]; rules?: Partial<TerrainRules> }
export interface MovementPath { waypoints: Position[] }
export interface MovementDistance { horizontal: number; vertical: number; totalMovementDistance: number }
export type VisibilityLevel = 'NOT_VISIBLE' | 'VISIBLE' | 'FULLY_VISIBLE';
export interface VisibilityResult {
  level: VisibilityLevel; hasLineOfSight: boolean; terrainFullyVisible: boolean;
  hidden: boolean; withinDetection: boolean;
}
export interface AttackModifier { source: 'COVER' | 'PLUNGING_FIRE' | 'TEMPORARY_EFFECT'; skillDelta: number }
export interface ModelAttackModifiers { modelId: string; hitDelta?: number; woundDelta?: number; saveDelta?: number; baseSkill: number; effectiveSkill: number; modifiers: AttackModifier[] }
export type TerrainEvent = EventContext & (
  { type: 'model-entered-terrain-area' | 'model-left-terrain-area'; modelId: string; areaId: string } |
  { type: 'model-changed-elevation'; modelId: string; fromZ: number; toZ: number } |
  { type: 'hidden-gained' | 'hidden-lost'; modelId: string } |
  { type: 'cover-applied' | 'plunging-fire-applied'; modelId: string; targetUnitId: string; effectiveSkill: number }
);
