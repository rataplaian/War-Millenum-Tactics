import { onBattlefield } from '../reserves/location';
import type { GameState, Model, Position3, TerrainFeature, Unit, VisibilityResult } from '../models';
import { baseRadius, EPSILON } from '../utils/geometry';
import { elevation, intervalCovered, modelHeight, prismIntervals, rayIntersectsCylinder, rectangle } from './geometry';
import { areasForModel, getDetectionRange, isModelHidden, isObscuring, terrainRules, unitForModel, withinDetection, type DetectionRangePolicy } from './rules';
import type { VisibilityPolicy } from '../rules/visibility';
export interface VisibilityProvider {
  inspect(observer: Model, target: Model): VisibilityResult;
  hasLineOfSight(observer: Model, target: Model): boolean;
  isModelVisible(observer: Model, target: Model): boolean;
  isModelFullyVisible(observer: Model, target: Model): boolean;
  isUnitVisible(observer: Model, target: Unit): boolean;
  isUnitFullyVisible(observer: Model, target: Unit): boolean;
}
export type VisibilityProviderFactory = (state: GameState) => VisibilityProvider;
/** Fixed logical cylinder samples, independent of display resolution. Replaceable with mesh LOS. */
function sampleModel(model: Model, facing?: Model): Position3[] {
  const radius = baseRadius(model.base), z = elevation(model.position), height = modelHeight(model);
  const points: Position3[] = [];
  const facingAngle = facing ? Math.atan2(facing.position.y - model.position.y, facing.position.x - model.position.x) : 0;
  const angles = facing ? [-Math.PI / 2, -Math.PI / 4, 0, Math.PI / 4, Math.PI / 2].map(a => a + facingAngle) : Array.from({ length: 8 }, (_, i) => i * Math.PI / 4);
  for (const dz of [0, height / 2, height]) {
    points.push({ ...model.position, z: z + dz });
    for (const angle of angles) points.push({ x: model.position.x + radius * Math.cos(angle), y: model.position.y + radius * Math.sin(angle), z: z + dz });
  }
  return points;
}
function featureBlocks(from: Position3, to: Position3, feature: TerrainFeature, solidHeight: number): boolean {
  const openings = feature.openings.flatMap(opening => {
    const minZ = feature.category === 'DENSE' ? Math.max(opening.minZ, solidHeight + EPSILON * 4) : opening.minZ;
    return minZ <= opening.maxZ ? prismIntervals(from, to, { ...opening, minZ }) : [];
  });
  return feature.sections.some(section => prismIntervals(from, to, section).some(interval => !intervalCovered(interval, openings)));
}
/** A provider owns one detached snapshot. Its query cache can never survive a state mutation. */
export function createVisibilityProvider(input: GameState, detection: DetectionRangePolicy = getDetectionRange, legacyPolicy?: VisibilityPolicy): VisibilityProvider {
  const state: GameState = JSON.parse(JSON.stringify(input));
  const models = new Map(state.units.filter(onBattlefield).flatMap(u => u.models).map(m => [m.id, m]));
  const terrain = state.battlefield.terrain, rules = terrainRules(state);
  const cache = new Map<string, VisibilityResult>();
  function inspect(observerInput: Model, targetInput: Model, ignoreTargetUnit = false): VisibilityResult {
    const observer = models.get(observerInput.id), target = models.get(targetInput.id);
    if (!observer || !target || !observer.alive || !target.alive) return { level: 'NOT_VISIBLE', hasLineOfSight: false, terrainFullyVisible: false, hidden: false, withinDetection: false };
    const key = `${observer.id}|${target.id}|${ignoreTargetUnit}`;
    const cached = cache.get(key); if (cached) return { ...cached };
    const hidden = isModelHidden(state, target), detected = withinDetection(state, observer, target, detection);
    const enemy = unitForModel(state, observer).playerId !== unitForModel(state, target).playerId;
    const ignoredAreas = new Set([...areasForModel(state, observer), ...areasForModel(state, target)].map(a => a.id));
    const obscuring = (terrain?.areas ?? []).filter(a => !ignoredAreas.has(a.id) && isObscuring(state, a));
    const blockers = [...models.values()].filter(m => m.alive && m.id !== target.id && m.unitId !== observer.unitId && (!ignoreTargetUnit || m.unitId !== target.unitId));
    const terrainClear = (a: Position3, b: Position3) => !obscuring.some(area => prismIntervals(a, b, { footprint: area.footprint, minZ: 0, maxZ: Number.MAX_VALUE }).length) &&
      !(terrain?.features ?? []).some(feature => featureBlocks(a, b, feature, rules.solidHeight)) &&
      !state.battlefield.losBlockers.some(blocker => blocker.opaque && prismIntervals(a, b, { footprint: rectangle(blocker.position.x, blocker.position.y, blocker.width, blocker.height), minZ: 0, maxZ: Number.MAX_VALUE }).length);
    const sourcePoints = sampleModel(observer), targetPoints = sampleModel(target, observer);
    let anyClear = false, full = false, terrainFull = false;
    for (const a of sourcePoints) {
      let allClear = true, allTerrain = true;
      for (const b of targetPoints) {
        const clearTerrain = terrainClear(a, b);
        const clear = clearTerrain && !blockers.some(m => rayIntersectsCylinder(a, b, m));
        allTerrain &&= clearTerrain; allClear &&= clear; anyClear ||= clear;
      }
      full ||= allClear; terrainFull ||= allTerrain;
      if (full && terrainFull) break;
    }
    // Compatibility injection only; default Shooting always uses the primitive provider.
    if (legacyPolicy) { anyClear = legacyPolicy(observer, target, state.battlefield); full = anyClear; }
    const visible = anyClear && (!enemy || !hidden || detected);
    const result: VisibilityResult = { level: visible ? full ? 'FULLY_VISIBLE' : 'VISIBLE' : 'NOT_VISIBLE', hasLineOfSight: anyClear, terrainFullyVisible: terrainFull, hidden, withinDetection: detected };
    cache.set(key, result); return { ...result };
  }
  return {
    inspect: (a, b) => inspect(a, b), hasLineOfSight: (a, b) => inspect(a, b).hasLineOfSight,
    isModelVisible: (a, b) => inspect(a, b).level !== 'NOT_VISIBLE',
    isModelFullyVisible: (a, b) => inspect(a, b).level === 'FULLY_VISIBLE',
    isUnitVisible: (observer, unit) => unit.models.some(m => m.alive && inspect(observer, m).level !== 'NOT_VISIBLE'),
    // The target unit's other models are ignored only for this full-unit check.
    isUnitFullyVisible: (observer, unit) => unit.models.some(m => m.alive) && unit.models.filter(m => m.alive).every(m => inspect(observer, m, true).level === 'FULLY_VISIBLE'),
  };
}
