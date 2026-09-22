import type { Model, Phase, RangedWeapon } from '../models';
import type { Formation, SetupConstraints } from '../setup/types';
export interface TransportCapacityDefinition {
  maximumModels: number; allowedKeywords: readonly string[]; excludedKeywords: readonly string[];
  modelCosts?: readonly { keywords: readonly string[]; cost: number }[];
  firingDeck?: number; dedicated?: boolean;
}
export interface EmbarkedState { transportId: string; embarkedAtTurn: number; embarkedAtPhase: Phase; preBattle: boolean }
export type DisembarkMode = 'RAPID' | 'TACTICAL' | 'COMBAT' | 'EMERGENCY';
export interface HazardResult { rolls: number[]; mortalWounds: number; destroyedModelIds: string[] }
export interface DisembarkTransaction {
  unitId: string; transportId: string; mode: DisembarkMode; positions: Formation;
  hazard?: HazardResult; setupConstraints: SetupConstraints;
}
export interface DestroyedTransport { transportId: string; frozenModel: Model; remainingPassengerIds: string[] }
export interface TransportState { disembark: DisembarkTransaction | null; destroyed: DestroyedTransport[]; tacticalFollowUp?: string }
export interface FiringDeckSelection { passengerUnitId: string; modelId: string; weaponId: string; borrowed: RangedWeapon }
export interface PlacementSearchResult { formation: Formation | null; exhausted: boolean; impossibleModelIds?: string[] }
export interface TransportPolicy {
  capacityException?: (transportId: string, passengerId: string) => boolean;
}
