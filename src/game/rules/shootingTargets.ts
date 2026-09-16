import { battleStarted, onBattlefield, setupBusy } from '../reserves/location';
import type { CommandFailure, CommandResult, GameState, LegalTarget, RangedWeapon, Unit } from '../models';
import { definitionFor, failure } from './movement';
import { isUnitEngaged } from './spatial';
import { edgeDistance, EPSILON } from '../utils/geometry';
import type { VisibilityPolicy } from './visibility';
import { createVisibilityProvider, type VisibilityProvider } from '../terrain/visibility';
/** Centralized prototype engagement restriction. No pistol/vehicle exceptions. */
export function normalShootingAllowed(state: GameState, unit: Unit): boolean { return !isUnitEngaged(state, unit); }
export function shootingPhaseError(state: GameState): CommandFailure | null {
  if (!battleStarted(state)) return failure('PRE_BATTLE');
  if (setupBusy(state)) return failure('SETUP_IN_PROGRESS');
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
  if (unit.state.hasShot) return failure('ALREADY_SHOT');
  if (!unit.models.some(m => m.alive)) return failure('NO_LIVING_MODELS');
  if (!normalShootingAllowed(state, unit)) return failure('UNIT_ENGAGED');
  return { ok: true, value: unit };
}
export function availableRangedWeapons(state: GameState, unitId: string): CommandResult<RangedWeapon[]> {
  const shooter = validateShooter(state, unitId);
  if (!shooter.ok) return shooter;
  const weapons = definitionFor(state, shooter.value).weapons.filter((w): w is RangedWeapon => w.kind === 'ranged');
  if (!weapons.length) return failure('NO_RANGED_WEAPONS');
  return { ok: true, value: weapons.filter(w => !state.shooting?.firedWeaponIds.includes(w.id)) };
}
export function validateRangedWeapon(state: GameState, unitId: string, weaponId: string): CommandResult<RangedWeapon> {
  const shooter = validateShooter(state, unitId);
  if (!shooter.ok) return shooter;
  const weapon = definitionFor(state, shooter.value).weapons.find(w => w.id === weaponId);
  if (!weapon) return failure('WEAPON_NOT_FOUND');
  if (weapon.kind !== 'ranged') return failure('WEAPON_NOT_RANGED');
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
  const livingTargets = target.models.filter(m => m.alive);
  if (!livingTargets.length) return failure('TARGET_DESTROYED');
  const livingShooters = shooter.models.filter(m => m.alive);
  let nearestDistance = Infinity;
  let anyInRange = false;
  const eligibleFiringModelIds = livingShooters.filter(model => {
    let eligible = false;
    for (const enemy of livingTargets) {
      const distance = rangedDistance(model, enemy);
      nearestDistance = Math.min(nearestDistance, distance);
      if (distance <= weapon.value.range + EPSILON) {
        anyInRange = true;
        // Range AND visibility must apply to the same shooter/target pair.
        if (typeof visibility === 'function' ? visibility(model, enemy, state.battlefield) : visibility.isModelVisible(model, enemy)) eligible = true;
      }
    }
    return eligible;
  }).map(m => m.id);
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
