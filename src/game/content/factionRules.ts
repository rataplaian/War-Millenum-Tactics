import type { GameState, Unit } from '../models';
import { edgeDistance, EPSILON } from '../utils/geometry';
import { onBattlefield } from '../reserves/location';
import { effectiveFlag } from '../effects/EffectEngine';
/** The snapshot stores stable rule IDs; rule evaluation lives here rather than in UI or unit-name checks. */
export const hasFactionRule = (s: GameState, u: Unit, ruleId: string): boolean => s.factionRuleIds?.[u.playerId]?.includes(ruleId) ?? false;
export const thrillSeekers = (s: GameState, u: Unit): boolean => hasFactionRule(s, u, 'THRILL_SEEKERS');
export const canShootAfterMove = (s: GameState, u: Unit): boolean => !!(u.state.hasAdvanced && effectiveFlag(s,u.id,'AFTER_ADVANCE_SHOOT_CHARGE')) || thrillSeekers(s, u) &&
  !!(u.state.hasAdvanced || u.state.hasFallenBack) && u.lastMove?.turn === s.turn &&
  ['ADVANCE_MOVE','FALL_BACK_MOVE'].includes(u.lastMove.kind);
export const canChargeAfterMove = canShootAfterMove;
export function recordTurnEngagement(s: GameState): void {
  const engaged: Record<string,string[]> = {};
  for (const u of s.units.filter(onBattlefield)) engaged[u.id] = s.units.filter(v => onBattlefield(v) && v.playerId !== u.playerId &&
    u.models.some(a => a.alive && v.models.some(b => b.alive && edgeDistance(a,b) <= s.spatialRules.engagementDistance + EPSILON))).map(v => v.id);
  s.factionHistory = { turn: s.turn, phaseIndex: s.flow?.phaseIndex ?? 1, engagedAtTurnStart: engaged, attackedByPhase: {}, chargedByPhase: {} };
}
export function recordMovementPhaseEngagement(s: GameState): void {
  const h=s.factionHistory; if(!h) return;
  h.engagedAtPhaseStart=Object.fromEntries(s.units.filter(onBattlefield).map(u=>[u.id,s.units.filter(v=>onBattlefield(v) && v.playerId!==u.playerId &&
    u.models.some(a=>a.alive && v.models.some(b=>b.alive && edgeDistance(a,b)<=s.spatialRules.engagementDistance+EPSILON))).map(v=>v.id)]));
}
/** After a Fall Back, disallow old engagements and units attacked or charged by another friendly unit this phase. */
export function thrillTargetLegal(s: GameState, u: Unit, targetId: string): boolean {
  if (!thrillSeekers(s,u) || !u.state.hasFallenBack) return true;
  const h = s.factionHistory;
  if (!h || h.turn !== s.turn) return false;
  const phase = String(s.flow?.phaseIndex ?? s.phase);
  return !(h.engagedAtTurnStart[u.id] ?? []).includes(targetId) &&
    !(h.attackedByPhase[phase]?.[targetId] ?? []).some(id=>id!==u.id) &&
    !(h.chargedByPhase[phase]?.[targetId] ?? []).some(id=>id!==u.id);
}
export function recordFactionTarget(s: GameState, kind: 'attackedByPhase' | 'chargedByPhase', attackerId: string, targetIds: readonly string[]): void {
  const h=s.factionHistory; if (!h || h.turn!==s.turn) return;
  const key=String(s.flow?.phaseIndex ?? s.phase);
  const targets=h[kind][key] ??= {};
  for(const id of targetIds) targets[id]=[...new Set([...(targets[id] ?? []),attackerId])];
}
