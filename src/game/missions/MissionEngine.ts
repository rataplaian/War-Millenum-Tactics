import { PHASES, type CommandResult, type GameEvent, type GameState, type Phase } from '../models';
import { flowEvent } from '../flow/events';
import { actionBusy, onBattlefield } from '../reserves/location';
import { resolveReserveExpiration } from '../reserves/ReserveController';
import type { ReservePolicy } from '../reserves/ReservePolicy';
import type { RandomSource } from '../utils/dice';
import { failure } from '../rules/movement';
import { completeMissionActions, interruptAction } from './actions';
import { calculateLevelOfControl, resolveObjectiveControl } from './objectives';
import type { MissionDefinition, MissionState, ScoringRule, ScoringWindow, VictoryPointEntry } from './types';
const empty = (s: GameState) => Object.fromEntries(s.players.map(p => [p.id, {} as Record<string, number>]));
const validNumber = (n: number) => Number.isSafeInteger(n) && n >= 0;
const windows = ['START_OF_COMMAND_PHASE','END_OF_COMMAND_PHASE','END_OF_PHASE','END_OF_TURN','END_OF_BATTLE_ROUND','END_OF_BATTLE'];
export function validMissionDefinition(s: GameState, d: MissionDefinition): boolean {
  const rules = [...d.primary.flatMap(x => x.rules), ...d.secondaries.map(x => x.rule)];
  return !!d.id && !!d.name && validNumber(d.maximumBattleRounds) && d.maximumBattleRounds >= 1 &&
    d.battlefield.width === s.battlefield.width && d.battlefield.height === s.battlefield.height &&
    d.objectives.length > 0 && new Set(d.objectives.map(x => x.id)).size === d.objectives.length &&
    d.objectives.every(o => !!o.id && (o.type === 'TERRAIN_OBJECTIVE' ? !!s.battlefield.terrain?.areas.some(x => x.id === o.terrainAreaId) :
      o.type === 'MARKER_OBJECTIVE' && !!o.position && Number.isFinite(o.position.x) && Number.isFinite(o.position.y) && validNumber(o.markerRange ?? 0))) &&
    Object.values(d.caps).every(x => x === undefined || validNumber(x)) &&
    validNumber(d.secondaryPolicy.fixedCount) && validNumber(d.secondaryPolicy.tacticalHandSize) && windows.includes(d.secondaryPolicy.drawTiming) &&
    new Set(d.actions.map(x => x.id)).size === d.actions.length &&
    d.actions.every(a => !!a.id && !!a.name && ['Command','Movement','Shooting','Charge','Fight'].includes(a.starts) && windows.includes(a.completes) &&
      ['TURN','BATTLE'].includes(a.useLimit.scope) && validNumber(a.useLimit.count) && a.useLimit.count >= 1 &&
      ['SECURE_OBJECTIVE','MISSION_PROGRESS','AWARD_VP'].includes(a.effect.kind) && (a.effect.amount === undefined || validNumber(a.effect.amount))) &&
    new Set(d.secondaries.map(x => x.id)).size === d.secondaries.length &&
    d.secondaries.every(x => !!x.id && !!x.name && ['FIXED','TACTICAL'].includes(x.mode) && (!x.actionId || d.actions.some(a => a.id === x.actionId))) &&
    rules.every(r => !!r.id && validNumber(r.reward) && windows.includes(r.timing) &&
      (r.condition.kind === 'CONTROLLED_OBJECTIVES' ? validNumber(r.condition.minimum) && r.condition.minimum >= 1 :
       r.condition.kind === 'ACTION_COMPLETED' ? d.actions.map(a => a.id).includes(r.condition.actionId) : r.condition.kind === 'EVENT' && !!r.condition.name));
}
/** Data-only definitions are embedded in the snapshot; no caller code or RNG is needed to resume. */
export function instantiateMission(s: GameState, definition: MissionDefinition, attackerPlayerId: string,
  selectedFixed: Record<string, string[]> = {}): CommandResult {
  if (s.mission) return failure('MISSION_ALREADY_SET');
  if (!s.flow || s.status !== 'in-progress' || (s.flow.started && (s.round !== 1 || s.turn !== 1 || s.phase !== 'Command'))) return failure('INVALID_CONFIGURATION');
  const defender = s.players.find(p => p.id !== attackerPlayerId);
  if (!defender || !validMissionDefinition(s, definition) || definition.maximumBattleRounds < s.round ||
      definition.primary.some(p => p.playerId && !s.players.some(x => x.id === p.playerId))) return failure('INVALID_CONFIGURATION');
  for (const p of s.players) {
    const ids = selectedFixed[p.id] ?? [];
    if (ids.length > definition.secondaryPolicy.fixedCount || new Set(ids).size !== ids.length ||
        ids.some(id => !definition.secondaries.some(d => d.id === id && d.mode === 'FIXED'))) return failure('INVALID_CONFIGURATION');
  }
  s.flow.rules.maximumBattleRounds = definition.maximumBattleRounds;
  s.mission = { definition: JSON.parse(JSON.stringify(definition)), setupStep: s.deployment ? 'DEPLOYMENT' : 'BATTLE', attackerPlayerId, defenderPlayerId: defender.id,
    objectives: definition.objectives.map(o => ({ ...JSON.parse(JSON.stringify(o)), controllingPlayerId: null, securedByPlayerId: null })),
    activeActions: [], actionUses: [], primaryProgress: empty(s), secondaryProgress: empty(s),
    fixed: Object.fromEntries(s.players.map(p => [p.id, [...(selectedFixed[p.id] ?? [])]])),
    tactical: Object.fromEntries(s.players.map(p => [p.id, { deck: [], hand: [], completed: [], discarded: [], retained: [] }])),
    ledger: [], initialEventSequence: s.events.length, lastEventSequence: s.events.length, scoredWindows: [], completedObjectives: [], currentMissionRules: [...(definition.missionRules ?? [])], matchResult: null };
  return { ok: true, value: undefined };
}
export function shuffleTactical(s: GameState, playerId: string, rng: RandomSource): CommandResult {
  const mission = s.mission, t = mission?.tactical[playerId];
  if (!mission || !t || !s.players.some(p => p.id === playerId)) return failure('MISSION_NOT_FOUND');
  if (t.deck.length || t.hand.length || t.completed.length || t.discarded.length) return failure('USAGE_LIMIT');
  const deck = mission.definition.secondaries.filter(d => d.mode === 'TACTICAL').map(d => d.id);
  for (let i = deck.length - 1; i > 0; i--) { const roll = rng(); if (!Number.isFinite(roll) || roll < 0 || roll >= 1) throw new RangeError('Invalid tactical RNG'); const j = Math.floor(roll * (i + 1)); [deck[i], deck[j]] = [deck[j]!, deck[i]!]; }
  t.deck = deck;
  return { ok: true, value: undefined };
}
export function drawTactical(s: GameState, playerId: string): CommandResult<string[]> {
  const mission = s.mission, hand = mission?.tactical[playerId];
  if (!mission || !hand) return failure('MISSION_NOT_FOUND');
  const drawn: string[] = [];
  while (hand.hand.length < mission.definition.secondaryPolicy.tacticalHandSize && hand.deck.length) {
    const id = hand.deck.shift()!; hand.hand.push(id); drawn.push(id); flowEvent(s, 'TACTICAL_DRAWN', { secondaryId: id }, '', playerId);
  }
  return { ok: true, value: drawn };
}
export function discardTactical(s: GameState, playerId: string, id: string): CommandResult {
  const h = s.mission?.tactical[playerId]; if (!h || !h.hand.includes(id)) return failure('INVALID_TARGET');
  h.hand.splice(h.hand.indexOf(id), 1); h.discarded.push(id); h.retained = h.retained.filter(x => x !== id);
  flowEvent(s, 'TACTICAL_DISCARDED', { secondaryId: id }, '', playerId);
  return { ok: true, value: undefined };
}
export function awardVictoryPoints(s: GameState, playerId: string, requested: number, sourceType: VictoryPointEntry['sourceType'], sourceId: string,
  stamp: { round: number; turn: number; phase: Phase; eventSequence?: number } = { round: s.round, turn: s.turn, phase: s.phase }): number {
  const m = s.mission; if (!m || !s.players.some(p => p.id === playerId) || !sourceId || !validNumber(requested)) throw Error('Invalid VP award');
  const c = m.definition.caps, entries = m.ledger.filter(e => e.playerId === playerId);
  const category = entries.filter(e => e.sourceType === sourceType), round = category.filter(e => e.round === stamp.round);
  const roundCap = sourceType === 'PRIMARY' ? c.primaryPerRound : sourceType === 'SECONDARY' ? c.secondaryPerRound : Infinity;
  const totalCap = sourceType === 'PRIMARY' ? c.primaryTotal : sourceType === 'SECONDARY' ? c.secondaryTotal : Infinity;
  const amount = Math.max(0, Math.min(requested, roundCap - round.reduce((n, e) => n + e.amount, 0), totalCap - category.reduce((n, e) => n + e.amount, 0),
    (c.total ?? Infinity) - entries.reduce((n, e) => n + e.amount, 0)));
  if (amount) { m.ledger.push({ id: m.ledger.length + 1, playerId, amount, sourceType, sourceId, ...stamp });
    flowEvent(s, 'VICTORY_POINTS_AWARDED', { amount, sourceType, sourceId }, '', playerId); }
  return amount;
}
export function scoreBreakdown(s: GameState, id: string) {
  const m = s.mission!;
  const count = (category: VictoryPointEntry['sourceType']) => m.ledger.filter(e => e.playerId === id && e.sourceType === category).reduce((n, e) => n + e.amount, 0);
  const primary = count('PRIMARY'), secondary = count('SECONDARY'), other = count('OTHER');
  return { playerId: id, primary, secondary, other, total: primary + secondary + other };
}
/** Emit one loss per unit whose last living model disappears, even if attachments split. */
export function recordDestroyedUnits(before: GameState, after: GameState) {
  if (!after.mission) return;
  const survivors = new Set(after.units.flatMap(u => u.models.filter(m => m.alive).map(m => m.id)));
  for (const unit of before.units) {
    const living = unit.models.filter(m => m.alive);
    if (living.length && living.every(m => !survivors.has(m.id)))
      flowEvent(after, 'UNIT_DESTROYED', { targetUnitId: unit.id, targetPlayerId: unit.playerId }, unit.id, unit.playerId);
  }
}
function recordProgress(s: GameState, e: GameEvent) {
  const m = s.mission!;
  for (const player of s.players) {
    for (const [category, definitions] of [
      ['PRIMARY', m.definition.primary.filter(x => !x.playerId || x.playerId === player.id).flatMap(x => x.rules)],
      ['SECONDARY', m.definition.secondaries.filter(x => (x.mode === 'FIXED' ? m.fixed[player.id]!.includes(x.id) : m.tactical[player.id]!.hand.includes(x.id))).map(x => x.rule)]
    ] as const) for (const rule of definitions) {
      const condition = rule.condition;
      const match = condition.kind === 'EVENT' ? (e.type === 'flow' ? e.name === condition.name : e.type === condition.name) &&
        (condition.ownUnit === undefined || (e.playerId === player.id) === condition.ownUnit) :
        condition.kind === 'ACTION_COMPLETED' && e.type === 'flow' && e.name === 'ACTION_COMPLETED' && e.detail.actionId === condition.actionId && e.playerId === player.id;
      if (match) { const counter = category === 'PRIMARY' ? m.primaryProgress[player.id]! : m.secondaryProgress[player.id]!; counter[rule.id] = (counter[rule.id] ?? 0) + 1; }
    }
  }
}
function scoreRule(s: GameState, playerId: string, rule: ScoringRule, category: 'PRIMARY' | 'SECONDARY', timing: ScoringWindow,
  stamp: { round: number; turn: number; phase: Phase; eventSequence?: number }): boolean {
  if (rule.timing !== timing) return false;
  const m = s.mission!, counter = category === 'PRIMARY' ? m.primaryProgress[playerId]! : m.secondaryProgress[playerId]!;
  const key = `${playerId}:${category}:${rule.id}:${rule.repeat === 'ONCE_PER_BATTLE' ? 'battle' : rule.repeat === 'ONCE_PER_ROUND' ? stamp.round : rule.repeat === 'ONCE_PER_TURN' ? stamp.turn : `${timing}:${stamp.eventSequence ?? s.events.length}`}`;
  if (m.scoredWindows.includes(key)) return false;
  if (rule.condition.kind === 'CONTROLLED_OBJECTIVES') {
    if (m.objectives.filter(o => o.controllingPlayerId === playerId).length < rule.condition.minimum) return false;
  } else {
    const count = counter[rule.id] ?? 0;
    const consumedKey = `used:${playerId}:${category}:${rule.id}`;
    const consumed = m.scoredWindows.filter(x => x.startsWith(`${consumedKey}:`)).length;
    if (count <= consumed) return false;
    m.scoredWindows.push(`${consumedKey}:${count}`);
  }
  m.scoredWindows.push(key);
  awardVictoryPoints(s, playerId, rule.reward, category, rule.id, stamp);
  return true;
}
function scoreWindow(s: GameState, timing: ScoringWindow, stamp: { round: number; turn: number; phase: Phase; eventSequence?: number }, activePlayerId?: string) {
  const m = s.mission!;
  const players = (timing === 'START_OF_COMMAND_PHASE' || timing === 'END_OF_COMMAND_PHASE' || timing === 'END_OF_TURN') && activePlayerId ? s.players.filter(p => p.id === activePlayerId) : s.players;
  for (const player of players) {
    for (const group of m.definition.primary.filter(g => !g.playerId || g.playerId === player.id))
      for (const rule of group.rules.filter(r => r.eligiblePlayer !== 'ACTIVE' || !activePlayerId || player.id === activePlayerId)) scoreRule(s, player.id, rule, 'PRIMARY', timing, stamp);
    for (const secondary of m.definition.secondaries.filter(d => d.mode === 'FIXED' ? m.fixed[player.id]!.includes(d.id) : m.tactical[player.id]!.hand.includes(d.id))) {
      if ((secondary.rule.eligiblePlayer !== 'ACTIVE' || !activePlayerId || player.id === activePlayerId) &&
          scoreRule(s, player.id, secondary.rule, 'SECONDARY', timing, stamp) && secondary.mode === 'TACTICAL' && secondary.discardOnComplete) {
        const h = m.tactical[player.id]!; h.hand.splice(h.hand.indexOf(secondary.id), 1); h.completed.push(secondary.id);
        m.completedObjectives.push(`${player.id}:${secondary.id}`);
      }
    }
  }
  if (timing === 'END_OF_TURN') for (const player of players) {
    const h = m.tactical[player.id]!; h.retained = h.hand.filter(id => m.definition.secondaryPolicy.retainUncompleted && m.definition.secondaries.find(d => d.id === id)?.canRetain);
  }
  if (timing === m.definition.secondaryPolicy.drawTiming) for (const player of players) {
    const h = m.tactical[player.id]!;
    if (!m.definition.secondaryPolicy.retainUncompleted) for (const id of [...h.hand]) discardTactical(s, player.id, id);
    else h.retained = h.hand.filter(id => m.definition.secondaries.find(d => d.id === id)?.canRetain);
    drawTactical(s, player.id);
  }
}
export function finishMission(s: GameState, reason: string, reserves?: ReservePolicy) {
  const m = s.mission; if (!m || m.matchResult) return;
  for (const action of m.activeActions.filter(a => a.state === 'ACTIVE')) interruptAction(s, action, 'BATTLE_ENDED');
  s.status = 'finished'; resolveReserveExpiration(s, s.round, reserves, true);
  scoreWindow(s, 'END_OF_BATTLE', { round: s.round, turn: s.turn, phase: s.phase });
  const scores = s.players.map(p => scoreBreakdown(s, p.id));
  const winner = scores[0]!.total === scores[1]!.total ? null : scores[0]!.total > scores[1]!.total ? scores[0]!.playerId : scores[1]!.playerId;
  m.matchResult = { scores, winnerPlayerId: winner, outcome: winner ? 'WIN' : 'DRAW', endReason: reason, completedBattleRounds: reason === 'ROUND_LIMIT' ? s.round : Math.max(0, s.round - 1) };
  flowEvent(s, 'MISSION_BATTLE_ENDED', { reason, winnerPlayerId: winner ?? '' });
}
/** Incremental event consumer; its cursor and all progress are serializable. */
export function synchronizeMission(s: GameState, reserves?: ReservePolicy) {
  const m = s.mission; if (!m || m.matchResult) return;
  if (s.deployment) m.setupStep = s.deployment.stage === 'BATTLE_STARTED' ? 'BATTLE' : s.deployment.stage === 'PRE_BATTLE_RULES' ? 'PRE_BATTLE' : s.deployment.stage === 'DEPLOY_ARMIES' ? 'DEPLOYMENT' : 'DECLARE_FORMATIONS';
  const earlyRecorded = new Set<number>();
  while (m.lastEventSequence < s.events.length) {
    const e = s.events[m.lastEventSequence++]!;
    if (!earlyRecorded.has(e.sequence)) recordProgress(s, e);
    if (e.type !== 'flow') continue;
    let timing: ScoringWindow | null = null;
    const stamp = { round: e.round, turn: e.turn, phase: s.phase, eventSequence: e.sequence };
    if (e.name === 'PHASE_ENDED') {
      timing = 'END_OF_PHASE'; stamp.phase = e.detail.phase as Phase;
      for (const o of m.objectives) resolveObjectiveControl(s, o, true);
    } else if (e.name === 'TURN_ENDED') {
      timing = 'END_OF_TURN'; stamp.phase = 'Fight';
      for (const o of m.objectives) resolveObjectiveControl(s, o);
    } else if (e.name === 'BATTLE_ROUND_ENDED') { timing = 'END_OF_BATTLE_ROUND'; stamp.phase = 'Fight'; }
    else if (e.name === 'COMMAND_STEP_STARTED' && e.detail.step === 'START_OF_COMMAND_PHASE') timing = 'START_OF_COMMAND_PHASE';
    else if (e.name === 'COMMAND_STEP_COMPLETED' && e.detail.step === 'END_OF_COMMAND_PHASE') timing = 'END_OF_COMMAND_PHASE';
    if (timing) {
      const beforeCompletion = s.events.length;
      completeMissionActions(s, timing, e.turn);
      // Completion effects are counted at their own end-of-turn boundary.
      for (const fresh of s.events.slice(beforeCompletion)) { recordProgress(s, fresh); earlyRecorded.add(fresh.sequence); }
      for (const action of m.activeActions.filter(a => a.state === 'COMPLETED' && a.startedAt.turn === e.turn && a.completesAt === timing)) {
        const def = m.definition.actions.find(x => x.id === action.actionId)!;
        if (def.effect.kind === 'AWARD_VP' && !m.scoredWindows.includes(`action-effect:${action.unitId}:${action.startedAt.turn}:${action.actionId}`)) {
          m.scoredWindows.push(`action-effect:${action.unitId}:${action.startedAt.turn}:${action.actionId}`);
          awardVictoryPoints(s, action.playerId, def.effect.amount ?? 0, 'OTHER', def.id, stamp);
        }
      }
      scoreWindow(s, timing, stamp, e.playerId);
    }
    if (m.definition.endConditions?.some(c => c.kind === 'EVENT_COUNT' && s.events.filter(x => x.sequence > m.initialEventSequence && x.type === 'flow' && x.name === c.event).length >= c.count) && !actionBusy(s)) {
      finishMission(s, 'MISSION_RULE', reserves); break;
    }
  }
  if (s.status === 'finished' && !m.matchResult) finishMission(s, 'ROUND_LIMIT', reserves);
  m.lastEventSequence = s.events.length;
}
