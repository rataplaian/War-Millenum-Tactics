/** An injected source must return a finite number in [0, 1). */
export type RandomSource = () => number;
/** Seeded 32-bit LCG. For repeatable simulations, not cryptography. */
export function createSeededRng(seed: number): RandomSource {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('Seed must be a uint32');
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}
export function rollD6(rng: RandomSource): number {
  const value = rng();
  if (!Number.isFinite(value) || value < 0 || value >= 1) throw new RangeError('RNG must return a value in [0, 1)');
  return Math.floor(value * 6) + 1;
}
export function rollD6s(count: number, rng: RandomSource): number[] {
  if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('Count must be a non-negative integer');
  return Array.from({ length: count }, () => rollD6(rng));
}
