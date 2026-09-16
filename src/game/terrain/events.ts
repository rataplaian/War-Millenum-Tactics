import type { GameState, TerrainEvent } from '../models';
import { elevation } from './geometry';
import { areasForModel, isModelHidden } from './rules';
type Payload = TerrainEvent extends infer E ? E extends TerrainEvent ? Omit<E, 'sequence' | 'round' | 'turn' | 'playerId' | 'unitId'> : never : never;
/** Compare committed commands only. Read-only visibility queries never emit events. */
export function recordTerrainChanges(before: GameState, after: GameState): void {
  if (!before.battlefield.terrain && !after.battlefield.terrain) return;
  for (const unit of after.units) for (const model of unit.models.filter(m => m.alive)) {
    const original = before.units.flatMap(u => u.models).find(m => m.id === model.id);
    if (!original?.alive) continue;
    const emit = (payload: Payload) => after.events.push({ ...payload, sequence: after.events.length + 1, round: after.round, turn: after.turn, playerId: unit.playerId, unitId: unit.id } as TerrainEvent);
    const oldAreas = areasForModel(before, original).map(a => a.id), newAreas = areasForModel(after, model).map(a => a.id);
    for (const id of oldAreas.filter(id => !newAreas.includes(id))) emit({ type: 'model-left-terrain-area', modelId: model.id, areaId: id });
    for (const id of newAreas.filter(id => !oldAreas.includes(id))) emit({ type: 'model-entered-terrain-area', modelId: model.id, areaId: id });
    if (elevation(original.position) !== elevation(model.position)) emit({ type: 'model-changed-elevation', modelId: model.id, fromZ: elevation(original.position), toZ: elevation(model.position) });
    const hidden = isModelHidden(after, model);
    if (hidden !== isModelHidden(before, original)) emit({ type: hidden ? 'hidden-gained' : 'hidden-lost', modelId: model.id });
  }
}
