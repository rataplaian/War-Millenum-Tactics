import type { GameState } from '../models';
import { scoreBreakdown, validMissionDefinition } from './MissionEngine';
const valid = (n: number, min = 0) => Number.isSafeInteger(n) && n >= min;
const fail = () => { throw new Error('Invalid mission snapshot'); };
/** Mission is optional in schema 3: previous Task snapshots load unchanged. */
export function validateMissionState(s: GameState) {
  const m = s.mission; if (!m) return;
  const d = m.definition, player = (id: string) => s.players.some(p => p.id === id);
  if (!s.flow || !d || !validMissionDefinition(s,d) || d.maximumBattleRounds !== s.flow.rules.maximumBattleRounds ||
      d.battlefield.width !== s.battlefield.width || d.battlefield.height !== s.battlefield.height ||
      !player(m.attackerPlayerId) || !player(m.defenderPlayerId) || m.attackerPlayerId === m.defenderPlayerId ||
      !['MUSTER', 'DETERMINE_MISSION', 'DETERMINE_DEPLOYMENT', 'CREATE_BATTLEFIELD', 'ATTACKER_DEFENDER', 'SELECT_SECONDARIES', 'DECLARE_FORMATIONS', 'DEPLOYMENT', 'PRE_BATTLE', 'BATTLE'].includes(m.setupStep) ||
      !valid(m.initialEventSequence) || !valid(m.lastEventSequence) || m.initialEventSequence > m.lastEventSequence || m.lastEventSequence > s.events.length ||
      !Array.isArray(m.objectives) || m.objectives.length !== d.objectives.length || new Set(m.objectives.map(o => o.id)).size !== m.objectives.length ||
      !Array.isArray(m.ledger) || !Array.isArray(m.activeActions) || !Array.isArray(m.scoredWindows) || m.scoredWindows.some(x => typeof x !== 'string') || !Array.isArray(m.completedObjectives) || !Array.isArray(m.actionUses)) fail();
  for (const o of m.objectives) {
    const source = d.objectives.find(x => x.id === o.id);
    if (!source || source.type !== o.type || source.terrainAreaId !== o.terrainAreaId ||
      (o.type === 'TERRAIN_OBJECTIVE' && !s.battlefield.terrain?.areas.some(a => a.id === o.terrainAreaId)) ||
      (o.type === 'MARKER_OBJECTIVE' && (!o.position || !Number.isFinite(o.position.x) || !Number.isFinite(o.position.y) || !valid(o.markerRange ?? 0))) ||
      (o.controllingPlayerId !== null && !player(o.controllingPlayerId)) || (o.securedByPlayerId !== null && (o.securedByPlayerId !== o.controllingPlayerId || !player(o.securedByPlayerId))) ||
      (o.securedByPlayerId && (!valid(o.securedAtRound ?? 0, 1) || !valid(o.securedAtTurn ?? 0, 1) || !o.securedSource))) fail();
  }
  for (const p of s.players) {
    const fixed = m.fixed[p.id], h = m.tactical[p.id], primary = m.primaryProgress[p.id], secondary = m.secondaryProgress[p.id];
    if (!fixed || !h || !primary || !secondary || fixed.length > d.secondaryPolicy.fixedCount || new Set(fixed).size !== fixed.length ||
      fixed.some(id => !d.secondaries.some(x => x.id === id && x.mode === 'FIXED')) ||
      !Array.isArray(h.deck) || !Array.isArray(h.hand) || !Array.isArray(h.discarded) || !Array.isArray(h.completed) || !Array.isArray(h.retained) ||
      h.hand.length > d.secondaryPolicy.tacticalHandSize || h.retained.some(id => !h.hand.includes(id)) ||
      new Set([...h.deck, ...h.hand, ...h.discarded, ...h.completed]).size !== [...h.deck, ...h.hand, ...h.discarded, ...h.completed].length ||
      [...h.deck, ...h.hand, ...h.discarded, ...h.completed].some(id => !d.secondaries.some(x => x.id === id && x.mode === 'TACTICAL')) ||
      Object.values(primary).some(n => !valid(n)) || Object.values(secondary).some(n => !valid(n))) fail();
  }
  for (const a of m.activeActions) if (!d.actions.some(x => x.id === a.actionId && x.completes === a.completesAt) || !s.units.some(u => u.id === a.unitId && u.playerId === a.playerId) ||
    !['ACTIVE', 'INTERRUPTED', 'COMPLETED', 'FAILED'].includes(a.state) || !valid(a.startedAt.turn, 1) || a.startedAt.turn > s.turn ||
    !valid(a.startedAt.round, 1) || a.startedAt.round > s.round || !['Command', 'Movement', 'Shooting', 'Charge', 'Fight'].includes(a.startedAt.phase) ||
    (a.state === 'ACTIVE' && (a.startedAt.turn !== s.turn || s.status !== 'in-progress'))) fail();
  if (m.actionUses.some(x => !player(x.playerId) || !d.actions.some(a => a.id === x.actionId) || !valid(x.turn, 1) || x.turn > s.turn)) fail();
  for (const [i, entry] of m.ledger.entries()) if (entry.id !== i + 1 || !player(entry.playerId) || !valid(entry.amount, 1) || !entry.sourceId ||
    !['PRIMARY', 'SECONDARY', 'OTHER'].includes(entry.sourceType) || !valid(entry.round, 1) || entry.round > s.round || !valid(entry.turn, 1) || entry.turn > s.turn ||
    !['Command', 'Movement', 'Shooting', 'Charge', 'Fight'].includes(entry.phase) || (entry.eventSequence !== undefined && (!valid(entry.eventSequence, 1) || entry.eventSequence > s.events.length))) fail();
  for (const p of s.players) for (const category of ['PRIMARY', 'SECONDARY'] as const) {
    const entries = m.ledger.filter(x => x.playerId === p.id && x.sourceType === category);
    const limit = category === 'PRIMARY' ? d.caps.primaryTotal : d.caps.secondaryTotal;
    const perRound = category === 'PRIMARY' ? d.caps.primaryPerRound : d.caps.secondaryPerRound;
    if (entries.reduce((n, e) => n + e.amount, 0) > limit ||
      [...new Set(entries.map(e => e.round))].some(round => entries.filter(e => e.round === round).reduce((n, e) => n + e.amount, 0) > perRound) ||
      (d.caps.total !== undefined && m.ledger.filter(x => x.playerId === p.id).reduce((n, e) => n + e.amount, 0) > d.caps.total)) fail();
  }
  if (!!m.matchResult !== (s.status === 'finished')) fail();
  if (m.matchResult) {
    const scores = s.players.map(p => scoreBreakdown(s, p.id));
    const winner = scores[0]!.total === scores[1]!.total ? null : scores[0]!.total > scores[1]!.total ? scores[0]!.playerId : scores[1]!.playerId;
    if (JSON.stringify(scores) !== JSON.stringify(m.matchResult.scores) || m.matchResult.winnerPlayerId !== winner ||
      m.matchResult.outcome !== (winner ? 'WIN' : 'DRAW') || !m.matchResult.endReason || !valid(m.matchResult.completedBattleRounds)) fail();
  }
}
