import type { UnitDefinition } from '../models';
import type { FactionContent, PresetRoster, RosterValidation } from './types';

/** Static muster validation. Battle placement still belongs to Task 006/008. */
export function validatePresetRoster(content: FactionContent, roster: PresetRoster): RosterValidation {
  const errors: string[] = [], report = (message: string) => { errors.push(message); };
  const catalog = new Map(content.datasheets.map(d => [d.id, d]));
  const units = new Map(roster.units.map(u => [u.id, u]));
  const definition = (id: string): UnitDefinition | undefined => catalog.get(units.get(id)?.datasheetId ?? '');
  const detachment = content.detachments.find(d => d.id === roster.detachmentId);
  if (roster.factionId !== content.id || roster.battleSize !== 'INCURSION' || !Number.isSafeInteger(roster.pointsLimit) || roster.pointsLimit < 1 || roster.pointsLimit > 1000 ||
      !Number.isSafeInteger(roster.enhancementLimit) || roster.enhancementLimit < 0 || !Number.isSafeInteger(roster.detachmentPointsLimit) || roster.detachmentPointsLimit < 0) report('Invalid roster configuration');
  if (!detachment || detachment.forceDisposition !== roster.forceDisposition || detachment.detachmentPoints > roster.detachmentPointsLimit) report('Invalid detachment or force disposition');
  if (!roster.units.length || units.size !== roster.units.length || roster.units.some(u => !u.id || !catalog.has(u.datasheetId))) report('Missing or duplicate roster units');
  let total = 0, known = true;
  const enhancements = new Set<string>();
  for (const u of roster.units) {
    const d = definition(u.id);
    if (!d || d.placeholder || !Number.isSafeInteger(d.modelCount) || d.modelCount < 1) { known = false; report(`Missing verified datasheet: ${u.id}`); continue; }
    if (!Number.isSafeInteger(d.points) || d.points! < 0) { known = false; report(`Missing verified points: ${d.id}`); }
    else total += d.points!;
    if (u.enhancementId) {
      const enhancement = detachment?.enhancements.find(e => e.id === u.enhancementId);
      if (!d.keywords.some(k => k.toUpperCase() === 'CHARACTER') || !enhancement || enhancements.has(u.enhancementId)) report(`Illegal enhancement: ${u.id}`);
      else if (!Number.isSafeInteger(enhancement.points) || enhancement.points < 0) { known = false; report(`Missing verified enhancement points: ${enhancement.id}`); }
      else total += enhancement.points;
      enhancements.add(u.enhancementId);
    }
    for (const ability of d.abilities) if (!content.abilities.some(a => a.id === ability.id && a.resolverId)) report(`Unregistered ability: ${ability.id}`);
  }
  if (enhancements.size > roster.enhancementLimit) report('Enhancement limit exceeded');
  if (!units.has(roster.warlordUnitId) ||
      !definition(roster.warlordUnitId)?.keywords.some(k => k.toUpperCase() === 'CHARACTER')) report('Invalid Warlord');
  for (const id of new Set(roster.units.map(u => u.datasheetId))) {
    const maximum = catalog.get(id)?.keywords.some(k => k.toUpperCase() === 'BATTLELINE') ? 6 : 3;
    if (roster.units.filter(u => u.datasheetId === id).length > maximum) report(`Too many units of ${id}`);
  }
  const attached = new Set<string>();
  for (const a of roster.attachments) {
    const body = definition(a.bodyguardId), ids = [...(a.leaderIds ?? []), ...(a.supportIds ?? [])];
    if (!a.id || !body || !ids.length || (a.leaderIds?.length ?? 0) > 1 || (a.supportIds?.length ?? 0) > 1 ||
        new Set([a.bodyguardId, ...ids]).size !== ids.length + 1) { report(`Invalid attachment: ${a.id}`); continue; }
    for (const id of [a.bodyguardId, ...ids]) {
      if (attached.has(id)) report(`Unit attached twice: ${id}`);
      attached.add(id);
    }
    for (const id of ids) {
      const d = definition(id), role = a.leaderIds?.includes(id) ? 'LEADER' : 'SUPPORT';
      if (!d || d.attachment?.role !== role || !d.attachment.canLeadDatasheetIds.includes(body.id)) report(`Illegal attachment: ${id}`);
    }
  }
  for (const u of roster.units) if (definition(u.id)?.attachment?.role === 'SUPPORT' && !attached.has(u.id)) report(`Unattached support: ${u.id}`);
  const occupant = new Set<string>(), usedTransports = new Set<string>();
  for (const manifest of roster.embarked) {
    const transport = definition(manifest.transportId), capacity = transport?.transport;
    let used = 0;
    if (!capacity || !manifest.passengerIds.length || usedTransports.has(manifest.transportId)) { report(`Invalid transport: ${manifest.transportId}`); continue; }
    usedTransports.add(manifest.transportId);
    for (const id of manifest.passengerIds) {
      if (occupant.has(id)) report(`Passenger embarked twice: ${id}`);
      occupant.add(id);
      const assignment = roster.attachments.find(a => a.id === id);
      if (attached.has(id) || (!assignment && !units.has(id))) { report(`Invalid passenger: ${id}`); continue; }
      const componentIds = assignment ? [assignment.bodyguardId, ...(assignment.leaderIds ?? []), ...(assignment.supportIds ?? [])] : [id];
      for (const componentId of componentIds) {
        const d = definition(componentId); if (!d) { report(`Unknown passenger component: ${componentId}`); continue; }
        const keys = d.keywords.map(k => k.toUpperCase());
        if ((capacity.allowedKeywords.length && !capacity.allowedKeywords.some(k => keys.includes(k.toUpperCase()))) ||
            capacity.excludedKeywords.some(k => keys.includes(k.toUpperCase()))) report(`Incompatible passenger: ${componentId}`);
        used += d.modelCount * Math.max(1, ...(capacity.modelCosts ?? []).filter(c => c.keywords.some(k => keys.includes(k.toUpperCase()))).map(c => c.cost));
      }
    }
    if (used > capacity.maximumModels) report(`Transport capacity exceeded: ${manifest.transportId}`);
  }
  if (known && total > roster.pointsLimit) report(`Points limit exceeded: ${total}/${roster.pointsLimit}`);
  return { valid: errors.length === 0 && known, totalPoints: known ? total : null, errors };
}
