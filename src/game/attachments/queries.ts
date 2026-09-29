import type { Ability, GameState, Model, Unit, UnitDefinition } from '../models';
export const attachmentFor = (s: GameState, id: string) => s.attachments?.find(a => a.id === id && a.active);
export function modelDefinition(s: GameState, u: Unit, m: Model): UnitDefinition {
  const d = s.definitions.find(d => d.id === (m.sourceDefinitionId ?? u.definitionId)); if (!d) throw Error('Missing model definition'); return d;
}
export const modelKeywords = (s: GameState, u: Unit, m: Model) => modelDefinition(s, u, m).keywords.map(k => k.toUpperCase());
export function unitKeywords(s: GameState, u: Unit): string[] {
  return [...new Set(u.models.filter(m => m.alive).flatMap(m => modelKeywords(s, u, m)))];
}
export function attackToughness(s: GameState, u: Unit): number {
  const record = attachmentFor(s, u.id), bodyguard = record?.components.find(c => c.role === 'BODYGUARD');
  const living = u.models.filter(m => m.alive), bodyguards = living.filter(m => m.componentUnitId === bodyguard?.original.id);
  return Math.max(...(bodyguards.length ? bodyguards : living).map(m => m.toughness ?? m.stats?.toughness ?? modelDefinition(s, u, m).stats.toughness));
}
export function sourceAbilities(s: GameState, u: Unit): { sourceUnitId: string; modelIds: string[]; ability: Ability }[] {
  const record = attachmentFor(s, u.id);
  const sources = record?.components.map(c => c.original) ?? [u];
  const propagated = sources.flatMap(source => {
    const models = u.models.filter(m => !record || m.componentUnitId === source.id);
    const retained = record?.retainedSources.some(r => r.componentId === source.id);
    if (!models.some(m => m.alive) && !retained) return [];
    const d = s.definitions.find(d => d.id === source.definitionId)!;
    return d.abilities.filter(a => (u.location !== 'EMBARKED' || a.whileEmbarked) && (!a.whileLeading || !!record || !!u.startedBattleAttached)).map(ability => ({ sourceUnitId: source.id,
      modelIds: ability.scope === 'MODEL' ? models.filter(m => m.alive || retained).map(m => m.id) : u.models.filter(m => m.alive).map(m => m.id), ability }));
  });
  const individual = u.models.filter(m => m.alive).flatMap(m => (m.abilities ?? []).filter(a => u.location !== 'EMBARKED' || a.whileEmbarked).map(a => ({ sourceUnitId: m.componentUnitId ?? u.id, modelIds: [m.id], ability: { ...a, scope: 'MODEL' as const } })));
  const viaDeck = s.shooting?.unitId === u.id ? [...new Set(s.shooting.firingDeck?.map(x => x.passengerUnitId) ?? [])].flatMap(id => {
    const passenger = s.units.find(x => x.id === id)!;
    return sourceAbilities(s, passenger).filter(x => x.ability.viaFiringDeck && x.ability.whileEmbarked).map(x => ({ ...x, modelIds: u.models.filter(m => m.alive).map(m => m.id) }));
  }) : [];
  return [...propagated, ...individual, ...viaDeck];
}
export function sourceModifier(s: GameState, unitId: string, characteristic: string, modelId?: string) {
  const u = s.units.find(u => u.id === unitId); if (!u) return 0;
  return sourceAbilities(s, u).reduce((n, x) => n + (x.ability.effect?.kind === 'MODIFIER' && x.ability.effect.characteristic === characteristic && (x.ability.scope !== 'MODEL' || (!!modelId && x.modelIds.includes(modelId))) ? x.ability.effect.value : 0), 0);
}
export function sourceFlag(s: GameState, unitId: string, flag: string): boolean | undefined {
  const u = s.units.find(u => u.id === unitId); if (!u) return;
  const a = sourceAbilities(s, u).find(x => x.ability.scope !== 'MODEL' && x.ability.effect?.kind === 'FLAG' && x.ability.effect.flag === flag)?.ability;
  return a?.effect?.kind === 'FLAG' ? a.effect.value : undefined;
}
export const historicalUnit = (s: GameState, id: string): Unit | undefined => s.units.find(u => u.id === id) ?? s.attachments?.flatMap(a => [...a.components.map(c => c.original), ...(a.archivedRuntime ? [a.archivedRuntime] : [])]).find(u => u.id === id);
export function modelHasWeapon(s: GameState, u: Unit, m: Model, weaponId: string) {
  return modelDefinition(s, u, m).weapons.some(w => (!m.weaponIds || m.weaponIds.includes(w.id)) &&
    weaponId === (m.componentUnitId && attachmentFor(s, u.id) ? `${m.componentUnitId}:${w.id}` : w.id));
}
