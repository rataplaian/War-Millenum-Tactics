import type { Model, Unit } from '../models';
/** Pure selection seam. Returns a model ID; the caller owns state changes. */
export type DamageAllocationPolicy = (models: readonly Model[], maximumWounds: number) => string | null;
/** Prototype automatic allocation: wounded survivor first, then stable model array order. */
export const allocateDamage: DamageAllocationPolicy = (models, maximumWounds) => {
  const living = models.filter(model => model.alive);
  return (living.find(model => model.woundsRemaining < maximumWounds) ?? living[0])?.id ?? null;
};
/** Returns a new unit; one attack can affect only one model. */
export function applyDamage(target: Unit, modelId: string, damage: number): Unit {
  if (!Number.isSafeInteger(damage) || damage < 0) throw new Error('Invalid resolved damage');
  const model = target.models.find(m => m.id === modelId);
  if (!model?.alive) throw new Error('Allocation must select a living target model');
  const woundsRemaining = Math.max(0, model.woundsRemaining - damage);
  return { ...target, models: target.models.map(m => m.id === modelId ?
    { ...m, woundsRemaining, alive: woundsRemaining > 0 } : m) };
}
