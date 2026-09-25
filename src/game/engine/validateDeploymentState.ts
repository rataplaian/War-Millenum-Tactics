import { validateCoreAbilities } from '../abilities/validation';
import type { GameState } from '../models';
import { baseInsideBattlefield, distanceTravelled, EPSILON, isFinitePosition } from '../utils/geometry';
import { edges, segmentCrossParameters } from '../terrain/geometry';
import { battleStarted, onBattlefield } from '../reserves/location';
import { allHave, scoutDistance } from '../deployment/abilities';
import { nextDeploymentPlayer, pendingDeployment, DeploymentController, choiceError } from '../deployment/DeploymentController';
export function validateDeploymentState(s: GameState): void {
  const require = (condition: unknown, why: string) => { if (!condition) throw new Error(`Invalid deployment snapshot: ${why}`); };
  const player = (id: string) => s.players.some(p => p.id === id), unit = (id: string) => s.units.find(u => u.id === id);
  const uniqueUnits = (ids: string[]) => new Set(ids).size === ids.length && ids.every(id => unit(id));
  const abilityList = (abilities: readonly { kind: string; distance?: number }[] | undefined) => require(!abilities || abilities.every(a => ['SCOUTS', 'INFILTRATORS', 'DEEP_STRIKE', 'FEEL_NO_PAIN', 'DEADLY_DEMISE', 'LONE_OPERATIVE', 'STEALTH', 'HOVER', 'SUPER_HEAVY_WALKER', 'FIGHTS_FIRST'].includes(a.kind) && (a.kind !== 'SCOUTS' || (Number.isFinite(a.distance) && a.distance! >= 0))), 'abilities');
  for (const d of s.definitions) { require(d.points === undefined || (Number.isSafeInteger(d.points) && d.points >= 0), 'points'); abilityList(d.coreAbilities); validateCoreAbilities(d.coreAbilities); }
  for (const u of s.units) {
    require(u.location === undefined || ['BATTLEFIELD', 'STRATEGIC_RESERVES', 'RESERVES', 'DESTROYED', 'EMBARKED'].includes(u.location), 'location');
    require(u.location !== 'DESTROYED' || u.models.every(m => !m.alive), 'destroyed health');
    require(!u.location || u.location === 'DESTROYED' || u.models.some(m => m.alive) || s.transportState?.disembark?.unitId === u.id || s.transportState?.destroyed.some(t => t.transportId === u.id), 'living location');
    u.models.forEach(m => { abilityList(m.coreAbilities); validateCoreAbilities(m.coreAbilities); });
    if (u.reserve) require(typeof u.reserve.initial === 'boolean' && typeof u.reserve.repositioned === 'boolean' && !!u.reserve.reason && Number.isInteger(u.reserve.enteredTurn) && u.reserve.enteredTurn >= 1 && u.reserve.enteredTurn <= s.turn && Number.isInteger(u.reserve.ingressCount) && u.reserve.ingressCount >= 0, 'reserve record');
    if (u.arrival) require(Number.isInteger(u.arrival.turn) && u.arrival.turn >= 1 && u.arrival.turn <= s.turn && ['STRATEGIC_RESERVES', 'DEEP_STRIKE', 'REPOSITION'].includes(u.arrival.method) && ['STRATEGIC_EDGE', 'DEEP_STRIKE'].includes(u.arrival.ingressMethod), 'arrival');
    if (u.moveLock) require(u.moveLock.kind === 'UNTIL_NEXT_CHARGE' && u.moveLock.turn === s.turn && ['Movement', 'Shooting'].includes(s.phase) && u.arrival?.turn === s.turn, 'arrival lock');
  }
  const d = s.deployment;
  if (d) {
    require(['PRE_BATTLE', 'DECLARE_BATTLE_FORMATIONS', 'DEPLOY_ARMIES', 'PRE_BATTLE_RULES', 'BATTLE_STARTED'].includes(d.stage), 'stage');
    require(player(d.firstDeploymentPlayerId) && player(d.nextPlayerId) && (d.firstTurnPlayerId === null || player(d.firstTurnPlayerId)), 'players');
    require(Number.isSafeInteger(d.pointsLimit) && d.pointsLimit > 0 && Object.values(d.rules).every(v => Number.isFinite(v) && v >= 0) && ['strategicReservePointsLimitRatio', 'standardIngressMinimumRound', 'ingressEdgeDistance', 'enemySetupDistance', 'infiltratorZoneDistance', 'scoutEnemyDistance', 'enemyZoneAllowedRound', 'reserveExpirationRound'].every(key => key in d.rules), 'rules');
    require(d.rules.strategicReservePointsLimitRatio <= 1 && [d.rules.standardIngressMinimumRound, d.rules.enemyZoneAllowedRound, d.rules.reserveExpirationRound].every(v => Number.isInteger(v) && v >= 1), 'rounds');
    require(uniqueUnits(d.deployed) && uniqueUnits(d.initialReserveIds) && uniqueUnits(d.scoutDone), 'unit lists');
    require(Object.entries(d.choices).every(([id, choice]) => unit(id) && ['SCOUTS', 'INFILTRATORS'].includes(choice) && allHave(s, unit(id)!, choice)), 'choices');
    require(new Set(d.zones.map(z => z.id)).size === d.zones.length && s.players.every(p => d.zones.some(z => z.playerId === p.id)), 'zones');
    for (const z of d.zones) {
      const v = z.footprint.vertices, lines = edges(z.footprint);
      require(!!z.id && player(z.playerId) && v.length >= 3 && v.length <= 128 && v.every(p => isFinitePosition(p) && p.x >= 0 && p.y >= 0 && p.x <= s.battlefield.width && p.y <= s.battlefield.height), 'zone polygon');
      require(Math.abs(lines.reduce((sum, [a, b]) => sum + a.x * b.y - b.x * a.y, 0)) > EPSILON, 'zone area');
      for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) if (j !== i + 1 && !(i === 0 && j === lines.length - 1)) require(!segmentCrossParameters(...lines[i]!, ...lines[j]!).length, 'zone crossing');
    }
    if (!battleStarted(s)) {
      require(s.turn === 1 && s.round === 1 && s.phase === 'Command' && s.status === 'in-progress', 'pre-battle turn');
      require(!s.movement && !s.shooting && !s.closeCombat, 'pre-battle actions');
      require(s.units.every(u => !onBattlefield(u) || d.deployed.includes(u.id)), 'undeployed battlefield unit');
      require(pendingDeployment(s).every(u => u.location === 'RESERVES'), 'deployment queue');
    }
    if (d.stage === 'PRE_BATTLE_RULES' || d.stage === 'BATTLE_STARTED') require(d.firstTurnPlayerId && !pendingDeployment(s).length, 'unfinished deployment');
  }
  require([s.setup, s.scout, s.movement, s.shooting, s.reactionMove, s.closeCombat?.move ?? s.closeCombat?.charge ?? s.closeCombat?.fight?.selected].filter(Boolean).length <= 1, 'overlapping transactions');
  if (s.setup) {
    const tx = s.setup, u = unit(tx.unitId);
    require(u && !onBattlefield(u) && u.models.some(m => m.alive), 'setup source');
    require(s.status === 'in-progress', 'finished setup');
    require(Object.entries(tx.positions).every(([id, p]) => u!.models.some(m => m.id === id && m.alive) && isFinitePosition(p)), 'setup positions');
    if (tx.kind === 'DEPLOYMENT') require(d?.stage === 'DEPLOY_ARMIES' && pendingDeployment(s).some(x => x.id === u!.id) && nextDeploymentPlayer(s) === u!.playerId && ['NORMAL', 'INFILTRATORS'].includes(tx.mode), 'deployment transaction');
    else if (tx.kind === 'SCOUT_SETUP') require(d?.stage === 'PRE_BATTLE_RULES' && u!.location === 'STRATEGIC_RESERVES' && allHave(s, u!, 'SCOUTS') && d.choices[u!.id] !== 'INFILTRATORS', 'scout setup');
    else require(tx.kind === 'INGRESS_MOVE' && battleStarted(s) && s.phase === 'Movement' && u!.playerId === s.activePlayerId && ['STRATEGIC_EDGE', 'DEEP_STRIKE'].includes(tx.mode), 'ingress transaction');
    if (tx.kind === 'DEPLOYMENT') require(choiceError(s, u!, tx.mode === 'INFILTRATORS' ? 'INFILTRATORS' : undefined).ok, 'deployment choice');
    if (tx.kind === 'SCOUT_SETUP') require(new DeploymentController(s).scoutUnits()[0]?.playerId === u!.playerId && !d!.scoutDone.includes(u!.id), 'scout setup order');
    if (tx.mode === 'DEEP_STRIKE') require(allHave(s, u!, 'DEEP_STRIKE'), 'deep strike ability');
    if (tx.mode === 'INFILTRATORS') require(allHave(s, u!, 'INFILTRATORS') && d?.choices[u!.id] !== 'SCOUTS', 'infiltrators ability');
  }
  if (s.scout) {
    const tx = s.scout, u = unit(tx.unitId);
    require(d?.stage === 'PRE_BATTLE_RULES' && u && onBattlefield(u) && allHave(s, u, 'SCOUTS') && d.choices[u.id] !== 'INFILTRATORS' && !d.scoutDone.includes(u.id), 'scout source');
    require(s.status === 'in-progress' && new DeploymentController(s).scoutUnits()[0]?.playerId === u!.playerId, 'scout order');
    require(tx.kind === 'SCOUT_MOVE' && tx.allowance === scoutDistance(s, u!) && tx.originals.length === u!.models.length && new Set(tx.originals.map(o => o.modelId)).size === tx.originals.length, 'scout originals');
    require(Object.entries(tx.used).every(([id, value]) => u!.models.some(m => m.id === id) && Number.isFinite(value) && value >= 0 && value <= tx.allowance + EPSILON), 'scout usage');
    for (const o of tx.originals) {
      const m = u!.models.find(m => m.id === o.modelId);
      require(m && isFinitePosition(o.position) && Number.isFinite(o.movementUsed) && o.movementUsed === m.movementUsed && (!m.alive || baseInsideBattlefield({ ...m, position: o.position }, s.battlefield)) && distanceTravelled(o.position, m.position) <= (tx.used[o.modelId] ?? 0) + EPSILON, 'scout original');
    }
  }
  for (const id of [s.movement?.unitId, s.shooting?.unitId, s.closeCombat?.charge?.unitId, s.closeCombat?.move?.unitId, s.closeCombat?.fight?.selected?.unitId]) if (id) require(onBattlefield(unit(id)!), 'off-field action');
}
