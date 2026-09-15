import { useRef, useState } from 'react';
import { Button, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { GameEngine } from '../game/engine/GameEngine';
import { createTestMatch } from '../game/data/prototype';
import type { GameState } from '../game/models';
export function GameScreen() {
  const engine = useRef<GameEngine | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  function start() { engine.current = GameEngine.create(createTestMatch()); setState(engine.current.getState()); }
  return <SafeAreaView style={styles.screen}><StatusBar style="light" /><ScrollView contentContainerStyle={styles.content}>
    <Text accessibilityRole="header" style={styles.title}>WAR MILLENNIUM TACTICS</Text>
    {!state ? <><Text style={styles.text}>Local prototype · Technical foundation</Text><Button title="START TEST BATTLE" onPress={start} /></> : <>
      <View accessibilityLiveRegion="polite" style={styles.card}>
        <Text style={styles.text}>Round: {state.round}</Text>
        <Text style={styles.text}>Turn: {state.turn}</Text>
        <Text style={styles.text}>Active player: {state.players.find(p => p.id === state.activePlayerId)?.name}</Text>
        <Text style={styles.text}>Current phase: {state.phase}</Text>
      </View>
      {state.units.map(unit => <View key={unit.id} style={styles.card}>
        <Text accessibilityRole="header" style={styles.unit}>{unit.name}</Text>
        <Text style={styles.text}>{state.players.find(p => p.id === unit.playerId)?.name} · {unit.factionId}</Text>
        <Text style={styles.text}>Models alive: {unit.models.filter(m => m.alive).length}/{unit.models.length}</Text>
        <Text style={styles.text}>Wounds remaining: {unit.models.reduce((sum, m) => sum + m.woundsRemaining, 0)}</Text>
        <Text style={styles.note}>PLACEHOLDER DATA — no official datasheet</Text>
      </View>)}
      <Button title="NEXT PHASE" onPress={() => { if (engine.current) setState(engine.current.nextPhase()); }} />
    </>}
  </ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#111827' }, content: { padding: 24, gap: 20, flexGrow: 1 },
  title: { color: '#fff', fontSize: 28, fontWeight: '700' }, text: { color: '#e5e7eb', fontSize: 16 },
  card: { padding: 16, backgroundColor: '#1f2937', borderRadius: 8, gap: 8 },
  unit: { color: '#fff', fontSize: 20, fontWeight: '600' }, note: { color: '#fcd34d', fontSize: 12 },
});
