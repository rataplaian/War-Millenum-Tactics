import { Pressable, ScrollView, Text, StyleSheet } from 'react-native';
import type { GameState } from '../game/models';
import { weaponProfile,diceLabel } from './combatPresentation';
export function WeaponBubbles({state,ids,selected,onChoose}:{state:GameState;ids:string[];selected:string|null;onChoose:(id:string)=>void}) {
  return <ScrollView horizontal contentContainerStyle={styles.row}>{ids.map(id=>{const w=weaponProfile(state,id);return <Pressable key={id} accessibilityRole="button" accessibilityLabel={`Weapon ${w?.name??id}`} accessibilityState={{selected:id===selected}} onPress={()=>onChoose(id)} style={[styles.bubble,id===selected&&styles.selected]}><Text style={styles.name}>{w?.name??id}</Text><Text style={styles.stats}>{w?.kind==='ranged'?`${w.range}″ · `:''}{w?`A ${diceLabel(w.attacks)} · S ${w.strength} · AP ${w.armourPenetration}`:''}</Text></Pressable>;})}</ScrollView>;
}
const styles=StyleSheet.create({row:{gap:8,paddingVertical:4},bubble:{maxWidth:220,minHeight:52,padding:10,borderRadius:16,borderWidth:1,borderColor:'#28394a',backgroundColor:'#101a25'},selected:{borderColor:'#2fe6d6'},name:{color:'#e8eef6',fontWeight:'700',fontSize:13},stats:{color:'#90a0b4',fontSize:11}});
