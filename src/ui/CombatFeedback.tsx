import { Text, View } from 'react-native';
import type { WeaponResolution } from '../game/models';
/** Completed engine event only. Never predicts damage or consumes RNG. */
export function CombatFeedback({resolution,label}:{resolution:WeaponResolution;label:string}){
 return <View accessibilityLiveRegion="polite" style={{padding:12,gap:5,borderWidth:1,borderColor:'#c79844',borderRadius:12,backgroundColor:'#161e28'}}><Text style={{color:'#f5b63d',fontWeight:'700'}}>Combat result · {label}</Text><Text style={{color:'#e8eef6'}}>{resolution.attacks} attacks → {resolution.hits} hits → {resolution.wounds} wounds → {resolution.savesFailed} failed saves</Text><Text style={{color:'#e8eef6'}}>{resolution.totalDamage} damage · {resolution.destroyedModelIds.length} casualties</Text><Text style={{color:'#90a0b4',fontSize:11}}>Hit dice: {resolution.hitRolls.join(', ')||'—'} · Wound dice: {resolution.woundRolls.join(', ')||'—'}</Text></View>;
}
