import type { CommandResult, GameState, Position, Unit } from '../models';
import type { Formation, IngressMethod, SetupConstraints, SetupTransaction } from './types';
import { validateSetup, type SetupPolicy } from './SetupValidator';
import { failure } from '../rules/movement';
import { actionBusy, arrivalLocked, battleStarted, locationOf } from '../reserves/location';
import { reserveRules, type ReservePolicy } from '../reserves/ReservePolicy';
import { allHave } from '../deployment/abilities';
import { choiceError, DeploymentController, nextDeploymentPlayer, pendingDeployment } from '../deployment/DeploymentController';
import { setupEvent } from './events';
export function setupConstraints(s: GameState, tx: SetupTransaction): SetupConstraints {
  const r = reserveRules(s);
  if (tx.kind === 'SCOUT_SETUP' || tx.mode === 'NORMAL') return { ownZone: true };
  if (tx.mode === 'INFILTRATORS') return { enemyDistance: r.enemySetupDistance, enemyZoneDistance: r.infiltratorZoneDistance };
  return { enemyDistance: r.enemySetupDistance, ...(tx.mode === 'STRATEGIC_EDGE' ? { edgeDistance: r.ingressEdgeDistance, excludeEnemyZone: s.round < r.enemyZoneAllowedRound } : {}) };
}
export function canDeployUnit(s: GameState, u: Unit, formation: Formation, infiltrators = false, policy: SetupPolicy = {}) {
  if (infiltrators) { const choice = choiceError(s, u, 'INFILTRATORS'); if (!choice.ok) return choice; }
  return validateSetup(s, u, formation, setupConstraints(s, { unitId: u.id, kind: 'DEPLOYMENT', mode: infiltrators ? 'INFILTRATORS' : 'NORMAL', positions: formation }), policy);
}
export const canDeployUsingInfiltrators = (s: GameState, u: Unit, f: Formation, p?: SetupPolicy) => canDeployUnit(s, u, f, true, p);
/** Candidate positions remain in the transaction, never in the live unit until commit. */
export class SetupController {
  constructor(private s: GameState, private policy: SetupPolicy = {}, private reserves: ReservePolicy = {}) {}
  begin(unitId: string, kind: SetupTransaction['kind'], mode: SetupTransaction['mode']): CommandResult {
    if (this.s.status !== 'in-progress') return failure('MATCH_FINISHED');
    if (actionBusy(this.s)) return failure('SETUP_IN_PROGRESS');
    const u = this.s.units.find(u => u.id === unitId); if (!u) return failure('UNIT_NOT_FOUND');
    if (!u.models.some(m => m.alive)) return failure('NO_LIVING_MODELS');
    if (kind === 'DEPLOYMENT') {
      if (this.s.deployment?.stage !== 'DEPLOY_ARMIES') return failure('WRONG_PRE_BATTLE_STEP');
      if (!pendingDeployment(this.s).some(x => x.id === unitId)) return failure('ALREADY_DEPLOYED');
      if (u.playerId !== nextDeploymentPlayer(this.s)) return failure('WRONG_DEPLOYMENT_PLAYER');
      if (!['NORMAL', 'INFILTRATORS'].includes(mode)) return failure('INVALID_CONFIGURATION');
      const choice = choiceError(this.s, u, mode === 'INFILTRATORS' ? 'INFILTRATORS' : undefined); if (!choice.ok) return choice;
    } else if (kind === 'SCOUT_SETUP') {
      const pool = new DeploymentController(this.s).scoutUnits();
      if (!pool.some(x => x.id === unitId) || u.location !== 'STRATEGIC_RESERVES') return failure('UNIT_NOT_ELIGIBLE');
      if (pool[0]!.playerId !== u.playerId) return failure('WRONG_DEPLOYMENT_PLAYER');
      const choice = choiceError(this.s, u, 'SCOUTS'); if (!choice.ok) return choice;
      mode = 'NORMAL';
    } else {
      if (!battleStarted(this.s)) return failure('PRE_BATTLE');
      if (this.s.phase !== 'Movement') return failure('WRONG_PHASE');
      if (u.playerId !== this.s.activePlayerId) return failure('NOT_YOUR_UNIT');
      if (!['STRATEGIC_RESERVES', 'RESERVES'].includes(locationOf(u))) return failure('NOT_IN_RESERVES');
      if (arrivalLocked(u)) return failure('ARRIVAL_MOVE_LOCK');
      if (!['STRATEGIC_EDGE', 'DEEP_STRIKE'].includes(mode)) return failure('INVALID_CONFIGURATION');
      if (mode === 'DEEP_STRIKE' && !allHave(this.s, u, 'DEEP_STRIKE')) return failure('ABILITY_REQUIRED');
      if (this.reserves.canIngress) { const result = this.reserves.canIngress(this.s, u, mode as IngressMethod); if (!result.ok) return result; }
      else {
        if (locationOf(u) !== 'STRATEGIC_RESERVES') return failure('NOT_IN_RESERVES');
        if (this.s.round < reserveRules(this.s).standardIngressMinimumRound) return failure('INGRESS_TOO_EARLY');
      }
    }
    this.s.setup = { unitId, kind, mode, positions: {} };
    setupEvent(this.s, u, kind === 'INGRESS_MOVE' ? 'unit-selected-for-ingress' : 'setup-started', { method: mode });
    if (kind === 'INGRESS_MOVE') setupEvent(this.s, u, 'ingress-started', { method: mode });
    return { ok: true, value: undefined };
  }
  stageModel(modelId: string, position: Position): CommandResult {
    const tx = this.s.setup; if (!tx) return failure('NO_SETUP');
    const u = this.s.units.find(u => u.id === tx.unitId)!;
    if (!u.models.some(m => m.id === modelId && m.alive)) return failure('MODEL_NOT_IN_UNIT');
    // Partial formation may be invalid while editing; never affects the live battlefield.
    if (![position.x, position.y, position.z ?? 0].every(Number.isFinite) || (position.z ?? 0) < 0) return failure('INVALID_POSITION');
    tx.positions[modelId] = { ...position }; return { ok: true, value: undefined };
  }
  preview(formation?: Formation): CommandResult<Unit> {
    const tx = this.s.setup; if (!tx) return failure('NO_SETUP');
    return validateSetup(this.s, this.s.units.find(u => u.id === tx.unitId)!, formation ?? tx.positions, setupConstraints(this.s, tx), this.policy);
  }
  complete(): CommandResult {
    const result = this.preview(); if (!result.ok) return result;
    const tx = this.s.setup!, u = result.value, d = this.s.deployment;
    this.s.units = this.s.units.map(x => x.id === u.id ? u : x);
    if (tx.kind === 'DEPLOYMENT') {
      d!.deployed.push(u.id);
      if (tx.mode === 'INFILTRATORS') d!.choices[u.id] = 'INFILTRATORS';
      d!.nextPlayerId = nextDeploymentPlayer(this.s, this.s.players.find(p => p.id !== u.playerId)!.id) ?? u.playerId;
      setupEvent(this.s, u, tx.mode === 'INFILTRATORS' ? 'unit-deployed-using-infiltrators' : 'unit-deployed');
    } else if (tx.kind === 'SCOUT_SETUP') {
      d!.choices[u.id] = 'SCOUTS'; d!.scoutDone.push(u.id); d!.deployed.push(u.id);
      setupEvent(this.s, u, 'scout-move-completed', { method: 'RESERVE_SETUP' });
    } else {
      const method = tx.mode as IngressMethod;
      u.arrival = { method: u.reserve?.repositioned ? 'REPOSITION' : method === 'DEEP_STRIKE' ? 'DEEP_STRIKE' : 'STRATEGIC_RESERVES', turn: this.s.turn, ingressMethod: method };
      u.moveLock = { kind: 'UNTIL_NEXT_CHARGE', turn: this.s.turn };
      if (u.reserve) u.reserve.ingressCount++;
      for (const passenger of this.s.units.filter(p => p.embarked?.transportId === u.id)) if (passenger.reserve) passenger.reserve.transportHasIngressed = true;
      setupEvent(this.s, u, 'ingress-completed', { method });
      if (method === 'DEEP_STRIKE') setupEvent(this.s, u, 'unit-deep-struck', { method });
    }
    u.setupAtTurn = tx.kind === 'INGRESS_MOVE' ? this.s.turn : 0;
    if (tx.kind === 'INGRESS_MOVE') u.lastMove = { kind: 'INGRESS_MOVE', turn: this.s.turn, phase: this.s.phase };
    this.s.setup = null; return { ok: true, value: undefined };
  }
  cancel(): CommandResult {
    const tx = this.s.setup; if (!tx) return failure('NO_SETUP');
    setupEvent(this.s, this.s.units.find(u => u.id === tx.unitId)!, 'setup-cancelled', { method: tx.mode });
    this.s.setup = null; return { ok: true, value: undefined };
  }
}
