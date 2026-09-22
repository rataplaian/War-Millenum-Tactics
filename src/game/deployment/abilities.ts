import { modelDefinition } from '../attachments/queries';
import type { GameState, Model, Unit } from '../models';
import type { CoreAbility } from '../setup/types';
export const abilitiesFor = (s: GameState, u: Unit, m: Model): readonly CoreAbility[] => m.coreAbilities ?? modelDefinition(s, u, m).coreAbilities ?? [];
export function allHave(s: GameState, u: Unit, kind: CoreAbility['kind']): boolean {
  const native = u.models.filter(m => m.alive);
  if (native.length && native.every(m => abilitiesFor(s, u, m).some(a => a.kind === kind))) return true;
  if (kind === 'SCOUTS' && s.definitions.find(d => d.id === u.definitionId)?.transport?.dedicated) {
    const embarked = s.units.filter(x => x.location === 'EMBARKED' && x.embarked?.transportId === u.id);
    if (embarked.length) return embarked.every(x => allHave(s, x, 'SCOUTS'));
  }
  const models = u.models.filter(m => m.alive);
  return !!models.length && models.every(m => abilitiesFor(s, u, m).some(a => a.kind === kind));
}
export function scoutDistance(s: GameState, u: Unit): number {
  if (!allHave(s, u, 'SCOUTS')) return 0;
  const native = u.models.filter(m => m.alive);
  if (native.every(m => abilitiesFor(s, u, m).some(a => a.kind === 'SCOUTS'))) return Math.min(...native.map(m => Math.max(...abilitiesFor(s, u, m).filter(a => a.kind === 'SCOUTS').map(a => a.distance))));
  if (s.definitions.find(d => d.id === u.definitionId)?.transport?.dedicated) { const embarked = s.units.filter(x => x.location === 'EMBARKED' && x.embarked?.transportId === u.id); if (embarked.length) return Math.min(...embarked.map(x => scoutDistance(s, x))); }
  return Math.min(...u.models.filter(m => m.alive).map(m => Math.max(...abilitiesFor(s, u, m).filter(a => a.kind === 'SCOUTS').map(a => a.distance))));
}
