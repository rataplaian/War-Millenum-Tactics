import { GameEngine } from '../engine/GameEngine';
import type { CommandResult, GameState, Position } from '../models';
import type { Formation } from '../setup/types';
import type { RandomSource } from '../utils/dice';
import { formationAt, setupAnchors, moveCandidates } from '../ai/PositionCandidates';
import { nextFightSelection } from '../rules/FightSequenceController';
import { CloseCombatController } from '../engine/CloseCombatController';
import { searchDisembark } from '../transports/placement';
import { setupConstraints } from '../setup/SetupController';
import type { AgileManoeuvre } from '../content/BattleFocus';
import { pendingCoreChoices } from '../abilities/core';

/** JSON-safe decisions. The command dispatcher is the only path to live GameEngine mutations. */
export type LegalAction =
  | { kind: 'ADVANCE_PRE_BATTLE' | 'ADVANCE_COMMAND_STEP' | 'ADVANCE_PHASE' | 'START_FIGHT' | 'ADVANCE_FIGHT_STEP' | 'COMPLETE_MOVE' | 'CANCEL_MOVE' | 'COMPLETE_SHOOTING' | 'COMPLETE_FIGHT' | 'COMPLETE_COMBAT_MOVE' | 'FAIL_CHARGE' | 'RESUME_ATTACK' | 'RESOLVE_DESTRUCTION' | 'COMPLETE_REACTION_SHOOTING' | 'COMPLETE_REACTION_MOVE' }
  | { kind: 'SET_FIRST_TURN' | 'PASS_WINDOW'; playerId: string }
  | { kind: 'ROLL_BATTLE_SHOCK' | 'BEGIN_MOVE' | 'BEGIN_SHOOTING' | 'DECLARE_CHARGE' | 'SELECT_FIGHT_UNIT' | 'SKIP_TACTICAL_MOVE' | 'BEGIN_DEPLOYMENT' | 'SKIP_SCOUT' | 'BEGIN_INGRESS' | 'BEGIN_DISEMBARK' | 'BEGIN_PILE_IN' | 'BEGIN_CONSOLIDATION'; unitId: string }
  | { kind: 'RESOLVE_COMMAND_ABILITY'; id: string }
  | { kind: 'USE_STRATAGEM'; id: string; playerId: string; targets: string[] }
  | { kind: 'USE_FACTION_ABILITY'; id: 'EUPHORIC_STRIKES' | 'DAEMONIC_PATRONS' | 'DOOM_SIREN' | 'TERRIFYING_CRESCENDO' | 'EXQUISITE_LETHAL' | 'EXQUISITE_SUSTAINED'; unitId: string; targetId?: string }
  | { kind: 'DEPLOY_FORMATION' | 'INGRESS_FORMATION'; formation: Formation }
  | { kind: 'DISEMBARK'; unitId: string; formation: Formation }
  | { kind: 'EMERGENCY_DISEMBARK'; unitId: string }
  | { kind: 'MOVE_MODEL' | 'COMBAT_MOVE_MODEL' | 'REACTION_MOVE_MODEL'; modelId: string; target: Position }
  | { kind: 'SELECT_CHARGE_TARGETS'; targetIds: string[] }
  | { kind: 'SELECT_SHOOTING_TARGET' | 'FIRE_WEAPON' | 'SELECT_MELEE_TARGET' | 'MELEE_ATTACK'; weaponId: string; targetId: string }
  | { kind: 'START_ACTION'; unitId: string; actionId: string; objectiveId?: string }
  | { kind: 'RESOLVE_FIGHT_ON_DEATH'; unitId: string; weaponId: string }
  | { kind: 'REACTION_FIRE'; weaponId: string }
  | { kind: 'CHOOSE_CORE_ABILITY'; modelId: string; abilityKind: string; instance: number }
  | { kind: 'AGILE_MANOEUVRE'; id: AgileManoeuvre; unitId: string; trigger: 'MOVE' | 'CHARGE' | 'FIGHT' | 'ENEMY_FALL_BACK' | 'AFTER_ENEMY_SHOT'; moveType?: 'NORMAL_MOVE' | 'ADVANCE_MOVE' };

const fail = (): CommandResult => ({ ok: false, reason: 'UNIT_NOT_ELIGIBLE' });
/** Read-only query; transaction probes run on detached engine snapshots. */
export function getLegalActions(engine: GameEngine, playerId: string, snapshot?: GameState): LegalAction[] {
  const s = snapshot??engine.getState();
  if (s.status === 'finished' || !s.players.some(p => p.id === playerId)) return [];
  const actions: LegalAction[] = [];
  const probe = (execute: (test: GameEngine) => CommandResult<unknown>) => execute(new GameEngine(s)).ok;
  const own = s.units.filter(u => u.playerId === playerId && u.models.some(m => m.alive));
  const window = s.flow?.window;
  const core=pendingCoreChoices(s);
  if(core.length) return core.filter(c=>own.some(u=>u.id===c.unitId)).map(c=>({kind:'CHOOSE_CORE_ABILITY',modelId:c.modelId,abilityKind:c.kind,instance:0}));
  if (s.attackJob && !window) return [{ kind: 'RESUME_ATTACK' }];
  if(s.reactionShooting && !window) {
    if(own.some(u=>u.id===s.reactionShooting!.unitId)) {
      const options=engine.getReactionShootingOptions();
      if(options.ok) for(const w of options.value.filter(w=>w.legal)) actions.push({kind:'REACTION_FIRE',weaponId:w.weaponId});
      actions.push({kind:'COMPLETE_REACTION_SHOOTING'});
    }
    return actions;
  }
  if (s.reactionMove) {
    if (s.reactionMove.unitId && own.some(u => u.id === s.reactionMove!.unitId)) {
      const u = own.find(u => u.id === s.reactionMove!.unitId)!;
      for (const m of u.models.filter(m => m.alive)) for (const p of moveCandidates(s,u,m.id).slice(0,6))
        if (probe(e => e.moveReactionModel(m.id,p))) actions.push({kind:'REACTION_MOVE_MODEL',modelId:m.id,target:p});
      if (probe(e=>e.completeReactionMove())) actions.push({kind:'COMPLETE_REACTION_MOVE'});
    }
    return actions;
  }
  if (s.deployment?.stage !== 'BATTLE_STARTED') {
    if (s.setup) {
      if (s.units.find(u=>u.id===s.setup!.unitId)?.playerId!==playerId) return [];
      const unit=s.units.find(u=>u.id===s.setup!.unitId)!;
      for(const anchor of setupAnchors(s,playerId)) {
        const formation=formationAt(unit,anchor);
        if(engine.previewSetup(formation).ok) actions.push({kind:s.setup.kind==='INGRESS_MOVE'?'INGRESS_FORMATION':'DEPLOY_FORMATION',formation});
        if(actions.length>=4) break;
      }
      return actions;
    }
    if(s.deployment?.stage==='PRE_BATTLE') return [{kind:'ADVANCE_PRE_BATTLE'}];
    if(s.deployment?.stage==='DECLARE_BATTLE_FORMATIONS') return [...(s.deployment.firstTurnPlayerId?[]:[{kind:'SET_FIRST_TURN' as const,playerId:s.players[0].id}]),{kind:'ADVANCE_PRE_BATTLE'}];
    if(s.deployment?.stage==='DEPLOY_ARMIES') {
      const next=engine.getDeploymentOptions().nextPlayerId;
      if(next===playerId) for(const u of own.filter(u=>u.location!=='EMBARKED'&&!s.deployment!.deployed.includes(u.id)))
        if(probe(e=>e.beginDeployment(u.id))) actions.push({kind:'BEGIN_DEPLOYMENT',unitId:u.id});
      if(!next) actions.push({kind:'ADVANCE_PRE_BATTLE'});
      return actions;
    }
    const scout=engine.getDeploymentOptions().scoutUnitIds[0];
    if(scout) {if(own.some(u=>u.id===scout)) actions.push({kind:'SKIP_SCOUT',unitId:scout});}
    else actions.push({kind:'ADVANCE_PRE_BATTLE'});
    return actions;
  }
  if(window) {
    if(!window.passedPlayerIds.includes(playerId)) {
      const options=engine.getStratagemOptions(playerId);
      for(const o of options) if(o.result.ok) actions.push({kind:'USE_STRATAGEM',id:o.stratagemId,playerId,targets:o.targetIds});
      const faction=engine.getFactionDebugOptions();
      for(const id of faction.euphoric) if(own.some(u=>u.id===id)) actions.push({kind:'USE_FACTION_ABILITY',id:'EUPHORIC_STRIKES',unitId:id});
      for(const {unitId,targetId} of faction.crescendo) if(own.some(u=>u.id===unitId)) actions.push({kind:'USE_FACTION_ABILITY',id:'TERRIFYING_CRESCENDO',unitId,targetId});
      for(const {unitId,targetId} of faction.doomSiren) if(own.some(u=>u.id===unitId)) actions.push({kind:'USE_FACTION_ABILITY',id:'DOOM_SIREN',unitId,targetId});
      if((s.battleFocus?.tokens[playerId]??0)>0 && (window.trigger==='AFTER_ENEMY_FALL_BACK'||window.trigger==='AFTER_UNIT_SHOT')) for(const u of own) {
        const id=window.trigger==='AFTER_UNIT_SHOT'?'FADE_BACK':'OPPORTUNITY_SEIZED',trigger=window.trigger==='AFTER_UNIT_SHOT'?'AFTER_ENEMY_SHOT':'ENEMY_FALL_BACK';
        if(probe(e=>e.useAgileManoeuvre(id,u.id,trigger,undefined,()=>0.5))) actions.push({kind:'AGILE_MANOEUVRE',id,unitId:u.id,trigger});
      }
      actions.push({kind:'PASS_WINDOW',playerId});
    }
    return actions;
  }
  if(s.fightOnDeath?.length) {
    for(const entry of s.fightOnDeath) {
      const u=s.units.find(u=>u.id===entry.defenderUnitId);
      if(u?.playerId===playerId) for(const w of s.definitions.find(d=>d.id===u.definitionId)?.weapons.filter(w=>w.kind==='melee')??[])
        if(probe(e=>e.resolveFightOnDeath(u.id,w.id,()=>0.5))) actions.push({kind:'RESOLVE_FIGHT_ON_DEATH',unitId:u.id,weaponId:w.id});
    }
    return actions;
  }
  if(s.transportState?.disembark) return [];
  if(s.setup) return [];
  if(s.movement) {
    const u=own.find(u=>u.id===s.movement!.unitId);if(!u)return [];
    const originals=s.movement.originals;
    const moved=u.models.find(m=>{const o=originals.find(o=>o.modelId===m.id);return o&&Math.hypot(o.position.x-m.position.x,o.position.y-m.position.y)>0.01});
    const offset=moved?{x:moved.position.x-originals.find(o=>o.modelId===moved.id)!.position.x,
      y:moved.position.y-originals.find(o=>o.modelId===moved.id)!.position.y}:null;
    for(const m of u.models.filter(m=>m.alive)) {
      const original=originals.find(o=>o.modelId===m.id)!;
      if(Math.hypot(original.position.x-m.position.x,original.position.y-m.position.y)>0.01)continue;
      const points=offset?[{x:original.position.x+offset.x,y:original.position.y+offset.y,z:original.position.z??0}]:
        moveCandidates(s,u,m.id).slice(0,9).map(p=>({x:m.position.x+(p.x-m.position.x)*0.7,y:m.position.y+(p.y-m.position.y)*0.7,z:0}));
      for(const p of points) if(engine.previewMove(m.id,p).ok) actions.push({kind:'MOVE_MODEL',modelId:m.id,target:p});
    }
    if(probe(e=>e.completeMovement())) actions.push({kind:'COMPLETE_MOVE'});
    actions.push({kind:'CANCEL_MOVE'});
    return actions;
  }
  if(s.shooting) {
    const u=own.find(u=>u.id===s.shooting!.unitId);if(!u)return [];
    const weapons=engine.getRangedWeapons(u.id);
    if(weapons.ok) for(const w of weapons.value) {
      const targets=engine.getLegalTargets(u.id,w.id);
      if(targets.ok) for(const t of targets.value) {
        if(s.shooting.selectedTarget?.weaponId===w.id && s.shooting.selectedTarget.targetUnitId===t.targetUnitId)
          actions.push({kind:'FIRE_WEAPON',weaponId:w.id,targetId:t.targetUnitId});
        else if(!s.shooting.selectedTarget) actions.push({kind:'SELECT_SHOOTING_TARGET',weaponId:w.id,targetId:t.targetUnitId});
      }
    }
    if(!s.shooting.selectedTarget && probe(e=>e.completeShooting(()=>0.5))) actions.push({kind:'COMPLETE_SHOOTING'});
    return actions;
  }
  const emergency=s.transportState?.destroyed[0]?.remainingPassengerIds[0];
  if(emergency) return own.some(u=>u.id===emergency)?[{kind:'EMERGENCY_DISEMBARK',unitId:emergency}]:[];
  if(s.destructionQueue?.some(q=>!q.resolved)) return [{kind:'RESOLVE_DESTRUCTION'}];
  if(s.closeCombat?.charge&&!s.closeCombat.move) {
    const charge=s.closeCombat.charge;
    if(!own.some(u=>u.id===charge.unitId))return [];
    for(const u of engine.getLegalChargeTargets()) if(probe(e=>e.selectChargeTargets([u.id]))) actions.push({kind:'SELECT_CHARGE_TARGETS',targetIds:[u.id]});
    actions.push({kind:'FAIL_CHARGE'});return actions;
  }
  if(s.closeCombat?.move) {
    const tx=s.closeCombat.move,u=own.find(u=>u.id===tx!.unitId);
    if(!u)return [];
    for(const m of u.models.filter(m=>m.alive && !((tx.used[m.id]??0)>0.01))) for(const p of moveCandidates(s,u,m.id).slice(0,9))
      if(engine.previewCombatMove(m.id,p).ok) actions.push({kind:'COMBAT_MOVE_MODEL',modelId:m.id,target:p});
    if(probe(e=>e.completeCombatMove())) actions.push({kind:'COMPLETE_COMBAT_MOVE'});
    if(tx.kind==='charge') actions.push({kind:'FAIL_CHARGE'});
    return actions;
  }
  if(s.phase==='Command' && playerId===s.activePlayerId) {
    for(const p of s.flow?.pending??[]) actions.push(p.kind==='BATTLE_SHOCK'?{kind:'ROLL_BATTLE_SHOCK',unitId:p.unitId!}:{kind:'RESOLVE_COMMAND_ABILITY',id:p.id});
    if(s.flow?.commandStep && !(s.flow.pending.length)) actions.push({kind:'ADVANCE_COMMAND_STEP'});
    if(!s.flow?.commandStep && engine.canAdvancePhase().allowed) actions.push({kind:'ADVANCE_PHASE'});
  }
  if(s.phase==='Movement' && playerId===s.activePlayerId) {
    if((s.battleFocus?.tokens[playerId]??0)>0)for(const u of own.filter(u=>u.location==='BATTLEFIELD'&&!u.state.hasMoved)) if(probe(e=>e.useAgileManoeuvre('SWIFT_AS_THE_WIND',u.id,'MOVE','NORMAL_MOVE'))) actions.push({kind:'AGILE_MANOEUVRE',id:'SWIFT_AS_THE_WIND',unitId:u.id,trigger:'MOVE',moveType:'NORMAL_MOVE'});
    for(const u of own.filter(u=>u.location==='BATTLEFIELD'&&!u.state.hasMoved)) if(probe(e=>e.beginMovement(u.id))) actions.push({kind:'BEGIN_MOVE',unitId:u.id});
    for(const u of own.filter(u=>u.location==='STRATEGIC_RESERVES')) if(probe(e=>e.beginIngress(u.id,'STRATEGIC_EDGE'))) actions.push({kind:'BEGIN_INGRESS',unitId:u.id});
    for(const u of own.filter(u=>u.location==='EMBARKED')) {
      const mode=engine.getDisembarkMode(u.id);
      if(mode.ok) {
        const transport=s.units.find(t=>t.id===u.embarked?.transportId);
        const parent=transport?.models.find(m=>m.alive);
        const constraints=transport?.arrival?.turn===s.turn?setupConstraints(s,{unitId:transport.id,kind:'INGRESS_MOVE',mode:transport.arrival.ingressMethod,positions:{}}):{};
        const formation=mode.value.formation??(parent?searchDisembark(s,u,parent,3,mode.value.mode==='RAPID'?constraints:{}).formation:null);
        if(formation) actions.push({kind:'DISEMBARK',unitId:u.id,formation});
      }
    }
  }
  if(s.phase==='Shooting' && playerId===s.activePlayerId) {
    for(const u of own) {
      if(engine.getRangedWeapons(u.id).ok) actions.push({kind:'BEGIN_SHOOTING',unitId:u.id});
      const debug=engine.getMissionDebug(u.id);
      for(const a of debug?.actions??[]) if(a.eligibility?.ok) actions.push({kind:'START_ACTION',unitId:u.id,actionId:a.id,objectiveId:a.objectives[0]});
    }
  }
  if(s.phase==='Charge' && playerId===s.activePlayerId && (s.battleFocus?.tokens[playerId]??0)>0) for(const u of own.filter(u=>u.location==='BATTLEFIELD'))
    if(probe(e=>e.declareCharge(u.id,()=>0.5))) actions.push({kind:'DECLARE_CHARGE',unitId:u.id});
  if(s.phase==='Charge' && playerId===s.activePlayerId) for(const u of own.filter(u=>u.location==='BATTLEFIELD'))
    if(probe(e=>e.useAgileManoeuvre('FLITTING_SHADOWS',u.id,'CHARGE'))) actions.push({kind:'AGILE_MANOEUVRE',id:'FLITTING_SHADOWS',unitId:u.id,trigger:'CHARGE'});
  if(s.phase==='Fight') {
    const fight=s.closeCombat?.fight;
    if(!fight && playerId===s.activePlayerId) actions.push({kind:'START_FIGHT'});
    else if(fight) {
      if(fight.step==='PILE_IN'||fight.step==='CONSOLIDATE') {
        const units=fight.step==='PILE_IN'?new CloseCombatController(s).pileInUnits():new CloseCombatController(s).consolidateUnits();
        if(units[0]?.playerId===playerId) for(const u of units.filter(u=>u.playerId===playerId)) actions.push({kind:'SKIP_TACTICAL_MOVE',unitId:u.id});
      }
      if(fight.step==='FIGHT') {
        const selected=fight.selected;
        if(selected) {
          const u=own.find(u=>u.id===selected.unitId);
          if(u) {
            const faction=engine.getFactionDebugOptions();
            if(faction.exquisite) actions.push({kind:'USE_FACTION_ABILITY',id:'EXQUISITE_LETHAL',unitId:u.id},{kind:'USE_FACTION_ABILITY',id:'EXQUISITE_SUSTAINED',unitId:u.id});
            if(faction.patrons===u.id) actions.push({kind:'USE_FACTION_ABILITY',id:'DAEMONIC_PATRONS',unitId:u.id});
            if(probe(e=>e.useAgileManoeuvre('SUDDEN_STRIKE',u.id,'FIGHT'))) actions.push({kind:'AGILE_MANOEUVRE',id:'SUDDEN_STRIKE',unitId:u.id,trigger:'FIGHT'});
            if(!selected.selectedTarget) for(const w of s.definitions.find(d=>d.id===u.definitionId)?.weapons.filter(w=>w.kind==='melee')??[])
              for(const enemy of s.units.filter(t=>t.playerId!==playerId&&t.location==='BATTLEFIELD'&&t.models.some(m=>m.alive)))
                if(probe(e=>e.selectMeleeTarget(w.id,enemy.id))) actions.push({kind:'SELECT_MELEE_TARGET',weaponId:w.id,targetId:enemy.id});
            if(selected.selectedTarget) actions.push({kind:'MELEE_ATTACK',weaponId:selected.selectedTarget.weaponId,targetId:selected.selectedTarget.targetUnitId});
            if(probe(e=>e.completeFightUnit(()=>0.5))) actions.push({kind:'COMPLETE_FIGHT'});
          }
        } else for(const id of nextFightSelection(s)?.unitIds??[]) if(own.some(u=>u.id===id)) actions.push({kind:'SELECT_FIGHT_UNIT',unitId:id});
      }
      if(playerId===s.activePlayerId && !fight.selected && (fight.step==='START' || fight.step==='PILE_IN'&&!new CloseCombatController(s).pileInUnits().length ||
        fight.step==='FIGHT'&&!nextFightSelection(s) || fight.step==='CONSOLIDATE'&&!new CloseCombatController(s).consolidateUnits().length)) actions.push({kind:'ADVANCE_FIGHT_STEP'});
    }
  }
  if(playerId===s.activePlayerId && engine.canAdvancePhase().allowed) actions.push({kind:'ADVANCE_PHASE'});
  return actions;
}

export function performAction(engine: GameEngine, action: LegalAction, rng: RandomSource): CommandResult<unknown> {
  switch(action.kind) {
    case 'ADVANCE_PRE_BATTLE': return engine.advancePreBattle();
    case 'SET_FIRST_TURN': return engine.setFirstTurn(action.playerId);
    case 'PASS_WINDOW': return engine.passTimingWindow(action.playerId);
    case 'ADVANCE_COMMAND_STEP': return engine.advanceCommandStep();
    case 'ADVANCE_PHASE': return engine.tryNextPhase();
    case 'ROLL_BATTLE_SHOCK': return engine.rollBattleShock(action.unitId,rng);
    case 'RESOLVE_COMMAND_ABILITY': return engine.resolveCommandAbility(action.id);
    case 'USE_STRATAGEM': return engine.useStratagem(action.id,action.playerId,action.targets,rng);
    case 'BEGIN_DEPLOYMENT': return engine.beginDeployment(action.unitId);
    case 'DEPLOY_FORMATION': case 'INGRESS_FORMATION': {
      for(const [id,p] of Object.entries(action.formation)) {const result=engine.stageSetupModel(id,p);if(!result.ok)return result;}
      return engine.completeSetup();
    }
    case 'SKIP_SCOUT': return engine.skipScout(action.unitId);
    case 'BEGIN_INGRESS': return engine.beginIngress(action.unitId,'STRATEGIC_EDGE');
    case 'BEGIN_DISEMBARK': return engine.beginDisembark(action.unitId,rng);
    case 'DISEMBARK': {
      const begun=engine.beginDisembark(action.unitId,rng,action.formation);if(!begun.ok)return begun;
      for(const [id,p] of Object.entries(action.formation)) {const staged=engine.stageDisembarkModel(id,p);if(!staged.ok)return staged;}
      return engine.completeDisembark();
    }
    case 'EMERGENCY_DISEMBARK': {
      const begun=engine.beginDisembark(action.unitId,rng);if(!begun.ok)return begun;
      return engine.resolveEmergencyDisembark();
    }
    case 'BEGIN_MOVE': return engine.beginMovement(action.unitId);
    case 'MOVE_MODEL': return engine.moveModel(action.modelId,action.target);
    case 'COMPLETE_MOVE': return engine.completeMovement(undefined,rng);
    case 'CANCEL_MOVE': return engine.cancelMovement();
    case 'BEGIN_SHOOTING': return engine.beginShooting(action.unitId);
    case 'SELECT_SHOOTING_TARGET': return engine.selectShootingTarget(action.weaponId,action.targetId);
    case 'FIRE_WEAPON': return engine.fireWeapon(action.weaponId,action.targetId,rng);
    case 'COMPLETE_SHOOTING': return engine.completeShooting(rng);
    case 'START_ACTION': return engine.startAction(action.unitId,action.actionId,action.objectiveId);
    case 'DECLARE_CHARGE': return engine.declareCharge(action.unitId,rng);
    case 'SELECT_CHARGE_TARGETS': return engine.selectChargeTargets(action.targetIds);
    case 'FAIL_CHARGE': return engine.failCharge();
    case 'COMBAT_MOVE_MODEL': return engine.moveCombatModel(action.modelId,action.target);
    case 'COMPLETE_COMBAT_MOVE': return engine.completeCombatMove();
    case 'START_FIGHT': return engine.startFightPhase();
    case 'ADVANCE_FIGHT_STEP': return engine.advanceFightStep();
    case 'SKIP_TACTICAL_MOVE': return engine.skipTacticalMove(action.unitId);
    case 'BEGIN_PILE_IN': return engine.beginPileIn(action.unitId);
    case 'BEGIN_CONSOLIDATION': return engine.beginConsolidation(action.unitId);
    case 'SELECT_FIGHT_UNIT': return engine.selectFightUnit(action.unitId);
    case 'SELECT_MELEE_TARGET': return engine.selectMeleeTarget(action.weaponId,action.targetId);
    case 'MELEE_ATTACK': return engine.meleeAttack(action.weaponId,action.targetId,rng);
    case 'COMPLETE_FIGHT': return engine.completeFightUnit(rng);
    case 'RESOLVE_FIGHT_ON_DEATH': return engine.resolveFightOnDeath(action.unitId,action.weaponId,rng);
    case 'RESUME_ATTACK': return engine.resumeAttack(rng);
    case 'RESOLVE_DESTRUCTION': return engine.resolveDestructionEffects(rng);
    case 'COMPLETE_REACTION_SHOOTING': return engine.completeReactionShooting(rng);
    case 'REACTION_FIRE': return engine.fireReactionWeapon(action.weaponId,rng);
    case 'CHOOSE_CORE_ABILITY': return engine.chooseCoreAbility(action.modelId,action.abilityKind,action.instance);
    case 'AGILE_MANOEUVRE': return engine.useAgileManoeuvre(action.id,action.unitId,action.trigger,action.moveType,rng);
    case 'REACTION_MOVE_MODEL': return engine.moveReactionModel(action.modelId,action.target);
    case 'COMPLETE_REACTION_MOVE': return engine.completeReactionMove();
    case 'USE_FACTION_ABILITY':
      switch(action.id) {
        case 'EUPHORIC_STRIKES': return engine.activateEuphoricStrikes(action.unitId);
        case 'DAEMONIC_PATRONS': return engine.activateDaemonicPatrons(action.unitId);
        case 'DOOM_SIREN': return engine.useDoomSiren(action.unitId,action.targetId!,rng);
        case 'TERRIFYING_CRESCENDO': return engine.useTerrifyingCrescendo(action.unitId,action.targetId!);
        case 'EXQUISITE_LETHAL': return engine.chooseExquisiteSwordsmanship('LETHAL_HITS');
        case 'EXQUISITE_SUSTAINED': return engine.chooseExquisiteSwordsmanship('SUSTAINED_HITS');
      }
  }
  return fail();
}
