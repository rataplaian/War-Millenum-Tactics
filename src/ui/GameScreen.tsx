import { useRef, useState } from 'react';
import { Button, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { GameEngine } from '../game/engine/GameEngine';
import { createTestMatch } from '../game/data/prototype';
import type { CommandResult, FailureReason, GameState, Position } from '../game/models';
import { BattlefieldView, PLAYER_COLORS } from './BattlefieldView';
const MESSAGES: Record<FailureReason, string> = {
  MATCH_FINISHED: 'The match has finished.', WRONG_PHASE: 'Movement is only available in the Movement phase.',
  UNIT_NOT_FOUND: 'Unit not found.', NOT_YOUR_UNIT: 'Select a unit belonging to the active player.',
  ALREADY_MOVED: 'This unit has already completed its movement.', NO_LIVING_MODELS: 'This unit has no living models.',
  MOVEMENT_IN_PROGRESS: 'Complete or cancel the current unit movement first.', NO_ACTIVE_MOVEMENT: 'Select a friendly unit first.',
  MODEL_NOT_IN_UNIT: 'Select a model from the moving unit.', MODEL_DEAD: 'This model is not alive.',
  INVALID_POSITION: 'Invalid target coordinates.', EXCEEDS_ALLOWANCE: 'Not enough movement remaining.',
  OUTSIDE_BATTLEFIELD: 'The entire base must remain inside the battlefield.', BASE_OVERLAP: 'Another model blocks this position.',
  UNIT_ENGAGED: 'Engaged units cannot make a normal move in this prototype.', ENEMY_ENGAGEMENT: 'A normal move cannot end within enemy engagement distance.',
  INCOHERENT: 'The final formation is not coherent. Reposition models or cancel.',
};
export function GameScreen() {
  const engine = useRef<GameEngine | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [target, setTarget] = useState<{ position: Position; legal: boolean } | null>(null);
  const [message, setMessage] = useState('');
  function report(result: CommandResult<unknown>, success: string) {
    setMessage(result.ok ? success : `${MESSAGES[result.reason]}${result.blockingModelId ? ` Blocker: ${result.blockingModelId}.` : ''}`);
    setState(engine.current!.getState());
  }
  function start() {
    engine.current = GameEngine.create(createTestMatch());
    setState(engine.current.getState());
    setMessage('Advance to Movement, select a unit, then a model and destination.');
  }
  function chooseUnit(unitId: string) {
    const result = engine.current!.beginMovement(unitId);
    report(result, 'Movement started. Select a model and tap its destination.');
    if (result.ok) { setSelectedModelId(null); setTarget(null); }
  }
  function chooseModel(unitId: string, modelId: string) {
    const current = engine.current!.getState();
    if (!current.movement) {
      const result = engine.current!.beginMovement(unitId);
      report(result, 'Model selected. Tap its destination.');
      if (!result.ok) return;
    } else if (current.movement.unitId !== unitId) {
      setMessage('Complete or cancel this unit before selecting another.'); return;
    }
    setSelectedModelId(modelId); setTarget(null);
  }
  function move(position: Position) {
    if (!selectedModelId) { setMessage('Select a friendly unit and one of its models first.'); return; }
    const result = engine.current!.moveModel(selectedModelId, position);
    setTarget({ position, legal: result.ok });
    report(result, result.ok ? `Legal move: ${result.value.distance.toFixed(2)}″. Remaining: ${result.value.remaining.toFixed(2)}″.` : '');
  }
  function finish(cancel: boolean) {
    const result = cancel ? engine.current!.cancelMovement() : engine.current!.completeMovement();
    report(result, cancel ? 'Movement cancelled. Original positions restored.' : 'Movement completed.');
    if (result.ok) { setSelectedModelId(null); setTarget(null); }
  }
  return <SafeAreaView style={styles.screen}><StatusBar style="light" /><ScrollView contentContainerStyle={styles.content}>
    <Text accessibilityRole="header" style={styles.title}>WAR MILLENNIUM TACTICS</Text>
    {!state ? <><Text style={styles.text}>Local prototype · Tabletop movement</Text><Button title="START TEST BATTLE" onPress={start} /></> : <>
      <Text style={styles.text}>Round {state.round} · Turn {state.turn} · {state.phase}</Text>
      <Text style={styles.text}>Active player: {state.players.find(p => p.id === state.activePlayerId)?.name}</Text>
      <Text style={styles.text}>Battlefield: {state.battlefield.width}″ × {state.battlefield.height}″</Text>
      <BattlefieldView state={state} selectedModelId={selectedModelId} target={target} onModel={chooseModel} onTarget={move} />
      <Text accessibilityLiveRegion="polite" style={styles.note}>{message}</Text>
      {state.units.map(unit => {
        const definition = state.definitions.find(d => d.id === unit.definitionId)!;
        const playerIndex = state.players.findIndex(p => p.id === unit.playerId);
        return <View key={unit.id} style={styles.card}>
          <Text style={[styles.unit, { color: PLAYER_COLORS[playerIndex] }]}>{definition.name} · P{playerIndex + 1}</Text>
          <Text style={styles.text}>Move {definition.stats.movement}″ · {unit.state.hasMoved ? 'Completed' : 'Available'}</Text>
          <Text style={styles.note}>PLACEHOLDER DATA</Text>
          <Button title="SELECT UNIT" onPress={() => chooseUnit(unit.id)}
            disabled={state.phase !== 'Movement' || unit.playerId !== state.activePlayerId || unit.state.hasMoved || !!state.movement} />
          {state.movement?.unitId === unit.id && unit.models.filter(m => m.alive).map((model, i) =>
            <View key={model.id} style={{ gap: 4 }}>
              <Button title={`${selectedModelId === model.id ? 'SELECTED' : 'SELECT'} MODEL ${i + 1}`} onPress={() => chooseModel(unit.id, model.id)} />
              <Text style={styles.text}>Used: {model.movementUsed.toFixed(2)}″ / {definition.stats.movement}″</Text>
            </View>)}
        </View>;
      })}
      <Button title="COMPLETE MOVE" disabled={!state.movement} onPress={() => finish(false)} />
      <Button title="CANCEL MOVE" disabled={!state.movement} onPress={() => finish(true)} />
      <Button title="NEXT PHASE" disabled={!!state.movement} onPress={() => {
        report(engine.current!.tryNextPhase(), 'Phase advanced.'); setSelectedModelId(null); setTarget(null);
      }} />
      <Text style={styles.text}>Movement events: {state.events.length}</Text>
    </>}
  </ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#111827' }, content: { padding: 20, gap: 14, flexGrow: 1 },
  title: { color: '#fff', fontSize: 26, fontWeight: '700' }, text: { color: '#e5e7eb', fontSize: 15 },
  card: { padding: 12, backgroundColor: '#1f2937', borderRadius: 8, gap: 8 },
  unit: { fontSize: 18, fontWeight: '600' }, note: { color: '#fcd34d', fontSize: 13 },
});
