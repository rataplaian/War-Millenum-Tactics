import type { CommandResult, GameState, Unit } from '../models';
import { modelKeywords } from '../attachments/queries';
import { failure } from '../rules/movement';
export const passengers = (s: GameState, transportId: string) => s.units.filter(u => u.location === 'EMBARKED' && u.embarked?.transportId === transportId && u.models.some(m => m.alive));
export const capacityDefinition = (s: GameState, t: Unit) => s.definitions.find(d => d.id === t.definitionId)?.transport;
export function passengerCost(s: GameState, t: Unit, u: Unit): number {
  const d = capacityDefinition(s, t); if (!d) return Infinity;
  return u.models.filter(m => m.alive).reduce((n, m) => {
    const keys = modelKeywords(s, u, m);
    return n + Math.max(1, ...(d.modelCosts ?? []).filter(r => r.keywords.some(k => keys.includes(k.toUpperCase()))).map(r => r.cost));
  }, 0);
}
export function remainingTransportCapacity(s: GameState, t: Unit): number {
  const d = capacityDefinition(s, t); return d ? d.maximumModels - passengers(s, t.id).reduce((n, u) => n + passengerCost(s, t, u), 0) : 0;
}
export function canEmbarkUnit(s: GameState, t: Unit, u: Unit): CommandResult {
  const d = capacityDefinition(s, t); if (!d || t.models.filter(m => m.alive).length !== 1) return failure('NOT_TRANSPORT');
  if (t.id === u.id || t.playerId !== u.playerId || !u.models.some(m => m.alive) || capacityDefinition(s, u) || u.location === 'EMBARKED') return failure('INVALID_PASSENGER');
  for (const m of u.models.filter(m => m.alive)) {
    const keys = modelKeywords(s, u, m);
    if ((d.allowedKeywords.length && !d.allowedKeywords.some(k => keys.includes(k.toUpperCase()))) || d.excludedKeywords.some(k => keys.includes(k.toUpperCase()))) return failure('INVALID_PASSENGER');
  }
  if (passengerCost(s, t, u) > remainingTransportCapacity(s, t)) return failure('TRANSPORT_CAPACITY');
  return { ok: true, value: undefined };
}
