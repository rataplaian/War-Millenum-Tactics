import assert from 'node:assert/strict';
import { GameEngine } from '../src/game/engine/GameEngine';
import { createDeploymentTestMatch } from '../src/game/data/deploymentPrototype';
import type { CommandResult, GameState, Unit } from '../src/game/models';
import type { Formation } from '../src/game/setup/types';
export function ok<T>(r: CommandResult<T>): T { if (!r.ok) assert.fail(JSON.stringify(r)); return r.value; }
export function no(r: CommandResult<unknown>, reason: string) { assert.equal(r.ok, false); if (!r.ok) assert.equal(r.reason, reason); }
export const formation = (u: Unit, x: number, y: number, z = 0): Formation => Object.fromEntries(u.models.filter(m => m.alive).map((m, i) => [m.id, { x: x + i * 1.5, y, z }]));
export function stage(e: GameEngine, f: Formation) { for (const [id, p] of Object.entries(f)) ok(e.stageSetupModel(id, p)); }
export function declarations(initial = createDeploymentTestMatch()) {
  const e = new GameEngine(initial); ok(e.advancePreBattle());
  for (const id of ['deploy-4', 'deploy-10']) if (initial.units.some(u => u.id === id)) ok(e.chooseDeploymentAbility(id, 'SCOUTS'));
  return e;
}
export function deployAll(e: GameEngine) {
  ok(e.advancePreBattle()); ok(e.setFirstTurn(e.getState().players[0].id));
  for (;;) {
    const s = e.getState(), player = e.getDeploymentOptions().nextPlayerId;
    const u = s.units.find(u => u.playerId === player && !s.deployment!.deployed.includes(u.id) && !s.deployment!.initialReserveIds.includes(u.id));
    if (!u) break;
    ok(e.beginDeployment(u.id));
    const index = Number(u.id.split('-')[1]) - 1;
    stage(e, formation(u, 3 + (index % 6) * 6, index < 6 ? 3 : 32)); ok(e.completeSetup());
  }
}
export function battle(reserves: string[] = [], modify?: (s: GameState) => void) {
  const s = createDeploymentTestMatch(); modify?.(s); const e = declarations(s);
  for (const id of reserves) ok(e.selectStrategicReserve(id));
  deployAll(e); ok(e.advancePreBattle());
  while (e.getDeploymentOptions().scoutUnitIds.length) ok(e.skipScout(e.getDeploymentOptions().scoutUnitIds[0]!));
  ok(e.advancePreBattle()); return e;
}
export function toRound(e: GameEngine, round: number) { while (e.getState().round < round) ok(e.tryNextTurn()); }
