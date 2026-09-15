import type { GameState } from '../models';
import { definitionFor } from '../rules/movement';
const EVENT_TYPES = ['movement-started', 'model-moved', 'movement-cancelled', 'movement-completed',
  'shooting-started', 'weapon-fired', 'model-damaged', 'model-destroyed', 'shooting-cancelled', 'shooting-completed'];
export function validateShootingState(state: GameState): void {
  const blockers = state.battlefield.losBlockers;
  if (new Set(blockers.map(b => b.id)).size !== blockers.length || blockers.some(b => !b.id || b.kind !== 'rectangle' ||
      typeof b.opaque !== 'boolean' || !Number.isFinite(b.position.x) || !Number.isFinite(b.position.y) ||
      !Number.isFinite(b.width) || b.width <= 0 || !Number.isFinite(b.height) || b.height <= 0 ||
      b.position.x < 0 || b.position.y < 0 || b.position.x + b.width > state.battlefield.width ||
      b.position.y + b.height > state.battlefield.height)) throw new Error('Invalid LOS blocker');
  for (const [i, event] of state.events.entries()) {
    const source = state.units.find(u => u.id === event.unitId);
    if (!EVENT_TYPES.includes(event.type) || event.sequence !== i + 1 || !source || event.playerId !== source.playerId ||
        !Number.isSafeInteger(event.turn) || event.turn < 1 || event.turn > state.turn ||
        event.round !== Math.floor((event.turn - 1) / 2) + 1 ||
        state.players[(event.turn - 1) % 2]!.id !== event.playerId) throw new Error('Invalid event context');
    if (event.type === 'weapon-fired' || event.type === 'model-damaged' || event.type === 'model-destroyed') {
      const weaponId = event.type === 'weapon-fired' ? event.resolution.weaponId : event.weaponId;
      const targetId = event.type === 'weapon-fired' ? event.resolution.targetUnitId : event.targetUnitId;
      const target = state.units.find(u => u.id === targetId);
      if (!target || target.playerId === source.playerId ||
          !definitionFor(state, source).weapons.some(w => w.id === weaponId && w.kind === 'ranged')) throw new Error('Invalid shooting event references');
      if (event.type === 'model-destroyed' && !target.models.some(m => m.id === event.modelId)) throw new Error('Invalid casualty reference');
      if (event.type === 'model-damaged' && !target.models.some(m => m.id === event.damage.modelId)) throw new Error('Invalid damage reference');
      if (event.type === 'weapon-fired' && event.resolution.eligibleFiringModelIds.some(id => !source.models.some(m => m.id === id))) throw new Error('Invalid firing model reference');
    }
  }
  if (!state.shooting) return;
  const transaction = state.shooting;
  const source = state.units.find(u => u.id === transaction.unitId);
  if (state.movement || state.phase !== 'Shooting' || state.status !== 'in-progress' || !source ||
      source.playerId !== state.activePlayerId || source.state.hasShot || !source.models.some(m => m.alive) ||
      typeof transaction.hasRolled !== 'boolean') throw new Error('Invalid shooting transaction');
  const weapons = definitionFor(state, source).weapons;
  if (!weapons.some(w => w.kind === 'ranged') || new Set(transaction.firedWeaponIds).size !== transaction.firedWeaponIds.length ||
      transaction.firedWeaponIds.some(id => !weapons.some(w => w.id === id && w.kind === 'ranged'))) throw new Error('Invalid fired weapon references');
  const start = state.events.reduce((last, e, i) => e.type === 'shooting-started' && e.unitId === source.id && e.turn === state.turn ? i : last, -1);
  if (start < 0) throw new Error('Missing shooting-started event');
  const actionEvents = state.events.slice(start + 1);
  if (actionEvents.some(e => e.type === 'shooting-cancelled' || e.type === 'shooting-completed' || e.unitId !== source.id || e.turn !== state.turn)) throw new Error('Invalid open shooting history');
  const shots = actionEvents.filter(e => e.type === 'weapon-fired');
  if (shots.length !== transaction.firedWeaponIds.length || shots.some((e, i) => e.resolution.weaponId !== transaction.firedWeaponIds[i]) ||
      transaction.hasRolled !== shots.some(e => e.resolution.hitRolls.length > 0 || e.resolution.attackCounts.some(a => a.resolved.rolls.length > 0))) throw new Error('Shooting history mismatch');
}
