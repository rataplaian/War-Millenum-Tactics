import { useEffect, useRef, useState } from 'react';
import { Button, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { PlaySession } from '../game/session/PlaySession';
import type { LegalAction } from '../game/actions/LegalActions';
import type { Position } from '../game/models';
import { BattlefieldView } from './BattlefieldView';
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
  const state=game?.getState(), humanActions=game?.getHumanActions()??[];
  const unit=state?.units.find(u=>u.id===selectedUnit);
  const definition=state?.definitions.find(d=>d.id===unit?.definitionId);
  const status=game?.status;
  const visible=state?humanActions.filter(a=>!actionUnitId(a,state)||actionUnitId(a,state)===selectedUnit):[];
  const groups=[...new Map(visible.map(a=>[commandKey(a),a])).values()];
  const options=visible.filter(a=>commandKey(a)===selectedCommand && (!('modelId' in a)||!selectedModel||a.modelId===selectedModel));
  const targetIds=[...new Set(options.flatMap(actionTargets))];
  const samples=options.map(actionPosition).filter((p):p is Position=>!!p).map(position=>({position,legal:true}));
  const prompt=status==='AI_DECISION'?'Opponent is playing — wait for your turn':status==='FINISHED'?'Match finished':pending?'Confirm action':selectedCommand?commandPrompt(options,selectedModel):selectedUnit?'Choose an action':'Select a unit or continue the match';

  function clearChoice(){setPending(null);setSelectedCommand(null);setLegalPreview(true);}
  function select(unitId:string,modelId:string|null){setSelectedUnit(unitId);setSelectedModel(modelId);clearChoice();}
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
    if(targetIds.includes(unitId)&&status==='HUMAN_DECISION') {const a=options.find(a=>actionTargets(a).includes(unitId));if(a)choose(a);return;}
    if(state?.units.find(u=>u.id===unitId)?.playerId===game?.humanPlayerId) {
      if(unitId===selectedUnit){setSelectedModel(modelId);setPending(null);}else select(unitId,modelId);
    }else setNotice('Enemy unit. Choose an attack first; legal targets have green rings.');
  }
  function newMatch(){session.current=new PlaySession(42,side);setSelectedUnit(null);setSelectedModel(null);clearChoice();setRevision(v=>v+1);setNotice('Start with Continue setup. Then select a unit to deploy.');}
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
      <Text style={styles.text}>Deploy your squads, then select a unit and an action. Green markers show legal suggestions. Every command asks for confirmation.</Text>
      <Button title={`YOUR FACTION: ${side}`} onPress={()=>setSide(side==='AELDARI'?'EMPERORS_CHILDREN':'AELDARI')}/>
      <Button title="NEW MATCH" onPress={newMatch}/><Button title="BACK TO MENU" onPress={onExit}/>
    </>:<>
      {status==='FINISHED'&&<Text style={styles.title}>{state.mission?.matchResult?.winnerPlayerId?`${state.players.find(p=>p.id===state.mission?.matchResult?.winnerPlayerId)?.name} wins`:'Draw'}</Text>}
      {!!notice&&<Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text>}
      {state.flow?.window&&<Text style={styles.notice}>Reaction window: {state.flow.window.trigger.replaceAll('_',' ')}. Use a reaction or Pass reaction.</Text>}
      <View style={styles.card}><Text style={styles.heading}>{unit?unitName(state,unit.id):'Your units'}</Text>
        <ScrollView horizontal contentContainerStyle={styles.row}>{state.units.filter(u=>u.playerId===game!.humanPlayerId&&u.models.some(m=>m.alive)).map(u=>{
          const visual=UNIT_VISUALS[modelDefinitionId(state,u)];return <Pressable key={u.id} accessibilityRole="button" accessibilityLabel={`Select ${unitName(state,u.id)}`} onPress={()=>select(u.id,null)} style={[styles.unitCard,selectedUnit===u.id&&styles.selected]}>
            {visual&&<Image source={TOKEN_ART[visual.token]} style={styles.portrait}/>}
            <Text style={styles.text}>{unitName(state,u.id)}</Text><Text style={styles.small}>{u.models.filter(m=>m.alive).length} models · {(u.location??'BATTLEFIELD').toLowerCase()}</Text>
          </Pressable>;
        })}</ScrollView>
        {unit&&<><Text style={styles.text}>{unit.models.filter(m=>m.alive).length}/{unit.models.length} models · {UNIT_VISUALS[unit.definitionId]?.category??'Attached unit'} · M {definition?.stats.movement}″ · T {definition?.stats.toughness} · Save {definition?.stats.save}+</Text>
          <ScrollView horizontal contentContainerStyle={styles.row}>{unit.models.filter(m=>m.alive).map(m=><Button key={m.id} title={`${selectedModel===m.id?'● ':''}Model ${unit.models.indexOf(m)+1} · ${m.woundsRemaining}W`} onPress={()=>{setSelectedModel(m.id);setPending(null);}}/>)}</ScrollView></>}
      </View>
      <View style={styles.card}><Text style={styles.heading}>Commands</Text>
        {status==='HUMAN_DECISION'?<>
          <View style={styles.row}>{groups.map(a=><Button key={commandKey(a)} title={commandName(a)} color={selectedCommand===commandKey(a)?'#ca8a04':'#2563eb'} onPress={()=>{setSelectedCommand(commandKey(a));setPending(null);setLegalPreview(true);setNotice('');const choices=visible.filter(c=>commandKey(c)===commandKey(a));if(choices.length===1&&!actionPosition(a)&&!actionTargets(a).length)choose(a);}}/>)}</View>
          {!groups.length&&<Text style={styles.text}>No legal commands for this unit. Select another unit.</Text>}
          {selectedCommand&&!pending&&<><Text style={styles.text}>{commandPrompt(options,selectedModel)}</Text>
            <View style={styles.row}>{options.map((a,i)=><Button key={i} title={actionDetail(a,state)} onPress={()=>choose(a)}/>)}</View>
            {!options.length&&<Text style={styles.text}>Select a different model or another command.</Text>}</>}
          {pending&&<View style={styles.confirm}><Text style={styles.heading}>Confirm action</Text><Text style={styles.text}>{commandName(pending)} · {actionDetail(pending,state)}</Text>
            <Button title="CONFIRM ACTION" disabled={!legalPreview} onPress={submit}/><Button title="CHANGE CHOICE" onPress={()=>setPending(null)}/></View>}
        </>:<Text style={styles.text}>{status==='FINISHED'?'Review the result or return to menu.':'AI is playing. Your commands will appear when it is your decision.'}</Text>}
      </View>
      <View style={styles.row}><Button title="ZOOM OUT" disabled={zoom<=1} onPress={()=>setZoom(z=>z-1)}/><Text style={styles.text}>Board ×{zoom} · scroll to pan</Text><Button title="ZOOM IN" disabled={zoom>=3} onPress={()=>setZoom(z=>z+1)}/></View>
      <Text style={styles.small}>Blue: Aeldari · Pink: Emperor’s Children · Yellow: selected squad · Green: legal target/destination. Bases use game-world sizes; zoom changes only the view.</Text>
      <ScrollView horizontal style={{maxHeight:560}}><ScrollView nestedScrollEnabled style={{width:720*zoom,height:520}}><View style={{width:720*zoom}}>
        <BattlefieldView state={state} selectedUnitId={selectedUnit} selectedModelId={selectedModel} validTargetIds={targetIds} humanPlayerId={game!.humanPlayerId} previewPositions={previewFormation} samples={samples} target={previewPosition?{position:previewPosition,legal:legalPreview}:null} onModel={boardModel} onTarget={tap}/>
      </View></ScrollView></ScrollView>
      <Button title={showLog?'HIDE BATTLE LOG':'SHOW BATTLE LOG'} onPress={()=>setShowLog(v=>!v)}/>
      {showLog&&<View style={styles.card}>{state.events.slice(-12).reverse().map(e=><Text key={e.sequence} style={styles.small}>{e.sequence}. {e.type==='flow'?e.name:e.type} · {e.unitId?unitName(state,e.unitId):''}</Text>)}</View>}
      <Button title="RESTART MATCH" onPress={newMatch}/><Button title="RETURN TO MENU" onPress={onExit}/>
    </>}
    </ScrollView></SafeAreaView>;
}
const styles=StyleSheet.create({page:{flex:1,backgroundColor:'#111827'},header:{padding:14,gap:6,borderBottomWidth:1,borderColor:'#334155'},content:{padding:14,gap:12,maxWidth:1100,width:'100%',alignSelf:'center'},title:{color:'#fff',fontSize:22,fontWeight:'700'},text:{color:'#e5e7eb'},small:{color:'#cbd5e1',fontSize:12},prompt:{color:'#fcd34d',fontWeight:'700',fontSize:18},notice:{color:'#fcd34d'},heading:{fontSize:18,fontWeight:'700',color:'#fff'},row:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:8},card:{backgroundColor:'#1f2937',borderRadius:8,padding:10,gap:10},unitCard:{width:144,padding:8,gap:5,borderWidth:2,borderColor:'transparent',borderRadius:8,backgroundColor:'#0f172a'},selected:{borderColor:'#facc15'},portrait:{width:52,height:52,borderRadius:26},confirm:{padding:12,gap:8,borderWidth:2,borderColor:'#facc15',borderRadius:8}});
