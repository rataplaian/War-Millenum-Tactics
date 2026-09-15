import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSeededRng, rollD6, rollD6s } from '../src/game/utils/dice';
test('seed 42 produces the known D6 sequence', () => {
  assert.deepEqual(rollD6s(8, createSeededRng(42)), [2, 1, 4, 2, 3, 1, 3, 1]);
  assert.deepEqual(rollD6s(20, createSeededRng(12)), rollD6s(20, createSeededRng(12)));
});
test('D6 includes both endpoints and supports empty pools', () => {
  assert.equal(rollD6(() => 0), 1); assert.equal(rollD6(() => 0.999999), 6);
  assert.deepEqual(rollD6s(0, createSeededRng(0)), []);
});
test('invalid randomness, counts and seeds fail explicitly', () => {
  for (const value of [-1, 1, NaN, Infinity]) assert.throws(() => rollD6(() => value));
  for (const count of [-1, 0.5, NaN]) assert.throws(() => rollD6s(count, createSeededRng(1)));
  for (const seed of [-1, 1.5, Infinity, 0x100000000]) assert.throws(() => createSeededRng(seed));
});
