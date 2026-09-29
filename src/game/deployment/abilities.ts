import { attachmentFor, modelDefinition } from '../attachments/queries';
import type { GameState, Model, Unit } from '../models';
import type { CoreAbility } from '../setup/types';
export function abilitiesFor(s: GameState, u: Unit, m: Model): readonly CoreAbility[] {
  const native=m.coreAbilities ?? modelDefinition(s,u,m).coreAbilities ?? [];
  const attachment=attachmentFor(s,u.id);
  const bodyguard=attachment?.components.find(c=>c.role==='BODYGUARD');
  const bodyguardDefinition=s.definitions.find(d=>d.id===bodyguard?.original.definitionId);
  if (!attachment || !bodyguardDefinition?.keywords.includes('BATTLELINE') || !bodyguardDefinition.keywords.includes('EMPERORS_CHILDREN') ||
      !modelDefinition(s,u,m).abilities.some(a=>a.id==='LORD_HOST') || m.componentUnitId===bodyguard?.original.id) return native;
  return [...native,{kind:'INFILTRATORS'},{kind:'SCOUTS',distance:6}];
}
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
