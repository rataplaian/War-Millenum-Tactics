import { sourceModifier, sourceFlag } from '../attachments/queries';
import type { GameState, Unit } from '../models';
import type { Characteristic, Effect, EffectInput } from './types';
import { flowEvent } from '../flow/events';
const key = (e: Effect) => e.payload.kind === 'FLAG' ? `FLAG:${e.payload.flag}` : e.payload.characteristic;
export function applyEffect(s: GameState, input: EffectInput): Effect {
  const f = s.flow; if (!f) throw new Error('Match flow required');
  const unit = s.units.find(u => u.id === input.target.unitId); if (!unit) throw new Error('Effect target missing');
  const e: Effect = { ...JSON.parse(JSON.stringify(input)), id: `effect-${f.nextEffectId++}`, active: true,
    expiryPlayerId: input.expiryPlayerId ?? unit.playerId,
    createdAt: { round: s.round, turn: s.turn, phaseIndex: f.phaseIndex, playerId: s.activePlayerId, phase: s.phase } };
  const matching = f.effects.filter(x => x.active && x.target.unitId === e.target.unitId && key(x) === key(e));
  if (e.stacking === 'REPLACE_SAME_SOURCE') for (const x of matching.filter(x => x.source === e.source)) removeEffect(s, x.id);
  if (e.stacking === 'NON_STACKING' && matching.length) { e.active = false; }
  f.effects.push(e); flowEvent(s, 'TEMPORARY_EFFECT_APPLIED', { effectId: e.id, source: e.source, active: e.active }, unit.id);
  return e;
}
export function removeEffect(s: GameState, id: string) {
  const e = s.flow?.effects.find(x => x.id === id); if (!e?.active) return;
  e.active = false; flowEvent(s, 'TEMPORARY_EFFECT_EXPIRED', { effectId: id }, e.target.unitId);
}
export function activeEffects(s: GameState, unitId: string): Effect[] {
  const all = (s.flow?.effects ?? []).filter(e => e.active && e.target.unitId === unitId && (s.units.find(u => u.id === unitId)?.location !== 'EMBARKED' || e.whileEmbarked));
  return all.filter(e => e.stacking !== 'HIGHEST_ONLY' || !all.some(x => x.stacking === 'HIGHEST_ONLY' && key(x) === key(e) &&
    x.payload.kind === 'MODIFIER' && e.payload.kind === 'MODIFIER' && (x.payload.value > e.payload.value || (x.payload.value === e.payload.value && all.indexOf(x) < all.indexOf(e)))));
}
export const modifierDelta = (s: GameState, unitId: string, characteristic: Characteristic) => activeEffects(s, unitId).reduce((sum, e) => sum + (e.payload.kind === 'MODIFIER' && e.payload.characteristic === characteristic ? e.payload.value : 0), 0);
export function effectiveCharacteristic(s: GameState, unitId: string, characteristic: Characteristic, base: number, modelId?: string): number {
  const n = base + modifierDelta(s, unitId, characteristic) + sourceModifier(s, unitId, characteristic, modelId);
  if (characteristic === 'BS' || characteristic === 'WS') return Math.max(2, Math.min(6, n));
  if (characteristic === 'SAVE') return Math.max(2, Math.min(7, n));
  if (characteristic === 'LEADERSHIP') return Math.max(4, Math.min(9, n));
  if (characteristic === 'HIT_ROLL' || characteristic === 'WOUND_ROLL') return Math.max(-1, Math.min(1, n));
  return Math.max(0, n);
}
export function effectiveFlag(s: GameState, unitId: string, flag: string, fallback = false): boolean {
  const found = activeEffects(s, unitId).filter(e => e.payload.kind === 'FLAG' && e.payload.flag === flag).at(-1);
  return found?.payload.kind === 'FLAG' ? found.payload.value : sourceFlag(s, unitId, flag) ?? fallback;
}
export type ExpiryPoint = 'PHASE_END' | 'TURN_END' | 'ROUND_END' | 'COMMAND_START' | 'COMMAND_END';
export function expireEffects(s: GameState, point: ExpiryPoint) {
  for (const e of s.flow?.effects ?? []) {
    if (!e.active) continue;
    const nextCommand = s.activePlayerId === e.expiryPlayerId && s.turn > e.createdAt.turn;
    if ((point === 'PHASE_END' && e.expiry === 'END_OF_CURRENT_PHASE' && e.createdAt.phaseIndex <= s.flow!.phaseIndex) ||
      (point === 'TURN_END' && e.expiry === 'END_OF_CURRENT_TURN') || (point === 'ROUND_END' && e.expiry === 'END_OF_BATTLE_ROUND') ||
      (point === 'COMMAND_START' && e.expiry === 'START_OF_NEXT_COMMAND_PHASE' && nextCommand) ||
      (point === 'COMMAND_END' && e.expiry === 'END_OF_NEXT_COMMAND_PHASE' && nextCommand)) removeEffect(s, e.id);
  }
}
/** A dash is represented explicitly, rather than silently mutating the datasheet to zero. */
export function effectiveObjectiveControl(s: GameState, unit: Unit): number | null {
  if (unit.state.battleShocked) return null;
  return effectiveCharacteristic(s, unit.id, 'OC', s.definitions.find(d => d.id === unit.definitionId)!.stats.objectiveControl);
}
