import type { Position, Unit, UnitDefinition, UnitState } from '../models';
export const freshUnitState = (): UnitState => ({ hasMoved: false, hasShot: false, hasCharged: false, hasFought: false });
/** Explicit IDs and positions keep initialization independent of clocks/randomness. */
export function createUnit(definition: UnitDefinition, id: string, playerId: string, positions: Position[]): Unit {
  if (!id || !playerId || !Number.isInteger(definition.modelCount) || definition.modelCount < 1 || positions.length !== definition.modelCount) throw new Error('Invalid unit initialization');
  if (!Number.isInteger(definition.stats.wounds) || definition.stats.wounds < 1) throw new Error('Invalid wounds');
  if (positions.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error('Invalid position');
  const profiles = definition.modelProfiles?.flatMap(profile => Array.from({ length: profile.count }, () => profile));
  if (profiles && (profiles.length !== definition.modelCount || profiles.some(p =>
    p.weaponIds.some(weaponId => !definition.weapons.some(w => w.id === weaponId))))) throw new Error('Invalid model profiles');
  return { definitionId: definition.id, id, playerId, state: freshUnitState(),
    ...(definition.abilities.some(a => a.id === 'ASPECT_SHRINE') ? { resourceCounters: { ASPECT_SHRINE: Math.floor(definition.modelCount / 5) } } : {}),
    models: positions.map((position, index) => { const profile = profiles?.[index]; return {
      id: `${id}:model:${index + 1}`, unitId: id,
      woundsRemaining: profile?.stats?.wounds ?? definition.stats.wounds, position: { ...position }, alive: true,
      base: { ...(profile?.base ?? definition.defaultBase) }, movementUsed: 0,
      ...(profile ? { weaponIds: [...profile.weaponIds], stats: { ...profile.stats }, ...(profile.coreAbilities ? { coreAbilities: [...profile.coreAbilities] } : {}) } : {}),
    }; }) };
}
