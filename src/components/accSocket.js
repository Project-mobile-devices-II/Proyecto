import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { style_01 } from '../styles/style_01';
import { createWs } from '../../App';

const AccSocket = () => {

  const [screen, setScreen] = useState("loading");
  const [isConnecting, setIsConnecting] = useState(false);
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
    if (!wsRef.current) { console.log("❌ WS NULL"); return; }
    console.log("📡 WS STATE:", wsRef.current.readyState);
    if (wsRef.current.readyState !== 1) { console.log("❌ WS NO ABIERTO"); Alert.alert("Error", "Conexión cerrada"); return; }
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
        console.log("📩 RECIBIDO RAW:", e.data);
        try {
          const data = JSON.parse(e.data);
          console.log("📦 TIPO:", data.type || "SIN TYPE");

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
            console.log("👥 PLAYERS RECIBIDOS:", JSON.stringify(data.players));
            console.log("🔍 MI CID:", myClientIdRef.current);
            console.log("📊 FASE:", data.phase);

            setGameState(data);
            setWhiteDice(data.white_dice || []);

            const hasMe = data.players.some(p => p.client_id === myClientIdRef.current);
            console.log("✅ HASME:", hasMe);

            if (hasMe) {
              const nextScreen = data.phase === "lobby" ? "lobby" : "game";
              console.log("➡️ CAMBIANDO A PANTALLA:", nextScreen);
              setScreen(nextScreen);
            } else {
              console.log("❌ NO ME ENCONTRÉ EN LA LISTA DE JUGADORES");
            }
          }

        } catch (err) {
          console.log("❌ PARSE ERROR:", err);
        }
      };
    };

    connect();
  }, []);

  // ================= APP STATE (reconexión al volver al frente) =================
  useEffect(() => {
    const handleAppStateChange = (nextAppState) => {
      if (nextAppState === 'active') {
        console.log("📱 App volvió al frente");

        if (!wsRef.current || wsRef.current.readyState !== 1) {
          console.log("🔄 Reconectando WS...");
          setIsConnecting(true);
          setScreen("loading");
          setConnected(false);

          const ws = createWs();
          wsRef.current = ws;

          ws.onopen = () => {
            console.log("✅ WS RECONECTADO");
            setConnected(true);
            setIsConnecting(false);
            setScreen("home");
          };

          ws.onclose = (e) => {
            console.log("❌ WS CERRADO:", e.code, e.reason);
            setConnected(false);
          };

          ws.onerror = (err) => {
            console.log("💥 WS ERROR:", err.message);
          };

          ws.onmessage = wsRef.current?.onmessage;
        }
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, []);

  // ================= ROOM =================
  const createRoom = () => {
    if (isConnecting) return;
    console.log("🔥 CLICK CREATE ROOM");
    safeSend({ type: "CREATE_ROOM", client_id: myClientIdRef.current });
};

  const joinRoom = () => {
    if (isConnecting) return;
    console.log("🔥 CLICK JOIN ROOM");
    if (!inputRoom) return Alert.alert("Error", "Ingresa código");
    safeSend({ type: "JOIN_ROOM", room_id: inputRoom, client_id: myClientIdRef.current });
};

  // ================= NICK =================
  const sendNick = () => {
    console.log("🔥 CLICK ENTRAR");
    console.log("📋 CID:", myClientIdRef.current);
    console.log("📋 ROOM:", roomId);
    console.log("📋 NICK:", nick);
    if (!nick) return Alert.alert("Error", "Ingresa nombre");
    safeSend({ type: "JOIN", nick, client_id: myClientIdRef.current, room_id: roomId });
  };

  // ================= GAME =================
  const toggleReady = () => {
    safeSend({ type: "READY", room_id: roomId, client_id: myClientIdRef.current });
  };

  const leaveRoom = () => {
    Alert.alert(
      "Salir de la sala",
      "¿Seguro que quieres salir?",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Salir",
          style: "destructive",
          onPress: () => {
            safeSend({ type: "LEAVE_ROOM", room_id: roomId, client_id: myClientIdRef.current });
            setRoomId('');
            setNick('');
            setGameState({ phase: 'lobby', players: [] });
            setScreen("home");
          }
        }
      ]
    );
  };

  const selectPrediction = (p) => {
    setPrediction(p);
    safeSend({ type: "PREDICTION", value: p, room_id: roomId, client_id: myClientIdRef.current });
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
    safeSend({ type: "SUBMIT_DICE", dice, room_id: roomId, client_id: myClientIdRef.current });
    setSelectedDice([]);
  };

  // ================= UI =================

  if (!connected || screen === "loading") {
    return (
      <View style={style_01.container}>
        <ActivityIndicator size="large" color="#ff3333" />
      </View>
    );
  }

  // ================= HOME =================
  if (screen === "home") {
    return (
      <View style={style_01.container}>
        <Text style={style_01.title}>🎲 DADO TRIPLE</Text>

        <TouchableOpacity onPress={createRoom} style={style_01.button}>
          <Text style={style_01.buttonText}>CREAR SALA</Text>
        </TouchableOpacity>

        <TextInput
          placeholder="Código sala"
          placeholderTextColor="#aaa"
          value={inputRoom}
          onChangeText={setInputRoom}
          style={style_01.input}
        />

        <TouchableOpacity onPress={joinRoom} style={style_01.button}>
          <Text style={style_01.buttonText}>UNIRSE</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ================= NICK =================
  if (screen === "nick") {
    return (
      <View style={style_01.container}>

        <View style={style_01.header}>
          <TouchableOpacity onPress={leaveRoom} style={style_01.buttonLeave}>
            <Text style={style_01.backButtonText}>←</Text>
          </TouchableOpacity>
          <Text style={[style_01.title, { flex: 1 }]}>DADO TRIPLE</Text>
          <View style={style_01.headerSpacer} />
        </View>

        <View style={style_01.roomCodeBox}>
          <Text style={style_01.roomCodeLabel}>CÓDIGO DE SALA</Text>
          <Text style={style_01.roomCodeValue}>{roomId}</Text>
        </View>

        <TextInput
          placeholder="Tu nombre"
          placeholderTextColor="#aaa"
          value={nick}
          onChangeText={setNick}
          style={style_01.input}
        />

        <TouchableOpacity onPress={sendNick} style={style_01.button}>
          <Text style={style_01.buttonText}>ENTRAR</Text>
        </TouchableOpacity>

      </View>
    );
  }

  // ================= LOBBY =================
  if (screen === "lobby") {
    const me = gameState.players.find(p => p.client_id === myClientIdRef.current);
    const isReady = me?.ready || false;
    const isOwner = gameState.players[0]?.client_id === myClientIdRef.current;
    const allReady = gameState.players.length >= 4 && gameState.players.every(p => p.ready);

    return (
      <View style={style_01.container}>

        {/* HEADER */}
        <View style={style_01.header}>
          <TouchableOpacity onPress={() => setScreen("nick")} style={style_01.backButton}>
            <Text style={style_01.backButtonText}>←</Text>
          </TouchableOpacity>
          <Text style={[style_01.title, { flex: 1 }]}>DADO TRIPLE</Text>
          <View style={style_01.headerSpacer} />
        </View>

        <Text style={style_01.screenSubtitle}>Sala de espera</Text>

        {/* CÓDIGO DE SALA */}
        <View style={style_01.roomCodeBox}>
          <Text style={style_01.roomCodeLabel}>CÓDIGO DE SALA</Text>
          <Text style={style_01.roomCodeValue}>{roomId}</Text>
          <Text style={style_01.roomCodeHint}>Comparte este código con tus amigos</Text>
        </View>

        {/* CONTADOR Y SECCIÓN */}
        <Text style={style_01.playerCount}>{gameState.players.length} / 10 jugadores</Text>
        <Text style={style_01.sectionLabel}>JUGADORES</Text>

        {/* LISTA DE JUGADORES */}
        <ScrollView style={{ flex: 1 }}>
          {gameState.players.map((p, i) => {
            const isMe = p.client_id === myClientIdRef.current;
            const initial = p.nick ? p.nick[0].toUpperCase() : '?';

            return (
              <View key={i} style={isMe ? style_01.playerCardMe : style_01.playerCard}>

                <View style={style_01.playerRow}>
                  <View style={isMe ? style_01.playerAvatarMe : style_01.playerAvatar}>
                    <Text style={style_01.playerAvatarText}>{initial}</Text>
                  </View>
                  <View>
                    <Text style={style_01.playerText}>{p.nick}</Text>
                    {isMe && <Text style={style_01.playerTag}>TÚ</Text>}
                    {i === 0 && <Text style={style_01.ownerTag}>DUEÑO</Text>}
                  </View>
                </View>

                <View style={p.ready ? style_01.readyBadge : style_01.waitingBadge}>
                  <Text style={p.ready ? style_01.readyBadgeText : style_01.waitingBadgeText}>
                    {p.ready ? 'Listo' : 'Esperando'}
                  </Text>
                </View>

              </View>
            );
          })}
        </ScrollView>

        {/* MENSAJE DE ESTADO */}
        {gameState.players.length < 4 ? (
          <Text style={style_01.statusText}>
            Se necesitan al menos 4 jugadores ({gameState.players.length}/4)
          </Text>
        ) : allReady ? (
          <Text style={style_01.statusTextSuccess}>¡Todos listos!</Text>
        ) : (
          <Text style={style_01.statusText}>Esperando que todos estén listos...</Text>
        )}

        {/* BOTÓN LISTO */}
        <TouchableOpacity
          onPress={toggleReady}
          style={isReady ? style_01.buttonReady : style_01.button}
        >
          <Text style={style_01.buttonText}>
            {isReady ? 'YA NO ESTOY LISTO' : 'ESTOY LISTO'}
          </Text>
        </TouchableOpacity>

        {/* BOTÓN INICIAR — solo para el dueño */}
        {isOwner && (
          allReady ? (
            <TouchableOpacity
              onPress={() => safeSend({
                type: "START_GAME",
                room_id: roomId,
                client_id: myClientIdRef.current
              })}
              style={style_01.buttonStart}
            >
              <Text style={style_01.buttonStartText}>INICIAR PARTIDA</Text>
            </TouchableOpacity>
          ) : (
            <View style={style_01.buttonDisabled}>
              <Text style={style_01.buttonDisabledText}>
                {gameState.players.length < 4
                  ? `Faltan ${4 - gameState.players.length} jugador${4 - gameState.players.length === 1 ? '' : 'es'} más`
                  : 'Todos deben estar listos antes de iniciar'}
              </Text>
            </View>
          )
        )}

        {/* BOTÓN SALIR */}
        <TouchableOpacity onPress={leaveRoom} style={style_01.buttonLeave}>
          <Text style={style_01.buttonLeaveText}>SALIR DE LA SALA</Text>
        </TouchableOpacity>

      </View>
    );
  }

  // ================= GAME (placeholder) =================
  return (
    <ScrollView style={style_01.container}>
      <Text style={style_01.text}>Ronda {gameState.round}</Text>

      {['ZERO', 'MIN', 'MORE', 'MAX'].map(p => (
        <TouchableOpacity key={p} onPress={() => selectPrediction(p)}>
          <Text style={style_01.text}>{p}</Text>
        </TouchableOpacity>
      ))}

      {whiteDice.map((d, i) => (
        <TouchableOpacity key={i} onPress={() => toggleDie(i)}>
          <Text style={style_01.text}>{d}</Text>
        </TouchableOpacity>
      ))}

      <TouchableOpacity onPress={sendDice} style={style_01.sendButton}>
        <Text style={style_01.sendButtonText}>ENVIAR</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

export default AccSocket;