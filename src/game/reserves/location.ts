import type { GameState, Unit } from '../models';
/** Missing location is explicitly the legacy battlefield default. Off-field coordinates are inert. */
export const locationOf = (unit: Unit) => unit.location ?? (unit.models.some(m => m.alive) ? 'BATTLEFIELD' : 'DESTROYED');
export const onBattlefield = (unit: Unit) => (unit.location ?? 'BATTLEFIELD') === 'BATTLEFIELD';
export const battleStarted = (state: GameState) => !state.deployment || state.deployment.stage === 'BATTLE_STARTED';
export const setupBusy = (state: GameState) => !!state.destructionQueue?.some(q => !q.resolved && !q.waitForAttackerId) || !!state.setup || !!state.scout || !!state.transportState?.disembark || !!state.transportState?.destroyed.length || !!state.transportState?.tacticalFollowUp;
export const actionBusy = (state: GameState) => setupBusy(state) || !!state.movement || !!state.shooting || !!state.closeCombat?.charge || !!state.closeCombat?.move || !!state.closeCombat?.fight?.selected;
export const arrivalLocked = (unit: Unit) => !!unit.moveLock;
export function normalizeDestroyed(state: GameState) {
  for (const unit of state.units) if (unit.location !== undefined && state.transportState?.disembark?.unitId !== unit.id && !state.transportState?.destroyed.some(x => x.transportId === unit.id) && !unit.models.some(m => m.alive)) { unit.location = 'DESTROYED'; delete unit.moveLock; delete unit.embarked; }
}
