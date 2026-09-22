import type { GameState } from '../models';
import { capacityDefinition, remainingTransportCapacity } from './capacity';
import { historicalUnit, modelDefinition } from '../attachments/queries';
import { isFinitePosition } from '../utils/geometry';
/** Optional schema-3 extensions: absent fields retain the pre-transport interpretation. */
export function validateTransportState(s: GameState): void {
  const check = (value: unknown, label: string) => { if (!value) throw Error(`Invalid transport/attachment snapshot: ${label}`); };
  const positive = (n: number) => Number.isSafeInteger(n) && n > 0;
  for (const d of s.definitions) {
    if (d.transport) {
      const t = d.transport;
      check(positive(t.maximumModels) && d.modelCount === 1 && Array.isArray(t.allowedKeywords) && Array.isArray(t.excludedKeywords), 'capacity');
      check(t.firingDeck === undefined || (Number.isSafeInteger(t.firingDeck) && t.firingDeck >= 0), 'deck capacity');
      check(!t.modelCosts || t.modelCosts.every(c => positive(c.cost) && c.keywords.length), 'model cost');
    }
    if (d.attachment) check(['LEADER', 'SUPPORT'].includes(d.attachment.role) && d.attachment.canLeadDatasheetIds.every(id => s.definitions.some(x => x.id === id && !x.attachment)), 'attachment compatibility');
    check(d.invulnerableSave === undefined || (Number.isInteger(d.invulnerableSave) && d.invulnerableSave >= 2 && d.invulnerableSave <= 7), 'invulnerable save');
  }
  for (const u of s.units) {
    if (u.location === 'EMBARKED') {
      const e = u.embarked, parent = s.units.find(t => t.id === e?.transportId);
      check(e && parent && parent.playerId === u.playerId && parent.id !== u.id && capacityDefinition(s, parent) && parent.location !== 'EMBARKED' && parent.location !== 'DESTROYED', 'parent');
      check(e && positive(e.embarkedAtTurn) && e.embarkedAtTurn <= s.turn && typeof e.preBattle === 'boolean', 'embark history');
    } else check(!u.embarked, 'orphan embark record');
    if (capacityDefinition(s, u)) check(remainingTransportCapacity(s, u) >= 0, 'manifest capacity');
    for (const m of u.models) if (m.sourceDefinitionId || m.componentUnitId) {
      const record = s.attachments?.find(a => a.components.some(c => c.original.id === m.componentUnitId && c.original.definitionId === m.sourceDefinitionId && c.original.models.some(x => x.id === m.id)));
      check(record && (record.active ? record.id === u.id : m.componentUnitId === u.id), 'model provenance');
    }
  }
  const records = s.attachments ?? [];
  check(new Set(records.map(a => a.id)).size === records.length, 'duplicate attachment');
  for (const a of records) {
    check(a.components.filter(c => c.role === 'BODYGUARD').length === 1 && a.components.length > 1 && new Set(a.components.map(c => c.original.id)).size === a.components.length, 'components');
    check(a.active ? s.units.some(u => u.id === a.id) && !a.archivedRuntime : !!a.archivedRuntime && !s.units.some(u => u.id === a.id), 'attachment identity');
    check(a.destroyedComponentIds.every(id => a.components.some(c => c.original.id === id)) && a.pendingSplitBy.every(id => historicalUnit(s, id)), 'component history');
  }
  const ts = s.transportState;
  if (!ts) return;
  check(new Set(ts.destroyed.map(x => x.transportId)).size === ts.destroyed.length, 'duplicate emergency');
  for (const q of ts.destroyed) {
    const t = s.units.find(u => u.id === q.transportId);
    check(t && capacityDefinition(s, t) && t.models.every(m => !m.alive) && q.frozenModel.unitId === t.id && isFinitePosition(q.frozenModel.position), 'destroyed parent');
    check(q.remainingPassengerIds.length && new Set(q.remainingPassengerIds).size === q.remainingPassengerIds.length && q.remainingPassengerIds.every(id => s.units.some(u => u.id === id && u.embarked?.transportId === t!.id)), 'emergency queue');
  }
  if (ts.tacticalFollowUp) check(s.phase === 'Movement' && s.units.some(u => u.id === ts.tacticalFollowUp && u.location === 'BATTLEFIELD' && u.playerId === s.activePlayerId), 'tactical follow-up');
  if (ts.disembark) {
    const tx = ts.disembark, u = s.units.find(u => u.id === tx.unitId);
    check(u && u.location === 'EMBARKED' && u.embarked?.transportId === tx.transportId && ['TACTICAL', 'RAPID', 'COMBAT', 'EMERGENCY'].includes(tx.mode), 'transaction');
    check(Object.entries(tx.positions).every(([id, p]) => u!.models.some(m => m.id === id && m.alive) && isFinitePosition(p)), 'candidate positions');
    check(!['COMBAT', 'EMERGENCY'].includes(tx.mode) || !!tx.hazard, 'missing hazard');
  }
  for (const selection of s.shooting?.firingDeck ?? []) {
    const u = historicalUnit(s, selection.passengerUnitId), m = u?.models.find(m => m.id === selection.modelId);
    const original = u && m && modelDefinition(s, u, m).weapons.find(w => w.id === selection.weaponId);
    check(original && original.kind === 'ranged' && JSON.stringify({ ...original, id: selection.borrowed.id }) === JSON.stringify(selection.borrowed) && selection.borrowed.id === `deck:${m!.id}:${original.id}`, 'borrowed profile');
  }
}
