import type { CommandResult, GameState, Unit } from '../models';
import type { DeploymentAbilityChoice } from '../setup/types';
import { failure, definitionFor } from '../rules/movement';
import { allHave } from './abilities';
import { actionBusy, onBattlefield } from '../reserves/location';
import { reservePoints } from '../reserves/ReservePolicy';
import { setupEvent } from '../setup/events';
const ok = (): CommandResult => ({ ok: true, value: undefined });
export function pendingDeployment(s: GameState): Unit[] {
  return s.units.filter(u => u.models.some(m => m.alive) && !s.deployment?.deployed.includes(u.id) && !s.deployment?.initialReserveIds.includes(u.id));
}
export function nextDeploymentPlayer(s: GameState, preferred = s.deployment!.nextPlayerId): string | null {
  const pending = pendingDeployment(s);
  return pending.some(u => u.playerId === preferred) ? preferred : pending[0]?.playerId ?? null;
}
export function choiceError(s: GameState, u: Unit, requested?: DeploymentAbilityChoice): CommandResult {
  const choice = s.deployment?.choices[u.id];
  if (allHave(s, u, 'INFILTRATORS') && allHave(s, u, 'SCOUTS') && !choice) return failure('ABILITY_CHOICE_REQUIRED');
  if (requested && choice && choice !== requested) return failure('INCOMPATIBLE_ABILITY');
  if (requested && !allHave(s, u, requested)) return failure('ABILITY_REQUIRED');
  return ok();
}
/** Pre-battle sequencing and alternating player selection only; geometry lives in SetupValidator. */
export class DeploymentController {
  constructor(private s: GameState) {}
  advance(): CommandResult {
    const d = this.s.deployment;
    if (!d || d.stage === 'BATTLE_STARTED') return failure('WRONG_PRE_BATTLE_STEP');
    if (actionBusy(this.s)) return failure('SETUP_IN_PROGRESS');
    if (d.stage === 'PRE_BATTLE') d.stage = 'DECLARE_BATTLE_FORMATIONS';
    else if (d.stage === 'DECLARE_BATTLE_FORMATIONS') { d.stage = 'DEPLOY_ARMIES'; d.nextPlayerId = nextDeploymentPlayer(this.s, d.firstDeploymentPlayerId) ?? d.firstDeploymentPlayerId; }
    else if (d.stage === 'DEPLOY_ARMIES') {
      if (pendingDeployment(this.s).length) return failure('INCOMPLETE_FORMATION');
      if (this.s.units.some(u => !choiceError(this.s, u).ok)) return failure('ABILITY_CHOICE_REQUIRED');
      if (!d.firstTurnPlayerId) return failure('FIRST_TURN_REQUIRED');
      d.stage = 'PRE_BATTLE_RULES';
    } else {
      if (this.scoutUnits().length) return failure('SCOUTS_PENDING');
      d.stage = 'BATTLE_STARTED';
      this.s.activePlayerId = d.firstTurnPlayerId!;
      this.s.phase = 'Command';
    }
    return ok();
  }
  setFirstTurn(playerId: string): CommandResult {
    const d = this.s.deployment;
    if (!d || !['PRE_BATTLE', 'DECLARE_BATTLE_FORMATIONS', 'DEPLOY_ARMIES'].includes(d.stage)) return failure('WRONG_PRE_BATTLE_STEP');
    if (!this.s.players.some(p => p.id === playerId)) return failure('INVALID_CONFIGURATION');
    d.firstTurnPlayerId = playerId; return ok();
  }
  choose(unitId: string, choice: DeploymentAbilityChoice): CommandResult {
    const d = this.s.deployment, u = this.s.units.find(u => u.id === unitId);
    if (!d || !['DECLARE_BATTLE_FORMATIONS', 'DEPLOY_ARMIES'].includes(d.stage)) return failure('WRONG_PRE_BATTLE_STEP');
    if (actionBusy(this.s)) return failure('SETUP_IN_PROGRESS');
    if (!u) return failure('UNIT_NOT_FOUND');
    if (!['SCOUTS', 'INFILTRATORS'].includes(choice) || !allHave(this.s, u, choice)) return failure('ABILITY_REQUIRED');
    if (d.deployed.includes(unitId) || d.scoutDone.includes(unitId)) return failure('IRREVERSIBLE_ACTION');
    d.choices[unitId] = choice; setupEvent(this.s, u, 'deployment-choice-selected', { method: choice }); return ok();
  }
  selectReserve(unitId: string, selected: boolean): CommandResult {
    const d = this.s.deployment, u = this.s.units.find(u => u.id === unitId);
    if (!d || d.stage !== 'DECLARE_BATTLE_FORMATIONS') return failure('WRONG_PRE_BATTLE_STEP');
    if (actionBusy(this.s)) return failure('SETUP_IN_PROGRESS');
    if (!u) return failure('UNIT_NOT_FOUND');
    if (!u.models.some(m => m.alive)) return failure('NO_LIVING_MODELS');
    const definition = definitionFor(this.s, u);
    if (selected && definition.keywords.some(k => k.toUpperCase() === 'FORTIFICATION')) return failure('FORTIFICATION_FORBIDDEN');
    if (definition.points === undefined) return failure('INVALID_CONFIGURATION');
    const points = reservePoints(this.s, u.playerId);
    if (selected && !d.initialReserveIds.includes(unitId) && points.used + definition.points > points.limit + 1e-9) return failure('RESERVE_POINTS_LIMIT');
    d.initialReserveIds = d.initialReserveIds.filter(id => id !== unitId);
    if (selected) {
      d.initialReserveIds.push(unitId); u.location = 'STRATEGIC_RESERVES';
      u.reserve = { initial: true, repositioned: false, reason: 'battle-formations', enteredTurn: this.s.turn, ingressCount: 0 };
      setupEvent(this.s, u, 'unit-placed-in-strategic-reserves');
    } else { u.location = 'RESERVES'; delete u.reserve; }
    return ok();
  }
  scoutUnits(): Unit[] {
    const d = this.s.deployment;
    if (!d || d.stage !== 'PRE_BATTLE_RULES') return [];
    const units = this.s.units.filter(u => u.models.some(m => m.alive) && allHave(this.s, u, 'SCOUTS') && d.choices[u.id] !== 'INFILTRATORS' && !d.scoutDone.includes(u.id) && (onBattlefield(u) || u.location === 'STRATEGIC_RESERVES'));
    return [...units.filter(u => u.playerId === d.firstTurnPlayerId), ...units.filter(u => u.playerId !== d.firstTurnPlayerId)];
  }
  skipScout(unitId: string): CommandResult {
    if (actionBusy(this.s)) return failure('SETUP_IN_PROGRESS');
    const pool = this.scoutUnits(), u = pool.find(u => u.id === unitId);
    if (!u) return failure('UNIT_NOT_ELIGIBLE');
    if (pool[0]!.playerId !== u.playerId) return failure('WRONG_DEPLOYMENT_PLAYER');
    this.s.deployment!.scoutDone.push(unitId); setupEvent(this.s, u, 'scout-skipped'); return ok();
  }
}
