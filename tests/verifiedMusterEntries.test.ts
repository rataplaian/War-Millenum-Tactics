import assert from 'node:assert/strict';
import test from 'node:test';
import { VERIFIED_ENHANCEMENTS, VERIFIED_MUSTER_ENTRIES, verifiedMusterPoints } from '../src/game/content/verifiedEntries';

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
