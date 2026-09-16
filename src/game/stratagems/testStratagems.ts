import type { StratagemDefinition } from './types';
/** Invented technical fixtures, never an official stratagem catalog. */
export const TEST_STRATAGEMS: readonly StratagemDefinition[] = [
  { id: 'test-offensive', name: 'TEST OFFENSIVE BUFF', labels: ['BATTLE_TACTIC'], cpCost: 1,
    timing: { phases: ['Shooting'], triggers: ['START_OF_PHASE', 'AFTER_UNIT_SHOT'], ownership: 'YOUR_TURN' },
    target: { relation: 'FRIENDLY', count: 1 }, conditions: ['ON_BATTLEFIELD', 'ALIVE', 'NOT_SHOT'], resolverId: 'APPLY_EFFECT',
    effect: { source: 'test-offensive', payload: { kind: 'MODIFIER', characteristic: 'BS', value: -1 }, expiry: 'END_OF_CURRENT_PHASE', stacking: 'NON_STACKING' } },
  { id: 'test-defence', name: 'TEST REACTIVE DEFENCE', labels: ['WARGEAR'], cpCost: 1,
    timing: { phases: ['Shooting'], triggers: ['AFTER_TARGET_SELECTED'], ownership: 'OPPONENT_TURN' },
    target: { relation: 'FRIENDLY', count: 1, selectedTargetOnly: true }, conditions: ['ON_BATTLEFIELD', 'ALIVE'], resolverId: 'APPLY_EFFECT',
    effect: { source: 'test-defence', payload: { kind: 'MODIFIER', characteristic: 'SAVE', value: -1 }, expiry: 'END_OF_CURRENT_PHASE', stacking: 'NON_STACKING' } },
  { id: 'test-command', name: 'TEST COMMAND EFFECT', labels: ['STRATEGIC_PLOY'], cpCost: 1,
    timing: { phases: ['Command'], triggers: ['AT_START_OF_COMMAND_PHASE', 'AT_END_OF_COMMAND_PHASE'], ownership: 'YOUR_TURN' },
    target: { relation: 'FRIENDLY', count: 1 }, conditions: ['ON_BATTLEFIELD', 'ALIVE'], resolverId: 'APPLY_EFFECT',
    effect: { source: 'test-command', payload: { kind: 'MODIFIER', characteristic: 'OC', value: 1 }, expiry: 'START_OF_NEXT_COMMAND_PHASE', stacking: 'REPLACE_SAME_SOURCE' } },
  { id: 'test-shock', name: 'TEST BATTLE-SHOCK OVERRIDE', labels: ['EPIC_DEED'], cpCost: 1,
    timing: { phases: ['Command'], triggers: ['AFTER_BATTLE_SHOCK_FAILED'], ownership: 'YOUR_TURN' },
    target: { relation: 'FRIENDLY', count: 1, selectedTargetOnly: true }, conditions: ['ON_BATTLEFIELD', 'ALIVE'], resolverId: 'CLEAR_BATTLE_SHOCK',
    overrides: { allowBattleShockedTarget: true } },
];
