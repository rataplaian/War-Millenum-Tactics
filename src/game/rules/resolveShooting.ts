import type { RangedWeapon, Unit, UnitDefinition, WeaponResolution } from '../models';
import { rollD6, type RandomSource } from '../utils/dice';
import { resolveWeaponValue } from './weaponValues';
import { hitSucceeds, resolveArmourSave, woundSucceeds, woundTarget } from './combatRolls';
import { allocateDamage, applyDamage, type DamageAllocationPolicy } from './damageAllocation';
/** Stateless orchestration. Each stage is replaceable without embedding rules in the UI. */
export function resolveShooting(weapon: RangedWeapon, eligibleFiringModelIds: readonly string[], initialTarget: Unit,
  targetDefinition: UnitDefinition, rng: RandomSource, allocation: DamageAllocationPolicy = allocateDamage) {
  let target = initialTarget;
  const attackCounts = eligibleFiringModelIds.map(modelId => ({ modelId, resolved: resolveWeaponValue(weapon.attacks, rng) }));
  const attacks = attackCounts.reduce((total, count) => total + count.resolved.value, 0);
  if (!Number.isSafeInteger(attacks)) throw new Error('Invalid total attacks');
  const resolution: WeaponResolution = {
    weaponId: weapon.id, targetUnitId: target.id, eligibleFiringModelIds: [...eligibleFiringModelIds], attackCounts, attacks,
    hitRolls: [], hits: 0, woundTarget: woundTarget(weapon.strength, targetDefinition.stats.toughness),
    woundRolls: [], wounds: 0, saveResults: [], savesFailed: 0, damageResults: [], totalDamage: 0, destroyedModelIds: [],
  };
  // Attack counts are rolled per eligible model first, then each attack resolves fully in order.
  // Once no targets remain, discard unneeded attacks without consuming further RNG.
  for (let attack = 0; attack < attacks && target.models.some(m => m.alive); attack++) {
    const hit = rollD6(rng);
    resolution.hitRolls.push(hit);
    if (!hitSucceeds(hit, weapon.skill)) continue;
    resolution.hits++;
    const wound = rollD6(rng);
    resolution.woundRolls.push(wound);
    if (!woundSucceeds(wound, resolution.woundTarget)) continue;
    resolution.wounds++;
    const save = resolveArmourSave(targetDefinition.stats.save, weapon.armourPenetration, rng);
    resolution.saveResults.push(save);
    if (save.saved) continue;
    resolution.savesFailed++;
    const resolved = resolveWeaponValue(weapon.damage, rng);
    const modelId = allocation(target.models, targetDefinition.stats.wounds);
    const model = target.models.find(m => m.id === modelId);
    if (!model?.alive) throw new Error('Allocation policy did not select a living model');
    const woundsBefore = model.woundsRemaining;
    target = applyDamage(target, model.id, resolved.value);
    const updated = target.models.find(m => m.id === model.id)!;
    const applied = woundsBefore - updated.woundsRemaining;
    const damage = { modelId: model.id, resolved, woundsBefore, woundsAfter: updated.woundsRemaining,
      applied, excess: resolved.value - applied, destroyed: !updated.alive };
    resolution.damageResults.push(damage);
    resolution.totalDamage += applied;
    if (damage.destroyed) resolution.destroyedModelIds.push(model.id);
  }
  return { target, resolution };
}
