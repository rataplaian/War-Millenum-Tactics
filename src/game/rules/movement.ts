import { temporalBlock } from '../flow/TimingWindows';
import { effectiveCharacteristic, effectiveFlag } from '../effects/EffectEngine';
import { arrivalLocked, battleStarted, onBattlefield, setupBusy } from '../reserves/location';
import { validateTerrainPath, validateTerrainPosition } from '../terrain/movement';
import { modelsOverlap } from '../terrain/geometry';
import type { CommandFailure, CommandResult, GameState, Model, MovementPath, Position, Unit, UnitDefinition } from '../models';
import { baseInsideBattlefield, basesOverlap, distanceTravelled, EPSILON, isFinitePosition } from '../utils/geometry';
import { enemyModelsWithinEngagement, isUnitEngaged } from './spatial';
export const failure = (reason: CommandFailure['reason']): CommandFailure => ({ ok: false, reason });
export function definitionFor(state: GameState, unit: Unit): UnitDefinition {
  const definition = state.definitions.find(d => d.id === unit.definitionId);
  if (!definition) throw new Error(`Missing definition: ${unit.definitionId}`);
  return definition;
}
export function movementPhaseError(state: GameState): CommandFailure | null {
  const block = temporalBlock(state); if (block) return block;
  if (!battleStarted(state)) return failure('PRE_BATTLE');
  if (setupBusy(state)) return failure('SETUP_IN_PROGRESS');
  if (state.status !== 'in-progress') return failure('MATCH_FINISHED');
  if (state.shooting) return failure('SHOOTING_IN_PROGRESS');
  if (state.phase !== 'Movement') return failure('WRONG_PHASE');
  return null;
}
export function validateBeginMovement(state: GameState, unitId: string): CommandResult<Unit> {
  const error = movementPhaseError(state);
  if (error) return error;
  if (state.movement) return failure('MOVEMENT_IN_PROGRESS');
  const unit = state.units.find(u => u.id === unitId);
  if (!unit) return failure('UNIT_NOT_FOUND');
  if (unit.playerId !== state.activePlayerId) return failure('NOT_YOUR_UNIT');
  if (!onBattlefield(unit)) return failure('NOT_ON_BATTLEFIELD');
  if (arrivalLocked(unit)) return failure('ARRIVAL_MOVE_LOCK');
  if (effectiveFlag(state, unit.id, 'CANNOT_MOVE')) return failure('UNIT_NOT_ELIGIBLE');
  if (unit.state.hasMoved) return failure('ALREADY_MOVED');
  if (!unit.models.some(m => m.alive)) return failure('NO_LIVING_MODELS');
  if (isUnitEngaged(state, unit)) return failure('UNIT_ENGAGED');
  return { ok: true, value: unit };
}
export interface MoveDetails { distance: number; totalUsed: number; remaining: number }
/** Endpoint-only policy. A future path validator can precede this without changing commands. */
export function validateFinalPosition(state: GameState, unit: Unit, model: Model, target: Position, allowEngagement = false): CommandResult {
  if (!isFinitePosition(target)) return failure('INVALID_POSITION');
  const candidate = { ...model, position: target };
  if (!baseInsideBattlefield(candidate, state.battlefield)) return failure('OUTSIDE_BATTLEFIELD');
  const blocker = state.units.filter(onBattlefield).flatMap(u => u.models)
    .find(other => other.alive && other.id !== model.id && modelsOverlap(candidate, other));
  if (blocker) return { ...failure('BASE_OVERLAP'), blockingModelId: blocker.id };
  const terrain = validateTerrainPosition(state, candidate);
  if (!terrain.ok) return terrain;
  const enemy = enemyModelsWithinEngagement(state, unit.playerId, candidate)[0];
  if (enemy && !allowEngagement) return { ...failure('ENEMY_ENGAGEMENT'), blockingModelId: enemy.id };
  return { ok: true, value: undefined };
}
export function validateModelMove(state: GameState, modelId: string, target: Position, path?: MovementPath): CommandResult<MoveDetails> {
  const error = movementPhaseError(state);
  if (error) return error;
  if (!state.movement) return failure('NO_ACTIVE_MOVEMENT');
  const unit = state.units.find(u => u.id === state.movement!.unitId);
  if (!unit) throw new Error('Active movement unit is missing');
  if (unit.playerId !== state.activePlayerId) return failure('NOT_YOUR_UNIT');
  const model = unit.models.find(m => m.id === modelId);
  if (!model) return failure('MODEL_NOT_IN_UNIT');
  if (!model.alive) return failure('MODEL_DEAD');
  if (!isFinitePosition(target)) return failure('INVALID_POSITION');
  const terrainPath = validateTerrainPath(state, model, target, path);
  const distance = terrainPath.ok ? terrainPath.value.totalMovementDistance : distanceTravelled(model.position, target);
  const allowance = effectiveCharacteristic(state, unit.id, 'MOVE', definitionFor(state, unit).stats.movement);
  const remaining = Math.max(0, allowance - model.movementUsed);
  if (distance > remaining + EPSILON) return { ...failure('EXCEEDS_ALLOWANCE'), distance, remaining };
  if (!terrainPath.ok) return terrainPath;
  const placement = validateFinalPosition(state, unit, model, target);
  if (!placement.ok) return { ...placement, distance, remaining };
  const totalUsed = Math.min(allowance, model.movementUsed + distance);
  return { ok: true, value: { distance, totalUsed, remaining: Math.max(0, allowance - totalUsed) } };
}
