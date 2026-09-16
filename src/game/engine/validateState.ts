import { validateFlowState } from '../flow/validateFlowState';
import { onBattlefield } from '../reserves/location';
import { validateDeploymentState } from './validateDeploymentState';
import { modelsOverlap } from '../terrain/geometry';
import { validateTerrainState } from './validateTerrainState';
import { validateCloseCombatState } from './validateCloseCombatState';
import { PHASES, type GameState } from '../models';
import { baseInsideBattlefield, basesOverlap, distanceTravelled, EPSILON, isFinitePosition } from '../utils/geometry';
import { definitionFor } from '../rules/movement';
import { validateWeapon } from '../rules/weaponValues';
import { validateShootingState } from './validateShootingState';
const nonNegative = (n: number) => Number.isFinite(n) && n >= 0;
/** Core integrity checks on typed snapshots; not an untrusted JSON schema parser. */
export function validateState(state: GameState): void {
  if (state.schemaVersion !== 3 || !state.id || !Number.isSafeInteger(state.round) || state.round < 1 ||
      !Number.isSafeInteger(state.turn) || state.turn < 1 || !PHASES.includes(state.phase) ||
      !['in-progress', 'finished'].includes(state.status)) throw new Error('Invalid match state (schema 3 required)');
  if (state.players.length !== 2 || new Set(state.players.map(p => p.id)).size !== 2 ||
      state.players.some(p => !p.id || !p.factionId) || !state.players.some(p => p.id === state.activePlayerId)) throw new Error('Invalid players');
  if (state.round !== Math.floor((state.turn - 1) / 2) + 1 || state.activePlayerId !== state.players[((state.turn - 1) + (state.deployment?.stage === 'BATTLE_STARTED' ? state.players.findIndex(p => p.id === state.deployment!.firstTurnPlayerId) : 0)) % 2]!.id) throw new Error('Inconsistent turn');
  if (!Number.isFinite(state.battlefield.width) || state.battlefield.width <= 0 ||
      !Number.isFinite(state.battlefield.height) || state.battlefield.height <= 0) throw new Error('Invalid battlefield');
  const { coherency, engagementDistance } = state.spatialRules;
  if (!nonNegative(engagementDistance) || !nonNegative(coherency.maxEdgeDistance) || typeof coherency.requireConnected !== 'boolean' ||
      !coherency.sizeBands.length || coherency.sizeBands[0]!.minModels !== 1 ||
      coherency.sizeBands.some((b, i) => !Number.isSafeInteger(b.minModels) || b.minModels < 1 ||
        !Number.isSafeInteger(b.requiredNeighbours) || b.requiredNeighbours < 0 ||
        (i > 0 && b.minModels <= coherency.sizeBands[i - 1]!.minModels))) throw new Error('Invalid spatial rules');
  if (!state.definitions.length || new Set(state.definitions.map(d => d.id)).size !== state.definitions.length) throw new Error('Invalid catalog');
  for (const d of state.definitions) {
    if (!d.id || !d.factionId || !Number.isSafeInteger(d.modelCount) || d.modelCount < 1 ||
        !Number.isSafeInteger(d.stats.leadership) || d.stats.leadership < 1 || !Number.isSafeInteger(d.stats.objectiveControl) || d.stats.objectiveControl < 0 || !Number.isSafeInteger(d.stats.wounds) || d.stats.wounds < 1 || !nonNegative(d.stats.movement) ||
        d.defaultBase.kind !== 'circle' || !Number.isFinite(d.defaultBase.diameterMm) || d.defaultBase.diameterMm <= 0) throw new Error('Invalid definition');
  }
  for (const definition of state.definitions) {
    if (!Number.isSafeInteger(definition.stats.toughness) || definition.stats.toughness < 1 ||
        !Number.isInteger(definition.stats.save) || definition.stats.save < 2 || definition.stats.save > 7 ||
        new Set(definition.weapons.map(w => w.id)).size !== definition.weapons.length) throw new Error('Invalid shooting statistics or weapon IDs');
    for (const weapon of definition.weapons) validateWeapon(weapon);
  }
  const ids = [...state.armies.map(a => a.id), ...state.units.map(u => u.id), ...state.units.flatMap(u => u.models.map(m => m.id))];
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) throw new Error('Duplicate or empty entity IDs');
  if (state.armies.length !== 2 || state.players.some(p => state.armies.filter(a => a.playerId === p.id && a.factionId === p.factionId).length !== 1)) throw new Error('Invalid armies');
  const references = state.armies.flatMap(a => a.unitIds);
  if (references.length !== state.units.length || new Set(references).size !== references.length || references.some(id => !state.units.some(u => u.id === id))) throw new Error('Invalid unit references');
  for (const unit of state.units) {
    const d = definitionFor(state, unit);
    const army = state.armies.find(a => a.unitIds.includes(unit.id));
    if (!army || army.playerId !== unit.playerId || army.factionId !== d.factionId || unit.models.length !== d.modelCount) throw new Error('Invalid unit ownership or model count');
    for (const model of unit.models) {
      if (model.unitId !== unit.id || !Number.isInteger(model.woundsRemaining) || model.woundsRemaining < 0 || model.woundsRemaining > d.stats.wounds ||
          model.alive !== (model.woundsRemaining > 0) || !isFinitePosition(model.position) ||
          model.base.kind !== 'circle' || !Number.isFinite(model.base.diameterMm) || model.base.diameterMm <= 0 ||
          !nonNegative(model.movementUsed) || (!state.flow && model.movementUsed > d.stats.movement + EPSILON) ||
          (onBattlefield(unit) && model.alive && !baseInsideBattlefield(model, state.battlefield))) throw new Error('Invalid model');
    }
  }
  const living = state.units.filter(onBattlefield).flatMap(u => u.models).filter(m => m.alive);
  if (living.some((a, i) => living.slice(i + 1).some(b => modelsOverlap(a, b)))) throw new Error('Overlapping live bases');
  if (state.movement) {
    const unit = state.units.find(u => u.id === state.movement!.unitId);
    if (!unit || !onBattlefield(unit) || state.phase !== 'Movement' || state.status !== 'in-progress' || unit.playerId !== state.activePlayerId || unit.state.hasMoved) throw new Error('Invalid movement transaction');
    const originals = state.movement.originals;
    if (originals.length !== unit.models.length || new Set(originals.map(o => o.modelId)).size !== originals.length) throw new Error('Invalid movement originals');
    for (const original of originals) {
      const model = unit.models.find(m => m.id === original.modelId);
      if (!model || !isFinitePosition(original.position) || !nonNegative(original.movementUsed) ||
          original.movementUsed > model.movementUsed + EPSILON ||
          distanceTravelled(original.position, model.position) > model.movementUsed - original.movementUsed + EPSILON ||
          (onBattlefield(unit) && model.alive && !baseInsideBattlefield({ ...model, position: original.position }, state.battlefield))) throw new Error('Invalid movement original');
    }
    // Cancel must also produce a collision-free state, including against other units.
    const restored = living.map(m => ({ ...m, position: originals.find(o => o.modelId === m.id)?.position ?? m.position }));
    if (restored.some((a, i) => restored.slice(i + 1).some(b => modelsOverlap(a, b)))) throw new Error('Overlapping movement originals');
  }
  if (state.events.some((event, i) => event.sequence !== i + 1 || (event.type !== 'flow' && !state.units.some(u => u.id === event.unitId)))) throw new Error('Invalid event sequence');
  validateFlowState(state);
  validateShootingState(state);
  validateCloseCombatState(state);
  validateTerrainState(state);
  validateDeploymentState(state);
}
