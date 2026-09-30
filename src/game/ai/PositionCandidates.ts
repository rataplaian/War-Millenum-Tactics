import type { GameState, Position, Unit } from '../models';
import type { Formation } from '../setup/types';
import { baseRadius } from '../utils/geometry';

/** Strategic suggestions only. Setup/terrain/coherency authority belongs to GameEngine. */
export function formationAt(unit: Unit, anchor: Position): Formation {
  const models = unit.models.filter(model => model.alive);
  const spacing = Math.max(...models.map(model => baseRadius(model.base) * 2), 1) + 0.15;
  const columns = Math.max(1, Math.ceil(Math.sqrt(models.length)));
  return Object.fromEntries(models.map((model, index) => [model.id, {
    x: anchor.x + (index % columns) * spacing,
    y: anchor.y + Math.floor(index / columns) * spacing,
    z: anchor.z ?? 0,
  }]));
}

export function setupAnchors(state: GameState, playerId: string): Position[] {
  const ownZone = state.deployment?.zones.find(zone => zone.playerId === playerId);
  const points = ownZone?.footprint.vertices ?? [];
  const minY = points.length ? Math.min(...points.map(point => point.y)) : 2;
  const maxY = points.length ? Math.max(...points.map(point => point.y)) : state.battlefield.height - 2;
  const anchors: Position[] = [];
  for (const y of [minY + 1.5, minY + 4, maxY - 3.5])
    for (let x = 2; x < state.battlefield.width - 2; x += 3.5)
      anchors.push({ x, y, z: 0 });
  return anchors;
}

export function moveCandidates(state: GameState, unit: Unit, modelId: string): Position[] {
  const model = unit.models.find(m => m.id === modelId)!;
  const characteristic = state.definitions.find(d => d.id === (model.sourceDefinitionId ?? unit.definitionId))?.stats.movement ?? 6;
  const objectives = state.mission?.objectives.map(o => state.battlefield.terrain?.areas.find(a => a.id === o.terrainAreaId))
    .filter((a): a is NonNullable<typeof a> => !!a).map(a => ({ x: a.footprint.vertices.reduce((v,p) => v+p.x,0)/a.footprint.vertices.length,
      y: a.footprint.vertices.reduce((v,p) => v+p.y,0)/a.footprint.vertices.length })) ?? [];
  const targets = [...objectives, ...state.units.filter(u => u.playerId !== unit.playerId && u.location === 'BATTLEFIELD')
    .flatMap(u => u.models.filter(m => m.alive).slice(0, 1).map(m => m.position))];
  return targets.flatMap(target => [0.5, 0.8, 1].map(fraction => {
    const dx = target.x-model.position.x, dy = target.y-model.position.y;
    const distance = Math.hypot(dx,dy) || 1;
    const step = Math.min(characteristic * fraction, Math.max(0,distance-1.5));
    return { x: model.position.x + dx/distance*step, y: model.position.y + dy/distance*step, z: model.position.z ?? 0 };
  }));
}
