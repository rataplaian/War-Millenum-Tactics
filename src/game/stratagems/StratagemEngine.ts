import { unitKeywords } from '../attachments/queries';
import type { CommandResult, GameState } from '../models';
import { failure } from '../rules/movement';
import { onBattlefield } from '../reserves/location';
import { canSpendCommandPoints, spendCommandPoints } from '../resources/CommandPoints';
import { applyEffect } from '../effects/EffectEngine';
import { flowEvent } from '../flow/events';
import { TEST_STRATAGEMS } from './testStratagems';
import type { StratagemDefinition, StratagemPolicies } from './types';
export class StratagemEngine {
  constructor(private s: GameState, private policy: StratagemPolicies = {}) {}
  definitions() { return this.policy.definitions ?? TEST_STRATAGEMS; }
  validate(id: string, playerId: string, targets: readonly string[]): CommandResult<StratagemDefinition> {
    const s = this.s, f = s.flow, w = f?.window, d = this.definitions().find(d => d.id === id);
    if (!d) return failure('STRATAGEM_NOT_FOUND');
    if (s.status !== 'in-progress') return failure('MATCH_FINISHED');
    if (!s.players.some(p => p.id === playerId)) return failure('INVALID_PLAYER');
    if (!f || !w || w.passedPlayerIds.includes(playerId) || !d.timing.phases.includes(s.phase) || !d.timing.triggers.includes(w.trigger) ||
      (d.timing.ownership === 'YOUR_TURN' && playerId !== s.activePlayerId) || (d.timing.ownership === 'OPPONENT_TURN' && playerId === s.activePlayerId)) return failure('WRONG_TIMING');
    if (!Number.isSafeInteger(d.cpCost) || d.cpCost < 0 || !Number.isSafeInteger(d.target.count) || d.target.count < 1) return failure('INVALID_CONFIGURATION');
    if (targets.length !== d.target.count || new Set(targets).size !== targets.length) return failure('INVALID_TARGET');
    for (const id of targets) {
      const u = s.units.find(u => u.id === id);
      if (!u || (d.target.relation === 'FRIENDLY' && u.playerId !== playerId) || (d.target.relation === 'ENEMY' && u.playerId === playerId) ||
        (d.target.selectedTargetOnly && w.targetUnitId !== id)) return failure('INVALID_TARGET');
      if (u.location === 'EMBARKED' && !d.overrides?.allowEmbarkedTarget) return failure('NOT_ON_BATTLEFIELD');
      const keywords = unitKeywords(s, u);
      if (d.target.keywords?.some(k => !keywords.includes(k.toUpperCase())) || d.conditions?.some(c =>
        (c === 'ON_BATTLEFIELD' && !onBattlefield(u)) || (c === 'ALIVE' && !u.models.some(m => m.alive)) || (c === 'NOT_SHOT' && u.state.hasShot))) return failure('UNIT_NOT_ELIGIBLE');
    }
    if (d.restrictions?.some(r => !this.policy.restrictions?.[r]?.(JSON.parse(JSON.stringify(s)), playerId, [...targets]))) return failure('UNIT_NOT_ELIGIBLE');
    const cp = canSpendCommandPoints(s, playerId, d.cpCost); if (!cp.ok) return cp;
    if (targets.some(id => { const u = s.units.find(u => u.id === id)!; return u.playerId === playerId && u.state.battleShocked && !d.overrides?.allowBattleShockedTarget; })) return failure('BATTLE_SHOCKED');
    const own = f.usage.filter(u => u.playerId === playerId), same = own.filter(u => u.stratagemId === id);
    if (same.filter(u => u.phaseIndex === f.phaseIndex).length >= (d.usageLimits?.perPhase ?? 1) ||
      same.filter(u => u.turn === s.turn).length >= (d.usageLimits?.perTurn ?? Infinity) || same.length >= (d.usageLimits?.perBattle ?? Infinity) ||
      (!d.overrides?.allowMultipleOnTarget && own.some(u => u.phaseIndex === f.phaseIndex && u.targetIds.some(t => targets.includes(t))))) return failure('USAGE_LIMIT');
    if (!['APPLY_EFFECT', 'CLEAR_BATTLE_SHOCK'].includes(d.resolverId) && !this.policy.resolvers?.[d.resolverId]) return failure('MISSING_RESOLVER');
    if (d.resolverId === 'APPLY_EFFECT' && !d.effect) return failure('INVALID_CONFIGURATION');
    return { ok: true, value: d };
  }
  use(id: string, playerId: string, targets: string[]): CommandResult {
    const legal = this.validate(id, playerId, targets); if (!legal.ok) return legal;
    const d = legal.value, s = this.s;
    // Caller provides a detached transaction. Resolver failure/throw cannot spend live CP.
    spendCommandPoints(s, playerId, d.cpCost);
    if (d.resolverId === 'APPLY_EFFECT') for (const unitId of targets) applyEffect(s, { ...d.effect!, target: { unitId } });
    else if (d.resolverId === 'CLEAR_BATTLE_SHOCK') for (const unitId of targets) { s.units.find(u => u.id === unitId)!.state.battleShocked = false; flowEvent(s, 'BATTLE_SHOCK_CLEARED', { source: id }, unitId); }
    else { const result = this.policy.resolvers![d.resolverId]!(s, targets, d); if (!result.ok) return result; }
    s.flow!.usage.push({ stratagemId: id, playerId, targetIds: [...targets], phaseIndex: s.flow!.phaseIndex, turn: s.turn, round: s.round });
    s.flow!.window!.passedPlayerIds = [];
    flowEvent(s, 'STRATAGEM_USED', { stratagemId: id, targetIds: targets, cost: d.cpCost }, '', playerId);
    return { ok: true, value: undefined };
  }
  options(playerId: string) {
    // Current fixture selectors have one target. Multi-target validation remains exact through validate().
    return this.definitions().flatMap(d => this.s.units.map(u => ({ stratagemId: d.id, name: d.name, targetIds: [u.id], result: this.validate(d.id, playerId, [u.id]) })));
  }
}
