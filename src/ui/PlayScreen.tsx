import { useEffect, useRef, useState } from 'react';
import { Button, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { PlaySession } from '../game/session/PlaySession';
import type { LegalAction } from '../game/actions/LegalActions';
import type { Position } from '../game/models';
import { BattlefieldView, PLAYER_COLORS } from './BattlefieldView';

function label(action: LegalAction) {
  switch(action.kind) {
    case 'DEPLOY_FORMATION':case 'INGRESS_FORMATION': return `${action.kind.replaceAll('_',' ')} · ${Object.values(action.formation)[0]?.x.toFixed(1)}″`;
    case 'USE_STRATAGEM': return `${action.id.replaceAll('_',' ')} · ${action.targets.join(', ')}`;
    case 'USE_FACTION_ABILITY': return `${action.id.replaceAll('_',' ')} · ${action.targetId??action.unitId}`;
    case 'SELECT_SHOOTING_TARGET':case 'FIRE_WEAPON':case 'SELECT_MELEE_TARGET':case 'MELEE_ATTACK': return `${action.kind.replaceAll('_',' ')} · ${action.weaponId} → ${action.targetId}`;
    case 'MOVE_MODEL':case 'COMBAT_MOVE_MODEL':case 'REACTION_MOVE_MODEL': return `${action.kind.replaceAll('_',' ')} · ${action.modelId} → (${action.target.x.toFixed(1)}, ${action.target.y.toFixed(1)})`;
    case 'START_ACTION': return `${action.actionId} · ${action.unitId}`;
    default: return `${action.kind.replaceAll('_',' ')}${'unitId' in action?` · ${action.unitId}`:''}`;
  }
}
export function PlayScreen({onExit}:{onExit:()=>void}) {
  const session=useRef<PlaySession|null>(null);
  const [side,setSide]=useState<'AELDARI'|'EMPERORS_CHILDREN'>('AELDARI');
  const [revision,setRevision]=useState(0);
  const [selectedUnit,setSelectedUnit]=useState<string|null>(null);
  const [selectedModel,setSelectedModel]=useState<string|null>(null);
  const [showUnits,setShowUnits]=useState(false);
  const [notice,setNotice]=useState('');
  const game=session.current;
  useEffect(()=>{
    if(!game||game.status!=='AI_DECISION')return;
    const timer=setTimeout(()=>{
      try {game.advanceAi(4);setRevision(v=>v+1);}
      catch(error){setNotice(`AI: ${error instanceof Error?error.message:String(error)}`);}
    },0);
    return ()=>clearTimeout(timer);
  },[game,revision]);
  const state=game?.getState(), actions=game?.getHumanActions()??[];
  const unit=state?.units.find(u=>u.id===selectedUnit), definition=state?.definitions.find(d=>d.id===unit?.definitionId);
  const visible=actions.filter(a=>!('unitId' in a)||!selectedUnit||a.unitId===selectedUnit)
    .filter(a=>!('modelId' in a)||!selectedModel||a.modelId===selectedModel);
  function submit(action:LegalAction) {
    if(!session.current)return;
    const result=session.current.submit(action);
    setNotice(result.ok?`${label(action)} ✓`:result.reason.replaceAll('_',' '));
    if(result.ok)setRevision(v=>v+1);
  }
  function tap(position:Position) {
    if(!selectedModel||!state)return;
    const kind=state.closeCombat?.move?'COMBAT_MOVE_MODEL':state.movement?'MOVE_MODEL':state.reactionMove?'REACTION_MOVE_MODEL':null;
    if(kind)submit({kind,modelId:selectedModel,target:{...position,z:0}});
  }
  return <SafeAreaView style={styles.page}><StatusBar style="light"/><ScrollView contentContainerStyle={styles.content}>
    <Text accessibilityRole="header" style={styles.title}>WAR MILLENNIUM TACTICS</Text>
    {!state?<>
      <Text style={styles.text}>Proving Ground · AI Standard · 5 Battle Rounds</Text>
      <Button title={`YOUR FACTION: ${side}`} onPress={()=>setSide(side==='AELDARI'?'EMPERORS_CHILDREN':'AELDARI')}/>
      <Button title="NEW MATCH" onPress={()=>{session.current=new PlaySession(42,side);setRevision(v=>v+1);setNotice('Match created. Choose a legal action.');}}/>
      <Button title="BACK TO MENU" onPress={onExit}/>
    </>:<>
      <Text style={styles.text}>Round {state.round}/{state.flow?.rules.maximumBattleRounds??5} · Turn {state.turn} · {state.phase} {state.flow?.commandStep??state.closeCombat?.fight?.step??''}</Text>
      <Text style={styles.text}>Active: {state.players.find(p=>p.id===state.activePlayerId)?.name} · {game!.status==='AI_DECISION'?'AI is thinking…':game!.status==='FINISHED'?'Match finished':'Your decision'}</Text>
      <Text style={styles.text}>CP: {state.players.map(p=>`${p.name} ${p.commandPoints??0}`).join(' · ')} {state.battleFocus?`· Battle Focus ${state.players.map(p=>`${p.name} ${state.battleFocus?.tokens[p.id]??0}`).join(' / ')}`:''}</Text>
      {state.flow?.window&&<Text style={styles.notice}>Reaction: {state.flow.window.trigger} · waiting for {state.players.filter(p=>!state.flow!.window!.passedPlayerIds.includes(p.id)).map(p=>p.name).join(', ')}</Text>}
      {!!state.flow?.pending.length&&<Text style={styles.notice}>Pending: {state.flow.pending.map(p=>p.label).join(', ')}</Text>}
      <Text style={styles.text}>VP: {state.mission?.matchResult?.scores.map(s=>`${state.players.find(p=>p.id===s.playerId)?.name} ${s.total}`).join(' · ')??state.players.map(p=>`${p.name} ${state.mission?.ledger.filter(e=>e.playerId===p.id).reduce((n,e)=>n+e.amount,0)??0}`).join(' · ')}</Text>
      {state.status==='finished'&&<Text style={styles.title}>{state.mission?.matchResult?.winnerPlayerId?`${state.players.find(p=>p.id===state.mission?.matchResult?.winnerPlayerId)?.name} wins`:'Draw'}</Text>}
      <BattlefieldView state={state} selectedModelId={selectedModel} target={null} onModel={(unitId,modelId)=>{setSelectedUnit(unitId);setSelectedModel(modelId);}} onTarget={tap}/>
      <Text style={styles.text}>Selected: {selectedUnit??'All units'} {selectedModel??''}</Text>
      <Button title="SHOW ALL ACTIONS" onPress={()=>{setSelectedUnit(null);setSelectedModel(null);}}/>
      {unit&&definition&&<View style={styles.card}><Text style={styles.heading}>{definition.name} · {unit.location??'BATTLEFIELD'}</Text>
        <Text style={styles.text}>Alive {unit.models.filter(m=>m.alive).length}/{unit.models.length} · Wounds {unit.models.filter(m=>m.alive).map(m=>m.woundsRemaining).join('/')} · M {definition.stats.movement} · T {definition.stats.toughness} · Sv {definition.stats.save}+ · OC {definition.stats.objectiveControl}</Text>
        <Text style={styles.text}>Weapons: {definition.weapons.map(w=>w.name).join(', ')}</Text>
        <Text style={styles.text}>Abilities: {definition.abilities.map(a=>a.name).join(', ')||'—'} · Effects: {state.flow?.effects.filter(e=>e.active&&e.target.unitId===unit.id).map(e=>e.source).join(', ')||'—'}</Text>
        <Text style={styles.text}>Attached: {state.attachments?.find(a=>a.id===unit.id)?.components.map(c=>c.original.id).join(', ')||'—'} · Transport: {unit.embarked?.transportId??'—'}</Text>
      </View>}
      <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text>
      {game!.status==='HUMAN_DECISION'&&<View style={styles.card}><Text style={styles.heading}>Legal actions ({visible.length})</Text>
        {visible.slice(0,40).map((a,i)=><Button key={`${a.kind}-${i}`} title={label(a)} onPress={()=>submit(a)}/>)}
        {visible.length>40&&<Text style={styles.text}>Select a unit or model to narrow the list.</Text>}
      </View>}
      <Button title={showUnits?'HIDE UNIT LIST':'SHOW UNIT LIST'} onPress={()=>setShowUnits(v=>!v)}/>
      {showUnits&&<View style={styles.card}><Text style={styles.heading}>Units</Text>{state.units.filter(u=>u.models.some(m=>m.alive)).map(u=>
        <Button key={u.id} title={`${selectedUnit===u.id?'● ':''}${state.definitions.find(d=>d.id===u.definitionId)?.name??u.id} · ${u.models.filter(m=>m.alive).length} · ${u.location??'BATTLEFIELD'}`}
          color={PLAYER_COLORS[state.players.findIndex(p=>p.id===u.playerId)]} onPress={()=>{setSelectedUnit(u.id);setSelectedModel(null);setShowUnits(false);}}/>)}</View>}
      <View style={styles.card}><Text style={styles.heading}>Battle log</Text>{state.events.slice(-12).reverse().map(e=><Text key={e.sequence} style={styles.text}>{e.sequence}. {e.type==='flow'?e.name:e.type} · {e.unitId}</Text>)}</View>
      <Button title="RESTART MATCH" onPress={()=>{session.current=new PlaySession(42,side);setSelectedUnit(null);setSelectedModel(null);setRevision(v=>v+1);}}/>
      <Button title="RETURN TO MENU" onPress={onExit}/>
    </>}
  </ScrollView></SafeAreaView>;
}
const styles=StyleSheet.create({page:{flex:1,backgroundColor:'#111827'},content:{padding:18,gap:12},title:{color:'#fff',fontSize:24,fontWeight:'700'},text:{color:'#e5e7eb'},notice:{color:'#fcd34d'},heading:{fontSize:18,fontWeight:'700',color:'#fff'},card:{backgroundColor:'#1f2937',borderRadius:8,padding:10,gap:6}});
