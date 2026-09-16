import assert from 'node:assert/strict';
import { GameEngine, type EnginePolicies } from '../src/game/engine/GameEngine';
import { createTestMatch } from '../src/game/data/prototype';
import type { GameState, CommandResult, Phase } from '../src/game/models';
import type { FlowRules } from '../src/game/flow/types';
export function ok<T>(result: CommandResult<T>): T { if (!result.ok) assert.fail(JSON.stringify(result)); return result.value; }
export function engine(s = createTestMatch(), policies: EnginePolicies = {}, rules: Partial<FlowRules> = {}) { const e = new GameEngine(s, policies); ok(e.enableMatchFlow(rules)); return e; }
export function pass(e: GameEngine) {
  for (let i = 0; e.getState().flow?.window; i++) {
    assert.ok(i < 30);
    const s = e.getState(); for (const p of s.players) if (!s.flow!.window!.passedPlayerIds.includes(p.id)) ok(e.passTimingWindow(p.id));
  }
}
export function command(e: GameEngine) {
  pass(e);
  for (let i = 0; e.getState().flow?.commandStep; i++) {
    assert.ok(i < 20); const s = e.getState();
    for (const p of s.flow!.pending) if (p.kind === 'BATTLE_SHOCK') { ok(e.rollBattleShock(p.unitId!, () => .99)); pass(e); } else ok(e.resolveCommandAbility(p.id));
    ok(e.advanceCommandStep()); pass(e);
  }
}
export function nextPhase(e: GameEngine) {
  if (e.getState().phase === 'Command') command(e);
  pass(e); const old = e.getState().flow!.phaseIndex;
  for (let i = 0; e.getState().flow!.phaseIndex === old && e.getState().status !== 'finished'; i++) { assert.ok(i < 5); ok(e.tryNextPhase()); pass(e); }
}
export function atPhase(phase: Phase) { const e = engine(); while (e.getState().phase !== phase) nextPhase(e); return e; }
export function snapshot(e: GameEngine): GameState { return JSON.parse(JSON.stringify(e.getState())); }
