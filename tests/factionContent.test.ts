import test from 'node:test';
import assert from 'node:assert/strict';
import { PROTOTYPE_UNITS } from '../src/game/data/prototype';
import { FactionContentRegistry } from '../src/game/content/FactionContentRegistry';
import { validatePresetRoster } from '../src/game/content/validatePresetRoster';
import type { FactionContent, PresetRoster } from '../src/game/content/types';

/** These invented catalog entries test structure only; they are never published as faction data. */
function fixture() {
  const troop = { ...PROTOTYPE_UNITS[0]!, id: 'troop', modelCount: 5, placeholder: false, points: 100,
    keywords: ['INFANTRY', 'BATTLELINE'], abilities: [] };
  const leader = { ...PROTOTYPE_UNITS[0]!, id: 'leader', modelCount: 1, placeholder: false, points: 70,
    keywords: ['INFANTRY', 'CHARACTER'], attachment: { role: 'LEADER' as const, canLeadDatasheetIds: ['troop'] }, abilities: [] };
  const transport = { ...PROTOTYPE_UNITS[0]!, id: 'carrier', modelCount: 1, placeholder: false, points: 80,
    keywords: ['VEHICLE'], transport: { maximumModels: 6, allowedKeywords: ['INFANTRY'], excludedKeywords: ['JUMP_PACK'],
      modelCosts: [{ keywords: ['HEAVY'], cost: 2 }] }, abilities: [] };
  const faction: FactionContent = { id: 'aeldari', name: 'Synthetic fixture', armyRuleId: 'test-rule',
    sources: { edition: 11, snapshotDate: '2026-09-25', factionPackVersion: 'synthetic', munitorumUpdateDate: 'synthetic', rulesUpdateVersion: 'synthetic', notes: 'Test only' },
    datasheets: [troop, leader, transport], abilities: [], detachments: [{ id: 'test', ruleId: 'test-rule', detachmentPoints: 2,
      forceDisposition: 'TAKE_AND_HOLD', enhancements: [{ id: 'upgrade', points: 15 }], stratagems: [] }] };
  const roster: PresetRoster = { id: 'fixture', factionId: 'aeldari', battleSize: 'INCURSION', pointsLimit: 1000,
    detachmentId: 'test', detachmentPointsLimit: 2, forceDisposition: 'TAKE_AND_HOLD', warlordUnitId: 'leader-1', enhancementLimit: 1,
    units: [{ id: 'troop-1', datasheetId: 'troop' }, { id: 'leader-1', datasheetId: 'leader', enhancementId: 'upgrade' },
      { id: 'carrier-1', datasheetId: 'carrier' }],
    attachments: [{ id: 'joined', bodyguardId: 'troop-1', leaderIds: ['leader-1'] }],
    embarked: [{ transportId: 'carrier-1', passengerIds: ['joined'] }] };
  return { faction, roster };
}

test('registry resolves only registered content; legal attached passenger consumes capacity and points', () => {
  const { faction, roster } = fixture(), registry = new FactionContentRegistry();
  registry.register(faction, [roster]);
  assert.equal(registry.datasheet('troop')?.name, faction.datasheets[0]!.name);
  assert.equal(registry.weapon('troop', 'test-rifle')?.name, faction.datasheets[0]!.weapons[0]!.name);
  assert.equal(registry.detachment('test')?.forceDisposition, 'TAKE_AND_HOLD');
  assert.equal(registry.enhancement('upgrade')?.points, 15);
  assert.equal(registry.preset('fixture')?.warlordUnitId, 'leader-1');
  assert.deepEqual(validatePresetRoster(faction, roster), { valid: true, totalPoints: 265, errors: [] });
  assert.throws(() => registry.register(faction));
});

test('roster rejects invalid attachments, transport capacity, disposition and missing verified points', () => {
  const { faction, roster } = fixture();
  const incompatible = { ...faction, datasheets: faction.datasheets.map(d => d.id === 'leader' ?
    { ...d, attachment: { role: 'LEADER' as const, canLeadDatasheetIds: [] } } : d) };
  assert.ok(validatePresetRoster(incompatible, roster).errors.some(e => e.includes('Illegal attachment')));
  const capacity = { ...faction, datasheets: faction.datasheets.map(d => d.id === 'carrier' ?
    { ...d, transport: { ...d.transport!, maximumModels: 5 } } : d) };
  assert.ok(validatePresetRoster(capacity, roster).errors.some(e => e.includes('Transport capacity exceeded')));
  assert.ok(validatePresetRoster(faction, { ...roster, forceDisposition: 'DISRUPTION' }).errors.some(e => e.includes('detachment')));
  assert.equal(validatePresetRoster(faction, { ...roster, pointsLimit: 1001 }).valid, false);
  const unknown = { ...faction, datasheets: faction.datasheets.map(d => d.id === 'leader' ? { ...d, points: undefined } : d) };
  assert.equal(validatePresetRoster(unknown, roster).totalPoints, null);
});
