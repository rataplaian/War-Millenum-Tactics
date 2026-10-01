import { onBattlefield } from '../game/reserves/location';
import { TacticalRangeOverlay, type TacticalRanges } from './TacticalRangeOverlay';
import { TerrainOverlay } from './TerrainOverlay';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { GameState, Position } from '../game/models';
import { baseRadius } from '../game/utils/geometry';
import { coordinateTransform } from './coordinates';
import { TOKEN_ART } from './tokenArt';
import { modelDefinitionId, UNIT_VISUALS, unitName } from './unitPresentation';
export const PLAYER_COLORS = ['#60a5fa', '#f472b6'] as const;
interface Props {
  state: GameState;
  selectedModelId: string | null;
  target: { position: Position; legal: boolean } | null;
  selectedUnitId?: string | null;
  validTargetIds?: string[];
  humanPlayerId?: string;
  previewPositions?: Record<string, Position>;
  tacticalRanges?: TacticalRanges;
  samples?: { position: Position; legal: boolean }[];
  onModel: (unitId: string, modelId: string) => void;
  onTarget: (position: Position) => void;
}
export function BattlefieldView({ state, selectedModelId, target, onModel, onTarget, samples = [], selectedUnitId, validTargetIds = [], humanPlayerId, previewPositions, tacticalRanges }: Props) {
  const [width, setWidth] = useState(0);
  const height = width * state.battlefield.height / state.battlefield.width;
  const transform = width > 0 ? coordinateTransform(state.battlefield, { width, height }) : null;
  return <View style={{ width: '100%', aspectRatio: state.battlefield.width / state.battlefield.height, backgroundColor: '#243c36' }}
    onLayout={event => setWidth(event.nativeEvent.layout.width)}>
    <Pressable accessibilityLabel="Battlefield: tap a destination for the selected model"
      style={StyleSheet.absoluteFill} onPress={event => {
        if (transform) onTarget(transform.screenToGame({ x: event.nativeEvent.locationX, y: event.nativeEvent.locationY }));
      }} />
    {transform && state.battlefield.losBlockers.map(blocker => {
      const origin = transform.gameToScreen(blocker.position);
      return <View pointerEvents="none" key={blocker.id} style={{ position: 'absolute', left: origin.x, top: origin.y,
        width: blocker.width * transform.scale, height: blocker.height * transform.scale,
        backgroundColor: blocker.opaque ? '#64748b' : '#475569', opacity: 0.6 }} />;
    })}
    {transform && <TerrainOverlay state={state} transform={transform} />}
    {transform && tacticalRanges && <TacticalRangeOverlay ranges={tacticalRanges} transform={transform}/> }
    {transform && samples.map((sample, i) => <View key={`sample-${i}`} pointerEvents="none" style={{ position: 'absolute', left: transform.gameToScreen(sample.position).x - 5, top: transform.gameToScreen(sample.position).y - 5, width: 10, height: 10, borderRadius: 5, backgroundColor: sample.legal ? '#4ade80' : '#f87171', opacity: 0.65 }} />)}
    {transform && state.units.flatMap(unit => unit.models.filter(m => m.alive && (onBattlefield(unit) || (!!previewPositions?.[m.id] || !!state.setup?.positions[m.id] || !!state.transportState?.disembark?.positions[m.id]))).map((model, i) => {
      const centre = transform.gameToScreen(previewPositions?.[model.id] ?? state.setup?.positions[model.id] ?? state.transportState?.disembark?.positions[model.id] ?? model.position);
      const diameter = baseRadius(model.base) * 2 * transform.scale;
      const playerIndex = state.players.findIndex(p => p.id === unit.playerId);
      const visual=UNIT_VISUALS[modelDefinitionId(state,unit,model)];
      const color=validTargetIds.includes(unit.id)?'#4ade80':selectedUnitId===unit.id?'#facc15':PLAYER_COLORS[playerIndex];
      return <Pressable key={model.id} accessibilityRole="button" accessibilityLabel={`${unitName(state,unit.id)}, model ${i + 1}${selectedModelId===model.id?", selected":""}`}
        hitSlop={humanPlayerId?8:undefined} onPress={() => onModel(unit.id, model.id)}
        style={{ position: 'absolute', left: centre.x - diameter / 2, top: centre.y - diameter / 2,
          width: diameter, height: diameter, borderRadius: diameter / 2, backgroundColor: PLAYER_COLORS[playerIndex],
          borderWidth: selectedModelId===model.id?3:2, borderColor: color, boxShadow:selectedUnitId===unit.id?'0 0 7px #facc1560':undefined, overflow:'hidden', opacity:previewPositions?.[model.id]?0.65:1, alignItems: 'center', justifyContent: 'center' }}>
        {visual && <Image source={TOKEN_ART[visual.token]} style={[StyleSheet.absoluteFill,{width:diameter-4,height:diameter-4}]} resizeMode="cover"/>}
        <Text pointerEvents="none" style={{ color: '#fff', backgroundColor:'#11182790', ...(humanPlayerId?{position:'absolute' as const,bottom:0,right:1}:{}), fontSize: Math.max(8,Math.min(12,diameter/3)), fontWeight: 'bold' }}>{i + 1}</Text>
      </Pressable>;
    }))}
    {transform && target && <View pointerEvents="none" style={{ position: 'absolute',
      left: transform.gameToScreen(target.position).x - 6, top: transform.gameToScreen(target.position).y - 6,
      width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: target.legal ? '#4ade80' : '#f87171' }} />}
  </View>;
}
