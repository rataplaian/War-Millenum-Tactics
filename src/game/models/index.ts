export type FactionId = string;
export type PlayerId = string;
/** Continuous tabletop coordinates, measured in inches. No grid snapping. */
export interface Position { x: number; y: number }
export interface Player { id: PlayerId; name: string; factionId: FactionId }
export interface Army { id: string; playerId: PlayerId; factionId: FactionId; unitIds: string[] }
export interface Model { id: string; unitId: string; woundsRemaining: number; position: Position; alive: boolean }
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
export interface UnitDefinition {
  id: string; name: string; factionId: FactionId; modelCount: number; stats: UnitStats;
  keywords: string[]; weapons: Weapon[]; abilities: Ability[]; placeholder: boolean;
}
export interface UnitState { hasMoved: boolean; hasShot: boolean; hasCharged: boolean; hasFought: boolean }
export interface Unit extends UnitDefinition { definitionId: string; playerId: PlayerId; models: Model[]; state: UnitState }
export const PHASES = ['Command', 'Movement', 'Shooting', 'Charge', 'Fight'] as const;
export type Phase = typeof PHASES[number];
export type GameStatus = 'in-progress' | 'finished';
export interface GameState {
  schemaVersion: 1; id: string; round: number; turn: number; activePlayerId: PlayerId;
  phase: Phase; players: [Player, Player]; armies: Army[]; units: Unit[]; status: GameStatus;
}
