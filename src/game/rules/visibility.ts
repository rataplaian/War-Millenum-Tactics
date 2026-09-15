import type { Battlefield, LosBlocker, Model, Position } from '../models';
import { EPSILON } from '../utils/geometry';
/** Slab intersection with a closed rectangle: touching an edge/corner blocks LOS. */
export function segmentIntersectsRectangle(from: Position, to: Position, rectangle: Pick<LosBlocker, 'position' | 'width' | 'height'>): boolean {
  let enter = 0;
  let exit = 1;
  for (const axis of ['x', 'y'] as const) {
    const start = from[axis];
    const delta = to[axis] - start;
    const minimum = rectangle.position[axis];
    const maximum = minimum + (axis === 'x' ? rectangle.width : rectangle.height);
    if (Math.abs(delta) <= EPSILON) {
      if (start < minimum - EPSILON || start > maximum + EPSILON) return false;
    } else {
      const a = (minimum - start) / delta;
      const b = (maximum - start) / delta;
      enter = Math.max(enter, Math.min(a, b));
      exit = Math.min(exit, Math.max(a, b));
      if (enter > exit + EPSILON) return false;
    }
  }
  return true;
}
/** Pure seam for a future height/terrain/detection policy; models are not blockers. */
export type VisibilityPolicy = (shooter: Model, target: Model, battlefield: Battlefield) => boolean;
export const basicLineOfSight: VisibilityPolicy = (shooter, target, battlefield) =>
  shooter.alive && target.alive && !battlefield.losBlockers.some(blocker => blocker.opaque &&
    segmentIntersectsRectangle(shooter.position, target.position, blocker));
export function visibleTargetModels(shooter: Model, targets: readonly Model[], battlefield: Battlefield,
  visibility: VisibilityPolicy = basicLineOfSight): Model[] {
  return shooter.alive ? targets.filter(target => target.alive && visibility(shooter, target, battlefield)) : [];
}
