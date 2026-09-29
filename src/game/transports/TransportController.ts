import type { CommandResult, GameState, Position, Unit } from '../models';
import { failure } from '../rules/movement';
import { canEmbarkUnit, capacityDefinition, passengers } from './capacity';
import { edgeDistance, EPSILON } from '../utils/geometry';
import { onBattlefield, actionBusy } from '../reserves/location';
import { flowEvent } from '../flow/events';
import { setupConstraints } from '../setup/SetupController';
import { searchDisembark, validateDisembarkFormation } from './placement';
import { resolveHazardRolls } from './HazardRoll';
import type { RandomSource } from '../utils/dice';
import type { DisembarkMode, DisembarkTransaction } from './types';
import type { Formation } from '../setup/types';
const success = (): CommandResult => ({ ok: true, value: undefined });
export const transportState = (s: GameState) => s.transportState ??= { disembark: null, destroyed: [] };
export function embark(s: GameState, unitId: string, transportId: string, beforeBattle = false): CommandResult {
  const u = s.units.find(u => u.id === unitId), t = s.units.find(u => u.id === transportId);
  if (!u || !t) return failure('UNIT_NOT_FOUND');
  const legal = canEmbarkUnit(s, t, u); if (!legal.ok) return legal;
  if (beforeBattle) {
    if (s.deployment?.stage !== 'DECLARE_BATTLE_FORMATIONS' || actionBusy(s) || !['RESERVES', 'STRATEGIC_RESERVES'].includes(u.location ?? '')) return failure('WRONG_PRE_BATTLE_STEP');
    if (s.deployment.initialReserveIds.includes(u.id)) return failure('INVALID_PASSENGER');
  } else {
    if (s.phase !== 'Movement' || u.playerId !== s.activePlayerId || !onBattlefield(t) || !onBattlefield(u)) return failure('WRONG_PHASE');
    if (s.movement?.unitId !== u.id) return failure('NO_ACTIVE_MOVEMENT');
    if (u.setupAtTurn === s.turn || u.arrival?.turn === s.turn) return failure('SET_UP_THIS_TURN');
    const model = t.models.find(m => m.alive)!;
    if (u.models.some(m => m.alive && edgeDistance(m, model) > 3 + EPSILON)) return failure('TOO_FAR_FROM_TRANSPORT');
  }
  if (beforeBattle && s.deployment?.initialReserveIds.includes(t.id)) {
    const total = s.units.filter(p => s.deployment!.initialReserveIds.includes(p.id) || (p.embarked && s.deployment!.initialReserveIds.includes(p.embarked.transportId))).filter(p => p.playerId === u.playerId).reduce((n, p) => n + (s.definitions.find(d => d.id === p.definitionId)!.points ?? 0), 0);
    if (total + (s.definitions.find(d => d.id === u.definitionId)!.points ?? 0) > s.deployment.pointsLimit * s.deployment.rules.strategicReservePointsLimitRatio) return failure('RESERVE_POINTS_LIMIT');
  }
  u.location = 'EMBARKED'; u.embarked = { transportId, embarkedAtTurn: s.turn, embarkedAtPhase: s.phase, preBattle: beforeBattle };
  flowEvent(s, 'UNIT_EMBARKED', { transportId, beforeBattle }, u.id, u.playerId); return success();
}
/** Called immediately after damage commits, before destruction normalization. */
export function detectDestroyedTransports(s: GameState) {
  for (const t of s.units.filter(t => capacityDefinition(s, t) && !t.models.some(m => m.alive))) {
    if (!passengers(s, t.id).length || s.transportState?.destroyed.some(x => x.transportId === t.id)) continue;
    const frozenModel = { ...JSON.parse(JSON.stringify(t.models[0]!)), alive: true };
    transportState(s).destroyed.push({ transportId: t.id, frozenModel, remainingPassengerIds: passengers(s, t.id).map(u => u.id) });
    flowEvent(s, 'EMERGENCY_DISEMBARK_STARTED', { passengerIds: passengers(s, t.id).map(u => u.id) }, t.id, t.playerId);
  }
}
export class TransportController {
  constructor(private s: GameState) {}
  mode(unitId: string, candidate?: Formation): CommandResult<{ mode: DisembarkMode; formation: Formation | null }> {
    const s = this.s, u = s.units.find(u => u.id === unitId), t = s.units.find(t => t.id === u?.embarked?.transportId);
    if (!u || u.location !== 'EMBARKED' || !t) return failure('NOT_EMBARKED');
    const emergency = s.transportState?.destroyed[0];
    if (emergency) return emergency.remainingPassengerIds.includes(unitId) ? { ok: true, value: { mode: 'EMERGENCY', formation: null } } : failure('DISEMBARK_NOT_ALLOWED');
    if (!onBattlefield(t) || !t.models.some(m => m.alive) || s.phase !== 'Movement' || u.playerId !== s.activePlayerId) return failure('WRONG_PHASE');
    if (!u.embarked!.preBattle && u.embarked!.embarkedAtTurn === s.turn && u.embarked!.embarkedAtPhase === s.phase) return failure('DISEMBARK_NOT_ALLOWED');
    const move = t.lastMove?.turn === s.turn && t.lastMove.phase === s.phase ? t.lastMove.kind : null;
    const rules = capacityDefinition(s, t)!;
    if (move === 'FALL_BACK_MOVE' || t.state.hasFallenBack) return failure('DISEMBARK_NOT_ALLOWED');
    if (move === 'ADVANCE_MOVE' || t.state.hasAdvanced) return rules.afterAdvance === 'SHOCK' ? { ok: true, value: { mode: 'SHOCK', formation: null } } : failure('DISEMBARK_NOT_ALLOWED');
    if (move === 'NORMAL_MOVE' && rules.afterNormalMove === 'ASSAULT') return { ok: true, value: { mode: 'ASSAULT', formation: null } };
    if (move === 'NORMAL_MOVE' || move === 'INGRESS_MOVE' || t.arrival?.turn === s.turn || t.state.hasMoved) return { ok: true, value: { mode: 'RAPID', formation: null } };
    if (candidate) { const valid = validateDisembarkFormation(s, u, t.models.find(m => m.alive)!, candidate, 3, {}); if (!valid.ok) return valid; return { ok: true, value: { mode: 'TACTICAL', formation: candidate } }; }
    const search = searchDisembark(s, u, t.models.find(m => m.alive)!, 3, {});
    if (search.exhausted) return failure('PLACEMENT_SEARCH_LIMIT');
    return { ok: true, value: { mode: search.formation ? 'TACTICAL' : 'COMBAT', formation: search.formation } };
  }
  begin(unitId: string, rng?: RandomSource, candidate?: Formation): CommandResult {
    const s = this.s;
    if (s.transportState?.disembark || s.movement || s.setup || s.scout || s.closeCombat?.move) return failure('DISEMBARK_IN_PROGRESS');
    if ((s.shooting || s.closeCombat?.fight?.selected) && !s.transportState?.destroyed.length) return failure('COMBAT_IN_PROGRESS');
    const mode = this.mode(unitId, candidate); if (!mode.ok) return mode;
    const u = s.units.find(u => u.id === unitId)!, t = s.units.find(t => t.id === u.embarked!.transportId)!;
    const tx: DisembarkTransaction = transportState(s).disembark = { unitId, transportId: t.id, mode: mode.value.mode, positions: mode.value.formation ?? {}, setupConstraints: t.arrival?.turn === s.turn ? setupConstraints(s, { unitId: t.id, kind: 'INGRESS_MOVE', mode: t.arrival.ingressMethod, positions: {} }) : {} };
    if (tx.mode === 'COMBAT' || tx.mode === 'EMERGENCY') {
      if (!rng) return failure('INVALID_CONFIGURATION');
      tx.hazard = resolveHazardRolls(s, u, u.models.filter(m => m.alive).length, rng);
      flowEvent(s, 'HAZARD_ROLLED', { rolls: tx.hazard.rolls, mortalWounds: tx.hazard.mortalWounds }, u.id, u.playerId);
    }
    flowEvent(s, 'DISEMBARK_STARTED', { mode: tx.mode, transportId: t.id }, u.id, u.playerId); return success();
  }
  stage(modelId: string, position: Position): CommandResult {
    const tx = this.s.transportState?.disembark; if (!tx) return failure('NO_DISEMBARK');
    const u = this.s.units.find(u => u.id === tx.unitId)!;
    if (!u.models.some(m => m.id === modelId && m.alive)) return failure('MODEL_NOT_IN_UNIT');
    if (![position.x, position.y, position.z ?? 0].every(Number.isFinite)) return failure('INVALID_POSITION');
    tx.positions[modelId] = { ...position }; return success();
  }
  preview(): CommandResult<Unit> {
    const s = this.s, tx = s.transportState?.disembark; if (!tx) return failure('NO_DISEMBARK');
    const u = s.units.find(u => u.id === tx.unitId)!, t = s.units.find(u => u.id === tx.transportId)!;
    const model = s.transportState?.destroyed.find(x => x.transportId === t.id)?.frozenModel ?? t.models.find(m => m.alive)!;
    const allowed = tx.mode === 'COMBAT' ? s.units.filter(x => x.playerId !== u.playerId && onBattlefield(x) && x.models.some(m => m.alive && edgeDistance(m, model) <= s.spatialRules.engagementDistance + EPSILON)).map(x => x.id) : [];
    return validateDisembarkFormation(s, u, model, tx.positions, tx.mode === 'COMBAT' || tx.mode === 'EMERGENCY' ? 6 : 3, tx.mode === 'RAPID' ? tx.setupConstraints : {}, allowed);
  }
  complete(): CommandResult {
    const s = this.s, tx = s.transportState?.disembark; if (!tx) return failure('NO_DISEMBARK');
    if (tx.mode === 'EMERGENCY') return failure('DISEMBARK_NOT_ALLOWED');
    const u = s.units.find(u => u.id === tx.unitId)!;
    if (u.models.some(m => m.alive)) { const valid = this.preview(); if (!valid.ok) return valid; Object.assign(u, valid.value); }
    this.finishPassenger(u); return success();
  }
  private finishPassenger(u: Unit) {
    const s = this.s, ts = transportState(s), tx = ts.disembark!;
    u.location = u.models.some(m => m.alive) ? 'BATTLEFIELD' : 'DESTROYED'; delete u.embarked; u.setupAtTurn = s.turn; delete u.moveLock;
    u.lastMove = { kind: 'DISEMBARK_MOVE', turn: s.turn, phase: s.phase };
    if (!['TACTICAL', 'ASSAULT', 'SHOCK'].includes(tx.mode)) u.cannotChargeUntilTurn = s.turn;
    if (tx.mode === 'COMBAT' || tx.mode === 'EMERGENCY') { u.state.battleShocked = true; flowEvent(s, 'BATTLE_SHOCK_APPLIED', { source: tx.mode }, u.id, u.playerId); }
    if (tx.mode === 'TACTICAL' && u.models.some(m => m.alive)) ts.tacticalFollowUp = u.id;
    if (tx.mode === 'COMBAT') flowEvent(s, 'COMBAT_DISEMBARK', {}, u.id, u.playerId);
    flowEvent(s, tx.mode === 'EMERGENCY' ? 'EMERGENCY_DISEMBARK_COMPLETED' : 'DISEMBARK_COMPLETED', { mode: tx.mode, transportId: tx.transportId }, u.id, u.playerId);
    const destroyed = ts.destroyed.find(x => x.transportId === tx.transportId);
    if (destroyed) {
      destroyed.remainingPassengerIds = destroyed.remainingPassengerIds.filter(id => id !== u.id);
      if (!destroyed.remainingPassengerIds.length) { const t = s.units.find(t => t.id === destroyed.transportId)!; t.location = 'DESTROYED'; ts.destroyed = ts.destroyed.filter(x => x !== destroyed); flowEvent(s, 'TRANSPORT_DESTROYED', {}, t.id, t.playerId); }
    }
    ts.disembark = null;
  }
  emergency(): CommandResult {
    const s = this.s, tx = s.transportState?.disembark; if (!tx || tx.mode !== 'EMERGENCY') return failure('NO_DISEMBARK');
    const u = s.units.find(u => u.id === tx.unitId)!, frozen = s.transportState!.destroyed.find(x => x.transportId === tx.transportId)!.frozenModel;
    // Search complete coherent formations first; reduce survivors only when no candidate
    // formation exists. A budget exhaustion leaves the entire transaction untouched.
    while (u.models.some(m => m.alive)) {
      const search = searchDisembark(s, u, frozen, 6, {});
      if (search.exhausted) return failure('PLACEMENT_SEARCH_LIMIT');
      if (search.formation) {
        for (const m of u.models) if (search.formation[m.id]) m.position = search.formation[m.id]!;
        break;
      }
      const m = u.models.find(m => m.id === search.impossibleModelIds?.[0])!;
      m.alive = false; m.woundsRemaining = 0;
      flowEvent(s, 'TRANSPORT_PASSENGER_DESTROYED', { modelId: m.id, transportId: tx.transportId }, u.id, u.playerId);
    }
    this.finishPassenger(u); return success();
  }
  cancel(): CommandResult {
    const tx = this.s.transportState?.disembark; if (!tx) return failure('NO_DISEMBARK');
    if (tx.hazard || tx.mode === 'EMERGENCY') return failure('IRREVERSIBLE_ACTION');
    flowEvent(this.s, 'DISEMBARK_CANCELLED', { mode: tx.mode, transportId: tx.transportId }, tx.unitId, this.s.units.find(u => u.id === tx.unitId)!.playerId);
    this.s.transportState!.disembark = null; return success();
  }
}
