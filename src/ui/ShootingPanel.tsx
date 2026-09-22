import { useState } from 'react';
import { Button, Text, View } from 'react-native';
import type { GameState, CommandResult } from '../game/models';
import type { GameEngine } from '../game/engine/GameEngine';
import type { RandomSource } from '../game/utils/dice';
interface Props {
  state: GameState;
  engine: GameEngine;
  rng: RandomSource;
  report: (result: CommandResult<unknown>, message: string) => void;
}
const textStyle = { color: '#e5e7eb', fontSize: 15 };
/** Lists legal options supplied by the engine; never computes combat results. */
export function ShootingPanel({ state, engine, rng, report }: Props) {
  const [weaponId, setWeaponId] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [precision, setPrecision] = useState<string | undefined>();
  const action = state.shooting;
  const weapons = action ? engine.getRangedWeapons(action.unitId) : null;
  const targets = action && weaponId ? engine.getLegalTargets(action.unitId, weaponId) : null;
  const weaponAvailable = weapons?.ok && weapons.value.some(w => w.id === weaponId);
  const targetAvailable = targets?.ok && targets.value.some(t => t.targetUnitId === targetId);
  function clear() { setWeaponId(null); setTargetId(null); setPrecision(undefined); }
  return <View style={{ gap: 10, padding: 12, backgroundColor: '#1f2937' }}>
    <Text style={textStyle}>Shooting · Select unit → weapon → target → FIRE</Text>
    {!action && state.units.filter(u => u.playerId === state.activePlayerId).map(unit => {
      const available = engine.getRangedWeapons(unit.id);
      const name = state.definitions.find(d => d.id === unit.definitionId)!.name;
      return <Button key={unit.id} title={`SHOOT: ${name}`} disabled={!available.ok}
        onPress={() => { clear(); report(engine.beginShooting(unit.id), 'Shooting started. Select a weapon.'); }} />;
    })}
    {action && <>
      <Text style={textStyle}>Firing unit: {state.definitions.find(d => d.id === state.units.find(u => u.id === action.unitId)!.definitionId)!.name}</Text>
      {weapons?.ok && weapons.value.map(weapon => <Button key={weapon.id}
        title={`${weaponId === weapon.id ? 'SELECTED: ' : ''}${weapon.name} · ${weapon.range}″`} disabled={!!action.selectedTarget}
        onPress={() => { setWeaponId(weapon.id); setTargetId(null); setPrecision(undefined); }} />)}
      {weapons?.ok && !weapons.value.length && <Text style={textStyle}>All ranged profiles used. Complete shooting.</Text>}
      {targets?.ok && targets.value.map(target => {
        const unit = state.units.find(u => u.id === target.targetUnitId)!;
        const name = state.definitions.find(d => d.id === unit.definitionId)!.name;
        return <View key={unit.id} style={{ gap: 4 }}>
          <Button title={`${targetId === unit.id ? 'SELECTED TARGET: ' : 'TARGET: '}${name}`} disabled={!!action.selectedTarget} onPress={() => { setTargetId(unit.id); if (state.flow) report(engine.selectShootingTarget(weaponId!, unit.id), 'Target selected. Resolve reaction window before FIRE.'); }} />
          <Text style={textStyle}>{target.eligibleFiringModelIds.length} eligible firing models · nearest {target.nearestDistance.toFixed(2)}″</Text>
        </View>;
      })}
      {targets?.ok && !targets.value.length && <Text style={textStyle}>No legal targets for this weapon.</Text>}
      {action && weaponId && targetId && <><Button title="NORMAL ALLOCATION" onPress={() => setPrecision(undefined)} />{engine.precisionTargets(action.unitId, weaponId, targetId).map(id => <Button key={id} title={`${precision === id ? 'SELECTED' : 'PRECISION'} ${id}`} onPress={() => setPrecision(id)} />)}</>}
      <Button title="FIRE" disabled={!weaponAvailable || !targetAvailable || !!state.flow?.window} onPress={() => {
        if (!weaponId || !targetId) return;
        const result = engine.fireWeapon(weaponId, targetId, rng, precision);
        report(result, 'Weapon resolved. See the battle log below.');
        if (result.ok) clear();
      }} />
      <Button title="COMPLETE SHOOTING" onPress={() => { const result = engine.completeShooting(); report(result, 'Shooting completed.'); if (result.ok) clear(); }} />
      <Button title="CANCEL SHOOTING" disabled={action.hasRolled || !!action.selectedTarget} onPress={() => { const result = engine.cancelShooting(); report(result, 'Shooting cancelled.'); if (result.ok) clear(); }} />
      {action.selectedTarget && <Text style={textStyle}>Target committed. Resolve the reaction window, then FIRE.</Text>}
      {action.hasRolled && <Text style={textStyle}>Dice have been rolled: cancellation is no longer available.</Text>}
    </>}
  </View>;
}
