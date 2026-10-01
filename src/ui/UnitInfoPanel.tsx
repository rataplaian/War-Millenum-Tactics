import { Image, Text, View, StyleSheet } from 'react-native';
import type { GameState, Unit } from '../game/models';
import { UNIT_VISUALS, modelDefinitionId, unitName } from './unitPresentation';
import { TOKEN_ART } from './tokenArt';
import { chosenWeapons, diceLabel } from './combatPresentation';
export function UnitInfoPanel({state,unit,expanded,readOnly}:{state:GameState;unit:Unit;expanded:boolean;readOnly:boolean}) {
  const d=state.definitions.find(d=>d.id===unit.definitionId)!;
  const visual=UNIT_VISUALS[modelDefinitionId(state,unit)],art=visual?TOKEN_ART[visual.token]:undefined;
  const living=unit.models.filter(m=>m.alive),wounds=living.reduce((n,m)=>n+m.woundsRemaining,0);
  const attachment=state.attachments?.find(a=>a.id===unit.id);
  const statuses=Object.entries(unit.state).filter(([,v])=>v).map(([k])=>k.replace(/^has/,'').replace(/([A-Z])/g,' $1').trim());
  return <View style={styles.panel}><View style={styles.row}>
    {art?<Image source={art} style={styles.portrait}/>:<Text style={styles.fallback}>◉</Text>}
    <View style={{flex:1}}><Text style={styles.name}>{unitName(state,unit.id)}{readOnly?' · Enemy / read-only':''}</Text><Text style={styles.small}>{living.length}/{unit.models.length} models · {wounds} wounds · {unit.location??'BATTLEFIELD'}</Text><Text style={styles.small}>M {d.stats.movement}″ · T {d.stats.toughness} · SV {d.stats.save}+ · OC {d.stats.objectiveControl}</Text></View>
  </View>{expanded&&<><Text style={styles.small}>Ld {d.stats.leadership}+ · W/model {d.stats.wounds} · {statuses.join(' / ')||'Ready'}</Text>
    {attachment&&<Text style={styles.small}>Attached: {attachment.components.map(c=>state.definitions.find(d=>d.id===c.original.definitionId)?.name??c.original.definitionId).join(' + ')}</Text>}
    {chosenWeapons(state,unit).map(w=><Text key={w.id} style={styles.small}>{w.name} · {w.kind==='ranged'?`${w.range}″ BS`:'Melee WS'} {w.skill}+ · A {diceLabel(w.attacks)} · S {w.strength} · AP {w.armourPenetration} · D {diceLabel(w.damage)}</Text>)}
  </>}</View>;
}
const styles=StyleSheet.create({panel:{padding:10,gap:6,backgroundColor:'#101a25',borderWidth:1,borderColor:'#28394a',borderRadius:12},row:{flexDirection:'row',gap:10,alignItems:'center'},portrait:{width:44,height:44,borderRadius:22},fallback:{color:'#c7b484',fontSize:32},name:{fontSize:14,fontWeight:'700',color:'#e8eef6'},small:{color:'#90a0b4',fontSize:12}});
