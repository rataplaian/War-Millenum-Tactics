import type { DeepReadonly, GameState, Unit, Weapon, ModelAttackModifiers } from '../models';
import type { AttackChoices } from '../abilities/types';
import type { AttackContext } from './types';
import { resolvedAbilities } from '../abilities/registry';
import { edgeDistance } from '../utils/geometry';
import { isUnitEngaged } from '../rules/spatial';
import { createVisibilityProvider, type VisibilityProvider } from '../terrain/visibility';
import { onBattlefield } from '../reserves/location';
export function buildAttackContext(s: GameState | undefined, id: string, target: Unit, weapon: DeepReadonly<Weapon>, choices: AttackChoices, modifier?: ModelAttackModifiers, visibility?: VisibilityProvider): AttackContext {
    const u = s?.units.find(u => u.models.some(m => m.id === id)), m = u?.models.find(m => m.id === id), provider = visibility ?? (s ? createVisibilityProvider(s) : null);
    const distance = m ? Math.min(...target.models.filter(m => m.alive).map(t => edgeDistance(m, t))) : 0;
    return { attackerUnitId: u?.id ?? '', attackerModelId: id, targetUnitId: target.id, weapon: JSON.parse(JSON.stringify(weapon)), attackType: weapon.kind, phase: s?.phase ?? 'Shooting', turn: s?.turn ?? 1,
        engagedWithTarget: !!(s && u && u.models.some(m => m.alive && target.models.some(t => t.alive && edgeDistance(m, t) <= s.spatialRules.engagementDistance + 1e-9))), distance, visible: !!(m && provider?.isUnitVisible(m, target)), engaged: !!(s && u && isUnitEngaged(s, u)), moved: !!u?.state.hasMoved, advanced: !!u?.state.hasAdvanced, charged: !!u?.state.hasCharged,
        stationary: !!u?.state.hasMoved && u.models.every(m => m.movementUsed === 0) && u.setupAtTurn !== s?.turn,
        friendlySpotter: !!(s && u && provider && s.units.filter(x => x.playerId === u.playerId && onBattlefield(x)).some(x => x.models.some(m => m.alive && provider.isUnitVisible(m, target)))),
        targetCount: target.models.filter(m => m.alive).length, abilities: resolvedAbilities(s, target, weapon, choices), terrainModifiers: modifier ?? null, activeEffects: s?.flow?.effects.filter(e => e.active && e.target.unitId === u?.id).map(e => e.id) ?? [] };
}
