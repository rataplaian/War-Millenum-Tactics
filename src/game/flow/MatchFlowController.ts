import { pendingCoreChoices } from '../abilities/core';
import { PHASES, type CommandResult, type GameState } from '../models';
import { actionBusy, battleStarted, onBattlefield } from '../reserves/location';
import { isUnitEngaged } from '../rules/spatial';
import { advancePhase } from '../rules/progression';
import { failure } from '../rules/movement';
import { CommandController } from '../command/CommandController';
import { flowEvent } from './events';
import { openWindow } from './TimingWindows';
import { applyEffect, expireEffects } from '../effects/EffectEngine';
import type { FlowPolicies, FlowRules } from './types';
export function enableFlow(s: GameState, rules: Partial<FlowRules> = {}): CommandResult {
  if (s.status !== 'in-progress') return failure('MATCH_FINISHED');
  if (s.flow) return failure('FLOW_ALREADY_ENABLED');
  const config = { maximumBattleRounds: 5, maxExtraCpPerBattleRound: 1, ...rules };
  if (!Number.isSafeInteger(config.maximumBattleRounds) || config.maximumBattleRounds < s.round || !Number.isSafeInteger(config.maxExtraCpPerBattleRound) || config.maxExtraCpPerBattleRound < 0 || actionBusy(s)) return failure('INVALID_CONFIGURATION');
  s.flow = { firstPlayerId: s.deployment?.firstTurnPlayerId ?? s.players[0].id, phaseIndex: (s.turn - 1) * 5 + PHASES.indexOf(s.phase) + 1,
    commandStep: null, rules: config, pending: [], window: null, queuedWindows: [], boundary: 'NONE', started: false, missionHookStarted: false,
    resolvedAbilities: [], effects: [], nextEffectId: 1, nextWindowId: 1, usage: [] };
  for (const p of s.players) { p.commandPoints ??= 0; p.extraCpGainedThisBattleRound ??= 0; }
  for (const e of s.closeCombat?.effects ?? []) if (e.turn === s.turn) applyEffect(s, { source: 'legacy-charge', target: { unitId: e.unitId }, payload: { kind: 'FLAG', flag: 'FIGHTS_FIRST', value: true }, expiry: 'END_OF_CURRENT_TURN', stacking: 'NON_STACKING' });
  if (s.closeCombat) s.closeCombat.effects = [];
  return { ok: true, value: undefined };
}
export class MatchFlowController {
  constructor(private s: GameState, private policies: FlowPolicies = {}) {}
  start() {
    const s = this.s, f = s.flow;
    if (!f || f.started || !battleStarted(s)) return;
    f.started = true; f.firstPlayerId = s.deployment?.firstTurnPlayerId ?? f.firstPlayerId;
    flowEvent(s, 'BATTLE_ROUND_STARTED'); flowEvent(s, 'TURN_STARTED'); openWindow(s, 'START_OF_TURN'); this.enterPhase();
  }
  private enterPhase() {
    flowEvent(this.s, 'PHASE_STARTED', { phase: this.s.phase }); openWindow(this.s, 'START_OF_PHASE');
    if (this.s.phase === 'Command') new CommandController(this.s, this.policies).enter('START_OF_COMMAND_PHASE');
  }
  canAdvancePhase() {
    const s = this.s, f = s.flow, blockingReasons: string[] = [];
    if (s.status !== 'in-progress') blockingReasons.push('MATCH_FINISHED');
    if (!battleStarted(s)) blockingReasons.push('PRE_BATTLE');
    if (actionBusy(s)) blockingReasons.push('TRANSACTION_OPEN');
    if (pendingCoreChoices(s).length) blockingReasons.push('ABILITY_CHOICE_REQUIRED');
    if (f?.window) blockingReasons.push('TIMING_WINDOW_OPEN');
    if (f?.pending.length) blockingReasons.push(...f.pending.map(p => `PENDING:${p.id}`));
    if (s.phase === 'Command' && f?.commandStep) blockingReasons.push(`COMMAND_STEP:${f.commandStep}`);
    if (s.phase === 'Fight' && ((s.closeCombat?.fight && s.closeCombat.fight.step !== 'END') || (!s.closeCombat?.fight && s.units.some(u => onBattlefield(u) && (u.state.hasCharged || isUnitEngaged(s, u)))))) blockingReasons.push('WRONG_FIGHT_STEP');
    blockingReasons.push(...(this.policies.blockers?.(JSON.parse(JSON.stringify(s))) ?? []));
    return { allowed: !blockingReasons.length, blockingReasons };
  }
  advance(): CommandResult {
    const s = this.s, f = s.flow;
    if (!f) return failure('FLOW_REQUIRED');
    if (!this.canAdvancePhase().allowed) return failure('PHASE_BLOCKED');
    // End windows resolve before expiry/transition. A second command commits the boundary.
    if (f.boundary === 'NONE') { f.boundary = 'PHASE_END'; openWindow(s, 'END_OF_PHASE'); return { ok: true, value: undefined }; }
    if (f.boundary === 'PHASE_END' && s.phase === 'Fight') { flowEvent(s, 'PHASE_ENDED', { phase: s.phase }); expireEffects(s, 'PHASE_END'); f.boundary = 'TURN_END'; openWindow(s, 'END_OF_TURN'); return { ok: true, value: undefined }; }
    if (f.boundary !== 'TURN_END') { flowEvent(s, 'PHASE_ENDED', { phase: s.phase }); expireEffects(s, 'PHASE_END'); }
    if (s.phase === 'Command') expireEffects(s, 'COMMAND_END');
    const endTurn = s.phase === 'Fight', endRound = endTurn && s.activePlayerId !== f.firstPlayerId;
    if (endTurn) { flowEvent(s, 'TURN_ENDED'); expireEffects(s, 'TURN_END'); }
    if (endRound) { flowEvent(s, 'BATTLE_ROUND_ENDED'); expireEffects(s, 'ROUND_END'); }
    if (endRound && s.round >= f.rules.maximumBattleRounds) { s.status = 'finished'; f.boundary = 'NONE'; return { ok: true, value: undefined }; }
    Object.assign(s, advancePhase(s)); f.phaseIndex++; f.boundary = 'NONE';
    if (endRound) { for (const p of s.players) p.extraCpGainedThisBattleRound = 0; flowEvent(s, 'BATTLE_ROUND_STARTED'); }
    if (endTurn) { flowEvent(s, 'TURN_STARTED'); openWindow(s, 'START_OF_TURN'); }
    this.enterPhase(); return { ok: true, value: undefined };
  }
}
