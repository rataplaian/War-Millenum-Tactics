import { isRecordedDeckWeapon, rangedLoadout } from '../transports/FiringDeck';
import { historicalUnit } from '../attachments/queries';
import { SETUP_EVENT_TYPES } from '../setup/types';
import { onBattlefield } from '../reserves/location';
import type { GameState } from '../models';
import { definitionFor } from '../rules/movement';
const EVENT_TYPES: readonly string[] = [...SETUP_EVENT_TYPES, 'movement-started', 'model-moved', 'movement-cancelled', 'movement-completed',
  'charge-declared', 'charge-rolled', 'charge-target-selected', 'charge-failed', 'combat-move-started', 'combat-model-moved', 'combat-move-completed', 'combat-move-cancelled', 'fight-unit-selected', 'fight-unit-completed', 'fight-unit-cancelled', 'overrun-fight', 'melee-attack-started', 'melee-attack-resolved',
  'model-entered-terrain-area', 'model-left-terrain-area', 'model-changed-elevation', 'hidden-gained', 'hidden-lost', 'cover-applied', 'plunging-fire-applied',
  'shooting-started', 'weapon-fired', 'model-damaged', 'model-destroyed', 'shooting-cancelled', 'shooting-completed'];
export function validateShootingState(state: GameState): void {
  const blockers = state.battlefield.losBlockers;
  if (new Set(blockers.map(b => b.id)).size !== blockers.length || blockers.some(b => !b.id || b.kind !== 'rectangle' ||
      typeof b.opaque !== 'boolean' || !Number.isFinite(b.position.x) || !Number.isFinite(b.position.y) ||
      !Number.isFinite(b.width) || b.width <= 0 || !Number.isFinite(b.height) || b.height <= 0 ||
      b.position.x < 0 || b.position.y < 0 || b.position.x + b.width > state.battlefield.width ||
      b.position.y + b.height > state.battlefield.height)) throw new Error('Invalid LOS blocker');
  for (const [i, event] of state.events.entries()) {
    if (event.type === 'flow') {
      if (event.sequence !== i + 1 || !state.players.some(p => p.id === event.playerId) || (event.unitId && !historicalUnit(state, event.unitId)) || !Number.isSafeInteger(event.turn) || event.turn < 1 || event.turn > state.turn || event.round !== Math.floor((event.turn - 1) / 2) + 1) throw new Error('Invalid flow event context');
      continue;
    }
    const source = historicalUnit(state, event.unitId);
    if (!EVENT_TYPES.includes(event.type) || event.sequence !== i + 1 || !source || event.playerId !== source.playerId ||
        !Number.isSafeInteger(event.turn) || event.turn < 1 || event.turn > state.turn ||
        event.round !== Math.floor((event.turn - 1) / 2) + 1 ||
        (!SETUP_EVENT_TYPES.some(t => t === event.type) && !['model-entered-terrain-area', 'model-left-terrain-area', 'model-changed-elevation', 'hidden-gained', 'hidden-lost'].includes(event.type) && !event.type.startsWith('combat-') && !event.type.startsWith('fight-') && !event.type.startsWith('melee-') && !event.type.startsWith('charge-') && event.type !== 'overrun-fight' && state.players[((event.turn - 1) + (state.deployment?.stage === 'BATTLE_STARTED' ? state.players.findIndex(p => p.id === state.deployment!.firstTurnPlayerId) : 0)) % 2]!.id !== event.playerId)) throw new Error('Invalid event context');
    if (event.type === 'weapon-fired' || event.type === 'model-damaged' || event.type === 'model-destroyed') {
      const weaponId = event.type === 'weapon-fired' ? event.resolution.weaponId : event.weaponId;
      const targetId = event.type === 'weapon-fired' ? event.resolution.targetUnitId : event.targetUnitId;
      const target = historicalUnit(state, targetId);
      if (!target || target.playerId === source.playerId ||
          (!definitionFor(state, source).weapons.some(w => w.id === weaponId && w.kind === 'ranged') && !isRecordedDeckWeapon(state, source.id, weaponId))) throw new Error('Invalid shooting event references');
      if (event.type === 'model-destroyed' && !target.models.some(m => m.id === event.modelId)) throw new Error('Invalid casualty reference');
      if (event.type === 'model-damaged' && !target.models.some(m => m.id === event.damage.modelId)) throw new Error('Invalid damage reference');
      if (event.type === 'weapon-fired' && event.resolution.eligibleFiringModelIds.some(id => !source.models.some(m => m.id === id))) throw new Error('Invalid firing model reference');
    }
  }
  if (!state.shooting) return;
  const transaction = state.shooting;
  const source = state.units.find(u => u.id === transaction.unitId);
  if (state.movement || state.phase !== 'Shooting' || state.status !== 'in-progress' || !source || !onBattlefield(source) ||
      source.playerId !== state.activePlayerId || source.state.hasShot || !source.models.some(m => m.alive) ||
      typeof transaction.hasRolled !== 'boolean') throw new Error('Invalid shooting transaction');
  const weapons = rangedLoadout(state, source);
  if ((!weapons.some(w => w.kind === 'ranged') && !definitionFor(state, source).transport?.firingDeck) || new Set(transaction.firedWeaponIds).size !== transaction.firedWeaponIds.length ||
      transaction.firedWeaponIds.some(id => !weapons.some(w => w.id === id && w.kind === 'ranged'))) throw new Error('Invalid fired weapon references');
  const start = state.events.reduce((last, e, i) => e.type === 'shooting-started' && e.unitId === source.id && e.turn === state.turn ? i : last, -1);
  if (start < 0) throw new Error('Missing shooting-started event');
  const actionEvents = state.events.slice(start + 1).filter(e => e.type !== 'flow');
  if (actionEvents.some(e => e.type === 'shooting-cancelled' || e.type === 'shooting-completed' || e.unitId !== source.id || e.turn !== state.turn)) throw new Error('Invalid open shooting history');
  const shots = actionEvents.filter(e => e.type === 'weapon-fired');
  if (shots.length !== transaction.firedWeaponIds.length || shots.some((e, i) => e.resolution.weaponId !== transaction.firedWeaponIds[i]) ||
      transaction.hasRolled !== (!!state.attackJob || shots.some(e => e.resolution.hitRolls.length > 0 || e.resolution.woundRolls.length > 0 || e.resolution.attackCounts.some(a => a.resolved.rolls.length > 0)))) throw new Error('Shooting history mismatch');
}
