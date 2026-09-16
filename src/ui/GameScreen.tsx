import { useRef, useState } from 'react';
import { Button, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { GameEngine } from '../game/engine/GameEngine';
import { createCloseCombatTestMatch } from '../game/data/closeCombatPrototype';
import { CloseCombatPanel } from './CloseCombatPanel';
import type { CommandResult, FailureReason, GameState, Position } from '../game/models';
import { BattlefieldView, PLAYER_COLORS } from './BattlefieldView';
import { ShootingPanel } from './ShootingPanel';
import { BattleLog } from './BattleLog';
import { createSeededRng, type RandomSource } from '../game/utils/dice';
const MESSAGES: Partial<Record<FailureReason, string>> = {
  MATCH_FINISHED: 'The match has finished.', WRONG_PHASE: 'This action is not available in the current phase.',
  UNIT_NOT_FOUND: 'Unit not found.', NOT_YOUR_UNIT: 'Select a unit belonging to the active player.',
  ALREADY_MOVED: 'This unit has already completed its movement.', NO_LIVING_MODELS: 'This unit has no living models.',
  MOVEMENT_IN_PROGRESS: 'Complete or cancel the current unit movement first.', NO_ACTIVE_MOVEMENT: 'Select a friendly unit first.',
  MODEL_NOT_IN_UNIT: 'Select a model from the moving unit.', MODEL_DEAD: 'This model is not alive.',
  INVALID_POSITION: 'Invalid target coordinates.', EXCEEDS_ALLOWANCE: 'Not enough movement remaining.',
  OUTSIDE_BATTLEFIELD: 'The entire base must remain inside the battlefield.', BASE_OVERLAP: 'Another model blocks this position.',
  UNIT_ENGAGED: 'Engaged units cannot make normal moves or normal shooting attacks in this prototype.', ENEMY_ENGAGEMENT: 'A normal move cannot end within enemy engagement distance.',
  SHOOTING_IN_PROGRESS: 'Complete or cancel the shooting action first.', NO_ACTIVE_SHOOTING: 'Select a shooting unit first.',
  ALREADY_SHOT: 'This unit has already shot.', NO_RANGED_WEAPONS: 'This unit has no ranged weapons.',
  WEAPON_NOT_FOUND: 'Weapon not found.', WEAPON_NOT_RANGED: 'Select a ranged weapon.', WEAPON_ALREADY_FIRED: 'This profile has already fired.',
  TARGET_NOT_FOUND: 'Target not found.', TARGET_NOT_ENEMY: 'Choose an enemy target.', TARGET_DESTROYED: 'The target unit is destroyed.',
  TARGET_OUT_OF_RANGE: 'Target is out of range.', TARGET_NOT_VISIBLE: 'No in-range target model is visible.',
  NO_ELIGIBLE_FIRING_MODELS: 'No models can fire at this target.', SHOOTING_ALREADY_RESOLVED: 'Dice have been rolled; shooting cannot be cancelled.',
  INCOHERENT: 'The final formation is not coherent. Reposition models or cancel.',
};
export function GameScreen() {
  const engine = useRef<GameEngine | null>(null);
  const rng = useRef<RandomSource | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [target, setTarget] = useState<{ position: Position; legal: boolean } | null>(null);
  const [message, setMessage] = useState('');
  function report(result: CommandResult<unknown>, success: string) {
    setMessage(result.ok ? success : `${MESSAGES[result.reason] ?? result.reason.replaceAll("_", " ")}${result.blockingModelId ? ` Blocker: ${result.blockingModelId}.` : ''}`);
    setState(engine.current!.getState());
  }
  function start() {
    engine.current = GameEngine.create(createCloseCombatTestMatch());
    rng.current = createSeededRng(42); // Explicit repeatable debug stream; no platform randomness.
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
    if (current.closeCombat?.move) {
      if (current.closeCombat.move.unitId !== unitId) { setMessage('Select a model from the moving unit.'); return; }
      setSelectedModelId(modelId); setTarget(null); return;
    }
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
    if (engine.current!.getState().closeCombat?.move) {
      const result = engine.current!.moveCombatModel(selectedModelId, position);
      setTarget({ position, legal: result.ok }); report(result, 'Position accepted. Complete movement to validate the final formation.'); return;
    }
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
    {!state ? <><Text style={styles.text}>Local prototype · Movement, shooting, charge and fight</Text><Button title="START TEST BATTLE" onPress={start} /></> : <>
      <Text style={styles.text}>Round {state.round} · Turn {state.turn} · {state.phase}</Text>
      <Text style={styles.text}>Active player: {state.players.find(p => p.id === state.activePlayerId)?.name}</Text>
      <Text style={styles.text}>Battlefield: {state.battlefield.width}″ × {state.battlefield.height}″</Text>
      {state.phase === 'Shooting' && <Text style={styles.note}>Choose shooter, weapon and target using the shooting controls below.</Text>}
      <BattlefieldView state={state} selectedModelId={selectedModelId} target={target} onModel={(unitId, modelId) => { if (state.phase === 'Movement' || state.closeCombat?.move) chooseModel(unitId, modelId); }} onTarget={position => { if (state.phase === 'Movement' || state.closeCombat?.move) move(position); }} />
      <Text accessibilityLiveRegion="polite" style={styles.note}>{message}</Text>
      {state.units.map(unit => {
        const definition = state.definitions.find(d => d.id === unit.definitionId)!;
        const playerIndex = state.players.findIndex(p => p.id === unit.playerId);
        return <View key={unit.id} style={styles.card}>
          <Text style={[styles.unit, { color: PLAYER_COLORS[playerIndex] }]}>{definition.name} · P{playerIndex + 1}</Text>
          <Text style={styles.text}>Move {definition.stats.movement}″ · {unit.state.hasMoved ? 'Completed' : 'Available'}</Text>
          <Text style={styles.text}>Alive: {unit.models.filter(m => m.alive).length}/{unit.models.length} · Wounds: {unit.models.map(m => m.woundsRemaining).join(" / ")}</Text>
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
      {state.phase === 'Shooting' && <ShootingPanel state={state} engine={engine.current!} rng={rng.current!} report={report} />}
      {(state.phase === 'Charge' || state.phase === 'Fight') && <CloseCombatPanel state={state} engine={engine.current!} rng={rng.current!} report={report} />}
      <Button title="COMPLETE MOVE" disabled={!state.movement} onPress={() => finish(false)} />
      <Button title="CANCEL MOVE" disabled={!state.movement} onPress={() => finish(true)} />
      <Button title="NEXT PHASE" disabled={!!state.movement || !!state.shooting || !!state.closeCombat?.charge || !!state.closeCombat?.move} onPress={() => {
        report(engine.current!.tryNextPhase(), 'Phase advanced.'); setSelectedModelId(null); setTarget(null);
      }} />
      <BattleLog events={state.events} />
    </>}
  </ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#111827' }, content: { padding: 20, gap: 14, flexGrow: 1 },
  title: { color: '#fff', fontSize: 26, fontWeight: '700' }, text: { color: '#e5e7eb', fontSize: 15 },
  card: { padding: 12, backgroundColor: '#1f2937', borderRadius: 8, gap: 8 },
  unit: { fontSize: 18, fontWeight: '600' }, note: { color: '#fcd34d', fontSize: 13 },
});
