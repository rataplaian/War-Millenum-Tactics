import { useState } from 'react';
import { Button, Text, View } from 'react-native';
import type { CommandResult, GameState } from '../game/models';
import { onBattlefield } from '../game/reserves/location';
import type { GameEngine } from '../game/engine/GameEngine';
export function MissionPanel({ state, engine, report }: { state: GameState; engine: GameEngine; report: (r: CommandResult<unknown>, message: string) => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  if (!state.mission) return null;
  const debug = engine.getMissionDebug(selectedId ?? undefined)!;
  const line = { color: '#e5e7eb', fontSize: 14 };
  return <View style={{ padding: 12, backgroundColor: '#173441', gap: 8 }}>
    <Text style={{ ...line, fontWeight: 'bold' }}>{debug.name} · ROUND {debug.round}/{state.mission.definition.maximumBattleRounds}</Text>
    {debug.scores.map(score => <Text key={score.playerId} style={line}>{score.playerId}: {score.total} VP · Primary {score.primary} · Secondary {score.secondary} · Other {score.other}</Text>)}
    {debug.objectives.map(o => <Text key={o.id} style={line}>{o.id}: {o.owner ?? 'uncontrolled'} {o.secured ? `(secured by ${o.secured})` : ''} · {o.control.map(c => `${c.playerId}: ${c.value} OC`).join(' / ')}</Text>)}
    {state.units.filter(u => u.playerId === state.activePlayerId && onBattlefield(u) && u.models.some(m => m.alive)).map(u =>
      <Button key={u.id} title={`${selectedId === u.id ? 'SELECTED' : 'SELECT'} ${u.id}`} onPress={() => setSelectedId(u.id)} />)}
    {selectedId && <Text style={line}>{selectedId} · OC per model: {debug.selectedUnitOC.map(m => `${m.id}: ${m.value}`).join(' / ') || '—'}</Text>}
    {selectedId && debug.actions.map(a => <View key={a.id} style={{ gap: 3 }}>
      <Text style={line}>{a.id}: {a.eligibility?.ok ? 'eligible' : a.eligibility?.reason ?? 'unavailable'}</Text>
      {a.objectives.length ? a.objectives.map(id => <Button key={id} title={`START ${a.id} → ${id}`} disabled={!a.eligibility?.ok || state.status === 'finished'}
        onPress={() => report(engine.startAction(selectedId, a.id, id), 'Action started.')} />) :
        <Button title={`START ${a.id}`} disabled={!a.eligibility?.ok || state.status === 'finished'}
          onPress={() => report(engine.startAction(selectedId, a.id), 'Action started.')} />}
    </View>)}
    <Text style={line}>Active Actions: {debug.activeActions.map(a => `${a.unitId}: ${a.actionId}`).join(', ') || 'none'}</Text>
    {state.players.map(p => <Text key={p.id} style={line}>{p.name} · Fixed: {debug.fixed[p.id]?.join(', ') || 'none'} · Tactical hand: {debug.tactical[p.id]?.hand.join(', ') || 'none'} · Deck: {debug.tactical[p.id]?.deck.length ?? 0}</Text>)}
    {debug.result && <Text style={{ ...line, fontWeight: 'bold' }}>BATTLE ENDED: {debug.result.outcome} · {debug.result.winnerPlayerId ?? 'draw'} · {debug.result.endReason}</Text>}
    {state.status === 'in-progress' && <Button title="END TEST BATTLE" onPress={() => report(engine.finishBattle(), 'Battle ended.')} />}
  </View>;
}
