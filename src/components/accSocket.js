import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { style_01 } from '../styles/style_01';
import { createWs, WS_IP } from '../../App';
import AsyncStorage from '@react-native-async-storage/async-storage';

const AccSocket = () => {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(true);
  const [nick, setNick] = useState('');
  const [nickEntered, setNickEntered] = useState(false);
  const [log, setLog] = useState('Conectando al servidor...\n');

  const [prediction, setPrediction] = useState(null);
  const [whiteDice, setWhiteDice] = useState([1,2,3,4,5,6,1,2,3]);
  const [selectedDice, setSelectedDice] = useState([]);
  const [gameState, setGameState] = useState({ phase: 'lobby', round: 1, players: [] });
  const [myNick, setMyNick] = useState('');   // ← Esta es la clave
  const myClientIdRef = useRef(null);

  const wsRef = useRef(null);

  useEffect(() => {

  const initClientId = async () => {
    let storedId = await AsyncStorage.getItem('client_id');

    if (!storedId) {
      storedId = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
      await AsyncStorage.setItem('client_id', storedId);
      console.log("🆕 Nuevo client_id:", storedId);
    } else {
      console.log("♻️ Reutilizando client_id:", storedId);
    }

    myClientIdRef.current = storedId;

    // 🔥 AQUÍ recién creas conexión
    const currentWs = createWs();
    wsRef.current = currentWs;

    currentWs.onopen = () => {
      setConnected(true);
      setConnecting(false);
      setLog(prev => prev + '✅ Conectado al servidor\n');
    };

    currentWs.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);

        const players = Array.isArray(data.players) ? data.players : [];

        setGameState({
          ...data,
          players,
          phase: data.phase || 'lobby',
          round: typeof data.round === 'number' ? data.round : 1,
          white_dice: Array.isArray(data.white_dice) ? data.white_dice : [],
        });

        if (Array.isArray(data.white_dice)) {
          setWhiteDice(data.white_dice);
        }

        const myCid = myClientIdRef.current;
        const hasMe = players.some(p => p.client_id === myCid);

        if (hasMe) {
          setNickEntered(true);
        }

      } catch (err) {
        console.log("ERROR WS:", err);
      }
    };
  };

  initClientId();

}, []);

  const sendNick = () => {
  if (nick.trim() === '') {
    Alert.alert('Error', 'Ingresa tu nombre');
    return;
  }

  const clientId = myClientIdRef.current;

  wsRef.current.send(JSON.stringify({
    type: 'JOIN',
    nick: nick,
    client_id: clientId
  }));

  setMyNick(nick);

  // 🔥 MOSTRAR LOBBY INMEDIATO
  setNickEntered(true);

  setLog(prev => prev + `👤 Enviando JOIN: ${nick} (${clientId})\n`);
};

  const toggleReady = () => {
    wsRef.current.send(JSON.stringify({ type: 'READY' }));
    setLog(prev => prev + '✅ Marcado como LISTO\n');
  };

  const selectPrediction = (pred) => {
    setPrediction(pred);
    wsRef.current.send(JSON.stringify({ type: 'PREDICTION', value: pred }));
  };

  const toggleDie = (index) => {
    if (selectedDice.includes(index)) {
      setSelectedDice(selectedDice.filter(i => i !== index));
    } else if (selectedDice.length < 3) {
      setSelectedDice([...selectedDice, index]);
    } else {
      Alert.alert('Máximo 3 dados');
    }
  };

  const sendCombination = () => {
    if (selectedDice.length !== 3) {
      Alert.alert('Error', 'Selecciona exactamente 3 dados');
      return;
    }
    const chosenDice = selectedDice.map(i => whiteDice[i]);
    wsRef.current.send(JSON.stringify({ type: 'SUBMIT_DICE', dice: chosenDice }));
    setSelectedDice([]);
  };

  // ==================== PANTALLA DE CONEXIÓN ====================
  if (connecting || !connected) {
    return (
      <View style={style_01.container}>
        <Text style={style_01.title}>🎲 DADO TRIPLE</Text>
        <ActivityIndicator size="large" color="#ff3333" style={{ marginTop: 50 }} />
        <Text style={{ color: '#fff', marginTop: 20 }}>Conectando al servidor...</Text>
      </View>
    );
  }

  // ==================== PANTALLA DE NOMBRE ====================
  if (!nickEntered) {
    return (
      <View style={style_01.container}>
        <Text style={style_01.title}>🎲 DADO TRIPLE</Text>
        <Text style={{ color: '#fff', marginVertical: 30, fontSize: 20 }}>Ingresa tu nombre</Text>
        <TextInput
          style={{ backgroundColor: '#333', color: '#fff', padding: 18, borderRadius: 12, fontSize: 18, width: '90%', alignSelf: 'center' }}
          placeholder="Tu nombre de usuario"
          value={nick}
          onChangeText={setNick}
        />
        <TouchableOpacity 
          style={{ backgroundColor: '#ff3333', padding: 18, borderRadius: 12, marginTop: 30, width: '80%', alignSelf: 'center' }}
          onPress={sendNick}
        >
          <Text style={{ color: '#fff', textAlign: 'center', fontWeight: 'bold', fontSize: 18 }}>ENTRAR AL JUEGO</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ==================== PANTALLA LOBBY (CORREGIDA) ====================
  if (gameState.phase === 'lobby') {
    return (
      <View style={style_01.container}>
        <Text style={style_01.title}>🎲 LOBBY - DADO TRIPLE</Text>
        <Text style={{ color: '#fff', fontSize: 18, marginBottom: 15 }}>
          Jugadores conectados ({gameState.players.length})
        </Text>
        <Text style={{ color: '#aaa', fontSize: 12, marginBottom: 8 }}>
          DEBUG: {JSON.stringify(gameState.players)}
        </Text>
        
        <ScrollView style={{ flex: 1 }}>
          {gameState.players.map((p, index) => {
            return (
              <View key={index} style={{
                backgroundColor: '#222',
                padding: 15,
                marginBottom: 8,
                borderRadius: 10,
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderWidth: p.client_id === myClientIdRef.current ? 3 : 0,
                borderColor: '#ffff00'
              }}>
                <Text style={{ color: '#fff', fontSize: 18 }}>
                  {p.nick}
                </Text>
                {p.ready && <Text style={{ color: '#0f0', fontWeight: 'bold' }}>✅ LISTO</Text>}
              </View>
            );
          })}
        </ScrollView>

        <TouchableOpacity 
          style={{ backgroundColor: '#00cc00', padding: 18, borderRadius: 12, marginTop: 20 }}
          onPress={toggleReady}
        >
          <Text style={{ color: '#000', textAlign: 'center', fontWeight: 'bold', fontSize: 20 }}>ESTOY LISTO</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ==================== PANTALLA DEL JUEGO ====================
  return (
    <ScrollView style={style_01.container}>
      <Text style={style_01.title}>🎲 DADO TRIPLE</Text>
      <Text style={style_01.subtitle}>Fase: {gameState.phase.toUpperCase()} • Ronda {gameState.round}</Text>

      <Text style={{color:'#fff', fontSize:18, marginTop:15}}>Elige tu predicción:</Text>
      <View style={style_01.predictionContainer}>
        {['ZERO', 'MIN', 'MORE', 'MAX'].map((pred) => (
          <TouchableOpacity
            key={pred}
            style={[
              style_01.predictionButton,
              pred === 'ZERO' && style_01.zero,
              pred === 'MIN' && style_01.min,
              pred === 'MORE' && style_01.more,
              pred === 'MAX' && style_01.max,
              prediction === pred && style_01.selected
            ]}
            onPress={() => selectPrediction(pred)}
          >
            <Text style={{ color: '#fff', fontWeight: 'bold' }}>{pred}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={style_01.diceContainer}>
        <Text style={{ color: '#fff', fontSize: 18, marginBottom: 12 }}>Dados Blancos</Text>
        <View style={style_01.diceRow}>
          {whiteDice.map((value, index) => (
            <TouchableOpacity
              key={index}
              style={[
                style_01.die,
                selectedDice.includes(index) && { borderColor: '#ffff00', backgroundColor: '#ffee00' }
              ]}
              onPress={() => toggleDie(index)}
            >
              <Text style={style_01.dieText}>{value}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <TouchableOpacity style={style_01.sendButton} onPress={sendCombination}>
        <Text style={{ color: '#fff', fontSize: 19, fontWeight: 'bold', textAlign: 'center' }}>
          ENVIAR COMBINACIÓN ({selectedDice.length}/3)
        </Text>
      </TouchableOpacity>

      <View style={style_01.logContainer}>
        <ScrollView>
          <Text style={style_01.logText}>{log}</Text>
        </ScrollView>
      </View>
    </ScrollView>
  );
};

export default AccSocket;