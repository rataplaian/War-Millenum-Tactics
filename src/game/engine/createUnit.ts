import type { Position, Unit, UnitDefinition, UnitState } from '../models';
export const freshUnitState = (): UnitState => ({ hasMoved: false, hasShot: false, hasCharged: false, hasFought: false });
/** Explicit IDs and positions keep initialization independent of clocks/randomness. */
export function createUnit(definition: UnitDefinition, id: string, playerId: string, positions: Position[]): Unit {
  if (!id || !playerId || !Number.isInteger(definition.modelCount) || definition.modelCount < 1 || positions.length !== definition.modelCount) throw new Error('Invalid unit initialization');
  if (!Number.isInteger(definition.stats.wounds) || definition.stats.wounds < 1) throw new Error('Invalid wounds');
  if (positions.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error('Invalid position');
  const data: UnitDefinition = JSON.parse(JSON.stringify(definition));
  return { ...data, definitionId: definition.id, id, playerId, state: freshUnitState(),
    models: positions.map((position, index) => ({ id: `${id}:model:${index + 1}`, unitId: id,
      woundsRemaining: definition.stats.wounds, position: { ...position }, alive: true })) };
}
