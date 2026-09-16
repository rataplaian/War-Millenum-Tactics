import type { CommandResult, GameState } from '../models';
import { COMMAND_STEPS, type CommandStep, type FlowPolicies } from '../flow/types';
import { flowEvent } from '../flow/events';
import { openWindow } from '../flow/TimingWindows';
import { gainCommandPoints } from '../resources/CommandPoints';
import { getUnitsRequiringBattleShockRoll, resolveBattleShockRoll } from './BattleShock';
import { failure } from '../rules/movement';
import type { RandomSource } from '../utils/dice';
export class CommandController {
  constructor(private s: GameState, private policies: FlowPolicies = {}) {}
  private addAbilities(step: CommandStep | 'MISSION_HOOK') {
    const f = this.s.flow!;
    for (const a of this.policies.abilities ?? []) if (a.step === step && a.mandatory && a.eligible(JSON.parse(JSON.stringify(this.s))))
      f.pending.push({ id: `${f.phaseIndex}:${step}:${a.id}`, kind: step === 'MISSION_HOOK' ? 'MISSION_HOOK' : 'ABILITY', resolverId: a.id, label: a.id });
  }
  enter(step: CommandStep) {
    const s = this.s, f = s.flow!; f.commandStep = step;
    flowEvent(s, 'COMMAND_STEP_STARTED', { step });
    if (step === 'START_OF_COMMAND_PHASE') { f.resolvedAbilities = []; openWindow(s, 'AT_START_OF_COMMAND_PHASE'); }
    if (step === 'GAIN_CORE_CP') for (const p of s.players) { const result = gainCommandPoints(s, p.id, 1, 'CORE_CP'); if (!result.ok) throw new Error('Core CP overflow'); }
    if (step === 'BATTLE_SHOCK') f.pending.push(...getUnitsRequiringBattleShockRoll(s).map(u => ({ id: `shock:${s.turn}:${u.id}`, kind: 'BATTLE_SHOCK' as const, unitId: u.id, label: `Battle-shock: ${u.id}` })));
    if (step === 'END_OF_COMMAND_PHASE') { f.missionHookStarted = false; openWindow(s, 'AT_END_OF_COMMAND_PHASE'); }
    this.addAbilities(step);
  }
  advance(): CommandResult {
    const s = this.s, f = s.flow;
    if (!f || s.phase !== 'Command' || !f.commandStep) return failure('WRONG_COMMAND_STEP');
    if (f.window) return failure('TIMING_WINDOW_OPEN');
    if (this.policies.blockers?.(JSON.parse(JSON.stringify(s))).length) return failure('PHASE_BLOCKED');
    if (f.pending.length) return failure('PENDING_RESOLUTION');
    if (f.commandStep === 'END_OF_COMMAND_PHASE' && !f.missionHookStarted) {
      f.missionHookStarted = true; this.addAbilities('MISSION_HOOK');
      if (f.pending.length) return { ok: true, value: undefined };
    }
    flowEvent(s, 'COMMAND_STEP_COMPLETED', { step: f.commandStep });
    const next = COMMAND_STEPS[COMMAND_STEPS.indexOf(f.commandStep) + 1];
    if (next) this.enter(next);
    else f.commandStep = null;
    return { ok: true, value: undefined };
  }
  roll(unitId: string, rng: RandomSource): CommandResult<ReturnType<typeof resolveBattleShockRoll>> {
    const s = this.s, f = s.flow;
    if (!f || f.commandStep !== 'BATTLE_SHOCK') return failure('WRONG_COMMAND_STEP');
    if (f.window) return failure('TIMING_WINDOW_OPEN');
    const pending = f.pending.find(p => p.kind === 'BATTLE_SHOCK' && p.unitId === unitId), unit = s.units.find(u => u.id === unitId);
    if (!pending || !unit) return failure('UNIT_NOT_ELIGIBLE');
    const result = resolveBattleShockRoll(s, unit, rng);
    flowEvent(s, 'BATTLE_SHOCK_ROLL_STARTED', {}, unitId);
    flowEvent(s, 'BATTLE_SHOCK_ROLL_RESOLVED', result, unitId);
    unit.state.battleShocked = !result.success;
    flowEvent(s, result.success ? 'BATTLE_SHOCK_CLEARED' : 'BATTLE_SHOCK_APPLIED', {}, unitId);
    f.pending = f.pending.filter(p => p.id !== pending.id);
    if (!result.success) openWindow(s, 'AFTER_BATTLE_SHOCK_FAILED', { unitId, targetUnitId: unitId });
    return { ok: true, value: result };
  }
  options() {
    const f = this.s.flow;
    return (this.policies.abilities ?? []).filter(a => !a.mandatory && a.step === (f?.missionHookStarted ? 'MISSION_HOOK' : f?.commandStep))
      .map(a => ({ id: a.id, available: !f?.window && !f?.resolvedAbilities.includes(a.id) && a.eligible(JSON.parse(JSON.stringify(this.s))) }));
  }
  resolve(id: string): CommandResult {
    const f = this.s.flow, pending = f?.pending.find(p => p.id === id);
    if (!f || !f.commandStep || pending?.kind === 'BATTLE_SHOCK') return failure('PENDING_RESOLUTION');
    if (f.window) return failure('TIMING_WINDOW_OPEN');
    const ability = this.policies.abilities?.find(a => a.id === (pending?.resolverId ?? id));
    if (!ability) return failure('MISSING_RESOLVER');
    if (!pending && !this.options().some(a => a.id === id && a.available)) return failure('UNIT_NOT_ELIGIBLE');
    const result = ability.resolve(this.s); if (!result.ok) return result;
    if (pending) f.pending = f.pending.filter(p => p.id !== id);
    f.resolvedAbilities.push(ability.id);
    flowEvent(this.s, pending ? 'MANDATORY_RESOLUTION_COMPLETED' : 'COMMAND_ABILITY_RESOLVED', { id, mandatory: !!pending });
    return result;
  }
}
