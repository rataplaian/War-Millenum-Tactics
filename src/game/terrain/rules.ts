import { modelKeywords } from '../attachments/queries';
import { onBattlefield } from '../reserves/location';
import type { GameState, Model, TerrainArea, TerrainRules, Unit } from '../models';
import { baseIntersectsPolygon, elevation } from './geometry';
import { edgeDistance, EPSILON } from '../utils/geometry';
export const DEFAULT_TERRAIN_RULES: Readonly<TerrainRules> = Object.freeze({ detectionRange: 15, solidHeight: 3, stepOverHeight: 2, climbProximity: 0.5, plungingHeight: 3, toweringRange: 12 });
export const terrainRules = (s: GameState): TerrainRules => ({ ...DEFAULT_TERRAIN_RULES, ...s.battlefield.terrain?.rules });
export const unitForModel = (s: GameState, m: Model): Unit => { const u = s.units.find(u => u.id === m.unitId); if (!u) throw new Error('Model unit missing'); return u; };
export function keywordsFor(s: GameState, model: Model): string[] {
  return modelKeywords(s, unitForModel(s, model), model);
}
export const hasAnyKeyword = (s: GameState, m: Model, allowed: readonly string[]) => keywordsFor(s, m).some(k => allowed.includes(k));
export const LIGHT_BODY = ['INFANTRY', 'BEASTS', 'SWARM'] as const;
export const areasForModel = (s: GameState, m: Model): TerrainArea[] => (onBattlefield(unitForModel(s, m)) ? s.battlefield.terrain?.areas ?? [] : []).filter(area => baseIntersectsPolygon(m, area.footprint));
export const isObscuring = (s: GameState, area: TerrainArea): boolean => (s.battlefield.terrain?.features ?? []).some(f => area.featureIds.includes(f.id) && (f.category === 'LIGHT' || f.category === 'DENSE'));
export function lastRangedAttackTurn(s: GameState, unit: Unit): number | undefined {
  // Old snapshots already contain attack events; preserve their Hidden history on load.
  return unit.lastRangedAttackTurnIndex ?? s.events.reduce<number | undefined>((last, e) => e.type === 'weapon-fired' && e.unitId === unit.id && e.resolution.attacks > 0 ? Math.max(last ?? 0, e.turn) : last, undefined);
}
export function isModelHidden(s: GameState, model: Model): boolean {
  if (!model.alive || !hasAnyKeyword(s, model, LIGHT_BODY)) return false;
  const last = lastRangedAttackTurn(s, unitForModel(s, model));
  if (last !== undefined && last >= s.turn - 1) return false;
  return areasForModel(s, model).some(area => s.battlefield.terrain!.features.some(f => area.featureIds.includes(f.id) && f.category === 'DENSE'));
}
export type DetectionRangePolicy = (observer: Model, state: GameState) => number;
export const getDetectionRange: DetectionRangePolicy = (_observer, state) => terrainRules(state).detectionRange;
export function baseDistance3(a: Model, b: Model): number { return edgeDistance(a, b); }
export function withinDetection(s: GameState, observer: Model, target: Model, policy: DetectionRangePolicy = getDetectionRange) {
  const range = policy(observer, s); if (!Number.isFinite(range) || range < 0) throw new Error('Invalid detection range');
  return baseDistance3(observer, target) <= range + EPSILON;
}
