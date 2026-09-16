import { useState } from 'react';
import { Button, Text, TextInput, View } from 'react-native';
import type { GameState, Position } from '../game/models';
import type { GameEngine } from '../game/engine/GameEngine';
const style = { color: '#e5e7eb', fontSize: 13 };
export function TerrainDebugPanel({ state, engine, observerId, onObserver, targetZ, onTargetZ, onDestination }: {
  state: GameState; engine: GameEngine; observerId: string | null; onObserver: (id: string) => void;
  targetZ: number; onTargetZ: (z: number) => void; onDestination: (p: Position) => void;
}) {
  const [targetId, setTargetId] = useState(state.units[1]!.id);
  const [x, setX] = useState('4.5'), [y, setY] = useState('5');
  const observer = state.units.flatMap(u => u.models).find(m => m.id === observerId);
  const source = observer && state.units.find(u => u.id === observer.unitId);
  const weapon = state.definitions.find(d => d.id === source?.definitionId)?.weapons.find(w => w.kind === 'ranged');
  const debug = engine.getTerrainDebug(observerId ?? undefined, targetId, weapon?.id);
  const levels = [...new Set([0, ...(state.battlefield.terrain?.features ?? []).flatMap(f => f.surfaces.map(s => s.z))])];
  return <View style={{ padding: 12, backgroundColor: '#1f2937', gap: 8 }}>
    <Text style={{ ...style, fontSize: 18 }}>Terrain / visibility inspector</Text>
    {state.battlefield.terrain?.features.map(feature => <Text key={feature.id} style={style}>{feature.terrainAreaId} → {feature.id}: {feature.category}, height {feature.height}″; surfaces {feature.surfaces.map(s => `${s.z}″`).join(', ') || 'none'}</Text>)}
    <Text style={style}>Yellow: area footprint · grey: physical sections · blue: elevated surface.</Text>
    <Text style={style}>Observer selection is read-only. Use the battlefield to select a model for movement.</Text>
    {state.units.map(u => <View key={u.id} style={{ gap: 4 }}>
      <Text style={style}>{u.id}</Text>
      {u.models.filter(m => m.alive).map(m => {
        const info = debug.models.find(d => d.modelId === m.id)!;
        return <View key={m.id}>
          <Button title={`${m.id === observerId ? '✓ ' : ''}OBSERVE: ${m.id}`} onPress={() => onObserver(m.id)} />
          <Text style={style}>z {info.elevation}″ · {info.areaIds.join(', ') || 'outside areas'} · Hidden {info.hidden ? 'YES' : 'NO'} · Detection {info.detectionRange}″</Text>
        </View>;
      })}
      <Button title={`${targetId === u.id ? '✓ ' : ''}INSPECT TARGET: ${u.id}`} onPress={() => setTargetId(u.id)} />
    </View>)}
    {debug.target && <>
      <Text style={style}>Unit: {debug.target.fullyVisible ? 'FULLY_VISIBLE' : debug.target.visible ? 'VISIBLE' : 'NOT_VISIBLE'}</Text>
      {debug.target.models.map(m => <Text key={m.modelId} style={style}>{m.modelId}: {m.level} · LOS {m.hasLineOfSight ? 'YES' : 'NO'} · within detection {m.withinDetection ? 'YES' : 'NO'}</Text>)}
      {debug.target.attack && <Text style={style}>Cover {debug.target.attack.modifiers.some(m => m.source === 'COVER') ? 'YES' : 'NO'} · Plunging Fire {debug.target.attack.modifiers.some(m => m.source === 'PLUNGING_FIRE') ? 'YES' : 'NO'} · BS {debug.target.attack.baseSkill}+ → {debug.target.attack.effectiveSkill}+</Text>}
    </>}
    <Text style={style}>Movement destination elevation: {targetZ}″ (applies to battlefield taps)</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{levels.map(z => <Button key={z} title={`z = ${z}″`} onPress={() => onTargetZ(z)} />)}</View>
    <Text style={style}>Exact destination for the currently moving model (inches):</Text>
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <TextInput accessibilityLabel="Destination X in inches" value={x} onChangeText={setX} keyboardType="decimal-pad" style={{ ...style, flex: 1, borderWidth: 1, borderColor: '#64748b', padding: 8 }} />
      <TextInput accessibilityLabel="Destination Y in inches" value={y} onChangeText={setY} keyboardType="decimal-pad" style={{ ...style, flex: 1, borderWidth: 1, borderColor: '#64748b', padding: 8 }} />
    </View>
    <Button title="MOVE TO X / Y / Z" disabled={!state.movement && !state.closeCombat?.move} onPress={() => onDestination({ x: Number(x), y: Number(y), z: targetZ })} />
  </View>;
}
