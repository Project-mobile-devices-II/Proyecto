import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { style_01 } from '../styles/style_01';
import { createWs } from '../../App';

const AccSocket = () => {

  const [screen, setScreen] = useState("loading");
  const [connected, setConnected] = useState(false);
  const [roomId, setRoomId] = useState('');
  const [inputRoom, setInputRoom] = useState('');
  const [nick, setNick] = useState('');
  const [gameState, setGameState] = useState({ phase: 'lobby', players: [] });

  const [whiteDice, setWhiteDice] = useState([]);
  const [selectedDice, setSelectedDice] = useState([]);
  const [prediction, setPrediction] = useState(null);

  const myClientIdRef = useRef(null);
  const wsRef = useRef(null);

  // ================= SAFE SEND =================
  const safeSend = (data) => {
    console.log("📤 INTENTANDO ENVIAR:", data);

    if (!wsRef.current) {
      console.log("❌ WS NULL");
      return;
    }

    console.log("📡 WS STATE:", wsRef.current.readyState);

    if (wsRef.current.readyState !== 1) {
      console.log("❌ WS NO ABIERTO");
      Alert.alert("Error", "Conexión cerrada");
      return;
    }

    wsRef.current.send(JSON.stringify(data));
  };

  // ================= INIT =================
  useEffect(() => {

    const connect = async () => {

      let cid = await AsyncStorage.getItem('client_id');

      if (!cid) {
        cid = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
        await AsyncStorage.setItem('client_id', cid);
        console.log("🆕 NUEVO CID:", cid);
      } else {
        console.log("♻️ CID EXISTENTE:", cid);
      }

      myClientIdRef.current = cid;

      const ws = createWs();
      wsRef.current = ws;

      console.log("🔌 Intentando conectar WS...");

      ws.onopen = () => {
        console.log("✅ WS CONECTADO");
        setConnected(true);
        setScreen("home");
      };

      ws.onclose = (e) => {
        console.log("❌ WS CERRADO:", e.code, e.reason);
        setConnected(false);
      };

      ws.onerror = (err) => {
        console.log("💥 WS ERROR:", err.message);
      };

      ws.onmessage = (e) => {
        console.log("📩 RECIBIDO:", e.data);

        try {
          const data = JSON.parse(e.data);

          if (data.type === "ROOM_CREATED") {
            console.log("🏠 ROOM CREATED:", data.room_id);
            setRoomId(data.room_id);
            setScreen("nick");
            return;
          }

          if (data.type === "ROOM_JOINED") {
            console.log("🚪 ROOM JOINED:", data.room_id);
            setRoomId(data.room_id);
            setScreen("nick");
            return;
          }

          if (data.type === "ERROR") {
            console.log("⚠️ ERROR SERVER:", data.message);
            Alert.alert("Error", data.message);
            return;
          }

          if (data.players) {
            console.log("👥 GAME STATE:", data.players.length);

            setGameState(data);
            setWhiteDice(data.white_dice || []);

            const hasMe = data.players.some(p => p.client_id === myClientIdRef.current);

            if (hasMe) {
              setScreen(data.phase === "lobby" ? "lobby" : "game");
            }
          }

        } catch (err) {
          console.log("❌ PARSE ERROR:", err);
        }
      };
    };

    connect();

  }, []);

  // ================= ROOM =================

  const createRoom = () => {
    console.log("🔥 CLICK CREATE ROOM");

    safeSend({
      type: "CREATE_ROOM",
      client_id: myClientIdRef.current
    });
  };

  const joinRoom = () => {
    console.log("🔥 CLICK JOIN ROOM");

    if (!inputRoom) return Alert.alert("Error", "Ingresa código");

    safeSend({
      type: "JOIN_ROOM",
      room_id: inputRoom,
      client_id: myClientIdRef.current
    });
  };

  // ================= NICK =================

  const sendNick = () => {
    console.log("🔥 CLICK JOIN GAME");

    if (!nick) return Alert.alert("Error", "Ingresa nombre");

    safeSend({
      type: "JOIN",
      nick,
      client_id: myClientIdRef.current,
      room_id: roomId
    });
  };

  // ================= GAME =================

  const toggleReady = () => {
    safeSend({
      type: "READY",
      room_id: roomId,
      client_id: myClientIdRef.current
    });
  };

  const selectPrediction = (p) => {
    setPrediction(p);

    safeSend({
      type: "PREDICTION",
      value: p,
      room_id: roomId,
      client_id: myClientIdRef.current
    });
  };

  const toggleDie = (i) => {
    if (selectedDice.includes(i)) {
      setSelectedDice(selectedDice.filter(x => x !== i));
    } else if (selectedDice.length < 3) {
      setSelectedDice([...selectedDice, i]);
    }
  };

  const sendDice = () => {
    if (selectedDice.length !== 3) return Alert.alert("Selecciona 3");

    const dice = selectedDice.map(i => whiteDice[i]);

    safeSend({
      type: "SUBMIT_DICE",
      dice,
      room_id: roomId,
      client_id: myClientIdRef.current
    });

    setSelectedDice([]);
  };

  // ================= UI =================

  if (!connected || screen === "loading") {
    return (
      <View style={style_01.container}>
        <ActivityIndicator size="large" color="#ff3333"/>
      </View>
    );
  }

  if (screen === "home") {
    return (
      <View style={style_01.container}>
        <Text style={style_01.title}>🎲 DADO TRIPLE</Text>

        <TouchableOpacity onPress={createRoom} style={style_01.button}>
          <Text style={{color:'#fff'}}>CREAR SALA</Text>
        </TouchableOpacity>

        <TextInput
          placeholder="Código sala"
          placeholderTextColor="#aaa"
          value={inputRoom}
          onChangeText={setInputRoom}
          style={style_01.input}
        />

        <TouchableOpacity onPress={joinRoom} style={style_01.button}>
          <Text style={{color:'#fff'}}>UNIRSE</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (screen === "nick") {
    return (
      <View style={style_01.container}>
        <Text style={{color:'#fff'}}>Sala: {roomId}</Text>

        <TextInput
          placeholder="Tu nombre"
          placeholderTextColor="#aaa"
          value={nick}
          onChangeText={setNick}
          style={style_01.input}
        />

        <TouchableOpacity onPress={sendNick} style={style_01.button}>
          <Text style={{color:'#fff'}}>ENTRAR</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (screen === "lobby") {
    return (
      <View style={style_01.container}>
        <Text style={{color:'#fff'}}>Sala: {roomId}</Text>

        <ScrollView>
          {gameState.players.map((p, i) => (
            <Text key={i} style={{color:'#fff'}}>
              {p.nick} {p.ready ? "✅" : ""}
            </Text>
          ))}
        </ScrollView>

        <TouchableOpacity onPress={toggleReady} style={style_01.button}>
          <Text style={{color:'#fff'}}>LISTO</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={style_01.container}>
      <Text style={{color:'#fff'}}>Ronda {gameState.round}</Text>

      {['ZERO','MIN','MORE','MAX'].map(p => (
        <TouchableOpacity key={p} onPress={() => selectPrediction(p)}>
          <Text style={{color:'#fff'}}>{p}</Text>
        </TouchableOpacity>
      ))}

      {whiteDice.map((d,i) => (
        <TouchableOpacity key={i} onPress={() => toggleDie(i)}>
          <Text style={{color:'#fff'}}>{d}</Text>
        </TouchableOpacity>
      ))}

      <TouchableOpacity onPress={sendDice}>
        <Text style={{color:'#fff'}}>ENVIAR</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

export default AccSocket;