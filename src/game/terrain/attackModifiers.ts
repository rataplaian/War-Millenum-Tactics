import { unitHasCore, hasWeaponAbility, resolvedAbilities } from '../abilities/registry';
import type { AttackChoices } from '../abilities/types';
import type { RangedWeapon } from '../models';
import { sourceModifier } from '../attachments/queries';
import { modifierDelta } from '../effects/EffectEngine';
import type { AttackModifier, GameState, Model, ModelAttackModifiers, Unit } from '../models';
import type { VisibilityProvider } from './visibility';
import { baseSupported, elevation } from './geometry';
import { areasForModel, baseDistance3, hasAnyKeyword, LIGHT_BODY, terrainRules } from './rules';
import { EPSILON } from '../utils/geometry';
export function benefitOfCover(state: GameState, attacker: Model, target: Unit, provider: VisibilityProvider): boolean {
  const living = target.models.filter(m => m.alive);
  return unitHasCore(state, target, 'STEALTH') || living.length > 0 && living.every(model =>
    (hasAnyKeyword(state, model, LIGHT_BODY) && areasForModel(state, model).length > 0) || !provider.inspect(attacker, model).terrainFullyVisible);
}
export function plungingFire(state: GameState, attacker: Model, target: Unit, provider: VisibilityProvider): boolean {
  const living = target.models.filter(m => m.alive), rules = terrainRules(state);
  if (!living.some(m => elevation(m.position) <= EPSILON) || !provider.isUnitVisible(attacker, target)) return false;
  const elevated = (state.battlefield.terrain?.features ?? []).some(f => f.surfaces.some(s => s.stable && s.z >= rules.plungingHeight - EPSILON && Math.abs(s.z - elevation(attacker.position)) <= EPSILON && baseSupported(attacker, s.footprint)));
  const towering = hasAnyKeyword(state, attacker, ['TOWERING']) && living.some(m => baseDistance3(attacker, m) <= rules.toweringRange + EPSILON);
  return elevated || towering;
}
/** Apply simultaneous BS characteristic changes without editing the catalog. Lower skill is better. */
export function applySkillModifiers(baseSkill: number, modifiers: readonly AttackModifier[]): number {
  return Math.max(2, Math.min(6, baseSkill + modifiers.reduce((n, modifier) => n + modifier.skillDelta, 0)));
}
export function shootingModifiers(state: GameState, attacker: Model, target: Unit, baseSkill: number, provider: VisibilityProvider, weapon?: RangedWeapon, choices: AttackChoices = {}): ModelAttackModifiers {
  const modifiers: AttackModifier[] = [];
  if (!(weapon && resolvedAbilities(state, target, weapon, choices).some(a => a.type === 'IGNORES_COVER')) && (benefitOfCover(state, attacker, target, provider) || choices.shootingMode === 'INDIRECT')) modifiers.push({ source: 'COVER', skillDelta: 1 });
  if (plungingFire(state, attacker, target, provider)) modifiers.push({ source: 'PLUNGING_FIRE', skillDelta: -1 });
  const delta = modifierDelta(state, attacker.unitId, 'BS') + sourceModifier(state, attacker.unitId, 'BS', attacker.id);
  if (delta) modifiers.push({ source: 'TEMPORARY_EFFECT', skillDelta: delta });
  return { modelId: attacker.id, baseSkill, effectiveSkill: applySkillModifiers(baseSkill, weapon && hasWeaponAbility(weapon, 'PSYCHIC') && choices.psychicIgnore !== 'NONE' ? modifiers.filter(m => choices.psychicIgnore !== 'ALL' && m.skillDelta < 0) : modifiers), modifiers };
}
