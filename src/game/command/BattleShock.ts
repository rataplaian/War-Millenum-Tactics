import { modelDefinition } from '../attachments/queries';
import type { GameState, Unit } from '../models';
import { rollD6s, type RandomSource } from '../utils/dice';
import { effectiveCharacteristic, effectiveFlag } from '../effects/EffectEngine';
import { onBattlefield } from '../reserves/location';
export function strengthFraction(s: GameState, u: Unit): number {
  const d = s.definitions.find(d => d.id === u.definitionId)!;
  return d.modelCount === 1 ? u.models.reduce((n, m) => n + m.woundsRemaining, 0) / d.stats.wounds : u.models.filter(m => m.alive).length / d.modelCount;
}
export const isBelowHalfStrength = (s: GameState, u: Unit) => strengthFraction(s, u) < 0.5;
export const isAtOrBelowHalfStrength = (s: GameState, u: Unit) => strengthFraction(s, u) <= 0.5;
export const getUnitsRequiringBattleShockRoll = (s: GameState) => s.units.filter(u => u.playerId === s.activePlayerId && onBattlefield(u) && u.models.some(m => m.alive) && (u.state.battleShocked || isAtOrBelowHalfStrength(s, u)));
export function resolveLeadershipRoll(characteristics: readonly number[], rng: RandomSource) {
  if (!characteristics.length || characteristics.some(n => !Number.isSafeInteger(n) || n < 1)) throw new Error('Invalid Leadership characteristics');
  const rolls = rollD6s(2, rng), total = rolls.reduce((a, b) => a + b, 0);
  return { rolls, total, success: characteristics.some(ld => total >= ld) };
}
export function resolveBattleShockRoll(s: GameState, u: Unit, rng: RandomSource) {
  const characteristics = u.models.filter(m => m.alive).map(m => effectiveCharacteristic(s, u.id, 'LEADERSHIP', m.leadership ?? modelDefinition(s, u, m).stats.leadership, m.id));
  return resolveLeadershipRoll(characteristics, rng);
}
export const canStartAction = (u: Unit) => !u.state.battleShocked && !u.state.hasAdvanced && !u.state.hasFallenBack && onBattlefield(u) && u.models.some(m => m.alive);
export const canCompleteAction = canStartAction;
/** Shared gate for the future Fall Back controller: Battle-shock forbids Ordered Retreat. */
export function fallBackOptions(s: GameState, u: Unit) {
  const orderedRetreat = !u.state.battleShocked && !effectiveFlag(s, u.id, 'FORBID_ORDERED_RETREAT');
  return { orderedRetreat, requiresDesperateEscape: !orderedRetreat };
}
