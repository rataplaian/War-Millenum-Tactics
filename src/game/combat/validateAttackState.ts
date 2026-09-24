import type { GameState } from '../models';
import { modelDefinition, historicalUnit } from '../attachments/queries';
import { abilitiesFor } from '../deployment/abilities';
import { validAttackChoices } from '../abilities/validation';
import { validateMovementAbilities } from '../abilities/movement';
import { validateWeapon } from '../rules/weaponValues';
/** Additive schema-3 fields: absent abilities/jobs preserve previous snapshots exactly. */
export function validateAttackState(s: GameState) {
    const require = (value: unknown, why: string) => { if (!value)
        throw Error(`Invalid combat abilities snapshot: ${why}`); };
    const natural = (n: number, min = 0) => Number.isSafeInteger(n) && n >= min;
    if (s.combatRules)
        require([s.combatRules.criticalHitThreshold, s.combatRules.criticalWoundThreshold].every(n => natural(n, 2) && n <= 6) && Number.isFinite(s.combatRules.loneOperativeDistance) && s.combatRules.loneOperativeDistance >= 0, 'rules');
    for (const u of s.units)
        for (const m of u.models) {
            const weapons = modelDefinition(s, u, m).weapons;
            require(!m.oneShotExpended || (new Set(m.oneShotExpended).size === m.oneShotExpended.length && m.oneShotExpended.every(id => weapons.some(w => w.id === id))), 'one shot');
            require(Object.entries(m.coreAbilityChoices ?? {}).every(([kind, n]) => natural(n) && !!abilitiesFor(s, u, m).filter(a => a.kind === kind)[n]), 'core choice');
        }
    for (const tx of [s.shooting, s.closeCombat?.fight?.selected])
        if (tx) {
            require(tx.hazardousCount === undefined || natural(tx.hazardousCount), 'hazard count');
            const u = s.units.find(u => u.id === tx.unitId)!;
            const weapons = [...s.definitions.find(d => d.id === u.definitionId)!.weapons, ...(s.shooting?.firingDeck?.map(x => x.borrowed) ?? [])];
            require(Object.entries(tx.attackChoices ?? {}).every(([id, choices]) => { const w = weapons.find(w => w.id === id); return w && validAttackChoices(w, choices); }), 'attack choices');
        }
    for (const tx of [s.movement, s.closeCombat?.charge])
        if (tx?.abilityChoices)
            require(validateMovementAbilities(s, s.units.find(u => u.id === tx.unitId)!, tx.abilityChoices, tx === s.closeCombat?.charge), 'movement choices');
    require(new Set(s.destructionQueue?.map(q => q.model.id)).size === (s.destructionQueue?.length ?? 0), 'duplicate destruction');
    for (const q of s.destructionQueue ?? [])
        require(historicalUnit(s, q.unitId)?.models.some(m => m.id === q.model.id) && !q.model.alive && typeof q.resolved === 'boolean' && (!q.waitForAttackerId || historicalUnit(s, q.waitForAttackerId)), 'destruction reference');
    const selection = s.shooting?.selectedTarget;
    if (selection?.modelCount !== undefined)
        require(natural(selection.modelCount, 1), 'selected model count');
    if (selection?.distances)
        require(Object.entries(selection.distances).every(([id, n]) => Number.isFinite(n) && n >= 0 && s.units.find(u => u.id === s.shooting!.unitId)?.models.some(m => m.id === id)), 'selected distances');
    if (s.shooting?.shootingMode)
        require(['NORMAL', 'INDIRECT'].includes(s.shooting.shootingMode), 'shooting mode');
    const j = s.attackJob;
    if (!j)
        return;
    validateWeapon(j.weapon);
    const tx = j.weapon.kind === 'ranged' ? s.shooting : s.closeCombat?.fight?.selected;
    require(tx?.unitId === j.attackerUnitId && tx.hasRolled && j.resolution.pending && s.phase === (j.weapon.kind === 'ranged' ? 'Shooting' : 'Fight'), 'job owner');
    require(['HIT_RESULT', 'WOUND_RESULT'].includes(j.stage) && natural(j.index) && j.index < j.modelIds.length && natural(j.additionalRemaining) && !!j.current, 'job cursor');
    require(j.resolution.weaponId === j.weapon.id && j.resolution.targetUnitId === j.target.id && j.targetDefinition.id === j.target.definitionId, 'job references');
    const target = s.units.find(u => u.id === j.target.id), source = s.units.find(u => u.id === j.attackerUnitId)!;
    require(target && target.playerId !== source.playerId && j.target.models.length === target.models.length && j.target.models.every(m => target.models.some(t => t.id === m.id && t.alive === m.alive && t.woundsRemaining === m.woundsRemaining)), 'job target');
    require(j.modelIds.every(id => source.models.some(m => m.id === id)) && j.contexts.every(c => c.attackerUnitId === source.id && c.targetUnitId === target!.id && j.modelIds.includes(c.attackerModelId)), 'job models');
    require(j.resolution.attacks === j.modelIds.length && j.resolution.attackCounts.every(c => natural(c.resolved.value)) && validAttackChoices(j.weapon, j.choices), 'job counts/choices');
    const die = j.stage === 'HIT_RESULT' ? j.current!.hit : j.current!.wound;
    require(die && natural(die.value, 1) && die.value <= 6 && natural(die.initial, 1) && die.initial <= 6 && typeof die.wasRerolled === 'boolean', 'paused die');
    require(j.deferredMortals.every(d => natural(d.amount) && natural(d.recordIndex) && !!j.resolution.attackRecords?.[d.recordIndex]), 'deferred mortals');
}
