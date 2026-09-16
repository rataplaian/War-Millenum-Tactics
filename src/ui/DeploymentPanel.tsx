import { useMemo, useState } from 'react';
import { Button, Text, TextInput, View } from 'react-native';
import type { CommandResult, GameState, Position } from '../game/models';
import type { GameEngine } from '../game/engine/GameEngine';
import { battleStarted, locationOf } from '../game/reserves/location';
import { BattlefieldView } from './BattlefieldView';
export function DeploymentPanel({ state, engine, report }: { state: GameState; engine: GameEngine; report: (r: CommandResult<unknown>, message: string) => void }) {
  const [modelId, setModelId] = useState<string | null>(null), [x, setX] = useState('3'), [y, setY] = useState('3'), [z, setZ] = useState('0');
  const [samplesVisible, showSamples] = useState(false);
  const [target, setTarget] = useState<{ position: Position; legal: boolean } | null>(null);
  const options = engine.getDeploymentOptions(), stage = state.deployment?.stage;
  const samples = useMemo(() => samplesVisible ? engine.getSetupPreviewSamples(Number(z)) : [], [engine, state, z, samplesVisible]);
  const txUnitId = state.setup?.unitId ?? state.scout?.unitId, txUnit = state.units.find(u => u.id === txUnitId);
  const preview = state.setup ? engine.previewSetup() : null;
  const act = (r: CommandResult<unknown>, message: string) => { report(r, message); if (r.ok) setTarget(null); };
  function destination(p: Position) {
    p = { ...p, z: Number(z) };
    if (state.setup) {
      const result = modelId ? engine.stageSetupModel(modelId, p) : engine.stageSetupFormationAt(p);
      const legal = result.ok ? engine.previewSetup() : result;
      setTarget({ position: p, legal: legal.ok }); report(result.ok ? legal : result, 'Formation legal; confirm to commit.');
    } else if (state.scout && modelId) {
      const result = engine.moveScoutModel(modelId, p); setTarget({ position: p, legal: result.ok }); report(result, 'Scout position accepted.');
    }
  }
  return <View style={{ gap: 8 }}>
    <Text style={{ color: '#fff', fontWeight: 'bold' }}>Deployment / Reserves · {stage ?? 'Legacy battle'}</Text>
    {options.points.map(p => <Text key={p.playerId} style={{ color: '#cbd5e1' }}>{p.playerId}: initial Strategic Reserves {p.used} / {p.limit} points</Text>)}
    {!battleStarted(state) && <>
      <Text style={{ color: '#fcd34d' }}>Next deployment: {options.nextPlayerId ?? 'done'} · First turn: {state.deployment?.firstTurnPlayerId ?? 'choose below'}</Text>
      {state.players.map(p => <Button key={p.id} title={`FIRST TURN: ${p.name}`} disabled={stage === 'PRE_BATTLE_RULES'} onPress={() => act(engine.setFirstTurn(p.id), 'First turn selected.')} />)}
      <Button title="NEXT PRE-BATTLE STEP" onPress={() => act(engine.advancePreBattle(), 'Pre-battle advanced.')} />
    </>}
    {(!battleStarted(state) || !!state.setup) && <BattlefieldView state={state} selectedModelId={modelId} target={target} samples={samples} onModel={(_u, id) => setModelId(id)} onTarget={destination} />}
    {txUnit && <>
      <Text style={{ color: '#fcd34d' }}>{state.setup ? `Setup: ${state.setup.mode} · ${preview?.ok ? 'LEGAL' : preview && !preview.ok ? preview.reason : ''}` : `Scout allowance ${state.scout!.allowance}″`}</Text>
      <Button title="SELECT WHOLE FORMATION" disabled={!state.setup} onPress={() => setModelId(null)} />
      {txUnit.models.filter(m => m.alive).map((m, i) => <Button key={m.id} title={`${modelId === m.id ? 'SELECTED' : 'SELECT'} MODEL ${i + 1}`} onPress={() => setModelId(m.id)} />)}
      <View style={{ flexDirection: 'row', gap: 8 }}>{[['x', x, setX], ['y', y, setY], ['z', z, setZ]].map(([label, value, setter]) => <TextInput key={label as string} accessibilityLabel={`Setup ${label}`} value={value as string} onChangeText={setter as (value: string) => void} keyboardType="decimal-pad" style={{ backgroundColor: '#fff', padding: 8, width: 75 }} />)}</View>
      <Button title="PREVIEW / PLACE AT X Y Z" onPress={() => destination({ x: Number(x), y: Number(y) })} />
      {state.setup && <><Button title={samplesVisible ? 'HIDE SETUP SAMPLES' : 'SHOW LEGAL / ILLEGAL SETUP SAMPLES'} onPress={() => showSamples(!samplesVisible)} /><Text style={{ color: '#cbd5e1' }}>Green/red dots test this complete formation at sampled anchors and selected elevation. Positions remain continuous; confirm always revalidates.</Text></>}
      <Button title="CONFIRM SETUP / SCOUT MOVE" onPress={() => act(state.setup ? engine.completeSetup() : engine.completeScoutMove(), 'Committed.')} />
      <Button title="CANCEL SETUP / SCOUT MOVE" onPress={() => act(state.setup ? engine.cancelSetup() : engine.cancelScoutMove(), 'Cancelled.')} />
    </>}
    {state.units.map(u => {
      const definition = state.definitions.find(d => d.id === u.definitionId)!;
      return <View key={u.id} style={{ padding: 8, backgroundColor: '#1f2937', gap: 4 }}>
        <Text style={{ color: '#fff' }}>{definition.name} · {u.playerId} · {locationOf(u)} · {definition.points} pts</Text>
        <Text style={{ color: '#cbd5e1' }}>{definition.coreAbilities?.map(a => a.kind === 'SCOUTS' ? `SCOUTS ${a.distance}″` : a.kind).join(' / ') || 'No deployment abilities'} · Choice: {state.deployment?.choices[u.id] ?? 'none'}</Text>
        {stage === 'DECLARE_BATTLE_FORMATIONS' && <Button title={u.location === 'STRATEGIC_RESERVES' ? 'RETURN TO DEPLOYMENT' : 'SELECT STRATEGIC RESERVES'} onPress={() => act(engine.selectStrategicReserve(u.id, u.location !== 'STRATEGIC_RESERVES'), 'Reserve selection updated.')} />}
        {(stage === 'DECLARE_BATTLE_FORMATIONS' || stage === 'DEPLOY_ARMIES') && <>
          {(['SCOUTS', 'INFILTRATORS'] as const).map(choice => <Button key={choice} title={`CHOOSE ${choice}`} onPress={() => act(engine.chooseDeploymentAbility(u.id, choice), 'Ability selected.')} />)}
          {stage === 'DEPLOY_ARMIES' && <><Button title="DEPLOY NORMALLY" onPress={() => { setModelId(null); act(engine.beginDeployment(u.id), 'Tap a formation anchor.'); }} /><Button title="DEPLOY USING INFILTRATORS" onPress={() => { setModelId(null); act(engine.beginDeployment(u.id, true), 'Tap a formation anchor.'); }} /></>}
        </>}
        {stage === 'PRE_BATTLE_RULES' && options.scoutUnitIds.includes(u.id) && <>
          <Button title={u.location === 'STRATEGIC_RESERVES' ? 'SCOUTS: SET UP FROM RESERVES' : 'START SCOUT MOVE'} onPress={() => { setModelId(null); act(u.location === 'STRATEGIC_RESERVES' ? engine.beginScoutSetup(u.id) : engine.beginScoutMove(u.id), 'Scout action started.'); }} />
          <Button title="SKIP SCOUTS" onPress={() => act(engine.skipScout(u.id), 'Scout opportunity passed.')} />
        </>}
        {battleStarted(state) && u.location === 'STRATEGIC_RESERVES' && <>
          <Button title="INGRESS: STRATEGIC EDGE" onPress={() => { setModelId(null); act(engine.beginIngress(u.id, 'STRATEGIC_EDGE'), 'Select an ingress formation.'); }} />
          <Button title="INGRESS: DEEP STRIKE" onPress={() => { setModelId(null); act(engine.beginIngress(u.id, 'DEEP_STRIKE'), 'Select a Deep Strike formation.'); }} />
        </>}
        {battleStarted(state) && u.location === 'BATTLEFIELD' && <Button title="DEBUG: REPOSITION TO RESERVES" onPress={() => act(engine.moveUnitToStrategicReserves(u.id, 'debug ability hook'), 'Unit repositioned.')} />}
        {u.arrival && <Text style={{ color: '#cbd5e1' }}>Arrival: {u.arrival.method} / {u.arrival.ingressMethod}, turn {u.arrival.turn}</Text>}
      </View>;
    })}
    {battleStarted(state) && <><Button title="DEBUG: NEXT PLAYER TURN" onPress={() => act(engine.tryNextTurn(), 'Turn advanced; round and reserve deadlines resolved by engine.')} /><Button title="DEBUG: FINISH BATTLE" onPress={() => act(engine.finishBattle(), 'Battle ended; reserve policy resolved.')} /></>}
  </View>;
}
