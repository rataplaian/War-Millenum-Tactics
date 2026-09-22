import assert from 'node:assert/strict';
import { GameEngine } from '../src/game/engine/GameEngine';
import { createTransportTestMatch } from '../src/game/data/transportPrototype';
import type { CommandResult, GameState } from '../src/game/models';
export function ok<T>(r: CommandResult<T>): T { assert.equal(r.ok, true, JSON.stringify(r)); if (!r.ok) throw Error('failed'); return r.value; }
export function no(r: CommandResult<unknown>, reason: string) { assert.equal(r.ok, false); if (!r.ok) assert.equal(r.reason, reason); }
export function attached() {
  const e = new GameEngine(createTransportTestMatch());
  ok(e.configureAttachments([{ id: 'attached', bodyguardId: 'bodyguard', leaderIds: ['leader'], supportIds: ['support'] }]));
  return e;
}
export function field(): GameState {
  const s = attached().getState(); delete s.deployment; s.phase = 'Movement';
  s.units.forEach((u, i) => { u.location = 'BATTLEFIELD'; u.models.forEach((m, j) => m.position = { x: 5 + j * 1.5, y: 5 + i * 7 }); });
  return s;
}
export function embarked(): GameState {
  const s = field(), u = s.units.find(u => u.id === 'attached')!, t = s.units.find(u => u.id === 'transport-b')!;
  t.models[0]!.position = { x: 15, y: 15 };
  u.location = 'EMBARKED'; u.embarked = { transportId: t.id, embarkedAtTurn: 1, embarkedAtPhase: 'Command', preBattle: true };
  return s;
}
