import { effectiveCharacteristic } from '../effects/EffectEngine';
import type { GameState } from '../models';
import type { DeepReadonly, Weapon, Unit, UnitDefinition, WeaponResolution, ModelAttackModifiers } from '../models';
import { rollD6, type RandomSource } from '../utils/dice';
import { resolveWeaponValue } from './weaponValues';
import { hitSucceeds, resolveArmourSave, woundSucceeds, woundTarget } from './combatRolls';
import { allocateDamage, applyDamage, type DamageAllocationPolicy } from './damageAllocation';
/** Stateless orchestration. Each stage is replaceable without embedding rules in the UI. */
export function resolveCombat(weapon: DeepReadonly<Weapon>, eligibleFiringModelIds: readonly string[], initialTarget: Unit,
  targetDefinition: UnitDefinition, rng: RandomSource, allocation: DamageAllocationPolicy = allocateDamage, modifiers: readonly ModelAttackModifiers[] = [], state?: GameState) {
  let target = initialTarget;
  const attackCounts = eligibleFiringModelIds.map(modelId => ({ modelId, resolved: resolveWeaponValue(weapon.attacks, rng) }));
  const attacks = attackCounts.reduce((total, count) => total + count.resolved.value, 0);
  if (!Number.isSafeInteger(attacks)) throw new Error('Invalid total attacks');
  const resolution: WeaponResolution = {
    weaponId: weapon.id, targetUnitId: target.id, eligibleFiringModelIds: [...eligibleFiringModelIds], attackCounts, attacks,
    hitRolls: [], hits: 0, woundTarget: woundTarget(weapon.strength, targetDefinition.stats.toughness),
    woundRolls: [], wounds: 0, saveResults: [], savesFailed: 0, damageResults: [], totalDamage: 0, destroyedModelIds: [],
  };
  if (modifiers.length) resolution.attackModifiers = JSON.parse(JSON.stringify(modifiers));
  if (state?.flow) resolution.attackModifiers = eligibleFiringModelIds.map(modelId => {
    const unit = state.units.find(u => u.models.some(m => m.id === modelId))!;
    const supplied = modifiers.find(m => m.modelId === modelId);
    const effectiveSkill = supplied?.effectiveSkill ?? effectiveCharacteristic(state, unit.id, weapon.kind === 'ranged' ? 'BS' : 'WS', weapon.skill);
    return { modelId, baseSkill: weapon.skill, effectiveSkill,
      modifiers: supplied ? [...supplied.modifiers] : effectiveSkill === weapon.skill ? [] : [{ source: 'TEMPORARY_EFFECT' as const, skillDelta: effectiveSkill - weapon.skill }],
      hitDelta: effectiveCharacteristic(state, unit.id, 'HIT_ROLL', 0), woundDelta: effectiveCharacteristic(state, unit.id, 'WOUND_ROLL', 0),
      saveDelta: effectiveCharacteristic(state, target.id, 'SAVE', targetDefinition.stats.save) - targetDefinition.stats.save };
  });
  // Attack counts are rolled per eligible model first, then each attack resolves fully in order.
  // Once no targets remain, discard unneeded attacks without consuming further RNG.
  let countIndex = 0, attacksThroughModel = attackCounts[0]?.resolved.value ?? 0;
  for (let attack = 0; attack < attacks && target.models.some(m => m.alive); attack++) {
    while (attack >= attacksThroughModel && countIndex < attackCounts.length - 1) attacksThroughModel += attackCounts[++countIndex]!.resolved.value;
    const firingModelId = attackCounts[countIndex]!.modelId;
    const attackerUnit = state?.units.find(u => u.models.some(m => m.id === firingModelId));
    const baseSkill = modifiers.find(m => m.modelId === firingModelId)?.effectiveSkill ?? weapon.skill;
    const skill = state && attackerUnit && !modifiers.length ? effectiveCharacteristic(state, attackerUnit.id, weapon.kind === 'ranged' ? 'BS' : 'WS', baseSkill) : baseSkill;
    const hitDelta = state && attackerUnit ? effectiveCharacteristic(state, attackerUnit.id, 'HIT_ROLL', 0) : 0;
    const woundDelta = state && attackerUnit ? effectiveCharacteristic(state, attackerUnit.id, 'WOUND_ROLL', 0) : 0;
    const hit = rollD6(rng);
    resolution.hitRolls.push(hit);
    if (hit === 1 || (hit !== 6 && !hitSucceeds(hit + hitDelta, skill))) continue;
    resolution.hits++;
    const wound = rollD6(rng);
    resolution.woundRolls.push(wound);
    if (wound === 1 || (wound !== 6 && !woundSucceeds(wound + woundDelta, resolution.woundTarget))) continue;
    resolution.wounds++;
    const save = resolveArmourSave(state ? effectiveCharacteristic(state, target.id, 'SAVE', targetDefinition.stats.save) : targetDefinition.stats.save, weapon.armourPenetration, rng);
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
