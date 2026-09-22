import { provablyCannotPlace } from './placementFeasibility';
import type { CommandResult, GameState, Model, Unit } from '../models';
import type { Formation, SetupConstraints } from '../setup/types';
import { validateSetup } from '../setup/SetupValidator';
import { basesOverlap, edgeDistance, baseRadius, centreDistance, EPSILON } from '../utils/geometry';
import { validateFinalPosition, failure } from '../rules/movement';
import type { PlacementSearchResult } from './types';
export function validateDisembarkFormation(s: GameState, u: Unit, transport: Model, formation: Formation, distance: number, constraints: SetupConstraints, allowedEngagedIds: readonly string[] = []): CommandResult<Unit> {
  const result = validateSetup(s, u, formation, constraints); if (!result.ok) return result;
  for (const m of result.value.models.filter(m => m.alive)) {
    if (basesOverlap(m, transport)) return failure('BASE_OVERLAP');
    if (Math.hypot(centreDistance(m.position, transport.position), (m.position.z ?? 0) - (transport.position.z ?? 0)) + baseRadius(m.base) - baseRadius(transport.base) > distance + EPSILON) return failure('TOO_FAR_FROM_TRANSPORT');
    if (s.units.filter(x => x.playerId !== u.playerId && (x.location ?? 'BATTLEFIELD') === 'BATTLEFIELD' && !allowedEngagedIds.includes(x.id)).some(x => x.models.some(e => e.alive && edgeDistance(m, e) <= s.spatialRules.engagementDistance + EPSILON))) return failure('ENEMY_ENGAGEMENT');
  }
  return result;
}
/** Deterministic bounded primitive placement search; never mistakes a search limit for impossibility.
 * Tangencies to circular bases and regular angular candidates; callers may stage any legal coordinates.
 */
export function searchDisembark(s: GameState, u: Unit, transport: Model, distance: number, constraints: SetupConstraints, allowed: readonly string[] = [], budget = 20000): PlacementSearchResult {
  const models = u.models.filter(m => m.alive), formation: Formation = {}; let visited = 0, exhausted = false;
  function visit(index: number): boolean {
    if (index === models.length) return validateDisembarkFormation(s, u, transport, formation, distance, constraints, allowed).ok;
    const m = models[index]!, min = baseRadius(transport.base) + baseRadius(m.base) + EPSILON * 2;
    const max = baseRadius(transport.base) + distance - baseRadius(m.base);
    const candidates: Formation[string][] = [];
    const placed = Object.entries(formation).map(([id, position]) => ({ ...models.find(x => x.id === id)!, position }));
    const blockers = [...s.units.filter(x => (x.location ?? 'BATTLEFIELD') === 'BATTLEFIELD').flatMap(x => x.models.filter(m => m.alive)), ...placed];
    for (let radius = min; radius <= max + EPSILON; radius += Math.max(.25, baseRadius(m.base))) {
      for (let i = 0; i < 64; i++) { const a = i * Math.PI / 32; candidates.push({ x: transport.position.x + Math.cos(a) * radius, y: transport.position.y + Math.sin(a) * radius, z: transport.position.z ?? 0 }); }
      for (const b of blockers) {
        const d = centreDistance(b.position, transport.position), r = baseRadius(b.base) + baseRadius(m.base) + EPSILON * 2;
        if (!d || d > radius + r || d < Math.abs(radius - r)) continue;
        const angle = Math.atan2(b.position.y - transport.position.y, b.position.x - transport.position.x), delta = Math.acos(Math.max(-1, Math.min(1, (radius * radius + d * d - r * r) / (2 * radius * d))));
        for (const a of [angle + delta, angle - delta]) candidates.push({ x: transport.position.x + Math.cos(a) * radius, y: transport.position.y + Math.sin(a) * radius, z: transport.position.z ?? 0 });
      }
    }
    candidates.sort((a, b) => centreDistance(a, transport.position) - centreDistance(b, transport.position));
    for (const p of candidates) {
      if (++visited > budget) { exhausted = true; return false; }
      const draftUnit = { ...u, location: 'BATTLEFIELD' as const, models: [...placed, { ...m, position: p }] };
      const draft = { ...s, units: s.units.map(x => x.id === u.id ? draftUnit : x) };
      if (!validateFinalPosition(draft, draftUnit, { ...m, position: p }, p, true).ok) continue;
      const single = { ...u, models: [{ ...m, position: p }] };
      if (!validateDisembarkFormation({ ...draft, units: draft.units.map(x => x.id === u.id ? single : x) }, single, transport, { [m.id]: p }, distance, constraints, allowed).ok) continue;
      formation[m.id] = p; if (visit(index + 1)) return true; delete formation[m.id]; if (exhausted) return false;
    }
    return false;
  }
  const found = visit(0);
  if (found) return { formation, exhausted: false };
  const impossibleModelIds = models.filter(m => provablyCannotPlace(s, u, m, transport, distance, allowed)).map(m => m.id);
  return { formation: null, exhausted: exhausted || !impossibleModelIds.length, impossibleModelIds };
}
