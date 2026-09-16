import test from 'node:test';
import assert from 'node:assert/strict';
import { engine, ok } from './flow.helpers';
import { GameEngine } from '../src/game/engine/GameEngine';
import type { GameState } from '../src/game/models';
const corruptions: [string, (s: GameState) => void][] = [
  ['skipped Command sequence', s => { s.flow!.commandStep = null; }],
  ['wrong first-turn player', s => { s.flow!.firstPlayerId = 'player-2'; }],
  ['negative CP', s => { s.players[0].commandPoints = -1; }],
  ['fraction CP', s => { s.players[0].commandPoints = .5; }],
  ['negative extra counter', s => { s.players[0].extraCpGainedThisBattleRound = -1; }],
  ['unknown first player', s => { s.flow!.firstPlayerId = 'missing'; }],
  ['incorrect phase index', s => { s.flow!.phaseIndex = 2; }],
  ['invalid step', s => { s.flow!.commandStep = 'BAD' as never; }],
  ['invalid maximum rounds', s => { s.flow!.rules.maximumBattleRounds = 0; }],
  ['invalid extra limit', s => { s.flow!.rules.maxExtraCpPerBattleRound = -1; }],
  ['bad window trigger', s => { s.flow!.window!.trigger = 'BAD' as never; }],
  ['bad passed player', s => { s.flow!.window!.passedPlayerIds = ['missing']; }],
  ['bad next window ID', s => { s.flow!.nextWindowId = 1; }],
  ['inconsistent pending battle shock', s => { s.flow!.pending = [{ id: 'bad', kind: 'BATTLE_SHOCK', unitId: 'unit-1', label: 'bad' }]; }],
  ['unknown effect target', s => { s.flow!.effects[0]!.target.unitId = 'missing'; }],
  ['bad effect expiry', s => { s.flow!.effects[0]!.expiry = 'BAD' as never; }],
  ['bad effect magnitude', s => { s.flow!.effects[0]!.payload = { kind: 'MODIFIER', characteristic: 'BS', value: Infinity }; }],
  ['future effect timestamp', s => { s.flow!.effects[0]!.createdAt.turn = 999; }],
  ['bad effect counter', s => { s.flow!.nextEffectId = 1; }],
  ['duplicate effect', s => { s.flow!.effects.push(s.flow!.effects[0]!); }],
  ['bad Battle-shock type', s => { s.units[0]!.state.battleShocked = 'yes' as never; }],
  ['negative Leadership', s => { s.units[0]!.models[0]!.leadership = -1; }],
];
for (const [name, edit] of corruptions) test(`snapshot rejects ${name}; load remains atomic`, () => {
  const e = engine(); ok(e.addTemporaryEffect({ source: 'test', target: { unitId: 'unit-1' }, payload: { kind: 'MODIFIER', characteristic: 'BS', value: -1 }, expiry: 'END_OF_CURRENT_PHASE', stacking: 'STACK' }));
  const before = e.getState(), bad = e.getState(); edit(bad); assert.throws(() => e.loadMatch(bad)); assert.deepEqual(e.getState(), before);
});
