import { Text, View } from 'react-native';
import type { LegalAction } from '../game/actions/LegalActions';
import type { GameState } from '../game/models';
import { weaponProfile,diceLabel } from './combatPresentation';
import { actionDetail,commandName } from './playCommands';
export function AttackCard({state,action}:{state:GameState;action:LegalAction}) {
  const w='weaponId' in action?weaponProfile(state,action.weaponId):undefined;
  return <View style={{gap:6}}><Text style={{color:'#e8eef6',fontWeight:'700'}}>{commandName(action)} · {actionDetail(action,state)}</Text>
    {w&&<Text style={{color:'#90a0b4',fontSize:12}}>Profile: {w.kind==='ranged'?'BS':'WS'} {w.skill}+ · A {diceLabel(w.attacks)} · S {w.strength} · AP {w.armourPenetration} · D {diceLabel(w.damage)}. Modifiers and dice are resolved by the engine.</Text>}
    {(action.kind==='SELECT_SHOOTING_TARGET'||action.kind==='SELECT_MELEE_TARGET')&&<Text style={{color:'#f5b63d',fontSize:12}}>Confirm target → resolve any reactions → confirm attacks.</Text>}
  </View>;
}
