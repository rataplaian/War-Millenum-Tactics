import { createTestMatch } from './prototype';
/** Close deployment and 2-inch engagement for the Task 004 debug scenario.
 * Unit equipment/stats remain invented fixtures. Legacy fixtures keep their tuning. */
export function createCloseCombatTestMatch() {
  const state = createTestMatch();
  state.id = 'close-combat-test';
  state.spatialRules.engagementDistance = 2;
  state.units[1]!.models.forEach(m => { m.position.y = 10.5; });
  state.definitions = state.definitions.map((d, i) => i ? d : { ...d, weapons: [...d.weapons,
    { id: 'test-sword', name: 'Placeholder sword', kind: 'melee', range: null,
      attacks: { kind: 'fixed', value: 2 }, skill: 3, strength: 4, armourPenetration: -1,
      damage: { kind: 'fixed', value: 1 }, traits: [] }] });
  return state;
}
