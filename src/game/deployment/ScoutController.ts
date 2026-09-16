import type { CommandResult, GameState, MovementPath, Position } from '../models';
import { failure, validateFinalPosition } from '../rules/movement';
import { validateTerrainPath } from '../terrain/movement';
import { EPSILON } from '../utils/geometry';
import { checkCoherency } from '../rules/spatial';
import { actionBusy, onBattlefield } from '../reserves/location';
import { reserveRules } from '../reserves/ReservePolicy';
import { horizontalEdgeDistance, isUnitWhollyWithinDeploymentZone } from '../setup/SetupValidator';
import { setupEvent } from '../setup/events';
import { choiceError, DeploymentController } from './DeploymentController';
import { scoutDistance } from './abilities';
export class ScoutController {
  constructor(private s: GameState) {}
  begin(unitId: string): CommandResult {
    if (actionBusy(this.s)) return failure('SETUP_IN_PROGRESS');
    const pool = new DeploymentController(this.s).scoutUnits(), u = pool.find(u => u.id === unitId);
    if (!u || !onBattlefield(u)) return failure('UNIT_NOT_ELIGIBLE');
    if (pool[0]!.playerId !== u.playerId) return failure('WRONG_DEPLOYMENT_PLAYER');
    const choice = choiceError(this.s, u, 'SCOUTS'); if (!choice.ok) return choice;
    if (!this.s.deployment!.zones.some(z => z.playerId === u.playerId && isUnitWhollyWithinDeploymentZone(u, z))) return failure('OUTSIDE_DEPLOYMENT_ZONE');
    this.s.scout = { kind: 'SCOUT_MOVE', unitId, allowance: scoutDistance(this.s, u), used: {}, originals: u.models.map(m => ({ modelId: m.id, position: { ...m.position }, movementUsed: m.movementUsed })) };
    setupEvent(this.s, u, 'scout-move-started'); return { ok: true, value: undefined };
  }
  move(modelId: string, target: Position, path?: MovementPath): CommandResult {
    const tx = this.s.scout; if (!tx) return failure('NO_SCOUT_MOVE');
    const u = this.s.units.find(u => u.id === tx.unitId)!, m = u.models.find(m => m.id === modelId);
    if (!m || !m.alive) return failure('MODEL_NOT_IN_UNIT');
    const route = validateTerrainPath(this.s, m, target, path); if (!route.ok) return route;
    const total = (tx.used[modelId] ?? 0) + route.value.totalMovementDistance;
    if (total > tx.allowance + EPSILON) return failure('EXCEEDS_ALLOWANCE');
    const final = validateFinalPosition(this.s, u, m, target); if (!final.ok) return final;
    const candidate = { ...m, position: target };
    if (this.s.units.filter(e => onBattlefield(e) && e.playerId !== u.playerId).flatMap(e => e.models).some(e => e.alive && horizontalEdgeDistance(candidate, e) <= reserveRules(this.s).scoutEnemyDistance + EPSILON)) return failure('TOO_CLOSE_TO_ENEMY');
    m.position = { ...target }; tx.used[modelId] = total;
    setupEvent(this.s, u, 'scout-model-moved', { modelId }); return { ok: true, value: undefined };
  }
  finish(cancel = false): CommandResult {
    const tx = this.s.scout; if (!tx) return failure('NO_SCOUT_MOVE');
    const u = this.s.units.find(u => u.id === tx.unitId)!;
    if (cancel) for (const o of tx.originals) { const m = u.models.find(m => m.id === o.modelId)!; m.position = { ...o.position }; m.movementUsed = o.movementUsed; }
    else {
      if (!checkCoherency(u.models, this.s.spatialRules.coherency).coherent) return failure('INCOHERENT');
      for (const m of u.models.filter(m => m.alive)) {
        const result = validateFinalPosition(this.s, u, m, m.position); if (!result.ok) return result;
        if (this.s.units.filter(e => onBattlefield(e) && e.playerId !== u.playerId).flatMap(e => e.models).some(e => e.alive && horizontalEdgeDistance(m, e) <= reserveRules(this.s).scoutEnemyDistance + EPSILON)) return failure('TOO_CLOSE_TO_ENEMY');
      }
      this.s.deployment!.choices[u.id] = 'SCOUTS'; this.s.deployment!.scoutDone.push(u.id);
    }
    setupEvent(this.s, u, cancel ? 'scout-move-cancelled' : 'scout-move-completed'); this.s.scout = null;
    return { ok: true, value: undefined };
  }
}
