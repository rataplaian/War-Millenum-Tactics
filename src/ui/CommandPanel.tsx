import { Button, Text, View } from 'react-native';
import type { GameState, CommandResult } from '../game/models';
import type { GameEngine } from '../game/engine/GameEngine';
import type { RandomSource } from '../game/utils/dice';
export function CommandPanel({ state, engine, rng, report }: { state: GameState; engine: GameEngine; rng: RandomSource; report: (r: CommandResult<unknown>, message: string) => void }) {
  const flow = state.flow; if (!flow) return null;
  const debug = engine.getCommandDebug(), text = { color: '#e5e7eb' };
  return <View style={{ padding: 12, gap: 8, backgroundColor: '#243044' }}>
    <Text style={text}>Round {state.round}/{flow.rules.maximumBattleRounds} · Turn {state.turn} · Phase #{flow.phaseIndex}</Text>
    <Text style={text}>Command step: {flow.commandStep ?? '—'} · Boundary: {flow.boundary}</Text>
    {state.players.map(p => <Text key={p.id} style={text}>{p.name}: {p.commandPoints} CP · Extra this round: {p.extraCpGainedThisBattleRound}/{flow.rules.maxExtraCpPerBattleRound}</Text>)}
    <Text style={text}>Pending: {flow.pending.length} · {debug.blockers.join(', ') || 'No phase blockers'}</Text>
    {flow.pending.map(p => <View key={p.id}><Text style={text}>{p.label}</Text><Button title={p.kind === 'BATTLE_SHOCK' ? `ROLL 2D6: ${p.unitId}` : `RESOLVE ${p.label}`} onPress={() => report(p.kind === 'BATTLE_SHOCK' ? engine.rollBattleShock(p.unitId!, rng) : engine.resolveCommandAbility(p.id), 'Mandatory resolution completed.')} /></View>)}
    {engine.getCommandAbilities().map(a => <Button key={a.id} title={`OPTIONAL ABILITY: ${a.id}`} disabled={!a.available} onPress={() => report(engine.resolveCommandAbility(a.id), 'Command ability resolved.')} />)}
    {debug.units.map(u => <Text key={u.id} style={text}>{u.id}: Battle-shocked {u.battleShocked ? 'YES' : 'NO'} · OC {u.objectiveControl ?? '—'} · Move {u.movement}″ · Actions {u.canStartAction ? 'eligible' : 'blocked'} · Retreat {u.orderedRetreat ? 'ordered allowed' : 'desperate escape required'}</Text>)}
    {state.phase === 'Command' && flow.commandStep && <Button title="ADVANCE COMMAND STEP" onPress={() => report(engine.advanceCommandStep(), 'Command step advanced.')} />}
    <Text style={text}>Timing window: {flow.window?.trigger ?? 'none'} · Queued: {flow.queuedWindows.length}</Text>
    {flow.window && state.players.map(p => <View key={p.id} style={{ gap: 5 }}>
      <Text style={text}>Available Stratagems · {p.name} · TECHNICAL TEST DATA</Text>
      {engine.getStratagemOptions(p.id).filter(o => state.units.find(u => u.id === o.targetIds[0])?.playerId === p.id).map(o => <View key={`${o.stratagemId}:${o.targetIds.join()}`}>
        <Text style={text}>{o.name} → {o.targetIds.join(', ')}: {o.result.ok ? 'LEGAL' : o.result.reason}</Text>
        {o.result.ok && <Button title={`USE ${o.name}`} onPress={() => report(engine.useStratagem(o.stratagemId, p.id, o.targetIds), 'Stratagem used. CP spent and effect applied.')} />}
      </View>)}
      <Button title={`PASS · ${p.name}`} disabled={flow.window!.passedPlayerIds.includes(p.id)} onPress={() => report(engine.passTimingWindow(p.id), 'Timing window passed.')} />
    </View>)}
    <Text style={text}>Active temporary effects</Text>
    {flow.effects.filter(e => e.active).map(e => <Text key={e.id} style={text}>{e.target.unitId}: {e.source} · {JSON.stringify(e.payload)} · expires {e.expiry} ({e.expiryPlayerId})</Text>)}
    {state.events.filter(e => e.type === 'flow' && e.name === 'BATTLE_SHOCK_ROLL_RESOLVED').slice(-2).map(e => <Text key={e.sequence} style={text}>{e.type === 'flow' ? `${e.unitId}: ${JSON.stringify(e.detail)}` : ''}</Text>)}
  </View>;
}
