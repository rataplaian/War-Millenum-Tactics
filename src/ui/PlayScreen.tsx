import { useEffect, useMemo, useRef, useState } from 'react';
import { type ButtonProps, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { PlaySession } from '../game/session/PlaySession';
import type { LegalAction } from '../game/actions/LegalActions';
import type { Position } from '../game/models';
import { UnitInfoPanel } from './UnitInfoPanel';
import { WeaponBubbles } from './WeaponBubbles';
import { AttackCard } from './AttackCard';
import { CombatFeedback } from './CombatFeedback';
import { actionsForWeapon,weaponChoices,completedCombat,weaponProfile } from './combatPresentation';
import { BattlefieldView } from './BattlefieldView';
import { RadialActionMenu } from './RadialActionMenu';
import { radialCommands, movementEnvelope, weaponReach, selectionPreview, shootingTargetIds, unitScreenBounds, type RadialCommand } from './battlefieldInteraction';
import { actionDetail, actionPosition, actionTargets, actionUnitId, commandKey, commandName, commandPrompt } from './playCommands';
import { modelDefinitionId, UNIT_VISUALS, unitName } from './unitPresentation';
import { TOKEN_ART } from './tokenArt';

export function PlayScreen({onExit}:{onExit:()=>void}) {
  const session=useRef<PlaySession|null>(null);
  const [side,setSide]=useState<'AELDARI'|'EMPERORS_CHILDREN'>('AELDARI');
  const [revision,setRevision]=useState(0);
  const [selectedUnit,setSelectedUnit]=useState<string|null>(null);
  const [selectedModel,setSelectedModel]=useState<string|null>(null);
  const [selectedCommand,setSelectedCommand]=useState<string|null>(null);
  const [pending,setPending]=useState<LegalAction|null>(null);
  const [zoom,setZoom]=useState(1);
  const [advanced,setAdvanced]=useState(false);
  const [info,setInfo]=useState(false);
  const [selectedWeapon,setSelectedWeapon]=useState<string|null>(null);
  const [dismissedCombat,setDismissedCombat]=useState(0);
  const [mode,setMode]=useState<'MOVE'|'SHOOT'|'PASSIVE'>('PASSIVE');
  const [viewport,setViewport]=useState({width:360,height:360});
  const [pan,setPan]=useState({x:0,y:0});
  const [showLog,setShowLog]=useState(false);
  const [notice,setNotice]=useState('');
  const [legalPreview,setLegalPreview]=useState(true);
  const game=session.current;
  useEffect(()=>{
    if(!game||game.status!=='AI_DECISION')return;
    const timer=setTimeout(()=>{
      try {game.advanceAi(1);setRevision(v=>v+1);}
      catch(error){setNotice(`AI: ${error instanceof Error?error.message:String(error)}`);}
    },16);
    return ()=>clearTimeout(timer);
  },[game,revision]);
  const state=useMemo(()=>game?.getState(),[game,revision]);
  const humanActions=useMemo(()=>game?.getHumanActions()??[],[game,revision]);
  const unit=state?.units.find(u=>u.id===selectedUnit);
  const definition=state?.definitions.find(d=>d.id===unit?.definitionId);
  const status=useMemo(()=>game?.status,[game,revision]);
  const visible=state?humanActions.filter(a=>!actionUnitId(a,state)||actionUnitId(a,state)===selectedUnit):[];
  const groups=[...new Map(visible.map(a=>[commandKey(a),a])).values()];
  const options=visible.filter(a=>commandKey(a)===selectedCommand && (!('modelId' in a)||!selectedModel||a.modelId===selectedModel));
  const preview=useMemo(()=>game&&selectedUnit?selectionPreview(game.engine,game.humanPlayerId,selectedUnit,humanActions):{movement:[],shooting:[]},[game,revision,selectedUnit]);
  const radial=state&&selectedUnit?radialCommands(humanActions,state,selectedUnit):[];
  const focusModel=unit?.models.find(m=>m.alive&&m.id===selectedModel)??unit?.models.find(m=>m.alive);
  const combatActions=visible.filter(a=>['SELECT_SHOOTING_TARGET','FIRE_WEAPON','SELECT_MELEE_TARGET','MELEE_ATTACK'].includes(a.kind));
  const activeWeapons=weaponChoices(combatActions);
  const weaponActions=actionsForWeapon(combatActions,selectedWeapon);
  const recentCombat=state?completedCombat(state.events).at(-1):undefined;
  const ranges=state&&unit&&focusModel?{origin:focusModel.position,movement:movementEnvelope(state,unit,focusModel),weapons:weaponReach(state,unit,focusModel).filter(w=>!selectedWeapon||w.id===selectedWeapon),mode}:undefined;
  const boardWidth=viewport.width*zoom;
  const anchor=state&&focusModel?{x:focusModel.position.x/state.battlefield.width*boardWidth-pan.x,y:focusModel.position.y/state.battlefield.width*boardWidth-pan.y}:null;
  const targetIds=mode==='SHOOT'?shootingTargetIds(weaponActions):[...new Set([...options.flatMap(actionTargets),...shootingTargetIds(preview.shooting)])];
  const movementSuggestions=(mode==='MOVE'||mode==='PASSIVE'?preview.movement:[]).filter(a=>!('modelId' in a)||!focusModel||a.modelId===focusModel.id);
  const samples=[...movementSuggestions,...options].map(actionPosition).filter((p):p is Position=>!!p).map(position=>({position,legal:true}));
  const prompt=status==='AI_DECISION'?'Opponent is playing — wait for your turn':status==='FINISHED'?'Match finished':pending?'Confirm action':mode==='SHOOT'&&!selectedWeapon?'Choose a weapon':mode==='SHOOT'&&selectedWeapon?'Tap a highlighted target, or resolve the pending reaction':selectedCommand?commandPrompt(options,selectedModel):selectedUnit?`${unit?unitName(state!,unit.id):'Unit'} · tap an action bubble`:'Tap your unit on the battlefield';

  function clearChoice(){setPending(null);setSelectedCommand(null);setLegalPreview(true);}
  function select(unitId:string,modelId:string|null){setSelectedUnit(unitId);setSelectedModel(modelId);setMode('PASSIVE');setSelectedWeapon(null);setInfo(false);clearChoice();}
  function choose(action:LegalAction){setPending(action);setLegalPreview(true);setNotice('Review the action below. Nothing changes until you confirm.');}
  function submit() {
    if(!game||!pending)return;
    const result=game.submit(pending);
    setNotice(result.ok?`${commandName(pending)} completed`:result.reason.replaceAll('_',' '));
    if(result.ok){clearChoice();setRevision(v=>v+1);}
  }
  function tap(position:Position) {
    if(!state||status!=='HUMAN_DECISION'||!selectedCommand)return;
    const placements=options.filter(a=>'formation' in a);
    if(placements.length){const nearest=placements.reduce((a,b)=>Math.hypot(actionPosition(a)!.x-position.x,actionPosition(a)!.y-position.y)<=Math.hypot(actionPosition(b)!.x-position.x,actionPosition(b)!.y-position.y)?a:b);choose(nearest);return;}
    if(!selectedModel)return;
    if(selectedCommand==='REACTION_MOVE_MODEL'){
      const choices=options.filter(a=>a.kind==='REACTION_MOVE_MODEL'&&a.modelId===selectedModel);
      if(choices.length)choose(choices.reduce((a,b)=>Math.hypot(actionPosition(a)!.x-position.x,actionPosition(a)!.y-position.y)<=Math.hypot(actionPosition(b)!.x-position.x,actionPosition(b)!.y-position.y)?a:b));
      return;
    }
    const kind=selectedCommand.split(':')[0];
    if(kind==='MOVE_MODEL'||kind==='COMBAT_MOVE_MODEL'||kind==='REACTION_MOVE_MODEL') {
      const target={...position,z:unit?.models.find(m=>m.id===selectedModel)?.position.z??0};
      const result=kind==='MOVE_MODEL'?game!.engine.previewMove(selectedModel,target):kind==='COMBAT_MOVE_MODEL'?game!.engine.previewCombatMove(selectedModel,target):null;
      setPending({kind,modelId:selectedModel,target});setLegalPreview(result?.ok??true);
      setNotice(result && !result.ok?result.reason.replaceAll('_',' '):'Destination selected. Confirm to move.');
    }
  }
  function boardModel(unitId:string,modelId:string){
    if(targetIds.includes(unitId)&&status==='HUMAN_DECISION') {const a=(mode==='SHOOT'?weaponActions:options).find(a=>actionTargets(a).includes(unitId));if(a){choose(a);return;}}
    if(state?.units.find(u=>u.id===unitId)?.playerId===game?.humanPlayerId) {
      if(unitId===selectedUnit){setSelectedModel(modelId);setPending(null);}else select(unitId,modelId);
    }else {select(unitId,modelId);setInfo(true);setNotice('Enemy information — read-only. Select your unit to act.');}
  }
  function radialAction(command:RadialCommand){
    if(command==='BACK'){clearChoice();setMode('PASSIVE');setSelectedWeapon(null);setNotice('Selection mode. Open transactions remain until Complete or Cancel.');return;}
    if(command==='INFO'){setInfo(v=>!v);return;}
    const available=radial.find(r=>r.id===command)?.actions;if(!game||!available?.length)return;
    const action=available[0]!;setInfo(false);setPending(null);setMode(command==='SHOOT'?'SHOOT':command==='MOVE'?'MOVE':'PASSIVE');
    if(action.kind==='BEGIN_MOVE'||action.kind==='BEGIN_SHOOTING'){
      const result=game.submit(action);setNotice(result.ok?(action.kind==='BEGIN_MOVE'?'Choose a model, then tap a destination.':'Choose a green enemy target or a weapon/target option.'):(result.reason.replaceAll('_',' ')));
      if(result.ok){setSelectedCommand(action.kind==='BEGIN_MOVE'?'MOVE_MODEL':'SELECT_SHOOTING_TARGET');setSelectedModel(focusModel?.id??null);setRevision(v=>v+1);}return;
    }
    setSelectedCommand(commandKey(action));if(!actionPosition(action)&&!actionTargets(action).length)choose(action);
  }
  function newMatch(){session.current=new PlaySession(42,side);setSelectedUnit(null);setSelectedModel(null);clearChoice();setRevision(v=>v+1);setNotice('Choose first player before Continue setup. Deploy units using More actions, then tap them on the battlefield.');}
  const previewPosition=pending?actionPosition(pending):undefined;
  const previewFormation=pending&&'formation' in pending?pending.formation:undefined;
  return <SafeAreaView style={styles.page}><StatusBar style="light"/>
    <View style={styles.header}><Text style={styles.title}>WAR MILLENNIUM TACTICS</Text>
      {state&&<><Text style={styles.text}>Round {state.round}/5 · {state.deployment?.stage!=='BATTLE_STARTED'?state.deployment?.stage.replaceAll('_',' '):state.phase} · {state.players.find(p=>p.id===state.activePlayerId)?.name}</Text>
        <Text style={styles.text}>CP {state.players.map(p=>`${p.name}: ${p.commandPoints??0}`).join(' / ')} · VP {state.players.map(p=>`${state.mission?.matchResult?.scores.find(s=>s.playerId===p.id)?.total??state.mission?.ledger.filter(e=>e.playerId===p.id).reduce((n,e)=>n+e.amount,0)??0}`).join(' / ')}</Text>
        <Text accessibilityLiveRegion="polite" style={styles.prompt}>{prompt}</Text></>}
    </View>
    <ScrollView contentContainerStyle={styles.content}>
    {!state?<>
      <Text style={styles.text}>Proving Ground · AI Standard · 5 Battle Rounds</Text>
      <Text style={styles.text}>Deploy your squads, then select a unit and an action. Green markers show legal suggestions. Moves and attacks ask for confirmation.</Text>
      <Button title={`YOUR FACTION: ${side}`} onPress={()=>setSide(side==='AELDARI'?'EMPERORS_CHILDREN':'AELDARI')}/>
      <Button title="NEW MATCH" onPress={newMatch}/><Button title="BACK TO MENU" onPress={onExit}/>
    </>:<>
      {status==='FINISHED'&&<Text style={styles.title}>{state.mission?.matchResult?.winnerPlayerId?`${state.players.find(p=>p.id===state.mission?.matchResult?.winnerPlayerId)?.name} wins`:'Draw'}</Text>}
      {!!notice&&<Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text>}
      {state.flow?.window&&<Text style={styles.notice}>Reaction window: {state.flow.window.trigger.replaceAll('_',' ')}. Use a reaction or Pass reaction.</Text>}
      <View style={styles.row}><Text style={styles.text}>{unit?unitName(state,unit.id):'BATTLEFIELD'}</Text><Button title="−" disabled={zoom<=1} onPress={()=>{setZoom(z=>z-1);setPan({x:0,y:0});}}/><Text style={styles.small}>×{zoom}</Text><Button title="+" disabled={zoom>=3} onPress={()=>setZoom(z=>z+1)}/></View>
      <View style={styles.board} onLayout={e=>setViewport({width:e.nativeEvent.layout.width,height:e.nativeEvent.layout.height})}>
        <ScrollView horizontal scrollEventThrottle={16} onScroll={e=>setPan(p=>({...p,x:e.nativeEvent.contentOffset.x}))}><ScrollView nestedScrollEnabled style={{width:boardWidth,height:viewport.height}} scrollEventThrottle={16} onScroll={e=>setPan(p=>({...p,y:e.nativeEvent.contentOffset.y}))}>
          <BattlefieldView state={state} selectedUnitId={selectedUnit} selectedModelId={selectedModel} tacticalRanges={ranges} humanPlayerId={game!.humanPlayerId} validTargetIds={targetIds} previewPositions={previewFormation} samples={samples} target={previewPosition?{position:previewPosition,legal:legalPreview}:null} onModel={boardModel} onTarget={tap}/>
        </ScrollView></ScrollView>
        {anchor&&unit?.location==='BATTLEFIELD'&&<RadialActionMenu anchor={anchor} viewport={viewport} avoid={unitScreenBounds(unit,boardWidth/state.battlefield.width,pan)} commands={[...radial.map(r=>r.id),'INFO','BACK']} onAction={radialAction}/>}
      </View>
      {unit&&<Text style={styles.small}>{unit.models.filter(m=>m.alive).length} models · {mode==='MOVE'?'MOVEMENT':mode==='SHOOT'?'SHOOTING':'TACTICAL PREVIEW'} · dashed ranges are maximum reach, not legal regions · green = engine-approved</Text>}
      {unit&&<UnitInfoPanel state={state} unit={unit} expanded={info} readOnly={unit.playerId!==game!.humanPlayerId}/>}

      {selectedCommand&&mode==='MOVE'&&unit&&<ScrollView horizontal contentContainerStyle={styles.row}>{unit.models.filter(m=>m.alive).map((m,i)=><Button key={m.id} title={`${m.id===selectedModel?'● ':''}Model ${i+1}`} onPress={()=>{setSelectedModel(m.id);setPending(null);}}/>)}</ScrollView>}
      {mode==='SHOOT'&&activeWeapons.length>0&&!pending&&<WeaponBubbles state={state} ids={activeWeapons} selected={selectedWeapon} onChoose={id=>{setSelectedWeapon(id);setPending(null);setSelectedCommand(null);setNotice('Tap a green target for this weapon.');}}/>}
      {mode==='SHOOT'&&selectedWeapon&&!pending&&<View style={styles.row}>{weaponActions.map((a,i)=><Button key={i} title={`${a.kind==='FIRE_WEAPON'?'FIRE · ':''}${actionDetail(a,state)}`} onPress={()=>choose(a)}/>)}</View>}
      {selectedCommand&&!pending&&<View style={styles.compact}><Text style={styles.small}>{commandPrompt(options,selectedModel)}</Text>{mode!=='MOVE'&&mode!=='SHOOT'&&<View style={styles.row}>{options.map((a,i)=><Button key={i} title={actionDetail(a,state)} onPress={()=>choose(a)}/>)}</View>}<Button title="CHANGE SELECTION" onPress={()=>{clearChoice();setMode('PASSIVE');}}/></View>}
      {pending&&<View style={styles.compact}><AttackCard state={state} action={pending}/><View style={styles.row}><Button title="CONFIRM ACTION" disabled={!legalPreview} onPress={submit}/><Button title="CHANGE CHOICE" onPress={()=>setPending(null)}/></View></View>}
      {!pending&&status==='HUMAN_DECISION'&&<View style={styles.row}>{[...new Map(humanActions.filter(a=>['COMPLETE_MOVE','CANCEL_MOVE','COMPLETE_COMBAT_MOVE','COMPLETE_SHOOTING','PASS_WINDOW','ADVANCE_PHASE','ADVANCE_COMMAND_STEP','ADVANCE_PRE_BATTLE','START_FIGHT','ADVANCE_FIGHT_STEP','RESUME_ATTACK','RESOLVE_DESTRUCTION','CHOOSE_CORE_ABILITY','COMPLETE_REACTION_SHOOTING','COMPLETE_REACTION_MOVE','SET_FIRST_TURN','ROLL_BATTLE_SHOCK','RESOLVE_COMMAND_ABILITY','REACTION_FIRE','COMPLETE_FIGHT','BEGIN_CONSOLIDATION','SKIP_TACTICAL_MOVE','FAIL_CHARGE','RESOLVE_FIGHT_ON_DEATH'].includes(a.kind)).map(a=>[commandKey(a),a])).values()].map(a=><Button key={commandKey(a)} title={commandName(a)} onPress={()=>choose(a)}/>)}</View>}
      {!pending&&state.flow?.window&&status==='HUMAN_DECISION'&&<View style={styles.compact}><Text style={styles.small}>Available reactions · choose one or pass</Text><View style={styles.row}>{humanActions.filter(a=>['USE_STRATAGEM','USE_FACTION_ABILITY','AGILE_MANOEUVRE'].includes(a.kind)).map((a,i)=><Button key={i} title={`${commandName(a)} · ${actionDetail(a,state)}`} onPress={()=>choose(a)}/>)}</View></View>}
      {recentCombat&&recentCombat.sequence>dismissedCombat&&<><CombatFeedback resolution={recentCombat.resolution} label={`${unitName(state,recentCombat.unitId)} → ${unitName(state,recentCombat.resolution.targetUnitId)}`}/><Button title="DISMISS RESULT" onPress={()=>setDismissedCombat(recentCombat.sequence)}/></>}
      <Button title={advanced?'HIDE MORE ACTIONS':'MORE ACTIONS'} onPress={()=>setAdvanced(v=>!v)}/>
      {advanced&&<>      <View style={styles.card}><Text style={styles.heading}>{unit?unitName(state,unit.id):'Your units'}</Text>
        <ScrollView horizontal contentContainerStyle={styles.row}>{state.units.filter(u=>u.playerId===game!.humanPlayerId&&u.models.some(m=>m.alive)).map(u=>{
          const visual=UNIT_VISUALS[modelDefinitionId(state,u)];return <Pressable key={u.id} accessibilityRole="button" accessibilityLabel={`Select ${unitName(state,u.id)}`} onPress={()=>select(u.id,null)} style={[styles.unitCard,selectedUnit===u.id&&styles.selected]}>
            {visual&&<Image source={TOKEN_ART[visual.token]} style={styles.portrait}/>}
            <Text style={styles.text}>{unitName(state,u.id)}</Text><Text style={styles.small}>{u.models.filter(m=>m.alive).length} models · {(u.location??'BATTLEFIELD').toLowerCase()}</Text>
          </Pressable>;
        })}</ScrollView>
        {unit&&<><Text style={styles.text}>{unit.models.filter(m=>m.alive).length}/{unit.models.length} models · {UNIT_VISUALS[unit.definitionId]?.category??'Attached unit'} · M {definition?.stats.movement}″ · T {definition?.stats.toughness} · Save {definition?.stats.save}+</Text>
          <ScrollView horizontal contentContainerStyle={styles.row}>{unit.models.filter(m=>m.alive).map(m=><Button key={m.id} title={`${selectedModel===m.id?'● ':''}Model ${unit.models.indexOf(m)+1} · ${m.woundsRemaining}W`} onPress={()=>{setSelectedModel(m.id);setPending(null);}}/>)}</ScrollView></>}
      </View>
      <View style={styles.card}><Text style={styles.heading}>Advanced controls</Text>
        {status==='HUMAN_DECISION'?<>
          <View style={styles.row}>{groups.map(a=><Button key={commandKey(a)} title={commandName(a)} color={selectedCommand===commandKey(a)?'#ca8a04':'#2563eb'} onPress={()=>{setSelectedCommand(commandKey(a));setPending(null);setLegalPreview(true);setNotice('');const choices=visible.filter(c=>commandKey(c)===commandKey(a));if(choices.length===1&&!actionPosition(a)&&!actionTargets(a).length)choose(a);}}/>)}</View>
          {!groups.length&&<Text style={styles.text}>No legal commands for this unit. Select another unit.</Text>}
          {selectedCommand&&!pending&&<><Text style={styles.text}>{commandPrompt(options,selectedModel)}</Text>
            <View style={styles.row}>{options.map((a,i)=><Button key={i} title={actionDetail(a,state)} onPress={()=>choose(a)}/>)}</View>
            {!options.length&&<Text style={styles.text}>Select a different model or another command.</Text>}</>}

        </>:<Text style={styles.text}>{status==='FINISHED'?'Review the result or return to menu.':'AI is playing. Your commands will appear when it is your decision.'}</Text>}
      </View>
</>}
      <Button title={showLog?'HIDE BATTLE LOG':'SHOW BATTLE LOG'} onPress={()=>setShowLog(v=>!v)}/>
      {showLog&&<View style={styles.card}>{state.events.slice(-12).reverse().map(e=><Text key={e.sequence} style={styles.small}>{e.sequence}. {e.type==='flow'?e.name:e.type} · {e.unitId?unitName(state,e.unitId):''}</Text>)}</View>}
      <Button title="RESTART MATCH" onPress={newMatch}/><Button title="RETURN TO MENU" onPress={onExit}/>
    </>}
    </ScrollView></SafeAreaView>;
}
const styles=StyleSheet.create({board:{height:480,borderRadius:12,overflow:'hidden',borderWidth:1,borderColor:'#47534c',backgroundColor:'#243c36'},compact:{padding:10,gap:6,borderRadius:12,backgroundColor:'#19232be8'},page:{flex:1,backgroundColor:'#111827'},header:{padding:14,gap:6,borderBottomWidth:1,borderColor:'#334155'},content:{padding:14,gap:12,maxWidth:1100,width:'100%',alignSelf:'center'},title:{color:'#fff',fontSize:16,fontWeight:'700'},text:{color:'#e5e7eb'},small:{color:'#cbd5e1',fontSize:12},prompt:{color:'#e8eef6',fontWeight:'600',fontSize:15},notice:{color:'#fcd34d'},heading:{fontSize:18,fontWeight:'700',color:'#fff'},row:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:8},card:{backgroundColor:'#1f2937',borderRadius:8,padding:10,gap:10},unitCard:{width:144,padding:8,gap:5,borderWidth:2,borderColor:'transparent',borderRadius:8,backgroundColor:'#0f172a'},selected:{borderColor:'#facc15'},portrait:{width:52,height:52,borderRadius:26},confirm:{padding:12,gap:8,borderWidth:2,borderColor:'#facc15',borderRadius:8}});

function Button({title,onPress,disabled,color}:ButtonProps){return <Pressable accessibilityRole="button" accessibilityState={{disabled:!!disabled}} disabled={disabled} onPress={onPress} style={{minHeight:44,paddingHorizontal:14,paddingVertical:10,borderRadius:12,borderWidth:1,borderColor:color??'#28394a',backgroundColor:'#101a25',justifyContent:'center',opacity:disabled?0.4:1}}><Text style={{color:'#e8eef6',fontSize:12,fontWeight:'600',textAlign:'center'}}>{title}</Text></Pressable>;}
