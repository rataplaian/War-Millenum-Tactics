import assert from 'node:assert/strict';
import test from 'node:test';
import { VERIFIED_ENHANCEMENTS, VERIFIED_MUSTER_ENTRIES, VERIFIED_MUSTER_PLANS, verifiedMusterPoints } from '../src/game/content/verifiedEntries';

test('all selected datasheets have a unique 11th-edition source and a valid fixed size/price', () => {
  assert.equal(VERIFIED_MUSTER_ENTRIES.length, 19);
  assert.equal(new Set(VERIFIED_MUSTER_ENTRIES.map(e => `${e.factionId}/${e.id}`)).size, 19);
  for (const entry of VERIFIED_MUSTER_ENTRIES) {
    assert.match(entry.source, /^https:\/\/www\.newrecruit\.eu\/wiki\/wh40k-11e\//);
    assert.ok(Number.isSafeInteger(entry.models) && entry.models > 0);
    assert.ok(Number.isSafeInteger(entry.points) && entry.points > 0);
  }
});

test('point checks reflect actual selected sizes and require a smaller Aeldari squad', () => {
  assert.equal(verifiedMusterPoints('AELDARI'), 935);
  assert.equal(verifiedMusterPoints('EMPERORS_CHILDREN'), 975);
  assert.equal(verifiedMusterPoints('EMPERORS_CHILDREN') + VERIFIED_ENHANCEMENTS.FAULTLESS_OPPORTUNIST.points, 990);
  assert.equal(verifiedMusterPoints('AELDARI') + 75, 1010); // Replace five Avengers with ten.
  assert.ok(verifiedMusterPoints('AELDARI') + VERIFIED_ENHANCEMENTS.BREATH_OF_VAUL.points <= 1000);
});

test('proposed formations reference roster entries once and fit sourced transport capacities', () => {
  for (const plan of VERIFIED_MUSTER_PLANS) {
    const entries = VERIFIED_MUSTER_ENTRIES.filter(e => e.factionId === plan.factionId);
    const units = new Map(entries.map(e => [e.id, e]));
    assert.ok(units.has(plan.warlordId));
    const used = new Set<string>();
    for (const formation of plan.attachments) {
      assert.ok(units.has(formation.bodyguardId));
      for (const id of [formation.bodyguardId, ...formation.leaderIds, ...(formation.supportIds ?? [])]) {
        assert.ok(units.has(id));
        assert.ok(!used.has(id));
        used.add(id);
      }
    }
    for (const manifest of plan.embarked) {
      assert.ok(units.has(manifest.transportId));
      let occupied = 0;
      for (const id of manifest.passengerIds) {
        const formation = plan.attachments.find(a => a.id === id);
        const components = formation ? [formation.bodyguardId, ...formation.leaderIds, ...(formation.supportIds ?? [])] : [id];
        for (const componentId of components) {
          const entry = units.get(componentId);
          assert.ok(entry, componentId);
          occupied += entry.models * (manifest.transportId === 'chaos-land-raider' && componentId === 'flawless-blades' ? 2 : 1);
        }
      }
      const maximum = manifest.transportId === 'chaos-land-raider' ? 14 : 12;
      assert.ok(occupied <= maximum, `${manifest.transportId}: ${occupied}/${maximum}`);
    }
  }
});
