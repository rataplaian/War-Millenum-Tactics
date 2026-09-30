import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GameScreen } from './src/ui/GameScreen';
import { PlayScreen } from './src/ui/PlayScreen';
import { useState } from 'react';
import { Button, Text, View } from 'react-native';
export default function App() {
  const [screen,setScreen]=useState<'MENU'|'PLAY'|'DEBUG'>('MENU');
  return <SafeAreaProvider>{screen==='PLAY'?<PlayScreen onExit={()=>setScreen('MENU')}/>:
    screen==='DEBUG'?<GameScreen onExit={()=>setScreen('MENU')}/>:<View style={{flex:1,backgroundColor:'#111827',justifyContent:'center',padding:24,gap:20}}>
      <Text style={{color:'white',fontSize:28,fontWeight:'700'}}>WAR MILLENNIUM TACTICS</Text>
      <Button title="PLAY" onPress={()=>setScreen('PLAY')}/>
      <Button title="DEBUG BATTLE" onPress={()=>setScreen('DEBUG')}/>
    </View>}</SafeAreaProvider>;
}
