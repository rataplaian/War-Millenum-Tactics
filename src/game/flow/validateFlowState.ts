import { rangedLoadout } from '../transports/FiringDeck';
import { historicalUnit } from '../attachments/queries';
import type { GameState } from '../models';
import { PHASES } from '../models';
import { COMMAND_STEPS } from './types';
import { battleStarted } from '../reserves/location';
const integer = (v: number, min = 0) => Number.isSafeInteger(v) && v >= min;
const fail = () => { throw new Error('Invalid match-flow snapshot'); };
const TRIGGERS = ['START_OF_PHASE', 'END_OF_PHASE', 'START_OF_TURN', 'END_OF_TURN', 'AT_START_OF_COMMAND_PHASE', 'AT_END_OF_COMMAND_PHASE', 'AFTER_ENEMY_FALL_BACK', 'AFTER_ENEMY_DESTROYED', 'BEFORE_CONSOLIDATE', 'AFTER_TARGET_SELECTED', 'AFTER_HIT_ROLL', 'AFTER_WOUND_ROLL', 'AFTER_UNIT_SHOT', 'AFTER_CHARGE_MOVE', 'AFTER_UNIT_FOUGHT', 'AFTER_BATTLE_SHOCK_FAILED'];
export function validateFlowState(s: GameState) {
  for (const p of s.players) if ((p.commandPoints !== undefined && !integer(p.commandPoints)) || (p.extraCpGainedThisBattleRound !== undefined && !integer(p.extraCpGainedThisBattleRound))) fail();
  for (const u of s.units) {
    if (u.state.battleShocked !== undefined && typeof u.state.battleShocked !== 'boolean') fail();
    for (const m of u.models) if (m.leadership !== undefined && !integer(m.leadership, 1)) fail();
  }
  const f = s.flow; if (!f) return;
  const player = (id: string) => s.players.some(p => p.id === id), unit = (id: string) => !!historicalUnit(s, id);
  if ((f.started && f.firstPlayerId !== (s.deployment?.firstTurnPlayerId ?? s.players[0].id)) || !player(f.firstPlayerId) || !integer(f.phaseIndex, 1) || f.phaseIndex !== (s.turn - 1) * 5 + PHASES.indexOf(s.phase) + 1 ||
    !integer(f.rules.maximumBattleRounds, 1) || f.rules.maximumBattleRounds < s.round || !integer(f.rules.maxExtraCpPerBattleRound) ||
    !integer(f.nextEffectId, 1) || !integer(f.nextWindowId, 1) || typeof f.started !== 'boolean' || typeof f.missionHookStarted !== 'boolean' ||
    (f.started !== battleStarted(s)) || s.players.some(p => p.commandPoints === undefined || p.extraCpGainedThisBattleRound === undefined) ||
    !['NONE', 'PHASE_END', 'TURN_END'].includes(f.boundary) || (f.boundary === 'TURN_END' && s.phase !== 'Fight') ||
    (f.commandStep !== null && (!COMMAND_STEPS.includes(f.commandStep) || s.phase !== 'Command')) ||
    (f.boundary !== 'NONE' && (f.commandStep || f.pending.length)) || (!f.window && f.queuedWindows.length)) fail();
  if (f.started && s.phase === 'Command' && f.commandStep === null && !s.events.some(e => e.type === 'flow' && e.name === 'COMMAND_STEP_COMPLETED' && e.turn === s.turn && e.detail.step === 'END_OF_COMMAND_PHASE')) fail();
  if (!Array.isArray(f.resolvedAbilities) || new Set(f.resolvedAbilities).size !== f.resolvedAbilities.length || f.resolvedAbilities.some(id => typeof id !== 'string' || !id)) fail();
  if (new Set(f.pending.map(p => p.id)).size !== f.pending.length) fail();
  for (const p of f.pending) {
    if (!p.id || !p.label || !['BATTLE_SHOCK', 'ABILITY', 'MISSION_HOOK', 'RULE'].includes(p.kind) || (p.unitId && !unit(p.unitId))) fail();
    if (p.kind === 'BATTLE_SHOCK' && (f.commandStep !== 'BATTLE_SHOCK' || !p.unitId || s.units.find(u => u.id === p.unitId)?.playerId !== s.activePlayerId)) fail();
    if ((p.kind === 'ABILITY' || p.kind === 'MISSION_HOOK') && (!f.commandStep || !p.resolverId)) fail();
  }
  const windows = [...(f.window ? [f.window] : []), ...f.queuedWindows];
  if (new Set(windows.map(w => w.id)).size !== windows.length) fail();
  for (const w of windows) if (!/^window-\d+$/.test(w.id) || Number(w.id.slice(7)) < 1 || Number(w.id.slice(7)) >= f.nextWindowId || !TRIGGERS.includes(w.trigger) || !player(w.playerId) ||
    (w.unitId && !unit(w.unitId)) || (w.targetUnitId && !unit(w.targetUnitId)) || w.passedPlayerIds.length >= 2 || new Set(w.passedPlayerIds).size !== w.passedPlayerIds.length || w.passedPlayerIds.some(id => !player(id))) fail();
  if (new Set(f.effects.map(e => e.id)).size !== f.effects.length) fail();
  for (const e of f.effects) {
    if (!/^effect-\d+$/.test(e.id) || Number(e.id.slice(7)) < 1 || Number(e.id.slice(7)) >= f.nextEffectId || !e.source || !unit(e.target.unitId) || !player(e.expiryPlayerId) || typeof e.active !== 'boolean' ||
      !integer(e.createdAt.turn, 1) || e.createdAt.turn > s.turn || !integer(e.createdAt.round, 1) || e.createdAt.round > s.round || !integer(e.createdAt.phaseIndex, 1) || e.createdAt.phaseIndex > f.phaseIndex || !player(e.createdAt.playerId) || !PHASES.includes(e.createdAt.phase) ||
      !['STACK', 'REPLACE_SAME_SOURCE', 'NON_STACKING', 'HIGHEST_ONLY'].includes(e.stacking) ||
      !['END_OF_CURRENT_PHASE', 'END_OF_CURRENT_TURN', 'END_OF_BATTLE_ROUND', 'START_OF_NEXT_COMMAND_PHASE', 'END_OF_NEXT_COMMAND_PHASE', 'UNTIL_EXPLICITLY_REMOVED'].includes(e.expiry)) fail();
    if (e.payload.kind === 'MODIFIER') {
      if (!['MOVE', 'BS', 'WS', 'SAVE', 'LEADERSHIP', 'OC', 'HIT_ROLL', 'WOUND_ROLL', 'ATTACKS', 'DAMAGE', 'AP', 'STRENGTH'].includes(e.payload.characteristic) || !Number.isFinite(e.payload.value)) fail();
    } else if (e.payload.kind !== 'FLAG' || !e.payload.flag || typeof e.payload.value !== 'boolean') fail();
  }
  for (const u of f.usage) if (!u.stratagemId || !player(u.playerId) || !u.targetIds.length || new Set(u.targetIds).size !== u.targetIds.length || u.targetIds.some(id => !unit(id)) || !integer(u.phaseIndex, 1) || u.phaseIndex > f.phaseIndex || !integer(u.turn, 1) || u.turn > s.turn || !integer(u.round, 1) || u.round > s.round) fail();
  const selected = s.shooting?.selectedTarget;
  if (selected && (!unit(selected.targetUnitId) || !rangedLoadout(s, s.units.find(u => u.id === s.shooting!.unitId)!).some(w => w.id === selected.weaponId && w.kind === 'ranged') || s.shooting!.firedWeaponIds.includes(selected.weaponId))) fail();
}
