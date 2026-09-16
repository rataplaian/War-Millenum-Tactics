import type { GameState, Unit } from '../models';
/** Missing location is explicitly the legacy battlefield default. Off-field coordinates are inert. */
export const locationOf = (unit: Unit) => unit.location ?? (unit.models.some(m => m.alive) ? 'BATTLEFIELD' : 'DESTROYED');
export const onBattlefield = (unit: Unit) => (unit.location ?? 'BATTLEFIELD') === 'BATTLEFIELD';
export const battleStarted = (state: GameState) => !state.deployment || state.deployment.stage === 'BATTLE_STARTED';
export const setupBusy = (state: GameState) => !!state.setup || !!state.scout;
export const actionBusy = (state: GameState) => setupBusy(state) || !!state.movement || !!state.shooting || !!state.closeCombat?.charge || !!state.closeCombat?.move || !!state.closeCombat?.fight?.selected;
export const arrivalLocked = (unit: Unit) => !!unit.moveLock;
export function normalizeDestroyed(state: GameState) {
  for (const unit of state.units) if (unit.location !== undefined && !unit.models.some(m => m.alive)) { unit.location = 'DESTROYED'; delete unit.moveLock; }
}
