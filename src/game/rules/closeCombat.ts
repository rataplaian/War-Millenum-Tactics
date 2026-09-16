import { arrivalLocked, battleStarted, onBattlefield, setupBusy } from '../reserves/location';
import { validateTerrainPath } from '../terrain/movement';
import type { CloseCombatState, CommandResult, GameState, Model, Position, Unit } from '../models';
import { baseRadius, centreDistance, edgeDistance, EPSILON } from '../utils/geometry';
import { definitionFor, failure, validateFinalPosition } from './movement';
import { checkCoherency, isUnitEngaged } from './spatial';

/** Central configuration; world distances are inches. Engagement uses SpatialRules. */
export const COMBAT_RULES = Object.freeze({ chargeTargetDistance: 12, chargeCloseDistance: 1, pileIn: 3, pileInTargetDistance: 5, consolidate: 3 });
export const emptyCloseCombat = (): CloseCombatState => ({ charge: null, move: null, declared: [], effects: [], fight: null });
export const living = (unit: Unit) => onBattlefield(unit) ? unit.models.filter(m => m.alive) : [];
export const enemies = (state: GameState, unit: Unit) => state.units.filter(u => u.playerId !== unit.playerId && living(u).length);
export const unitDistance = (a: Unit, b: Unit) => Math.min(...living(a).flatMap(m => living(b).map(n => edgeDistance(m, n))));
export const engagedTargets = (state: GameState, unit: Unit) => enemies(state, unit).filter(u => unitDistance(unit, u) <= state.spatialRules.engagementDistance + EPSILON);
export const hasFightsFirst = (state: GameState, unit: Unit) => state.closeCombat?.effects.some(e => e.unitId === unit.id && e.kind === 'FIGHTS_FIRST' && e.turn === state.turn) ?? false;
export interface ChargeExceptions { afterAdvance?: boolean; afterFallBack?: boolean; whileEngaged?: boolean }
/** Generic extension point: future ability evaluation supplies permissions. */
export function canDeclareCharge(state: GameState, unitId: string, exceptions: ChargeExceptions = {}): CommandResult<Unit> {
  if (!battleStarted(state)) return failure('PRE_BATTLE');
  if (setupBusy(state)) return failure('SETUP_IN_PROGRESS');
  if (state.status !== 'in-progress') return failure('MATCH_FINISHED');
  if (state.phase !== 'Charge') return failure('WRONG_PHASE');
  if (state.movement || state.shooting || state.closeCombat?.charge || state.closeCombat?.move) return failure('COMBAT_IN_PROGRESS');
  const unit = state.units.find(u => u.id === unitId);
  if (!unit) return failure('UNIT_NOT_FOUND');
  if (!onBattlefield(unit)) return failure('NOT_ON_BATTLEFIELD');
  if (arrivalLocked(unit)) return failure('ARRIVAL_MOVE_LOCK');
  if (unit.playerId !== state.activePlayerId) return failure('NOT_YOUR_UNIT');
  if (!living(unit).length) return failure('NO_LIVING_MODELS');
  if (state.closeCombat?.declared.includes(unitId)) return failure('ALREADY_DECLARED');
  if ((unit.state.hasAdvanced && !exceptions.afterAdvance) || (unit.state.hasFallenBack && !exceptions.afterFallBack) ||
      (isUnitEngaged(state, unit) && !exceptions.whileEngaged)) return failure('CHARGE_INELIGIBLE');
  return { ok: true, value: unit };
}
export function getModelsEligibleToFight(state: GameState, unit: Unit, target?: Unit): Model[] {
  const targets = target ? [target] : enemies(state, unit);
  return living(unit).filter(m => targets.some(u => u.playerId !== unit.playerId && living(u).some(n => edgeDistance(m, n) <= state.spatialRules.engagementDistance + EPSILON)));
}

interface Circle { position: Position; radius: number }
function intersections(a: Circle, b: Circle): Position[] {
  const d = centreDistance(a.position, b.position);
  if (d < EPSILON || d > a.radius + b.radius + EPSILON || d < Math.abs(a.radius - b.radius) - EPSILON) return [];
  const along = (a.radius ** 2 - b.radius ** 2 + d ** 2) / (2 * d);
  const height = Math.sqrt(Math.max(0, a.radius ** 2 - along ** 2));
  const dx = (b.position.x - a.position.x) / d, dy = (b.position.y - a.position.y) / d;
  return [-1, 1].map(sign => ({ x: a.position.x + along * dx - sign * height * dy, y: a.position.y + along * dy + sign * height * dx }));
}
/** Endpoint feasibility for circular bases: inspect disk-arrangement vertices and boundary projections.
 * No pixel sampling, path finding, terrain, or alternate geometry system. */
export function reachablePositions(state: GameState, unit: Unit, model: Model, origin: Position, allowance: number, targetModels: Model[], maxEdge: number): Position[] {
  const radius = baseRadius(model.base);
  const circles: Circle[] = [{ position: origin, radius: allowance },
    ...targetModels.map(m => ({ position: m.position, radius: radius + baseRadius(m.base) + maxEdge })),
    ...state.units.flatMap(u => living(u)).filter(m => m.id !== model.id).map(m => ({ position: m.position, radius: radius + baseRadius(m.base) }))];
  const xs = [radius, state.battlefield.width - radius], ys = [radius, state.battlefield.height - radius];
  const points: Position[] = [origin, ...xs.flatMap(x => ys.map(y => ({ x, y })))];
  for (const [i, circle] of circles.entries()) {
    for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) points.push({ x: circle.position.x + circle.radius * Math.cos(angle), y: circle.position.y + circle.radius * Math.sin(angle) });
    const d = centreDistance(origin, circle.position);
    if (d > EPSILON) points.push({ x: circle.position.x + (origin.x - circle.position.x) * circle.radius / d, y: circle.position.y + (origin.y - circle.position.y) * circle.radius / d });
    for (const other of circles.slice(i + 1)) points.push(...intersections(circle, other));
    for (const x of xs) {
      const q = circle.radius ** 2 - (x - circle.position.x) ** 2;
      if (q >= -EPSILON) for (const sign of [-1, 1]) points.push({ x, y: circle.position.y + sign * Math.sqrt(Math.max(0, q)) });
    }
    for (const y of ys) {
      const q = circle.radius ** 2 - (y - circle.position.y) ** 2;
      if (q >= -EPSILON) for (const sign of [-1, 1]) points.push({ x: circle.position.x + sign * Math.sqrt(Math.max(0, q)), y });
    }
  }
  const levels = [...new Set([origin.z ?? 0, ...targetModels.map(m => m.position.z ?? 0), ...(state.battlefield.terrain?.features ?? []).flatMap(f => f.surfaces.map(surface => surface.z))])];
  const candidates = state.battlefield.terrain ? points.flatMap(p => levels.map(z => ({ ...p, z }))) : points;
  return candidates.filter(position => centreDistance(origin, position) <= allowance + EPSILON &&
    targetModels.some(t => edgeDistance({ ...model, position }, t) <= maxEdge + EPSILON) &&
    validateFinalPosition(state, unit, model, position, true).ok && (() => { const path = validateTerrainPath(state, { ...model, position: origin }, position); return path.ok && path.value.totalMovementDistance <= allowance + EPSILON; })());
}
/** Return targets belonging to at least one witnessed legal target combination. */
export function getLegalChargeTargets(state: GameState, unit: Unit, roll: number): Unit[] {
  if (!Number.isInteger(roll) || roll < 2 || roll > 12) return [];
  const candidates = enemies(state, unit).filter(target => unitDistance(unit, target) <= Math.min(COMBAT_RULES.chargeTargetDistance, roll) + EPSILON);
  const legal = new Set<string>();
  let attempts = 0;
  const visit = (index: number, ids: string[]) => {
    if (attempts >= 256) return;
    if (index === candidates.length) {
      if (ids.length && ++attempts && findChargeFormation(state, unit, ids, roll)) ids.forEach(id => legal.add(id));
      return;
    }
    visit(index + 1, [...ids, candidates[index]!.id]);
    visit(index + 1, ids);
  };
  visit(0, []);
  return candidates.filter(u => legal.has(u.id));
}
export function meleeWeapons(state: GameState, unit: Unit) { return definitionFor(state, unit).weapons.filter(w => w.kind === 'melee'); }

/** Conservative formation witness for target selection, never a UI-side approximation.
 * Searches deterministic legal endpoints, not paths. A bounded search may decline a crowded
 * formation requiring a different ordering; it never declares an invalid witness legal. */
export function findChargeFormation(state: GameState, unit: Unit, targetIds: string[], roll: number): Position[] | null {
  const draft: GameState = JSON.parse(JSON.stringify(state));
  const source = draft.units.find(u => u.id === unit.id)!;
  const models = living(source), origins = models.map(m => ({ ...m.position }));
  const targets = draft.units.filter(u => targetIds.includes(u.id));
  if (!targets.length) return null;
  const targetModels = targets.flatMap(living);
  let budget = 10000;
  const search = (index: number): Position[] | null => {
    if (--budget < 0) return null;
    if (index === models.length) {
      const engaged = engagedTargets(draft, source).map(u => u.id);
      if (targetIds.some(id => !engaged.includes(id)) || engaged.some(id => !targetIds.includes(id)) || !checkCoherency(source.models, state.spatialRules.coherency).coherent) return null;
      for (const [i, model] of models.entries()) for (const threshold of [COMBAT_RULES.chargeCloseDistance, state.spatialRules.engagementDistance]) {
        if (!targetModels.some(t => edgeDistance(model, t) <= threshold + EPSILON) && reachablePositions(draft, source, model, origins[i]!, roll, targetModels, threshold).length) return null;
      }
      return models.map(m => ({ ...m.position }));
    }
    const model = models[index]!, origin = origins[index]!;
    const nearest = Math.min(...targetModels.map(t => edgeDistance({ ...model, position: origin }, t)));
    const candidates = [COMBAT_RULES.chargeCloseDistance, state.spatialRules.engagementDistance, nearest]
      .flatMap(threshold => reachablePositions(draft, source, model, origin, roll, targetModels, threshold))
      .filter(p => targetModels.some(t => edgeDistance({ ...model, position: p }, t) < edgeDistance({ ...model, position: origin }, t) - EPSILON))
      .sort((a, b) => {
        const close = (p: Position) => targetModels.some(t => edgeDistance({ ...model, position: p }, t) <= COMBAT_RULES.chargeCloseDistance + EPSILON) ? 0 : 1;
        return close(a) - close(b) || centreDistance(origin, a) - centreDistance(origin, b) || a.x - b.x || a.y - b.y;
      });
    const seen = new Set<string>();
    for (const position of candidates) {
      const key = `${position.x.toFixed(8)},${position.y.toFixed(8)},${(position.z ?? 0).toFixed(8)}`; if (seen.has(key)) continue; seen.add(key);
      model.position = position;
      const found = search(index + 1); if (found) return found;
      if (budget < 0) break;
    }
    model.position = origin; return null;
  };
  return search(0);
}
