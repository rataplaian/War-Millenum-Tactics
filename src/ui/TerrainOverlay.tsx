import { Text, View } from 'react-native';
import type { GameState, Polygon } from '../game/models';
import type { coordinateTransform } from './coordinates';
/** Pure drawing of supplied polygons; no visibility, support or movement decisions. */
export function TerrainOverlay({ state, transform }: { state: GameState; transform: ReturnType<typeof coordinateTransform> }) {
  const draw = (id: string, polygon: Polygon, color: string, label?: string) => <View key={id} pointerEvents="none">
    {polygon.vertices.map((v, i) => {
      const a = transform.gameToScreen(v), b = transform.gameToScreen(polygon.vertices[(i + 1) % polygon.vertices.length]!);
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      return <View key={i} style={{ position: 'absolute', left: (a.x + b.x) / 2 - length / 2, top: (a.y + b.y) / 2 - 1,
        width: length, height: 2, backgroundColor: color, transform: [{ rotate: `${Math.atan2(b.y - a.y, b.x - a.x)}rad` }] }} />;
    })}
    {label && <Text style={{ position: 'absolute', left: transform.gameToScreen(polygon.vertices[0]!).x, top: transform.gameToScreen(polygon.vertices[0]!).y,
      color, fontSize: 9, backgroundColor: '#111827aa' }}>{label}</Text>}
  </View>;
  const terrain = state.battlefield.terrain;
  return <View pointerEvents="none" style={{ position: 'absolute', inset: 0 }}>
    {terrain?.areas.map(a => draw(a.id, a.footprint, '#fbbf24'))}
    {terrain?.features.flatMap(f => [draw(f.id, f.footprint, f.category === 'DENSE' ? '#c084fc' : f.category === 'LIGHT' ? '#4ade80' : '#cbd5e1', `${f.category} ${f.height}″`),
      ...f.sections.map((section, i) => draw(`${f.id}-section-${i}`, section.footprint, '#94a3b8')),
      ...f.surfaces.filter(s => s.z > 0).map(s => draw(s.id, s.footprint, '#38bdf8', `z ${s.z}″`))])}
  </View>;
}
