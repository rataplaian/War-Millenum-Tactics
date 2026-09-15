import type { BaseGeometry, Battlefield, Position } from '../models';
/** Numerical tolerance only; not a tabletop rule threshold. */
export const EPSILON = 1e-9;
export const mmToInches = (mm: number): number => mm / 25.4;
export const inchesToMm = (inches: number): number => inches * 25.4;
export const baseRadius = (base: BaseGeometry): number => mmToInches(base.diameterMm) / 2;
export const isFinitePosition = (p: Position): boolean => Number.isFinite(p.x) && Number.isFinite(p.y);
export const centreDistance = (a: Position, b: Position): number => Math.hypot(b.x - a.x, b.y - a.y);
export const distanceTravelled = centreDistance;
export interface CircularFootprint { position: Position; base: BaseGeometry }
/** Non-negative gap; touching and overlapping bases both have zero edge distance. */
export function edgeDistance(a: CircularFootprint, b: CircularFootprint): number {
  return Math.max(0, centreDistance(a.position, b.position) - baseRadius(a.base) - baseRadius(b.base));
}
export function basesOverlap(a: CircularFootprint, b: CircularFootprint): boolean {
  return centreDistance(a.position, b.position) < baseRadius(a.base) + baseRadius(b.base) - EPSILON;
}
export function positionInsideBattlefield(p: Position, field: Battlefield): boolean {
  return isFinitePosition(p) && p.x >= 0 && p.y >= 0 && p.x <= field.width && p.y <= field.height;
}
/** The entire base must fit, not just its centre. Boundary contact is legal. */
export function baseInsideBattlefield(model: CircularFootprint, field: Battlefield): boolean {
  const radius = baseRadius(model.base);
  const { x, y } = model.position;
  return isFinitePosition(model.position) && x >= radius - EPSILON && y >= radius - EPSILON &&
    x + radius <= field.width + EPSILON && y + radius <= field.height + EPSILON;
}
