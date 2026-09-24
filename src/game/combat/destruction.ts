import type { GameState } from '../models';
import type { RandomSource } from '../utils/dice';
import { rollD6 } from '../utils/dice';
import { edgeDistance } from '../utils/geometry';
import { modelCore } from '../abilities/registry';
import { historicalUnit } from '../attachments/queries';
import { resolveWeaponValue } from '../rules/weaponValues';
import { resolveMortalWounds } from './damage';
import { detectDestroyedTransports } from '../transports/TransportController';
import { processAttachmentCasualties } from '../attachments/AttachmentController';
import { normalizeDestroyed, onBattlefield } from '../reserves/location';
import { flowEvent } from '../flow/events';
/** 24.08: capture destruction once; preserve the base while passengers disembark. */
export function queueDestructions(before: GameState, s: GameState, attackerId?: string) {
    for (const u of before.units.filter(onBattlefield))
        for (const m of u.models.filter(m => m.alive)) {
            const dead = s.units.flatMap(u => u.models).find(x => x.id === m.id);
            if (!dead || dead.alive || !modelCore(before, u, m, 'DEADLY_DEMISE').length || s.destructionQueue?.some(q => q.model.id === m.id))
                continue;
            s.destructionQueue ??= [];
            s.destructionQueue.push({ unitId: u.id, model: JSON.parse(JSON.stringify(dead)), resolved: false, ...(attackerId ? { waitForAttackerId: attackerId } : {}) });
        }
}
export function releaseDestructions(s: GameState, attackerId: string) {
    for (const item of s.destructionQueue ?? [])
        if (item.waitForAttackerId === attackerId)
            delete item.waitForAttackerId;
}
/** Iterative queue, never recursive. New destructions append once; transports take priority. */
export function resolveDestructions(s: GameState, rng: RandomSource) {
    while (!s.transportState?.destroyed.length && !s.transportState?.disembark) {
        const item = s.destructionQueue?.find(q => !q.resolved && !q.waitForAttackerId);
        if (!item)
            break;
        const unit = historicalUnit(s, item.unitId)!;
        const ability = modelCore(s, unit, item.model, 'DEADLY_DEMISE')[0];
        item.resolved = true;
        if (ability?.kind !== 'DEADLY_DEMISE')
            continue;
        const roll = rollD6(rng);
        flowEvent(s, 'DEADLY_DEMISE_ROLLED', { modelId: item.model.id, roll }, item.unitId, unit.playerId);
        if (roll !== 6)
            continue;
        const targets = s.units.filter(onBattlefield).filter(u => u.models.some(m => m.alive && edgeDistance(item.model, m) <= 6 + 1e-9));
        for (const target of targets) {
            const before: GameState = JSON.parse(JSON.stringify(s));
            const amount = resolveWeaponValue(ability.damage, rng);
            const damage = resolveMortalWounds(s, target, amount.value, rng);
            flowEvent(s, 'MORTAL_WOUNDS_RESOLVED', { source: 'DEADLY_DEMISE', sourceModelId: item.model.id, amount: amount.value, applied: damage.applied, ignored: damage.ignored, rolls: amount.rolls }, target.id, target.playerId);
            queueDestructions(before, s);
        }
        detectDestroyedTransports(s);
        processAttachmentCasualties(s);
        normalizeDestroyed(s);
    }
}
