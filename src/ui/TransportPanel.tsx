import { useState } from 'react';
import { Button, Text, TextInput, View } from 'react-native';
import type { CommandResult, GameState, Position } from '../game/models';
import type { GameEngine } from '../game/engine/GameEngine';
import type { RandomSource } from '../game/utils/dice';
import { BattlefieldView } from './BattlefieldView';
const text = { color: '#e5e7eb' };
export function TransportPanel({ state, engine, rng, report }: { state: GameState; engine: GameEngine; rng: RandomSource; report: (r: CommandResult<unknown>, message: string) => void }) {
  const [selected, setSelected] = useState<string | null>(null), [model, setModel] = useState<string | null>(null);
  const [x, setX] = useState('15'), [y, setY] = useState('15'), [z, setZ] = useState('0');
  const [deck, setDeck] = useState<{ modelId: string; weaponId: string }[]>([]);
  const debug = engine.getTransportDebug(), tx = state.transportState?.disembark;
  const unit = state.units.find(u => u.id === selected);
  function place(p: Position) { if (model) report(engine.stageDisembarkModel(model, { ...p, z: Number(z) }), 'Candidate staged; preview checks the complete formation.'); }
  return <View style={{ gap: 8, padding: 10, backgroundColor: '#1f2937' }}>
    <Text style={text}>Transports / Attached Units</Text>
    {debug.transports.map(t => { const u = state.units.find(u => u.id === t.id)!, capacity = state.definitions.find(d => d.id === u.definitionId)!.transport!.maximumModels;
      return <Text key={t.id} style={text}>{t.id}: {capacity - t.remaining}/{capacity} used · {t.remaining} free · passengers: {t.passengers.join(', ') || 'none'}</Text>;
    })}
    {state.units.map(u => <Button key={u.id} title={`${selected === u.id ? 'SELECTED' : 'SELECT'} ${u.id} · ${u.location ?? 'BATTLEFIELD'}`} onPress={() => { setSelected(u.id); setDeck([]); }} />)}
    {unit && <>
      <Text style={text}>{JSON.stringify(debug.units.find(u => u.id === unit.id), null, 2)}</Text>
      {state.deployment?.stage === 'DECLARE_BATTLE_FORMATIONS' && debug.transports.map(t => <Button key={t.id} title={`START EMBARKED IN ${t.id}`} onPress={() => report(engine.startEmbarked(unit.id, t.id), 'Passenger manifest updated.')} />)}
      {state.phase === 'Movement' && <>
        {(['NORMAL_MOVE', 'ADVANCE_MOVE', 'FALL_BACK_MOVE'] as const).map(kind => <Button key={kind} title={`BEGIN ${kind}`} onPress={() => report(engine.beginMovement(unit.id, kind, rng), 'Move selected; use the battlefield controls.')} />)}
        {debug.transports.map(t => <Button key={t.id} title={`COMPLETE MOVE + EMBARK IN ${t.id}`} disabled={state.movement?.unitId !== unit.id} onPress={() => report(engine.completeMovement(t.id), 'Movement committed and passenger embarked.')} />)}
      </>}
      {unit.location === 'EMBARKED' && <Button title="DISEMBARK / EMERGENCY DISEMBARK" onPress={() => { setModel(null); report(engine.beginDisembark(unit.id, rng), 'Disembark started.'); }} />}
      {state.phase === 'Shooting' && !state.shooting && debug.transports.some(t => t.id === unit.id) && <>
        {engine.getFiringDeckOptions(unit.id).map(o => { const checked = deck.some(d => d.modelId === o.modelId && d.weaponId === o.weaponId); return <Button key={`${o.modelId}:${o.weaponId}`} title={`${checked ? 'REMOVE' : 'ADD'} ${o.modelId} / ${o.weaponId}`} onPress={() => setDeck(checked ? deck.filter(d => d.modelId !== o.modelId) : [...deck.filter(d => d.modelId !== o.modelId), o])} />; })}
        <Button title={`SHOOT WITH FIRING DECK (${deck.length})`} onPress={() => report(engine.beginShooting(unit.id, deck), 'Temporary loadout selected; use Shooting controls.')} />
      </>}
    </>}
    {tx && <>
      <Text style={text}>Mode: {tx.mode} · Hazard: {tx.hazard?.rolls.join(', ') ?? 'none'} · Mortal wounds: {tx.hazard?.mortalWounds ?? 0}</Text>
      {state.units.find(u => u.id === tx.unitId)!.models.filter(m => m.alive).map(m => <Button key={m.id} title={`PLACE ${m.id}`} onPress={() => setModel(m.id)} />)}
      <BattlefieldView state={state} selectedModelId={model} target={null} onModel={(_u, id) => setModel(id)} onTarget={place} />
      <View style={{ flexDirection: 'row', gap: 8 }}>{[[x,setX,'x'],[y,setY,'y'],[z,setZ,'z']].map(([value,setter,label]) => <TextInput key={label as string} accessibilityLabel={`Disembark ${label}`} value={value as string} onChangeText={setter as (v:string)=>void} keyboardType="decimal-pad" style={{backgroundColor:'#fff',padding:8,width:70}} />)}</View>
      <Button title="STAGE X Y Z" onPress={() => place({x:Number(x),y:Number(y)})} />
      <Button title="VALIDATE FORMATION" onPress={() => report(engine.previewDisembark(), 'Formation legal.')} />
      <Button title={tx.mode === 'EMERGENCY' ? 'RESOLVE EMERGENCY PLACEMENT' : 'COMPLETE DISEMBARK'} onPress={() => report(tx.mode === 'EMERGENCY' ? engine.resolveEmergencyDisembark() : engine.completeDisembark(), 'Disembark resolved. Tactical requires immediate Normal/Advance movement.')} />
      <Button title="CANCEL DISEMBARK" onPress={() => report(engine.cancelDisembark(), 'Cancelled.')} />
    </>}
    {state.transportState?.tacticalFollowUp && <Text style={text}>Mandatory move pending: {state.transportState.tacticalFollowUp}</Text>}
    {state.attachments?.filter(a => !a.active).map(a => <Text key={a.id} style={text}>Split: {a.id} → {a.components.map(c => c.original.id).join(', ')}</Text>)}
  </View>;
}
