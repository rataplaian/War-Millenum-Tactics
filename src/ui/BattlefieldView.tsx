import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { GameState, Position } from '../game/models';
import { baseRadius } from '../game/utils/geometry';
import { coordinateTransform } from './coordinates';
export const PLAYER_COLORS = ['#60a5fa', '#f472b6'] as const;
interface Props {
  state: GameState;
  selectedModelId: string | null;
  target: { position: Position; legal: boolean } | null;
  onModel: (unitId: string, modelId: string) => void;
  onTarget: (position: Position) => void;
}
export function BattlefieldView({ state, selectedModelId, target, onModel, onTarget }: Props) {
  const [width, setWidth] = useState(0);
  const height = width * state.battlefield.height / state.battlefield.width;
  const transform = width > 0 ? coordinateTransform(state.battlefield, { width, height }) : null;
  return <View style={{ width: '100%', aspectRatio: state.battlefield.width / state.battlefield.height, backgroundColor: '#243c36' }}
    onLayout={event => setWidth(event.nativeEvent.layout.width)}>
    <Pressable accessibilityLabel="Battlefield: tap a destination for the selected model"
      style={StyleSheet.absoluteFill} onPress={event => {
        if (transform) onTarget(transform.screenToGame({ x: event.nativeEvent.locationX, y: event.nativeEvent.locationY }));
      }} />
    {transform && state.units.flatMap(unit => unit.models.filter(m => m.alive).map((model, i) => {
      const centre = transform.gameToScreen(model.position);
      const diameter = baseRadius(model.base) * 2 * transform.scale;
      const playerIndex = state.players.findIndex(p => p.id === unit.playerId);
      return <Pressable key={model.id} accessibilityRole="button" accessibilityLabel={`${unit.id}, model ${i + 1}`}
        onPress={() => onModel(unit.id, model.id)}
        style={{ position: 'absolute', left: centre.x - diameter / 2, top: centre.y - diameter / 2,
          width: diameter, height: diameter, borderRadius: diameter / 2, backgroundColor: PLAYER_COLORS[playerIndex],
          borderWidth: 2, borderColor: selectedModelId === model.id ? '#fef08a' : '#0f172a', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: '#0f172a', fontSize: 10, fontWeight: 'bold' }}>{i + 1}</Text>
      </Pressable>;
    }))}
    {transform && target && <View pointerEvents="none" style={{ position: 'absolute',
      left: transform.gameToScreen(target.position).x - 6, top: transform.gameToScreen(target.position).y - 6,
      width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: target.legal ? '#4ade80' : '#f87171' }} />}
  </View>;
}
