import { Text, View } from 'react-native';
import type { Position } from '../game/models';
import type { coordinateTransform } from './coordinates';
export interface TacticalRanges { origin:Position; movement:number; weapons:{range:number;name:string}[]; mode:'MOVE'|'SHOOT'|'PASSIVE' }
/** Screen scale is rendering only. These circles are envelopes, never legal regions. */
export function TacticalRangeOverlay({ranges,transform}:{ranges:TacticalRanges;transform:ReturnType<typeof coordinateTransform>}) {
  const centre=transform.gameToScreen(ranges.origin);
  const radii=[...new Set(ranges.weapons.map(w=>w.range))].sort((a,b)=>b-a);
  return <View pointerEvents="none" style={{position:'absolute',left:0,top:0,right:0,bottom:0,overflow:'hidden'}}>
    {radii.map((radius,i)=><View key={radius} accessibilityLabel={`Weapon reach ${radius} inches, not guaranteed legal`} style={{position:'absolute',left:centre.x-radius*transform.scale,top:centre.y-radius*transform.scale,width:2*radius*transform.scale,height:2*radius*transform.scale,borderRadius:radius*transform.scale,borderWidth:1,borderColor:ranges.mode==='SHOOT'?'#9bbdcbaa':'#9bbdcb66',backgroundColor:ranges.mode==='SHOOT'?'#8caab008':'transparent',borderStyle:'dashed'}}>
      <Text style={{position:'absolute',top:4,left:'50%',color:'#b7cad1',fontSize:11}}>{radius}″ reach</Text>
    </View>)}
    <View accessibilityLabel={`Maximum movement envelope ${ranges.movement} inches, not guaranteed legal`} style={{position:'absolute',left:centre.x-ranges.movement*transform.scale,top:centre.y-ranges.movement*transform.scale,width:2*ranges.movement*transform.scale,height:2*ranges.movement*transform.scale,borderRadius:ranges.movement*transform.scale,borderWidth:1,borderColor:'#d6c28b88',backgroundColor:ranges.mode==='MOVE'?'#d6c28b20':'#d6c28b0c',borderStyle:'dashed'}}/>
  </View>;
}
