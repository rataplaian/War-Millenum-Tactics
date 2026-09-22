import type { Unit } from '../models';
export type AttachmentRole = 'BODYGUARD' | 'LEADER' | 'SUPPORT';
export interface AttachmentDefinition { role: 'LEADER' | 'SUPPORT'; canLeadDatasheetIds: readonly string[] }
export interface AttachmentAssignment { id: string; bodyguardId: string; leaderIds?: string[]; supportIds?: string[] }
export interface AttachmentRecord {
  id: string; active: boolean; components: { role: AttachmentRole; original: Unit }[];
  destroyedComponentIds: string[]; retainedSources: { componentId: string; attackerId: string }[];
  pendingSplitBy: string[]; archivedRuntime?: Unit;
}
export interface AttachmentPolicy { maxLeaders?: number; maxSupports?: number }
