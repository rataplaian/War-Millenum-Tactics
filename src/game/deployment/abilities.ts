import type { GameState, Model, Unit } from '../models';
import type { CoreAbility } from '../setup/types';
export const abilitiesFor = (s: GameState, u: Unit, m: Model): readonly CoreAbility[] => m.coreAbilities ?? s.definitions.find(d => d.id === u.definitionId)!.coreAbilities ?? [];
export function allHave(s: GameState, u: Unit, kind: CoreAbility['kind']): boolean {
  const models = u.models.filter(m => m.alive);
  return !!models.length && models.every(m => abilitiesFor(s, u, m).some(a => a.kind === kind));
}
export function scoutDistance(s: GameState, u: Unit): number {
  if (!allHave(s, u, 'SCOUTS')) return 0;
  return Math.min(...u.models.filter(m => m.alive).map(m => Math.max(...abilitiesFor(s, u, m).filter(a => a.kind === 'SCOUTS').map(a => a.distance))));
}
