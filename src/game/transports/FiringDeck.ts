import type { CommandResult, GameState, RangedWeapon, Unit } from '../models';
import { capacityDefinition, passengers } from './capacity';
import { modelDefinition } from '../attachments/queries';
import { failure } from '../rules/movement';
import { flowEvent } from '../flow/events';
export function rangedLoadout(s: GameState, u: Unit): readonly RangedWeapon[] {
  const normal = s.definitions.find(d => d.id === u.definitionId)!.weapons.filter((w): w is RangedWeapon => w.kind === 'ranged');
  return [...normal, ...(s.shooting?.unitId === u.id ? s.shooting.firingDeck?.map(x => x.borrowed) ?? [] : [])];
}
export function firingDeckOptions(s: GameState, transportId: string) {
  return passengers(s, transportId).filter(u => u.selectedToShootAt?.turn !== s.turn && !u.state.hasShot && (u.cannotShootUntilTurn ?? 0) < s.turn).flatMap(u => u.models.filter(m => m.alive).flatMap(m => modelDefinition(s, u, m).weapons.filter(w => w.kind === 'ranged' && !w.traits.some(t => t.id.toUpperCase().replaceAll('_', ' ') === 'ONE SHOT')).map(w => ({ passengerUnitId: u.id, modelId: m.id, weaponId: w.id }))));
}
export function selectFiringDeck(s: GameState, unitId: string, selections: { modelId: string; weaponId: string }[]): CommandResult {
  const t = s.units.find(u => u.id === unitId)!;
  const limit = capacityDefinition(s, t)?.firingDeck ?? 0;
  if (selections.length > limit || new Set(selections.map(x => x.modelId)).size !== selections.length) return failure('FIRING_DECK_LIMIT');
  const options = firingDeckOptions(s, unitId);
  if (selections.some(x => !options.some(o => o.modelId === x.modelId && o.weaponId === x.weaponId))) return failure('INVALID_PASSENGER');
  s.shooting!.firingDeck = selections.map(x => {
    const match = options.find(o => o.modelId === x.modelId && o.weaponId === x.weaponId)!, u = s.units.find(u => u.id === match.passengerUnitId)!, m = u.models.find(m => m.id === x.modelId)!;
    const w = modelDefinition(s, u, m).weapons.find(w => w.id === x.weaponId) as RangedWeapon;
    return { ...match, borrowed: { ...JSON.parse(JSON.stringify(w)), id: `deck:${m.id}:${w.id}` } };
  });
  // Restriction applies to every embarked unit, including unselected passengers.
  for (const u of passengers(s, unitId)) u.cannotShootUntilTurn = s.turn;
  flowEvent(s, 'FIRING_DECK_SELECTED', { modelIds: selections.map(x => x.modelId), weaponIds: selections.map(x => x.weaponId) }, t.id, t.playerId);
  return { ok: true, value: undefined };
}

/** Provenance remains resolvable after the temporary loadout has been discarded. */
export function isRecordedDeckWeapon(s: GameState, transportId: string, weaponId: string): boolean {
  return s.events.some(e => e.type === 'flow' && e.name === 'FIRING_DECK_SELECTED' && e.unitId === transportId &&
    Array.isArray(e.detail.modelIds) && Array.isArray(e.detail.weaponIds) && e.detail.modelIds.some((id, i) => weaponId === `deck:${id}:${(e.detail.weaponIds as string[])[i]}`));
}
