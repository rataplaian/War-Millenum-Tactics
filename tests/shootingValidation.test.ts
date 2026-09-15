import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GameState, RangedWeapon } from '../src/game/models';
import { GameEngine } from '../src/game/engine/GameEngine';
import { dice, reject, rifle, shootingState, startedShooting } from './shooting.helpers';
const invalidWeapons: [string, Partial<RangedWeapon>][] = [
  ['empty ID', { id: '' }], ['zero range', { range: 0 }], ['nonfinite range', { range: Infinity }],
  ['skill below range', { skill: 1 }], ['skill above range', { skill: 7 }], ['fractional skill', { skill: 3.5 }],
  ['invalid strength', { strength: 0 }], ['positive AP', { armourPenetration: 1 }],
  ['fractional AP', { armourPenetration: -1.5 }], ['negative attacks', { attacks: { kind: 'fixed', value: -1 } }],
  ['invalid dice count', { attacks: { kind: 'dice', count: 0, sides: 6, modifier: 0 } }],
  ['negative dice outcome', { attacks: { kind: 'dice', count: 1, sides: 6, modifier: -2 } }],
  ['negative damage', { damage: { kind: 'fixed', value: -1 } }],
  ['invalid die size', { damage: { kind: 'dice', count: 1, sides: 8, modifier: 0 } } as unknown as Partial<RangedWeapon>],
];
for (const [name, patch] of invalidWeapons) {
  test(`weapon validation rejects ${name}`, () => {
    assert.throws(() => GameEngine.create(shootingState(s => rifle(s, patch))));
  });
}
test('catalog rejects duplicate weapon IDs, invalid toughness and invalid save', () => {
  const duplicate = shootingState(); const d = duplicate.definitions[0]!;
  duplicate.definitions = [{ ...d, weapons: [d.weapons[0]!, d.weapons[0]!] }, duplicate.definitions[1]!];
  assert.throws(() => GameEngine.create(duplicate));
  for (const stats of [{ toughness: 0 }, { toughness: NaN }, { save: 1 }, { save: 8 }, { save: 3.5 }]) {
    const state = shootingState(); state.definitions = state.definitions.map((definition, i) => i === 0 ?
      { ...definition, stats: { ...definition.stats, ...stats } } : definition);
    assert.throws(() => GameEngine.create(state));
  }
});
test('snapshot schema 1 and 2 are explicitly rejected', () => {
  for (const schemaVersion of [1, 2]) assert.throws(() => GameEngine.create({ ...shootingState(), schemaVersion } as GameState), /schema 3/);
});
test('invalid LOS blocker dimensions/position/identity are rejected', () => {
  const blocker = { id: 'wall', kind: 'rectangle' as const, position: { x: 5, y: 5 }, width: 2, height: 2, opaque: true };
  for (const patch of [{ width: 0 }, { height: -1 }, { width: Infinity }, { position: { x: NaN, y: 5 } }, { position: { x: 29, y: 5 } }]) {
    const state = shootingState(); state.battlefield.losBlockers = [{ ...blocker, ...patch }];
    assert.throws(() => GameEngine.create(state));
  }
  const duplicate = shootingState(); duplicate.battlefield.losBlockers = [blocker, { ...blocker }];
  assert.throws(() => GameEngine.create(duplicate));
});
test('shooting snapshot ownership, phase and fired history cannot be corrupted', () => {
  const game = startedShooting(); game.fireWeapon('test-rifle', 'unit-2', dice(1, 1, 1, 1, 1, 1).rng);
  const before = game.getState();
  const edits: ((s: GameState) => void)[] = [
    s => { s.shooting!.unitId = 'unit-2'; }, s => { s.phase = 'Fight'; },
    s => { s.shooting!.firedWeaponIds = ['missing']; },
    s => { s.shooting!.firedWeaponIds = ['test-rifle', 'test-rifle']; },
    s => { s.shooting!.firedWeaponIds = []; }, s => { s.shooting!.hasRolled = false; },
    s => { s.units[0]!.state.hasShot = true; },
    s => { s.events[0]!.sequence = 99; }, s => { s.events[0]!.playerId = 'player-2'; },
    s => { s.units[1]!.models[0]!.woundsRemaining = 0; },
    s => { s.movement = { unitId: 'unit-1', originals: [] }; },
    s => { const e = s.events.find(e => e.type === 'weapon-fired'); if (e?.type === 'weapon-fired') e.resolution.weaponId = 'missing'; },
  ];
  for (const edit of edits) {
    const bad = game.getState(); edit(bad); assert.throws(() => game.loadMatch(bad)); assert.deepEqual(game.getState(), before);
  }
});
test('destroyed enemies disappear from legal targets of an unused weapon', () => {
  const game = startedShooting(s => {
    rifle(s, { damage: { kind: 'fixed', value: 10 } });
    const d = s.definitions[0]!; s.definitions = [{ ...d, weapons: [d.weapons[0]!, { ...d.weapons[0]!, id: 'second' } as RangedWeapon] }, s.definitions[1]!];
  });
  game.fireWeapon('test-rifle', 'unit-2', dice(6, 6, 1, 6, 6, 1, 6, 6, 1).rng);
  assert.deepEqual(game.getLegalTargets('unit-1', 'second'), { ok: true, value: [] });
  reject(game, () => game.fireWeapon('second', 'unit-2', () => { throw new Error('Unexpected roll'); }), 'TARGET_DESTROYED');
});
test('both prototype factions can shoot and hasShot resets for subsequent turns', () => {
  const game = startedShooting(); game.completeShooting(); game.nextTurn(); game.nextPhase(); game.nextPhase();
  assert.equal(game.beginShooting('unit-2').ok, true);
  const shots = game.fireWeapon('test-carbine', 'unit-1', dice(1, 1, 1).rng); assert.ok(shots.ok && shots.value.attacks === 3);
  game.completeShooting(); game.nextTurn(); game.nextPhase(); game.nextPhase();
  assert.equal(game.beginShooting('unit-1').ok, true);
});
