import type { CommandResult, GameState, Unit, UnitDefinition } from '../models';
import type { AttachmentAssignment, AttachmentPolicy, AttachmentRecord } from './types';
import { failure } from '../rules/movement';
import { flowEvent } from '../flow/events';
import { allHave } from '../deployment/abilities';
const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x));
export function validateRoster(s: GameState): CommandResult {
  if (s.units.some(u => s.definitions.find(d => d.id === u.definitionId)?.attachment?.role === 'SUPPORT' && !u.startedBattleAttached)) return failure('SUPPORT_REQUIRES_BODYGUARD');
  return { ok: true, value: undefined };
}
export function formAttachments(s: GameState, assignments: readonly AttachmentAssignment[], policy: AttachmentPolicy = {}): CommandResult {
  if (s.deployment?.stage !== 'PRE_BATTLE' || s.events.length || s.flow?.started) return failure('WRONG_PRE_BATTLE_STEP');
  if (new Set(assignments.map(a => a.id)).size !== assignments.length) return failure('INVALID_ATTACHMENT');
  const taken = new Set<string>();
  for (const a of assignments) {
    const ids = [a.bodyguardId, ...(a.leaderIds ?? []), ...(a.supportIds ?? [])], units = ids.map(id => s.units.find(u => u.id === id));
    if (!a.id || s.units.some(u => u.id === a.id) || units.some(u => !u) || ids.some(id => taken.has(id)) || new Set(ids).size !== ids.length) return failure('INVALID_ATTACHMENT');
    const body = units[0]!, bd = s.definitions.find(d => d.id === body.definitionId)!;
    if (units.some(u => u!.startedBattleAttached) || bd.attachment || (a.leaderIds?.length ?? 0) > (policy.maxLeaders ?? 1) || (a.supportIds?.length ?? 0) > (policy.maxSupports ?? 1) || ids.length === 1) return failure('INVALID_ATTACHMENT');
    for (let i = 1; i < units.length; i++) {
      const u = units[i]!, d = s.definitions.find(d => d.id === u.definitionId)!, role = a.leaderIds?.includes(u.id) ? 'LEADER' : 'SUPPORT';
      if (u.playerId !== body.playerId || d.attachment?.role !== role || !d.attachment.canLeadDatasheetIds.includes(body.definitionId)) return failure('INVALID_ATTACHMENT');
    }
    ids.forEach(id => taken.add(id));
  }
  for (const a of assignments) {
    const ids = [a.bodyguardId, ...(a.leaderIds ?? []), ...(a.supportIds ?? [])], units = ids.map(id => s.units.find(u => u.id === id)!);
    const definitions = units.map(u => s.definitions.find(d => d.id === u.definitionId)!);
    const d: UnitDefinition = { ...copy(definitions[0]!), id: `attached-definition:${a.id}`, name: definitions.map(d => d.name).join(' + '),
      modelCount: definitions.reduce((n, d) => n + d.modelCount, 0), points: definitions.reduce((n, d) => n + (d.points ?? 0), 0),
      stats: { ...definitions[0]!.stats, wounds: Math.max(...definitions.map(d => d.stats.wounds)) },
      keywords: [...new Set(definitions.flatMap(d => [...d.keywords]))], abilities: [], coreAbilities: [],
      weapons: units.flatMap((u, i) => definitions[i]!.weapons.map(w => ({ ...copy(w), id: `${u.id}:${w.id}` }))) };
    // Mixed profiles belong to each original datasheet; the attached unit has heterogeneous components.
    delete (d as { modelProfiles?: UnitDefinition['modelProfiles'] }).modelProfiles;
    const runtime: Unit = { ...copy(units[0]!), id: a.id, definitionId: d.id, startedBattleAttached: true,
      models: units.flatMap(u => u.models.map(m => ({ ...copy(m), unitId: a.id, componentUnitId: u.id, sourceDefinitionId: u.definitionId }))) };
    s.attachments ??= []; s.attachments.push({ id: a.id, active: true, components: units.map((u, i) => ({ role: i === 0 ? 'BODYGUARD' : a.leaderIds?.includes(u.id) ? 'LEADER' : 'SUPPORT', original: copy(u) })), destroyedComponentIds: [], retainedSources: [], pendingSplitBy: [] });
    s.definitions = [...s.definitions, d]; s.units = [...s.units.filter(u => !ids.includes(u.id)), runtime];
    s.armies.forEach(army => { if (army.playerId === runtime.playerId) army.unitIds = [...army.unitIds.filter(id => !ids.includes(id)), a.id]; });
    flowEvent(s, 'ATTACHED_UNIT_FORMED', { componentIds: ids }, a.id, runtime.playerId);
  }
  return validateRoster(s);
}
function split(s: GameState, a: AttachmentRecord, u: Unit) {
  const survivors: Unit[] = a.components.map(c => {
    const models = u.models.filter(m => m.componentUnitId === c.original.id).map(m => ({ ...copy(m), unitId: c.original.id }));
    return { ...copy(c.original), ...copy(u), id: c.original.id, definitionId: c.original.definitionId, models, startedBattleAttached: true,
      resourceCounters: c.role === 'BODYGUARD' ? copy(u.resourceCounters ?? {}) : copy(c.original.resourceCounters ?? {}),
      location: models.some(m => m.alive) ? u.location : 'DESTROYED' };
  });
  for (const unit of survivors) if (unit.location === 'DESTROYED') { delete unit.embarked; delete unit.moveLock; }
  a.archivedRuntime = copy(u); a.active = false; a.pendingSplitBy = []; a.retainedSources = [];
  s.units = [...s.units.filter(x => x.id !== u.id), ...survivors];
  s.armies.forEach(army => { if (army.playerId === u.playerId) army.unitIds = [...army.unitIds.filter(id => id !== u.id), ...survivors.map(x => x.id)]; });
  for (const effect of [...(s.flow?.effects ?? [])].filter(e => e.active && e.target.unitId === u.id)) {
    effect.active = false;
    for (const unit of survivors.filter(x => x.models.some(m => m.alive))) s.flow!.effects.push({ ...copy(effect), id: `effect-${s.flow!.nextEffectId++}`, active: true, target: { unitId: unit.id } });
  }
  if (s.deployment) for (const key of ['deployed', 'initialReserveIds', 'scoutDone'] as const) if (s.deployment[key].includes(u.id)) s.deployment[key] = [...s.deployment[key].filter(id => id !== u.id), ...survivors.map(x => x.id)];
  if (s.deployment?.choices[u.id]) { const choice = s.deployment.choices[u.id]!; delete s.deployment.choices[u.id]; for (const x of survivors) if (allHave(s, x, choice)) s.deployment.choices[x.id] = choice; }
  const fight = s.closeCombat?.fight;
  if (fight) for (const key of ['pileInDone', 'eligibleAtFightStart', 'engagedAtFightStart', 'fought', 'consolidateDone'] as const) fight[key] = fight[key].flatMap(id => id === u.id ? survivors.filter(x => x.models.some(m => m.alive)).map(x => x.id) : [id]);
  if (s.closeCombat) s.closeCombat.effects = s.closeCombat.effects.flatMap(e => e.unitId === u.id ? survivors.filter(x => x.models.some(m => m.alive)).map(x => ({ ...e, unitId: x.id })) : [e]);
  for (const tx of s.transportState?.destroyed ?? []) tx.remainingPassengerIds = tx.remainingPassengerIds.flatMap(id => id === u.id ? survivors.filter(x => x.models.some(m => m.alive)).map(x => x.id) : [id]);
  flowEvent(s, 'ATTACHED_UNIT_SPLIT', { componentIds: survivors.map(x => x.id) }, u.id, u.playerId);
  for (const c of a.components.filter(c => c.role !== 'BODYGUARD')) if (survivors.find(x => x.id === c.original.id)!.models.some(m => m.alive)) flowEvent(s, c.role === 'LEADER' ? 'LEADER_SEPARATED' : 'SUPPORT_SEPARATED', {}, c.original.id, u.playerId);
}
export function processAttachmentCasualties(s: GameState, attackerId?: string) {
  for (const a of s.attachments?.filter(a => a.active) ?? []) {
    const u = s.units.find(u => u.id === a.id)!;
    for (const c of a.components) if (!u.models.some(m => m.componentUnitId === c.original.id && m.alive) && !a.destroyedComponentIds.includes(c.original.id)) {
      a.destroyedComponentIds.push(c.original.id);
      if (attackerId) a.retainedSources.push({ componentId: c.original.id, attackerId });
      flowEvent(s, 'ATTACHED_COMPONENT_DESTROYED', { componentId: c.original.id, keywords: [...s.definitions.find(d => d.id === c.original.definitionId)!.keywords] }, u.id, u.playerId);
    }
    const bodyAlive = a.components.some(c => c.role === 'BODYGUARD' && !a.destroyedComponentIds.includes(c.original.id));
    const attachedAlive = a.components.some(c => c.role !== 'BODYGUARD' && !a.destroyedComponentIds.includes(c.original.id));
    if (!bodyAlive || !attachedAlive) {
      if (attackerId) { if (!a.pendingSplitBy.includes(attackerId)) a.pendingSplitBy.push(attackerId); }
      else if (!a.pendingSplitBy.length) split(s, a, u);
    }
  }
}
export function finishAttacker(s: GameState, attackerId: string) {
  for (const a of s.attachments?.filter(a => a.active) ?? []) {
    a.retainedSources = a.retainedSources.filter(x => x.attackerId !== attackerId);
    const pending = a.pendingSplitBy.includes(attackerId); a.pendingSplitBy = a.pendingSplitBy.filter(id => id !== attackerId);
    if (pending && !a.pendingSplitBy.length) split(s, a, s.units.find(u => u.id === a.id)!);
  }
}
