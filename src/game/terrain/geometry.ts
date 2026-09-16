import type { Model, Polygon, Position, Position3, TerrainPrism } from '../models';
import { baseRadius, centreDistance, EPSILON } from '../utils/geometry';
export const elevation = (p: Position): number => p.z ?? 0;
export const position3 = (p: Position): Position3 => ({ x: p.x, y: p.y, z: elevation(p) });
export const modelHeight = (m: Model): number => m.volume?.height ?? 1.5;
export const distance3 = (a: Position, b: Position) => Math.hypot(centreDistance(a, b), elevation(b) - elevation(a));
export const rectangle = (x: number, y: number, width: number, height: number): Polygon => ({ vertices: [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }] });
export const edges = (p: Polygon): [Position, Position][] => p.vertices.map((v, i) => [v, p.vertices[(i + 1) % p.vertices.length]!]);
const cross = (a: Position, b: Position) => a.x * b.y - a.y * b.x;
const minus = (a: Position, b: Position) => ({ x: a.x - b.x, y: a.y - b.y });
export function pointSegmentDistance(p: Position, a: Position, b: Position): number {
  const v = minus(b, a), w = minus(p, a), length2 = v.x ** 2 + v.y ** 2;
  const t = length2 ? Math.max(0, Math.min(1, (v.x * w.x + v.y * w.y) / length2)) : 0;
  return centreDistance(p, { x: a.x + v.x * t, y: a.y + v.y * t });
}
export function pointInPolygon(point: Position, polygon: Polygon): boolean {
  let inside = false;
  for (const [a, b] of edges(polygon)) {
    if (pointSegmentDistance(point, a, b) <= EPSILON) return true;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
export function distanceToPolygon(p: Position, polygon: Polygon): number {
  return pointInPolygon(p, polygon) ? 0 : Math.min(...edges(polygon).map(([a, b]) => pointSegmentDistance(p, a, b)));
}
export const baseIntersectsPolygon = (model: Pick<Model, 'base' | 'position'>, polygon: Polygon) => distanceToPolygon(model.position, polygon) <= baseRadius(model.base) + EPSILON;
export const baseSupported = (model: Pick<Model, 'base' | 'position'>, polygon: Polygon) => pointInPolygon(model.position, polygon) && edges(polygon).every(([a, b]) => pointSegmentDistance(model.position, a, b) >= baseRadius(model.base) - EPSILON);
export function segmentCrossParameters(a: Position, b: Position, c: Position, d: Position): number[] {
  const r = minus(b, a), s = minus(d, c), q = minus(c, a), determinant = cross(r, s);
  if (Math.abs(determinant) <= EPSILON) {
    if (Math.abs(cross(q, r)) > EPSILON) return [];
    const length2 = r.x ** 2 + r.y ** 2;
    if (!length2) return [];
    return [c, d].map(p => ((p.x - a.x) * r.x + (p.y - a.y) * r.y) / length2).filter(t => t >= 0 && t <= 1);
  }
  const t = cross(q, s) / determinant, u = cross(q, r) / determinant;
  return t >= -EPSILON && t <= 1 + EPSILON && u >= -EPSILON && u <= 1 + EPSILON ? [Math.max(0, Math.min(1, t))] : [];
}
export const interpolate = (a: Position, b: Position, t: number): Position3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: elevation(a) + (elevation(b) - elevation(a)) * t });
/** Exact segment intervals inside a simple polygonal prism, supporting concave footprints. */
export function prismIntervals(a: Position, b: Position, prism: TerrainPrism): [number, number][] {
  const cuts = [0, 1, ...edges(prism.footprint).flatMap(([c, d]) => segmentCrossParameters(a, b, c, d))];
  const dz = elevation(b) - elevation(a);
  if (Math.abs(dz) > EPSILON) for (const z of [prism.minZ, prism.maxZ]) { const t = (z - elevation(a)) / dz; if (t >= 0 && t <= 1) cuts.push(t); }
  cuts.sort((x, y) => x - y);
  const inside = (t: number) => { const p = interpolate(a, b, t); return p.z >= prism.minZ - EPSILON && p.z <= prism.maxZ + EPSILON && pointInPolygon(p, prism.footprint); };
  const intervals: [number, number][] = [];
  for (let i = 0; i < cuts.length - 1; i++) if (inside((cuts[i]! + cuts[i + 1]!) / 2)) intervals.push([cuts[i]!, cuts[i + 1]!]);
  // Tangent contact with closed solids counts as blocked as well.
  for (const t of cuts) if (inside(t)) intervals.push([t, t]);
  return intervals;
}
export function segmentNearPolygon(a: Position, b: Position, polygon: Polygon, radius: number): boolean {
  if (pointInPolygon(a, polygon) || pointInPolygon(b, polygon)) return true;
  return edges(polygon).some(([c, d]) => segmentCrossParameters(a, b, c, d).length ||
    Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b)) < radius - EPSILON);
}
export function intervalCovered(interval: [number, number], openings: [number, number][]): boolean {
  let cursor = interval[0];
  for (const [start, end] of [...openings].sort((a, b) => a[0] - b[0])) {
    if (end < cursor - EPSILON) continue;
    if (start > cursor + EPSILON) return false;
    cursor = Math.max(cursor, end); if (cursor >= interval[1] - EPSILON) return true;
  }
  return false;
}
export function rayIntersectsCylinder(a: Position, b: Position, model: Model): boolean {
  const dx = b.x - a.x, dy = b.y - a.y, x = a.x - model.position.x, y = a.y - model.position.y;
  const radius = baseRadius(model.base), aa = dx ** 2 + dy ** 2, bb = 2 * (x * dx + y * dy), cc = x ** 2 + y ** 2 - radius ** 2;
  let lo = 0, hi = 1;
  if (aa <= EPSILON) { if (cc > EPSILON) return false; }
  else {
    const disc = bb ** 2 - 4 * aa * cc; if (disc < -EPSILON) return false;
    const root = Math.sqrt(Math.max(0, disc)); lo = Math.max(lo, (-bb - root) / (2 * aa)); hi = Math.min(hi, (-bb + root) / (2 * aa));
  }
  const dz = elevation(b) - elevation(a), min = elevation(model.position), max = min + modelHeight(model);
  if (Math.abs(dz) <= EPSILON) { if (elevation(a) < min || elevation(a) > max) return false; }
  else { const t1 = (min - elevation(a)) / dz, t2 = (max - elevation(a)) / dz; lo = Math.max(lo, Math.min(t1, t2)); hi = Math.min(hi, Math.max(t1, t2)); }
  return lo <= hi + EPSILON;
}
/** Physical volume collision, not merely top-down footprint overlap. */
export function modelsOverlap(a: Model, b: Model): boolean {
  return centreDistance(a.position, b.position) < baseRadius(a.base) + baseRadius(b.base) - EPSILON &&
    elevation(a.position) < elevation(b.position) + modelHeight(b) - EPSILON && elevation(b.position) < elevation(a.position) + modelHeight(a) - EPSILON;
}
