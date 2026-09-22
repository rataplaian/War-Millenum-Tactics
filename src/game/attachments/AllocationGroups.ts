import type { GameState, Model, Unit } from '../models';
import { modelDefinition, modelKeywords } from './queries';
export interface AllocationGroup { id: string; modelIds: string[]; character: boolean; wounded: boolean; wounds: number; save: number; invulnerableSave?: number }
export function allocationGroups(s: GameState, u: Unit): AllocationGroup[] {
  const groups: AllocationGroup[] = [];
  for (const m of u.models.filter(m => m.alive)) {
    const d = modelDefinition(s, u, m), character = modelKeywords(s, u, m).includes('CHARACTER');
    const id = character ? m.id : `normal:${d.stats.wounds}:${d.stats.save}:${d.invulnerableSave ?? '-'}`;
    let group = groups.find(g => g.id === id);
    if (!group) { group = { id, character, modelIds: [], wounded: false, wounds: d.stats.wounds, save: d.stats.save, ...(d.invulnerableSave ? { invulnerableSave: d.invulnerableSave } : {}) }; groups.push(group); }
    group.modelIds.push(m.id); group.wounded ||= m.woundsRemaining < d.stats.wounds;
  }
  return groups.sort((a, b) => Number(a.character) - Number(b.character) || Number(b.wounded) - Number(a.wounded));
}
export function allocationModel(s: GameState, u: Unit, precisionModelId?: string): Model | undefined {
  const groups = allocationGroups(s, u), group = groups.find(g => g.character && g.modelIds.includes(precisionModelId ?? '')) ?? groups[0];
  if (!group) return;
  const models = u.models.filter(m => group.modelIds.includes(m.id));
  return models.find(m => m.woundsRemaining < modelDefinition(s, u, m).stats.wounds) ?? models[0];
}
