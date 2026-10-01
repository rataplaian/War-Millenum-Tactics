import { Pressable, StyleSheet, Text, View } from 'react-native';
import { menuPlacement, type RadialCommand, type ScreenBounds } from './battlefieldInteraction';
const slots=[{x:82,y:0},{x:154,y:38},{x:154,y:108},{x:82,y:136},{x:10,y:108},{x:10,y:38}];
export function RadialActionMenu({anchor,viewport,commands,onAction,avoid}:{anchor:{x:number;y:number};viewport:{width:number;height:number};avoid?:ScreenBounds;commands:RadialCommand[];onAction:(command:RadialCommand)=>void}) {
  return <View pointerEvents="box-none" style={[styles.menu,menuPlacement(anchor,viewport,undefined,avoid)]}>
    {commands.map((command,i)=><Pressable key={command} accessibilityRole="button" accessibilityLabel={`Radial ${command}`} onPress={()=>onAction(command)} style={[styles.bubble,{left:slots[i]!.x,top:slots[i]!.y}]}><Text style={styles.label}>{command}</Text></Pressable>)}
  </View>;
}
const styles=StyleSheet.create({menu:{position:'absolute',width:220,height:180},bubble:{position:'absolute',width:64,height:44,borderRadius:22,backgroundColor:'#111827e8',borderWidth:1,borderColor:'#c4b584',alignItems:'center',justifyContent:'center'},label:{color:'#f8fafc',fontSize:12,fontWeight:'700'}});
