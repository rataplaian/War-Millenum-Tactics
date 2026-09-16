import type { GameState } from '../models';
import type { FlowEvent, FlowEventName } from './types';
export function flowEvent(s: GameState, name: FlowEventName, detail: FlowEvent['detail'] = {}, unitId = '', playerId = s.activePlayerId) {
  s.events.push({ type: 'flow', name, detail, unitId, playerId, round: s.round, turn: s.turn, sequence: s.events.length + 1 });
}
