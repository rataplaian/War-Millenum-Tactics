import assert from 'node:assert/strict';
import type { CommandResult, FailureReason, GameState, RangedWeapon } from '../src/game/models';
import { GameEngine, type EnginePolicies } from '../src/game/engine/GameEngine';
import { createTestMatch } from '../src/game/data/prototype';
export function dice(...rolls: number[]) {
  let calls = 0;
  const rng = () => {
    const roll = rolls[calls++];
    if (roll === undefined) throw new Error('Controlled RNG exhausted');
    return (roll - 0.5) / 6;
  };
  return { rng, calls: () => calls };
}
export function shootingState(edit?: (s: GameState) => void): GameState {
  const state = createTestMatch(); state.phase = 'Shooting'; edit?.(state); return state;
}
export function shootingGame(edit?: (s: GameState) => void, policies?: EnginePolicies) {
  return GameEngine.create(shootingState(edit), policies);
}
export function startedShooting(edit?: (s: GameState) => void, policies?: EnginePolicies) {
  const game = shootingGame(edit, policies); assert.equal(game.beginShooting('unit-1').ok, true); return game;
}
export function rifle(state: GameState, patch: Partial<RangedWeapon>) {
  state.definitions = state.definitions.map((d, i) => i === 0 ? { ...d, weapons: [{ ...d.weapons[0]!, ...patch } as RangedWeapon] } : d);
}
export function oneShooter(state: GameState) {
  for (const m of state.units[0]!.models.slice(1)) { m.alive = false; m.woundsRemaining = 0; }
  rifle(state, { attacks: { kind: 'fixed', value: 1 } });
}
export function reject(game: GameEngine, action: () => CommandResult<unknown>, reason: FailureReason) {
  const before = game.getState(); const result = action(); assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, reason);
  assert.deepEqual(game.getState(), before); return result;
}
