import type { GameState, Unit } from '../models';
import type { SetupEventType } from './types';
export function setupEvent(s: GameState, u: Unit, type: SetupEventType, metadata: { method?: string; reason?: string; modelId?: string } = {}) {
  s.events.push({ type, sequence: s.events.length + 1, round: s.round, turn: s.turn, playerId: u.playerId, unitId: u.id, ...metadata });
}
