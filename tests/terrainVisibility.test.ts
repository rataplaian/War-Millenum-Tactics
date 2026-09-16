import test from 'node:test';
import assert from 'node:assert/strict';
import { createVisibilityProvider } from '../src/game/terrain/visibility';
import { isModelHidden, isObscuring } from '../src/game/terrain/rules';
import { benefitOfCover, plungingFire, shootingModifiers, applySkillModifiers } from '../src/game/terrain/attackModifiers';
import { terrainState, feature, areaOnly, observer, target } from './terrain.helpers';
import { rectangle } from '../src/game/terrain/geometry';
import { createUnit } from '../src/game/engine/createUnit';

test('clear primitive LOS is fully visible for models and units', () => {
  const s = terrainState(), p = createVisibilityProvider(s); assert.equal(p.hasLineOfSight(observer(s), target(s)), true);
  assert.equal(p.inspect(observer(s), target(s)).level, 'FULLY_VISIBLE'); assert.equal(p.isUnitFullyVisible(observer(s), s.units[1]!), true);
});
test('low intervening geometry produces partial LOS distinct from full visibility', () => {
  const s = terrainState(); feature(s, 'EXPOSED', 12, 3, 1, 4, 1.2);
  const p = createVisibilityProvider(s); assert.equal(p.inspect(observer(s), target(s)).level, 'VISIBLE'); assert.equal(p.isUnitFullyVisible(observer(s), s.units[1]!), false);
});
test('a tall wall blocks every primitive ray', () => {
  const s = terrainState(); feature(s, 'EXPOSED', 12, 3, 1, 4, 4);
  const p = createVisibilityProvider(s); assert.equal(p.inspect(observer(s), target(s)).level, 'NOT_VISIBLE'); assert.equal(p.isUnitVisible(observer(s), s.units[1]!), false);
});
test('third-party live models block LOS; dead third-party models do not', () => {
  const s = terrainState(); const blocker = createUnit(s.definitions[0]!, 'third-party', 'player-1', [{ x: 12, y: 5 }, { x: 12, y: 7 }, { x: 12, y: 9 }]);
  blocker.models[0]!.base.diameterMm = 100; blocker.models[0]!.volume = { kind: 'cylinder', height: 5 }; s.units.push(blocker);
  assert.equal(createVisibilityProvider(s).isModelVisible(observer(s), target(s)), false);
  blocker.models.forEach(m => { m.alive = false; }); assert.equal(createVisibilityProvider(s).isModelVisible(observer(s), target(s)), true);
});
test('observer-unit models are ignored for LOS', () => {
  const s = terrainState(), blocker = s.units[0]!.models[1]!; blocker.alive = true; blocker.position = { x: 12, y: 5 }; blocker.base.diameterMm = 100; blocker.volume = { kind: 'cylinder', height: 5 };
  assert.equal(createVisibilityProvider(s).isModelVisible(observer(s), target(s)), true);
});
test('target-unit models are ignored for full-unit visibility but block individual visibility', () => {
  const s = terrainState(), blocker = s.units[1]!.models[1]!; blocker.alive = true; blocker.position = { x: 12, y: 5 }; blocker.base.diameterMm = 100; blocker.volume = { kind: 'cylinder', height: 5 };
  const p = createVisibilityProvider(s); assert.equal(p.isModelVisible(observer(s), target(s)), false); assert.equal(p.isUnitFullyVisible(observer(s), s.units[1]!), true);
});
test('unit visible needs one visible living model; fully visible needs all', () => {
  const s = terrainState(); feature(s, 'EXPOSED', 12, 3, 1, 4, 4);
  const other = s.units[1]!.models[1]!; other.alive = true; other.position = { x: 5, y: 12 };
  const p = createVisibilityProvider(s); assert.equal(p.isUnitVisible(observer(s), s.units[1]!), true); assert.equal(p.isUnitFullyVisible(observer(s), s.units[1]!), false);
});
for (const category of ['LIGHT', 'DENSE'] as const) {
  test(`${category} area obscures outside-to-outside even without a physical wall`, () => {
    const s = terrainState(); areaOnly(s, category, 10, 2, 3, 7); assert.equal(isObscuring(s, s.battlefield.terrain!.areas[0]!), true);
    assert.equal(createVisibilityProvider(s).isModelVisible(observer(s), target(s)), false);
  });
  test(`${category} observer or target inside its area can see out/in`, () => {
    const s = terrainState(); areaOnly(s, category, 3, 2, 3, 7); let p = createVisibilityProvider(s); assert.equal(p.isModelVisible(observer(s), target(s)), true);
    s.battlefield.terrain = { areas: [], features: [] }; areaOnly(s, category, 18, 2, 4, 7); p = createVisibilityProvider(s); assert.equal(p.isModelVisible(observer(s), target(s)), true);
  });
  test(`${category} another intervening area still blocks when observer is inside an area`, () => {
    const s = terrainState(); areaOnly(s, category, 3, 2, 3, 7); areaOnly(s, category, 10, 2, 3, 7);
    assert.equal(createVisibilityProvider(s).isModelVisible(observer(s), target(s)), false);
  });
}
test('Exposed areas do not become Obscuring', () => {
  const s = terrainState(); areaOnly(s, 'EXPOSED', 10, 2, 3, 7); assert.equal(isObscuring(s, s.battlefield.terrain!.areas[0]!), false); assert.equal(createVisibilityProvider(s).isModelVisible(observer(s), target(s)), true);
});
for (const keyword of ['INFANTRY', 'BEASTS', 'SWARM']) test(`${keyword} inside a Dense area is Hidden before firing`, () => {
  const s = terrainState([keyword]); areaOnly(s, 'DENSE', 18, 2, 5, 7); assert.equal(isModelHidden(s, target(s)), true);
});
for (const keyword of ['MONSTER', 'VEHICLE', 'MOBILE', 'FLY']) test(`${keyword} alone is not Hidden`, () => {
  const s = terrainState([keyword]); areaOnly(s, 'DENSE', 18, 2, 5, 7); assert.equal(isModelHidden(s, target(s)), false);
});
test('Light terrain alone never grants Hidden', () => {
  const s = terrainState(); areaOnly(s, 'LIGHT', 18, 2, 5, 7); assert.equal(isModelHidden(s, target(s)), false);
});
test('Hidden outside 15 inches fails visibility, inside requires actual LOS', () => {
  const s = terrainState(); target(s).position.x = 22; areaOnly(s, 'DENSE', 18, 2, 6, 7);
  assert.equal(createVisibilityProvider(s).isModelVisible(observer(s), target(s)), false);
  observer(s).position.x = 8; assert.equal(createVisibilityProvider(s).isModelVisible(observer(s), target(s)), true);
  feature(s, 'EXPOSED', 12, 3, 1, 4, 4); const result = createVisibilityProvider(s).inspect(observer(s), target(s)); assert.equal(result.withinDetection, true); assert.equal(result.level, 'NOT_VISIBLE');
});
test('Detection never caps visibility of a non-Hidden enemy', () => {
  const s = terrainState(); target(s).position.x = 30; assert.equal(createVisibilityProvider(s).isModelVisible(observer(s), target(s)), true);
});
test('Detection range is configurable and replaceable', () => {
  const s = terrainState(); target(s).position.x = 22; areaOnly(s, 'DENSE', 18, 2, 6, 7); s.battlefield.terrain!.rules = { detectionRange: 20 };
  assert.equal(createVisibilityProvider(s).isModelVisible(observer(s), target(s)), true);
  assert.equal(createVisibilityProvider(s, () => 5).isModelVisible(observer(s), target(s)), false);
});
test('Hidden history excludes current/previous turns and allows turn+2', () => {
  const s = terrainState(); areaOnly(s, 'DENSE', 18, 2, 5, 7); s.units[1]!.lastRangedAttackTurnIndex = 1;
  for (const turn of [1, 2]) { s.turn = turn; assert.equal(isModelHidden(s, target(s)), false); }
  s.turn = 3; assert.equal(isModelHidden(s, target(s)), true);
});
test('Solid closes a low window but allows a geometrically clear upper opening', () => {
  const s = terrainState(); const f = feature(s, 'DENSE', 12, 3, 1, 4, 5);
  // Both models are within the same area so only physical/Solid LOS is tested.
  s.battlefield.terrain!.areas[0]!.footprint = rectangle(2, 2, 22, 7);
  f.openings = [{ footprint: f.footprint, minZ: 0, maxZ: 2 }];
  assert.equal(createVisibilityProvider(s).isModelVisible(observer(s), target(s)), false);
  observer(s).position.z = 3.5; target(s).position.z = 3.5;
  f.openings = [{ footprint: f.footprint, minZ: 3.1, maxZ: 5 }];
  assert.equal(createVisibilityProvider(s).isModelFullyVisible(observer(s), target(s)), true);
});
test('terrain cover requires every living model to qualify', () => {
  const s = terrainState(); areaOnly(s, 'LIGHT', 18, 2, 4, 7); let p = createVisibilityProvider(s);
  assert.equal(benefitOfCover(s, observer(s), s.units[1]!, p), true);
  const other = s.units[1]!.models[1]!; other.alive = true; other.position = { x: 20, y: 12 }; p = createVisibilityProvider(s);
  assert.equal(benefitOfCover(s, observer(s), s.units[1]!, p), false);
});
test('terrain partial visibility grants cover even for a vehicle', () => {
  const s = terrainState(['VEHICLE']); feature(s, 'EXPOSED', 12, 3, 1, 4, 1.2);
  assert.equal(benefitOfCover(s, observer(s), s.units[1]!, createVisibilityProvider(s)), true);
});
test('third-party model occlusion alone does not grant terrain cover', () => {
  const s = terrainState(['VEHICLE']); const blocker = createUnit(s.definitions[0]!, 'third-party', 'player-1', [{ x: 12, y: 5 }, { x: 12, y: 7 }, { x: 12, y: 9 }]); s.units.push(blocker);
  assert.equal(benefitOfCover(s, observer(s), s.units[1]!, createVisibilityProvider(s)), false);
});
test('Plunging Fire needs a supported surface of at least three inches and a ground target', () => {
  const s = terrainState(); const f = feature(s, 'EXPOSED', 3, 3, 3, 4, 3); observer(s).position.z = 3;
  assert.equal(plungingFire(s, observer(s), s.units[1]!, createVisibilityProvider(s)), true);
  observer(s).position.z = 2.9; f.height = 2.9; f.sections[0]!.maxZ = 2.9; f.surfaces[0]!.z = 2.9;
  assert.equal(plungingFire(s, observer(s), s.units[1]!, createVisibilityProvider(s)), false);
  observer(s).position.z = 3; f.height = 3; f.sections[0]!.maxZ = 3; f.surfaces[0]!.z = 3; target(s).position.z = 1;
  assert.equal(plungingFire(s, observer(s), s.units[1]!, createVisibilityProvider(s)), false);
});
test('TOWERING applies within twelve inches, not beyond', () => {
  const s = terrainState(['TOWERING']); target(s).position.x = 15;
  assert.equal(plungingFire(s, observer(s), s.units[1]!, createVisibilityProvider(s)), true);
  target(s).position.x = 20; assert.equal(plungingFire(s, observer(s), s.units[1]!, createVisibilityProvider(s)), false);
});
test('Cover and Plunging Fire cancel through the same modifier pipeline', () => {
  const s = terrainState(); feature(s, 'EXPOSED', 3, 3, 3, 4, 3); observer(s).position.z = 3; areaOnly(s, 'LIGHT', 18, 2, 4, 7);
  const result = shootingModifiers(s, observer(s), s.units[1]!, 3, createVisibilityProvider(s)); assert.equal(result.modifiers.length, 2); assert.equal(result.effectiveSkill, 3);
  assert.equal(applySkillModifiers(2, [{ source: 'PLUNGING_FIRE', skillDelta: -1 }]), 2);
  assert.equal(applySkillModifiers(6, [{ source: 'COVER', skillDelta: 1 }]), 6);
});
test('provider cache is snapshot-scoped and no query emits events', () => {
  const s = terrainState(); const p = createVisibilityProvider(s), before = structuredClone(s); p.inspect(observer(s), target(s)); assert.deepEqual(s, before);
  feature(s, 'EXPOSED', 12, 3, 1, 4, 4); assert.equal(p.isModelVisible(observer(s), target(s)), true); assert.equal(createVisibilityProvider(s).isModelVisible(observer(s), target(s)), false);
});

test('Detection and Towering boundaries are inclusive in base-edge 3D distance', () => {
  const s = terrainState(['INFANTRY', 'TOWERING']); areaOnly(s, 'DENSE', 15, 2, 10, 7);
  const radii = (observer(s).base.diameterMm + target(s).base.diameterMm) / 50.8;
  target(s).position.x = observer(s).position.x + radii + 15;
  assert.equal(createVisibilityProvider(s).isModelVisible(observer(s), target(s)), true);
  target(s).position.x += 0.01; assert.equal(createVisibilityProvider(s).isModelVisible(observer(s), target(s)), false);
  target(s).position.x = observer(s).position.x + radii + 12;
  assert.equal(plungingFire(s, observer(s), s.units[1]!, createVisibilityProvider(s)), true);
  target(s).position.x += 0.01; assert.equal(plungingFire(s, observer(s), s.units[1]!, createVisibilityProvider(s)), false);
});
