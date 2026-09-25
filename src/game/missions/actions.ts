import { unitKeywords } from '../attachments/queries';
import { onBattlefield } from '../reserves/location';
import { isUnitEngaged } from '../rules/spatial';
import { failure } from '../rules/movement';
import { flowEvent } from '../flow/events';
import { effectiveModelOC, modelWithinObjective, secureObjective } from './objectives';
import type { CommandResult, GameState, Unit } from '../models';
import type { ActionDefinition, ActiveAction, ObjectiveState, ScoringWindow } from './types';
export function eligibleActionObjectives(s: GameState, u: Unit, a: ActionDefinition): ObjectiveState[] {
  return (s.mission?.objectives ?? []).filter(o => u.models.some(m => effectiveModelOC(s, u, m) > 0 && modelWithinObjective(s, m, o)) && (!a.requiresControl || o.controllingPlayerId === u.playerId));
}
export function canStartMissionAction(s: GameState, unitId: string, actionId: string, objectiveId?: string): CommandResult {
  const u = s.units.find(u => u.id === unitId), a = s.mission?.definition.actions.find(a => a.id === actionId);
  if (!s.mission || !s.flow) return failure('MISSION_NOT_FOUND');
  if (!u) return failure('UNIT_NOT_FOUND');
  if (!a) return failure('ACTION_NOT_FOUND');
  if (s.status !== 'in-progress') return failure('MATCH_FINISHED');
  if (s.flow.window || s.flow.pending.length || s.flow.boundary !== 'NONE') return failure('PHASE_BLOCKED');
  if (s.movement || s.shooting || s.closeCombat?.charge || s.closeCombat?.move || s.closeCombat?.fight?.selected) return failure('PHASE_BLOCKED');
  if (s.activePlayerId !== u.playerId) return failure('NOT_YOUR_UNIT');
  if (s.phase !== a.starts) return failure('WRONG_PHASE');
  if (!onBattlefield(u) || !u.models.some(m => m.alive)) return failure('NOT_ON_BATTLEFIELD');
  const words = unitKeywords(s, u);
  if (words.some(k => k === 'AIRCRAFT' || k === 'FORTIFICATION') || u.state.battleShocked ||
    !u.models.some(m => effectiveModelOC(s, u, m) > 0) || (isUnitEngaged(s, u) && !words.includes('TITANIC')) ||
    u.state.hasAdvanced || u.state.hasFallenBack ||
    (u.lastMove?.turn === s.turn && (u.lastMove.kind === 'ADVANCE_MOVE' || u.lastMove.kind === 'FALL_BACK_MOVE')) ||
    s.mission.activeActions.some(x => x.unitId === unitId && x.startedAt.turn === s.turn) ||
    (a.allowedKeywords?.length && !a.allowedKeywords.some(k => words.includes(k.toUpperCase())))) return failure('ACTION_INELIGIBLE');
  const used = s.mission.actionUses.filter(x => x.actionId === actionId && x.playerId === u.playerId && (a.useLimit.scope === 'BATTLE' || x.turn === s.turn)).length;
  if (used >= a.useLimit.count) return failure('USAGE_LIMIT');
  const eligible = eligibleActionObjectives(s, u, a);
  if (a.requiresObjective && (!eligible.length || !objectiveId || !eligible.some(o => o.id === objectiveId))) return failure('OBJECTIVE_NOT_CONTROLLED');
  if (objectiveId && (!s.mission.objectives.some(o => o.id === objectiveId) || !eligible.some(o => o.id === objectiveId))) return failure('OBJECTIVE_NOT_CONTROLLED');
  return { ok: true, value: undefined };
}
export function startMissionAction(s: GameState, unitId: string, actionId: string, objectiveId?: string): CommandResult {
  const gate = canStartMissionAction(s, unitId, actionId, objectiveId); if (!gate.ok) return gate;
  const def = s.mission!.definition.actions.find(a => a.id === actionId)!;
  const action: ActiveAction = { actionId, unitId, playerId: s.activePlayerId, objectiveId, startedAt: { round: s.round, turn: s.turn, phase: s.phase }, completesAt: def.completes, state: 'ACTIVE', source: def.id };
  s.mission!.activeActions.push(action); s.mission!.actionUses.push({ actionId, playerId: s.activePlayerId, turn: s.turn });
  flowEvent(s, 'ACTION_STARTED', { actionId, objectiveId: objectiveId ?? '' }, unitId);
  return { ok: true, value: undefined };
}
export function interruptAction(s: GameState, action: ActiveAction, reason: string) {
  if (action.state !== 'ACTIVE') return;
  action.state = 'INTERRUPTED'; action.reason = reason;
  flowEvent(s, 'ACTION_INTERRUPTED', { actionId: action.actionId, reason }, action.unitId, action.playerId);
}
/** Called on committed transactions; staged drag positions never interrupt an action. */
export function interruptActionsOnCommit(before: GameState, after: GameState) {
  const mission = after.mission; if (!mission) return;
  for (const action of mission.activeActions.filter(x => x.state === 'ACTIVE')) {
    const previous = before.units.find(u => u.id === action.unitId), current = after.units.find(u => u.id === action.unitId);
    if (!current || !onBattlefield(current) || !current.models.some(m => m.alive)) { interruptAction(after, action, 'LEFT_BATTLEFIELD'); continue; }
    if (!previous) continue;
    const combat = after.events.slice(before.events.length).some(e => e.unitId === action.unitId && e.type === 'combat-move-completed' && (e.kind === 'pile-in' || e.kind === 'consolidate'));
    const moved = current.models.some(m => {
      const old = previous.models.find(x => x.id === m.id);
      return old && (old.position.x !== m.position.x || old.position.y !== m.position.y || (old.position.z ?? 0) !== (m.position.z ?? 0));
    });
    if ((moved || current.lastMove?.turn === after.turn && current.lastMove !== previous.lastMove && JSON.stringify(current.lastMove) !== JSON.stringify(previous.lastMove)) && !combat) interruptAction(after, action, 'MOVED');
  }
}
export function completeMissionActions(s: GameState, timing: ScoringWindow, eventTurn: number) {
  for (const action of s.mission?.activeActions ?? []) {
    if (action.state !== 'ACTIVE' || action.completesAt !== timing || action.startedAt.turn !== eventTurn) continue;
    const unit = s.units.find(u => u.id === action.unitId), def = s.mission!.definition.actions.find(a => a.id === action.actionId)!;
    if (!unit || !onBattlefield(unit) || !unit.models.some(m => m.alive)) { action.state = 'FAILED'; flowEvent(s, 'ACTION_FAILED', { actionId: action.actionId, reason: 'LEFT_BATTLEFIELD' }, action.unitId, action.playerId); continue; }
    if (def.effect.kind === 'SECURE_OBJECTIVE' && (!action.objectiveId || !secureObjective(s, action.objectiveId, action.playerId, action.actionId))) { action.state = 'FAILED'; flowEvent(s, 'ACTION_FAILED', { actionId: action.actionId, reason: 'OBJECTIVE_LOST' }, action.unitId, action.playerId); continue; }
    action.state = 'COMPLETED'; flowEvent(s, 'ACTION_COMPLETED', { actionId: action.actionId, objectiveId: action.objectiveId ?? '', amount: def.effect.amount ?? 0 }, action.unitId, action.playerId);
  }
}
