import { historicalUnit } from '../attachments/queries';
import type { GameState } from '../models';
import { baseInsideBattlefield, distanceTravelled, EPSILON, isFinitePosition } from '../utils/geometry';
import { COMBAT_RULES } from '../rules/closeCombat';
/** Task 003 snapshots without this optional extension remain loadable. */
export function validateCloseCombatState(state: GameState): void {
  const combat = state.closeCombat;
  if (!combat) return;
  const require = (condition: unknown, message: string) => { if (!condition) throw new Error(`Invalid close combat snapshot: ${message}`); };
  const unit = (id: string) => historicalUnit(state, id);
  const ids = (values: string[]) => Array.isArray(values) && new Set(values).size === values.length && values.every(id => !!unit(id));
  require(ids(combat.declared), 'declared units');
  for (const effect of combat.effects) require(unit(effect.unitId) && effect.kind === 'FIGHTS_FIRST' && effect.expiresAt === 'END_OF_TURN' && effect.turn === state.turn, 'effect');
  if (combat.charge) {
    const charge = combat.charge, source = unit(charge.unitId);
    require(state.status === 'in-progress' && state.phase === 'Charge' && source?.playerId === state.activePlayerId && combat.declared.includes(charge.unitId), 'charge owner/phase');
    require(charge.rolls.length === 2 && charge.rolls.every(r => Number.isInteger(r) && r >= 1 && r <= 6) && charge.distance === charge.rolls.reduce((a, b) => a + b, 0), 'charge roll');
    require(ids(charge.targetIds) && charge.targetIds.every(id => unit(id)!.playerId !== source!.playerId), 'charge targets');
    require(state.events.some(e => e.type === 'charge-rolled' && e.unitId === charge.unitId && e.turn === state.turn && e.distance === charge.distance && e.rolls.every((r, i) => r === charge.rolls[i])), 'missing roll event');
  }
  const fight = combat.fight;
  if (fight) {
    require(state.phase === 'Fight' && !combat.charge && ['START', 'PILE_IN', 'FIGHT', 'CONSOLIDATE', 'END'].includes(fight.step), 'fight phase');
    require(['FIGHTS_FIRST', 'REMAINING_COMBATS'].includes(fight.category) && state.players.some(p => p.id === fight.nextPlayerId), 'fight selector');
    for (const list of [fight.pileInDone, fight.eligibleAtFightStart, fight.engagedAtFightStart, fight.fought, fight.consolidateDone]) require(ids(list), 'fight unit references');
    if (fight.selected) {
      const selected = fight.selected, source = unit(selected.unitId);
      require(fight.step === 'FIGHT' && source && !fight.fought.includes(selected.unitId), 'selected fighter');
      require(new Set(selected.usedModelIds).size === selected.usedModelIds.length && selected.usedModelIds.every(id => source!.models.some(m => m.id === id)), 'used fighters');
      require(typeof selected.hasRolled === 'boolean' && typeof selected.overrunDone === 'boolean', 'selected flags');
    }
  }
  const move = combat.move;
  if (move) {
    const source = unit(move.unitId);
    require(source && !state.movement && !state.shooting, 'exclusive move');
    require(['charge', 'pile-in', 'overrun', 'consolidate'].includes(move.kind), 'move kind');
    require(move.kind === 'charge' ? combat.charge?.unitId === move.unitId : fight && fight.step === (move.kind === 'pile-in' ? 'PILE_IN' : move.kind === 'consolidate' ? 'CONSOLIDATE' : 'FIGHT'), 'move phase');
    require(move.allowance === (move.kind === 'charge' ? combat.charge?.distance : move.kind === 'consolidate' ? COMBAT_RULES.consolidate : COMBAT_RULES.pileIn), 'move allowance');
    require(ids(move.targetIds) && move.targetIds.length && move.targetIds.every(id => unit(id)!.playerId !== source!.playerId), 'move targets');
    require(move.originals.length === source!.models.length && new Set(move.originals.map(o => o.modelId)).size === move.originals.length, 'original model set');
    for (const original of move.originals) {
      const model = source!.models.find(m => m.id === original.modelId);
      require(model && isFinitePosition(original.position) && Number.isFinite(original.movementUsed) && original.movementUsed === model.movementUsed, 'original model');
      const used = move.used[original.modelId] ?? 0;
      require(Number.isFinite(used) && used >= 0 && used <= move.allowance + EPSILON && distanceTravelled(original.position, model!.position) <= used + EPSILON, 'move distance');
      require(!model!.alive || baseInsideBattlefield({ ...model!, position: original.position }, state.battlefield), 'original bounds');
    }
    require(Object.keys(move.used).every(id => source!.models.some(m => m.id === id)), 'usage model');
  }
  for (const event of state.events) {
    if (event.type === 'melee-attack-resolved' || event.type === 'melee-attack-started') {
      const weaponId = event.type === 'melee-attack-resolved' ? event.resolution.weaponId : event.weaponId;
      const targetId = event.type === 'melee-attack-resolved' ? event.resolution.targetUnitId : event.targetUnitId;
      const source = unit(event.unitId)!;
      require(unit(targetId)?.playerId !== source.playerId && unit(targetId), 'melee target');
      require(state.definitions.find(d => d.id === source.definitionId)?.weapons.some(w => w.id === weaponId && w.kind === 'melee'), 'melee weapon');
    }
  }
}
