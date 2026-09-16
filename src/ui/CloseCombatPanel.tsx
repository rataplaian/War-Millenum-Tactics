import { useState } from 'react';
import { Button, Text, View } from 'react-native';
import type { CommandResult, GameState } from '../game/models';
import type { GameEngine } from '../game/engine/GameEngine';
import type { RandomSource } from '../game/utils/dice';
import { nextFightSelection } from '../game/rules/FightSequenceController';
import { getModelsEligibleToFight, meleeWeapons } from '../game/rules/closeCombat';

export function CloseCombatPanel({ state, engine, rng, report }: {
  state: GameState; engine: GameEngine; rng: RandomSource;
  report: (result: CommandResult<unknown>, message: string) => void;
}) {
  const [targets, setTargets] = useState<string[]>([]);
  const combat = state.closeCombat, fight = combat?.fight;
  const chosen = fight?.selected && state.units.find(u => u.id === fight.selected!.unitId);
  const enemies = state.units.filter(u => u.models.some(m => m.alive));
  const toggle = (id: string) => setTargets(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
  const run = (result: CommandResult<unknown>, message = 'Action completed.') => { report(result, message); if (result.ok) setTargets([]); };
  const label = (id: string) => { const unit = state.units.find(u => u.id === id)!; return state.definitions.find(d => d.id === unit.definitionId)!.name; };
  return <View style={{ gap: 8 }}>
    <Text style={{ color: '#fff', fontSize: 18 }}>Charge / Fight debug</Text>
    {state.phase === 'Charge' && <>
      {!combat?.charge && state.units.filter(u => u.playerId === state.activePlayerId).map(u =>
        <Button key={u.id} title={`CHARGE: ${label(u.id)}`} onPress={() => run(engine.declareCharge(u.id, rng), 'Charge rolled. Select targets after the roll.')} />)}
      {combat?.charge && <>
        <Text style={{ color: '#fcd34d' }}>2D6: {combat.charge.rolls.join(' + ')} = {combat.charge.distance}″</Text>
        {!combat.move && <>
          {engine.getLegalChargeTargets().map(u => <Button key={u.id} title={`${targets.includes(u.id) ? '✓ ' : ''}${label(u.id)}`} onPress={() => toggle(u.id)} />)}
          <Button title="CONFIRM CHARGE TARGETS" disabled={!targets.length} onPress={() => run(engine.selectChargeTargets(targets), 'Move every charging model, then complete.')} />
        </>}
        <Button title="RESOLVE AS FAILED CHARGE" onPress={() => run(engine.failCharge(), 'Charge failed. Roll spent; positions restored.')} />
      </>}
    </>}
    {state.phase === 'Fight' && <>
      <Text style={{ color: '#fff' }}>Step: {fight?.step ?? 'Not started'} · {fight?.category ?? ''}</Text>
      {!fight && <Button title="START FIGHT PHASE" onPress={() => run(engine.startFightPhase())} />}
      {fight && !combat?.move && !fight.selected && <Button title="NEXT FIGHT STEP" onPress={() => run(engine.advanceFightStep())} />}
      {fight && ['PILE_IN', 'CONSOLIDATE'].includes(fight.step) && !combat?.move && <>
        <Text style={{ color: '#cbd5e1' }}>If unengaged, select enemy targets before starting movement. Engaged targets are selected by the engine.</Text>
        {enemies.map(u => <Button key={`target-${u.id}`} title={`${targets.includes(u.id) ? '✓ ' : ''}TARGET ${label(u.id)}`} onPress={() => toggle(u.id)} />)}
        {state.units.map(u => <View key={u.id} style={{ gap: 4 }}>
          <Button title={`${fight.step === 'PILE_IN' ? 'PILE IN' : 'CONSOLIDATE'}: ${label(u.id)}`} onPress={() => run(fight.step === 'PILE_IN' ? engine.beginPileIn(u.id, targets) : engine.beginConsolidation(u.id, targets), 'Select a model on the battlefield, then tap a destination.')} />
          <Button title={`PASS: ${label(u.id)}`} onPress={() => run(engine.skipTacticalMove(u.id))} />
        </View>)}
      </>}
      {fight?.step === 'FIGHT' && !chosen && <>
        <Text style={{ color: '#fcd34d' }}>Selector: {nextFightSelection(state)?.playerId ?? 'No eligible units'}</Text>
        {nextFightSelection(state)?.unitIds.map(id => <Button key={id} title={`FIGHT: ${label(id)}`} onPress={() => run(engine.selectFightUnit(id))} />)}
      </>}
      {chosen && !combat?.move && <>
        <Text style={{ color: '#fff' }}>Fighting: {label(chosen.id)}</Text>
        {enemies.filter(u => u.playerId !== chosen.playerId).map(target => <View key={target.id} style={{ gap: 4 }}>
          <Button title={`${targets.includes(target.id) ? '✓ ' : ''}OVERRUN TARGET: ${label(target.id)}`} onPress={() => toggle(target.id)} />
          {meleeWeapons(state, chosen).map(w => <Button key={w.id} title={`${w.name} → ${label(target.id)}`}
            disabled={!getModelsEligibleToFight(state, chosen, target).some(m => !fight!.selected!.usedModelIds.includes(m.id))}
            onPress={() => run(engine.meleeAttack(w.id, target.id, rng), 'Melee resolved. See wounds and combat log.')} />)}
        </View>)}
        <Button title="OVERRUN PILE IN" onPress={() => run(engine.beginOverrun(targets))} />
        <Button title="CANCEL FIGHT SELECTION" disabled={!!fight?.selected?.hasRolled || !!fight?.selected?.overrunDone} onPress={() => run(engine.cancelFightUnit())} />
        <Button title="COMPLETE FIGHT UNIT" onPress={() => run(engine.completeFightUnit())} />
      </>}
    </>}
    {combat?.move && <>
      <Text style={{ color: '#fcd34d' }}>{combat.move.kind}: {combat.move.allowance}″ maximum per model. Tap a model and its destination.</Text>
      {Object.entries(combat.move.used).map(([id, used]) => <Text key={id} style={{ color: '#fff' }}>{id}: {used.toFixed(2)}″ used</Text>)}
      <Button title="COMPLETE COMBAT MOVE" onPress={() => run(engine.completeCombatMove())} />
      <Button title="CANCEL COMBAT MOVE" disabled={combat.move.kind === 'charge'} onPress={() => run(engine.cancelCombatMove())} />
    </>}
  </View>;
}
