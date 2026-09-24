import { pendingCoreChoices } from '../abilities/core';
import { expireEffects } from '../effects/EffectEngine';
import type { GameState, CommandResult } from '../models';
import type { TimingWindow, Trigger } from './types';
import { flowEvent } from './events';
import { failure } from '../rules/movement';
export function openWindow(s: GameState, trigger: Trigger, context: { unitId?: string; targetUnitId?: string; playerId?: string } = {}) {
  const f = s.flow; if (!f) return;
  const w: TimingWindow = { id: `window-${f.nextWindowId++}`, trigger, playerId: context.playerId ?? s.activePlayerId, ...context, passedPlayerIds: [] };
  if (f.window) f.queuedWindows.push(w);
  else { f.window = w; if (w.trigger === 'AT_START_OF_COMMAND_PHASE') expireEffects(s, 'COMMAND_START'); flowEvent(s, 'TIMING_WINDOW_OPENED', { windowId: w.id, trigger }, w.unitId); }
}
export function passWindow(s: GameState, playerId: string): CommandResult {
  const f = s.flow, w = f?.window;
  if (!f || !w) return failure('NO_TIMING_WINDOW');
  if (!s.players.some(p => p.id === playerId) || w.passedPlayerIds.includes(playerId)) return failure('INVALID_PLAYER');
  w.passedPlayerIds.push(playerId);
  if (w.passedPlayerIds.length === s.players.length) {
    flowEvent(s, 'TIMING_WINDOW_CLOSED', { windowId: w.id, trigger: w.trigger });
    f.window = f.queuedWindows.shift() ?? null;
    if (f.window?.trigger === 'AT_START_OF_COMMAND_PHASE') expireEffects(s, 'COMMAND_START');
    if (f.window) flowEvent(s, 'TIMING_WINDOW_OPENED', { windowId: f.window.id, trigger: f.window.trigger }, f.window.unitId);
  }
  return { ok: true, value: undefined };
}
export const temporalBlock = (s: GameState) => pendingCoreChoices(s).length ? failure('ABILITY_CHOICE_REQUIRED') : s.flow?.window ? failure('TIMING_WINDOW_OPEN') : s.flow?.pending.length ? failure('PENDING_RESOLUTION') : s.flow && s.flow.boundary !== 'NONE' ? failure('PHASE_BLOCKED') : null;
