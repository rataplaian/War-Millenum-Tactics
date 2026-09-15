import type { BattlefieldDimensions, Position } from '../game/models';
export interface Viewport { width: number; height: number }
/** Uniform scale + letterboxing. This module contains no game rules. */
export function coordinateTransform(field: BattlefieldDimensions, viewport: Viewport) {
  if (![field.width, field.height, viewport.width, viewport.height].every(n => Number.isFinite(n) && n > 0)) {
    throw new Error('Coordinate dimensions must be positive');
  }
  const scale = Math.min(viewport.width / field.width, viewport.height / field.height);
  const offset = { x: (viewport.width - field.width * scale) / 2, y: (viewport.height - field.height * scale) / 2 };
  return {
    scale,
    gameToScreen: (p: Position): Position => ({ x: p.x * scale + offset.x, y: p.y * scale + offset.y }),
    screenToGame: (p: Position): Position => ({ x: (p.x - offset.x) / scale, y: (p.y - offset.y) / scale }),
  };
}
