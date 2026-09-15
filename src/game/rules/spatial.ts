import type { CoherencyRule, GameState, Model, Unit } from '../models';
import { edgeDistance, EPSILON } from '../utils/geometry';
export interface CoherencyResult { coherent: boolean; failingModelIds: string[]; connected: boolean }
/** Requirements are chosen by living unit size, not starting model count. */
export function checkCoherency(models: readonly Model[], rule: CoherencyRule): CoherencyResult {
  const living = models.filter(m => m.alive);
  if (living.length <= 1) return { coherent: true, failingModelIds: [], connected: true };
  const band = [...rule.sizeBands].reverse().find(b => living.length >= b.minModels);
  if (!band) throw new Error('Missing coherency size band');
  const neighbours = living.map(a => living.filter(b => a.id !== b.id && edgeDistance(a, b) <= rule.maxEdgeDistance + EPSILON));
  const failingModelIds = living.filter((_, i) => neighbours[i]!.length < band.requiredNeighbours).map(m => m.id);
  const visited = new Set<string>();
  const pending = [living[0]!];
  while (pending.length) {
    const model = pending.pop()!;
    if (visited.has(model.id)) continue;
    visited.add(model.id);
    pending.push(...neighbours[living.indexOf(model)]!.filter(m => !visited.has(m.id)));
  }
  const connected = visited.size === living.length;
  return { coherent: failingModelIds.length === 0 && (!rule.requireConnected || connected), failingModelIds, connected };
}
export function enemyModelsWithinEngagement(state: GameState, playerId: string, model: Model): Model[] {
  if (!model.alive) return [];
  return state.units.filter(u => u.playerId !== playerId).flatMap(u => u.models)
    .filter(enemy => enemy.alive && edgeDistance(model, enemy) <= state.spatialRules.engagementDistance + EPSILON);
}
export function isUnitEngaged(state: GameState, unit: Unit): boolean {
  return unit.models.some(model => enemyModelsWithinEngagement(state, unit.playerId, model).length > 0);
}
