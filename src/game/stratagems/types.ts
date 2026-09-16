import type { GameState, Phase, CommandResult } from '../models';
import type { Trigger } from '../flow/types';
import type { EffectInput } from '../effects/types';
export interface StratagemDefinition {
  id: string; name: string; labels: ('BATTLE_TACTIC' | 'EPIC_DEED' | 'STRATEGIC_PLOY' | 'WARGEAR')[]; cpCost: number;
  timing: { phases: Phase[]; triggers: Trigger[]; ownership: 'YOUR_TURN' | 'OPPONENT_TURN' | 'EITHER' };
  target: { relation: 'FRIENDLY' | 'ENEMY' | 'EITHER'; count: number; selectedTargetOnly?: boolean; keywords?: string[] };
  conditions?: ('ON_BATTLEFIELD' | 'ALIVE' | 'NOT_SHOT')[];
  restrictions?: string[];
  resolverId: string;
  effect?: Omit<EffectInput, 'target'>;
  usageLimits?: { perPhase?: number; perTurn?: number; perBattle?: number };
  overrides?: { allowBattleShockedTarget?: boolean; allowMultipleOnTarget?: boolean };
}
export interface StratagemPolicies {
  definitions?: readonly StratagemDefinition[];
  restrictions?: Record<string, (s: Readonly<GameState>, playerId: string, targetIds: readonly string[]) => boolean>;
  resolvers?: Record<string, (s: GameState, targetIds: readonly string[], definition: StratagemDefinition) => CommandResult>;
}
