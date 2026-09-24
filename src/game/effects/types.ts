import type { FlowStamp } from '../flow/types';
export type Characteristic = 'MOVE' | 'BS' | 'WS' | 'SAVE' | 'LEADERSHIP' | 'OC' | 'HIT_ROLL' | 'WOUND_ROLL' | 'ATTACKS' | 'DAMAGE' | 'AP' | 'STRENGTH';
export type EffectPayload = { kind: 'MODIFIER'; characteristic: Characteristic; value: number } | { kind: 'FLAG'; flag: string; value: boolean };
export type Expiry = 'END_OF_CURRENT_PHASE' | 'END_OF_CURRENT_TURN' | 'END_OF_BATTLE_ROUND' | 'START_OF_NEXT_COMMAND_PHASE' | 'END_OF_NEXT_COMMAND_PHASE' | 'UNTIL_EXPLICITLY_REMOVED';
export type Stacking = 'STACK' | 'REPLACE_SAME_SOURCE' | 'NON_STACKING' | 'HIGHEST_ONLY';
export interface Effect { whileEmbarked?: boolean; id: string; source: string; target: { unitId: string }; payload: EffectPayload; createdAt: FlowStamp; expiry: Expiry; expiryPlayerId: string; stacking: Stacking; active: boolean }
export type EffectInput = Omit<Effect, 'id' | 'createdAt' | 'active' | 'expiryPlayerId'> & { expiryPlayerId?: string };
