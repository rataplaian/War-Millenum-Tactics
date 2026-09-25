import type { ForceDisposition } from '../missions/types';
import type { UnitDefinition } from '../models';
import type { StratagemDefinition } from '../stratagems/types';

/** Versions are explicit: an unknown source must never be represented as verified. */
export interface RulesSourceSnapshot {
  edition: 11;
  snapshotDate: string;
  factionPackVersion: string;
  munitorumUpdateDate: string;
  rulesUpdateVersion: string;
  notes: string;
}

export interface FactionContent {
  id: string;
  name: string;
  sources: RulesSourceSnapshot;
  armyRuleId: string;
  detachments: readonly {
    id: string; ruleId: string; detachmentPoints: number; forceDisposition: ForceDisposition;
    enhancements: readonly { id: string; points: number }[];
    stratagems: readonly StratagemDefinition[];
  }[];
  datasheets: readonly UnitDefinition[];
  /** Resolvers are registered separately; missing implementations fail content validation. */
  abilities: readonly { id: string; resolverId: string }[];
}

export interface PresetRoster {
  id: string;
  factionId: string;
  battleSize: 'INCURSION';
  pointsLimit: number;
  detachmentId: string;
  detachmentPointsLimit: number;
  forceDisposition: ForceDisposition;
  warlordUnitId: string;
  enhancementLimit: number;
  units: readonly { id: string; datasheetId: string; enhancementId?: string }[];
  attachments: readonly { id: string; bodyguardId: string; leaderIds?: readonly string[]; supportIds?: readonly string[] }[];
  embarked: readonly { transportId: string; passengerIds: readonly string[] }[];
}

export interface RosterValidation { valid: boolean; totalPoints: number | null; errors: string[] }
