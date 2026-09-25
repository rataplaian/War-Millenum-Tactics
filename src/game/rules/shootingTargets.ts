import { rangedLoadout } from '../transports/FiringDeck';
import { hasWeaponAbility, loneOperativeDistance, weaponInstanceId, resolvedAbilities } from '../abilities/registry';
import { unitKeywords, modelKeywords } from '../attachments/queries';
import { modelHasWeapon } from '../attachments/queries';
import { effectiveFlag } from '../effects/EffectEngine';
import { temporalBlock } from '../flow/TimingWindows';
import { battleStarted, onBattlefield, setupBusy } from '../reserves/location';
import type { CommandFailure, CommandResult, GameState, LegalTarget, RangedWeapon, Unit } from '../models';
import { definitionFor, failure } from './movement';
import { isUnitEngaged } from './spatial';
import { edgeDistance, EPSILON } from '../utils/geometry';
import type { VisibilityPolicy } from './visibility';
import { createVisibilityProvider, type VisibilityProvider } from '../terrain/visibility';
/** Centralized prototype engagement restriction. No pistol/vehicle exceptions. */
export function normalShootingAllowed(state: GameState, unit: Unit): boolean {
 return !isUnitEngaged(state, unit) || unitKeywords(state, unit).some(k => k === 'MONSTER' || k === 'VEHICLE') || rangedLoadout(state, unit).some(w => hasWeaponAbility(w, 'CLOSE_QUARTERS'));
}
/** 10.05/10.06: weapon eligibility is narrower than unit eligibility. */
export function getEligibleRangedWeapons(state: GameState, unit: Unit) {
 return rangedLoadout(state, unit).filter(w => (!unit.state.hasAdvanced || hasWeaponAbility(w, 'ASSAULT')) &&
  (!isUnitEngaged(state, unit) || unitKeywords(state, unit).some(k => k === 'MONSTER' || k === 'VEHICLE') || hasWeaponAbility(w, 'CLOSE_QUARTERS')) &&
  unit.models.some(m => m.alive && (!hasWeaponAbility(w, 'ONE_SHOT') || !m.oneShotExpended?.includes(weaponInstanceId(state, unit, m, w)))));
}
export function shootingPhaseError(state: GameState): CommandFailure | null {
  const block = temporalBlock(state); if (block) return block;
  if (!battleStarted(state)) return failure('PRE_BATTLE');
  if (setupBusy(state) && !(state.shooting && state.transportState?.destroyed.length && !state.transportState.disembark && !state.setup && !state.scout && !state.transportState.tacticalFollowUp)) return failure('SETUP_IN_PROGRESS');
  if (state.status !== 'in-progress') return failure('MATCH_FINISHED');
  if (state.movement) return failure('MOVEMENT_IN_PROGRESS');
  if (state.phase !== 'Shooting') return failure('WRONG_PHASE');
  return null;
}
export function validateShooter(state: GameState, unitId: string): CommandResult<Unit> {
  const error = shootingPhaseError(state);
  if (error) return error;
  if (state.shooting && state.shooting.unitId !== unitId) return failure('SHOOTING_IN_PROGRESS');
  const unit = state.units.find(u => u.id === unitId);
  if (!unit) return failure('UNIT_NOT_FOUND');
  if (unit.playerId !== state.activePlayerId) return failure('NOT_YOUR_UNIT');
  if (!onBattlefield(unit)) return failure('NOT_ON_BATTLEFIELD');
  if ((state.mission?.activeActions.some(a => a.unitId === unit.id && a.startedAt.turn === state.turn) && !unitKeywords(state, unit).includes('TITANIC')) ||
      (unit.cannotShootUntilTurn ?? 0) >= state.turn || unit.state.hasFallenBack || effectiveFlag(state, unit.id, 'CANNOT_SHOOT')) return failure('UNIT_NOT_ELIGIBLE');
  if (unit.state.hasShot) return failure('ALREADY_SHOT');
  if (!unit.models.some(m => m.alive)) return failure('NO_LIVING_MODELS');
  if (!normalShootingAllowed(state, unit) || (unit.state.hasAdvanced && isUnitEngaged(state, unit))) return failure('UNIT_ENGAGED');
  return { ok: true, value: unit };
}
export function availableRangedWeapons(state: GameState, unitId: string): CommandResult<RangedWeapon[]> {
  const shooter = validateShooter(state, unitId);
  if (!shooter.ok) return shooter;
  const weapons = getEligibleRangedWeapons(state, shooter.value);
  if (!weapons.length) return failure('NO_RANGED_WEAPONS');
  return { ok: true, value: weapons.filter(w => !state.shooting?.firedWeaponIds.includes(w.id)) };
}
export function validateRangedWeapon(state: GameState, unitId: string, weaponId: string): CommandResult<RangedWeapon> {
  const shooter = validateShooter(state, unitId);
  if (!shooter.ok) return shooter;
  const weapon = rangedLoadout(state, shooter.value).find(w => w.id === weaponId);
  if (!weapon) return failure(definitionFor(state, shooter.value).weapons.some(w => w.id === weaponId) ? 'WEAPON_NOT_RANGED' : 'WEAPON_NOT_FOUND');
  if (weapon.kind !== 'ranged') return failure('WEAPON_NOT_RANGED');
  if (!getEligibleRangedWeapons(state, shooter.value).some(w => w.id === weaponId)) return failure('UNIT_NOT_ELIGIBLE');
  if (state.shooting?.firedWeaponIds.includes(weaponId)) return failure('WEAPON_ALREADY_FIRED');
  return { ok: true, value: weapon };
}
/** Centralized range measurement policy: living base-edge gap in inches. */
export const rangedDistance = edgeDistance;
export function validateShootingTarget(state: GameState, unitId: string, weaponId: string, targetUnitId: string,
  visibility: VisibilityProvider | VisibilityPolicy = createVisibilityProvider(state)): CommandResult<LegalTarget> {
  const weapon = validateRangedWeapon(state, unitId, weaponId);
  if (!weapon.ok) return weapon;
  const shooter = state.units.find(u => u.id === unitId)!;
  const target = state.units.find(u => u.id === targetUnitId);
  if (!target) return failure('TARGET_NOT_FOUND');
  if (target.playerId === shooter.playerId) return failure('TARGET_NOT_ENEMY');
  if (!onBattlefield(target)) return failure('NOT_ON_BATTLEFIELD');
  let applicable;
  try { applicable = resolvedAbilities(state, target, weapon.value, state.shooting?.attackChoices?.[weaponId] ?? {}); } catch { return failure('ABILITY_CHOICE_REQUIRED'); }
  const active = (type: string) => applicable.some(a => a.type === type);
  if (shooter.state.hasAdvanced && !active('ASSAULT')) return failure('UNIT_NOT_ELIGIBLE');
  const livingTargets = target.models.filter(m => m.alive);
  if (!livingTargets.length) return failure('TARGET_DESTROYED');
  const livingShooters = shooter.models.filter(m => m.alive && (weaponId.startsWith('deck:') || modelHasWeapon(state, shooter, m, weaponId)));
  let nearestDistance = Infinity;
  let anyInRange = false;
  const eligibleFiringModelIds = livingShooters.filter(model => {
    let eligible = false;
    if (hasWeaponAbility(weapon.value, 'ONE_SHOT') && model.oneShotExpended?.includes(weaponInstanceId(state, shooter, model, weapon.value))) return false;
    const heavy = modelKeywords(state, shooter, model).some(k => k === 'MONSTER' || k === 'VEHICLE');
    const cq = active('CLOSE_QUARTERS');
    const engagedTarget = livingTargets.some(enemy => shooter.models.some(m => m.alive && rangedDistance(m, enemy) <= state.spatialRules.engagementDistance + EPSILON));
    if (isUnitEngaged(state, shooter) && ((!heavy && (!cq || !engagedTarget)) || (engagedTarget && active('BLAST')))) return false;
    if (!heavy && state.shooting?.firedWeaponIds.some(id => { const prior = rangedLoadout(state, shooter).find(w => w.id === id); return prior && modelHasWeapon(state, shooter, model, id) && hasWeaponAbility(prior, 'CLOSE_QUARTERS') !== cq; })) return false;
    const indirect = active('INDIRECT_FIRE') && state.shooting?.shootingMode === 'INDIRECT';
    if (indirect && (!hasWeaponAbility(weapon.value, 'INDIRECT_FIRE') || shooter.state.hasAdvanced || isUnitEngaged(state, shooter))) return false;
    const lone = loneOperativeDistance(state, target);
    for (const enemy of livingTargets) {
      const distance = rangedDistance(model, enemy);
      nearestDistance = Math.min(nearestDistance, distance);
      if (distance <= weapon.value.range + EPSILON && (lone === null || livingTargets.some(t => rangedDistance(model, t) <= lone + EPSILON))) {
        anyInRange = true;
        // Range AND visibility must apply to the same shooter/target pair.
        if (indirect || (typeof visibility === 'function' ? visibility(model, enemy, state.battlefield) : visibility.isModelVisible(model, enemy))) eligible = true;
      }
    }
    return eligible;
  }).map(m => m.id);
  if (nearestDistance === Infinity) return failure('NO_ELIGIBLE_FIRING_MODELS');
  if (!anyInRange) return { ...failure('TARGET_OUT_OF_RANGE'), distance: nearestDistance };
  if (!eligibleFiringModelIds.length) return failure('TARGET_NOT_VISIBLE');
  return { ok: true, value: { targetUnitId, eligibleFiringModelIds, nearestDistance } };
}
export function legalShootingTargets(state: GameState, unitId: string, weaponId: string,
  visibility: VisibilityProvider | VisibilityPolicy = createVisibilityProvider(state)): CommandResult<LegalTarget[]> {
  const weapon = validateRangedWeapon(state, unitId, weaponId);
  if (!weapon.ok) return weapon;
  const targets: LegalTarget[] = [];
  for (const target of state.units) {
    const result = validateShootingTarget(state, unitId, weaponId, target.id, visibility);
    if (result.ok) targets.push(result.value);
  }
  return { ok: true, value: targets };
}
