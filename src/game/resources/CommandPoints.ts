import type { CommandResult, GameState } from '../models';
import { failure } from '../rules/movement';
import { flowEvent } from '../flow/events';
export function canSpendCommandPoints(s: GameState, playerId: string, amount: number): CommandResult {
  const p = s.players.find(p => p.id === playerId);
  if (!p || !Number.isSafeInteger(amount) || amount < 0) return failure('INVALID_CONFIGURATION');
  return (p.commandPoints ?? 0) >= amount ? { ok: true, value: undefined } : failure('INSUFFICIENT_CP');
}
export function spendCommandPoints(s: GameState, playerId: string, amount: number): CommandResult {
  const valid = canSpendCommandPoints(s, playerId, amount); if (!valid.ok) return valid;
  const p = s.players.find(p => p.id === playerId)!; p.commandPoints = (p.commandPoints ?? 0) - amount;
  flowEvent(s, 'CP_SPENT', { amount }, '', playerId); return valid;
}
/** Core gains are called only by the Command controller. External abilities use OTHER_CP_GAIN. */
export function gainCommandPoints(s: GameState, playerId: string, amount: number, kind: 'CORE_CP' | 'OTHER_CP_GAIN', policy: { ignoreLimit?: boolean; limit?: number } = {}): CommandResult<number> {
  const p = s.players.find(p => p.id === playerId), limit = policy.limit ?? s.flow?.rules.maxExtraCpPerBattleRound ?? 1;
  if (!p || !Number.isSafeInteger(amount) || amount < 0 || !Number.isSafeInteger(limit) || limit < 0) return failure('INVALID_CONFIGURATION');
  const granted = kind === 'CORE_CP' || policy.ignoreLimit ? amount : Math.min(amount, Math.max(0, limit - (p.extraCpGainedThisBattleRound ?? 0)));
  if (!Number.isSafeInteger((p.commandPoints ?? 0) + granted)) return failure('INVALID_CONFIGURATION');
  p.commandPoints = (p.commandPoints ?? 0) + granted;
  if (kind !== 'CORE_CP') p.extraCpGainedThisBattleRound = (p.extraCpGainedThisBattleRound ?? 0) + granted;
  if (granted) flowEvent(s, kind === 'CORE_CP' ? 'CORE_CP_GAINED' : 'OTHER_CP_GAINED', { amount: granted }, '', playerId);
  return { ok: true, value: granted };
}
