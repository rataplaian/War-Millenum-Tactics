import { Text, View } from 'react-native';
import type { GameEvent } from '../game/models';
export function BattleLog({ events }: { events: readonly GameEvent[] }) {
  const lastShot = [...events].reverse().find(event => (event.type === 'weapon-fired' || event.type === 'melee-attack-resolved'));
  return <View style={{ gap: 6 }}>
    <Text style={{ color: '#fff', fontWeight: '600' }}>Battle log</Text>
    {(lastShot?.type === 'weapon-fired' || lastShot?.type === 'melee-attack-resolved') && <Text accessibilityLiveRegion="polite" style={{ color: '#fcd34d' }}>
      Last attack: {lastShot.resolution.attacks} attacks · {lastShot.resolution.hits} hits · {lastShot.resolution.wounds} wounds · {lastShot.resolution.savesFailed} failed saves · {lastShot.resolution.totalDamage} damage applied · {lastShot.resolution.destroyedModelIds.length} destroyed
    </Text>}
    {(lastShot?.type === 'weapon-fired' || lastShot?.type === 'melee-attack-resolved') && lastShot.resolution.attackModifiers?.map(m => <Text key={m.modelId} style={{ color: '#cbd5e1', fontSize: 12 }}>{m.modelId}: BS {m.baseSkill}+ → {m.effectiveSkill}+ · {m.modifiers.map(modifier => modifier.source).join(' + ') || 'no terrain modifiers'}</Text>)}
    {events.slice(-6).map(event => <Text key={event.sequence} style={{ color: '#cbd5e1', fontSize: 12 }}>
      #{event.sequence} · {event.unitId} · {event.type}
    </Text>)}
  </View>;
}
