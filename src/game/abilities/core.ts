import type { GameState, Model, Unit } from '../models';
import { abilitiesFor } from '../deployment/abilities';
/** 24.02: duplicates require a stable, serializable instance selection. Scouts keeps 24.31. */
export function pendingCoreChoices(s: GameState) {
    return s.units.flatMap(u => u.models.filter(m => m.alive).flatMap(m => {
        const abilities = abilitiesFor(s, u, m);
        return [...new Set(abilities.map(a => a.kind))].filter(kind => kind !== 'SCOUTS' && abilities.filter(a => a.kind === kind).length > 1 && m.coreAbilityChoices?.[kind] === undefined).map(kind => ({ unitId: u.id, modelId: m.id, kind }));
    }));
}
export function chosenCore(s: GameState, u: Unit, m: Model, kind: string) {
    const instances = abilitiesFor(s, u, m).filter(a => a.kind === kind);
    // Commands are blocked by pendingCoreChoices before this fallback can resolve an action.
    const selected = instances[m.coreAbilityChoices?.[kind] ?? 0];
    return selected ? [selected] : [];
}
