import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator, AppState, BackHandler, Modal } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Sound from 'react-native-sound';
Sound.setCategory('Playback');
import { style_01 } from '../styles/style_01';
import { createWs } from '../../App';

const REGLAS = [
  "🎲 Cada jugador recibe 9 dados blancos, 1 rojo y 1 azul.",
  "👁️ Los dados blancos son visibles para todos. Los dados de color solo para ti.",
  "🎯 Selecciona 3 dados para presentar tu combinación. Puedes usar dados ocultos.",
  "🔴🔵 Los dados ocultos solo se revelan cuando todos presentaron.",
  "🏆 Triple > Escalera > Doble > Sencillo.",
  "📈 Puntos: 1° = 6pts, 2° = 3pts, 3° = 1pt, 4° = 0pts.",
  "🤝 Empate: se suman los puntos de las posiciones y se dividen.",
  "🔮 Predice tu puntaje: ZERO / MIN(1-6) / MORE(7-10) / MAX(+10).",
  "✅ Predicción correcta = doble de puntos. ZERO correcto = +40pts.",
  "🔄 3 presentaciones por ronda. 4 rondas en total.",
  "⏱️ Tienes 10 segundos por turno.",
];

// ── FIX PARPADEO: componentes fuera del render principal ──
const RulesModal = memo(({ visible, onClose }) => (
  <Modal visible={visible} transparent animationType="fade">
    <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', padding: 20 }}>
      <View style={{ backgroundColor: '#1a1a1a', borderRadius: 12, padding: 20, borderColor: '#ff3333', borderWidth: 1 }}>
        <Text style={{ color: '#ff3333', fontSize: 18, fontWeight: 'bold', marginBottom: 16, textAlign: 'center' }}>📋 REGLAS</Text>
        <ScrollView style={{ maxHeight: 400 }}>
          {REGLAS.map((r, i) => (
            <Text key={i} style={{ color: '#fff', fontSize: 13, marginBottom: 8, lineHeight: 20 }}>{r}</Text>
          ))}
        </ScrollView>
        <TouchableOpacity onPress={onClose} style={{ backgroundColor: '#ff3333', borderRadius: 8, padding: 12, marginTop: 12 }}>
          <Text style={{ color: '#fff', fontWeight: 'bold', textAlign: 'center' }}>CERRAR</Text>
        </TouchableOpacity>
      </View>
    </View>
  </Modal>
));

const RulesButton = memo(({ onPress }) => (
  <TouchableOpacity
    onPress={onPress}
    style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#ff3333', justifyContent: 'center', alignItems: 'center' }}
  >
    <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 16 }}>?</Text>
  </TouchableOpacity>
));

const CountdownDisplay = memo(({ countdown }) => (
  <View style={{ alignItems: 'center', marginVertical: 8 }}>
    <Text style={{ fontSize: 36, fontWeight: 'bold', color: countdown <= 5 ? '#ff3333' : '#ffffff' }}>
      {countdown}
    </Text>
  </View>
));

const TurnDisplay = memo(({ myTurn, nickTurn }) => (
  <View style={{ backgroundColor: myTurn ? '#ff3333' : '#222', borderRadius: 8, padding: 10, marginVertical: 8, alignItems: 'center' }}>
    <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 15 }}>
      {myTurn ? '⭐ Es tu turno' : `⏳ ${nickTurn} está jugando...`}
    </Text>
  </View>
));

const AccSocket = () => {

  const menuMusicRef = useRef(null);
  const gameMusicRef = useRef(null);
  const currentTrackRef = useRef(null);
  const [screen, setScreen] = useState("loading");
  const [isConnecting, setIsConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [roomId, setRoomId] = useState('');
  const [inputRoom, setInputRoom] = useState('');
  const [nick, setNick] = useState('');
  // ── FIX 4: pendingAction guarda si el usuario quiere crear o unirse ──
  const [pendingAction, setPendingAction] = useState(null); // 'create' | 'join'
  const [gameState, setGameState] = useState({
    phase: 'lobby',
    players: [],
    round: 1,
    presentation_order: [],
    current_presentation: 0,
    round_scores: {},
    current_turn: '',
    timer_id: 0,
  });
  const [countdown, setCountdown] = useState(10);
  const [showRules, setShowRules] = useState(false);
  const [selectedDice, setSelectedDice] = useState([]);
  const [useRed, setUseRed] = useState(false);
  const [useBlue, setUseBlue] = useState(false);

  const myClientIdRef = useRef(null);
  const wsRef = useRef(null);
  const countdownRef = useRef(null);
  const lastTimerIdRef = useRef(0);
  const gameStateRef = useRef(gameState);
  const roomIdRef = useRef(roomId);

  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);
  useEffect(() => { roomIdRef.current = roomId; }, [roomId]);

  // ================= COUNTDOWN =================
  const startCountdown = useCallback((seconds = 10) => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    setCountdown(seconds);
    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(countdownRef.current);
          handleCountdownEnd();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const stopCountdown = () => {
    if (countdownRef.current) clearInterval(countdownRef.current);
  };

  const handleCountdownEnd = () => {
    const state = gameStateRef.current;
    const myId = myClientIdRef.current;
    const rid = roomIdRef.current;
    if (!myId || !rid) return;
    if (state.current_turn !== myId) return;

    if (state.phase === "rolling") {
      const me = state.players.find(p => p.client_id === myId);
      if (me && me.white_dice.length === 0) {
        safeSendDirect({ type: "ROLL_DICE", room_id: rid, client_id: myId });
      }
    }
    if (state.phase === "presenting") {
      const me = state.players.find(p => p.client_id === myId);
      if (me && !me.submitted_combination) {
        const available = me.remaining_dice;
        if (available.length >= 3) {
          safeSendDirect({
            type: "SUBMIT_COMBINATION",
            dice: [available[0], available[1], available[2]],
            use_red: false,
            use_blue: false,
            room_id: rid,
            client_id: myId
          });
        }
      }
    }
  };

  const safeSendDirect = (data) => {
    if (!wsRef.current || wsRef.current.readyState !== 1) return;
    wsRef.current.send(JSON.stringify(data));
  };

  const safeSend = (data) => {
    if (!wsRef.current || wsRef.current.readyState !== 1) {
      Alert.alert("Error", "Conexión cerrada");
      return;
    }
    wsRef.current.send(JSON.stringify(data));
  };

  // ================= CONECTAR WS =================
  const connectWs = async () => {
    let cid = await AsyncStorage.getItem('client_id');
    if (!cid) {
      cid = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
      await AsyncStorage.setItem('client_id', cid);
    }
    myClientIdRef.current = cid;

    // ── FIX 1: cargar nick guardado ──
    const savedNick = await AsyncStorage.getItem('player_nick');
    if (savedNick) setNick(savedNick);

    const ws = createWs();
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setIsConnecting(false);
      setScreen("home");
    };

    ws.onclose = () => { setConnected(false); };
    ws.onerror = (err) => { console.log("💥 WS ERROR:", err.message); };

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);

        if (data.type === "ROOM_CREATED") {
          const savedRoomId = data.room_id;
          setRoomId(savedRoomId);
          // mandar JOIN automáticamente con el nick ya escrito
          if (pendingNickRef.current) {
            safeSendDirect({
              type: "JOIN",
              nick: pendingNickRef.current,
              client_id: myClientIdRef.current,
              room_id: savedRoomId
            });
            pendingNickRef.current = '';
          }
          setPendingAction(null);
          return;
        }

        if (data.type === "ROOM_JOINED") {
          setRoomId(data.room_id);
          setScreen("nick");
          return;
        }

        if (data.type === "ERROR") { Alert.alert("Error", data.message); return; }

        if (data.players) {
          const newPhase = data.phase;
          const newTurn = data.current_turn;
          const newTimerId = data.timer_id ?? 0;

          setGameState(prev => {
            if (newTimerId < lastTimerIdRef.current) return prev;
            lastTimerIdRef.current = newTimerId;

            const phaseChanged = prev.phase !== newPhase;
            const turnChanged = prev.current_turn !== newTurn;

            if (phaseChanged || turnChanged) {
              setSelectedDice([]);
              setUseRed(false);
              setUseBlue(false);
              if ((newPhase === "rolling" || newPhase === "presenting") && newTurn === myClientIdRef.current) {
                startCountdown(10);
              } else {
                stopCountdown();
              }
            }
            return data;
          });

          const hasMe = data.players.some(p => p.client_id === myClientIdRef.current);
          if (hasMe) {
            if (newPhase === "lobby") setScreen("lobby");
            else if (["rolling", "prediction", "presenting", "round_end"].includes(newPhase)) setScreen("game");
            else if (newPhase === "game_over") setScreen("game_over");
          }
        }

      } catch (err) { console.log("❌ PARSE ERROR:", err); }
    };
  };

  useEffect(() => { connectWs(); return () => stopCountdown(); }, []);


  // Soundtracks management for the game

  const screenMusicMap = {
    loading: 'menu_music.mp3',
    home: 'menu_music.mp3',
    nick: 'menu_music.mp3',
    lobby: 'menu_music.mp3',
    game: 'game_music.mp3',
  };

  const stopAll = () => {
    if (menuMusicRef.current) {
      menuMusicRef.current.stop();
      menuMusicRef.current.release();
      menuMusicRef.current = null;
    }
    if (gameMusicRef.current) {
      gameMusicRef.current.stop();
      gameMusicRef.current.release();
      gameMusicRef.current = null;
    }
    currentTrackRef.current = null;
  };

  const playMusic = (file) => {
    //Checks if current music equals music to play
    if (currentTrackRef.current === file) {
      return;
    }

    // In case of overlapping, stops everything first
    stopAll();

    const sound = new Sound (file, Sound.MAIN_BUNDLE, (error) => {
      if (error){
        console.log("ERROR: Cannot play music -> ", error);
        return;
      }
      // Plays music indefinetly so people can get tired of balatro and minecraft
      sound.setNumberOfLoops(-1);
      sound.play();
    });

    if (file === "menu_music.mp3"){
      menuMusicRef.current = sound;
    }else if (file === "game_music.mp3"){
      gameMusicRef.current = sound;
    }
    currentTrackRef.current = file;

  };

  useEffect (() => {
    const track = screenMusicMap[screen]
    if (track){
      playMusic(track);
    }else{
      stopAll();
    }

  }, [screen]);

  // End of sound management

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active' && (!wsRef.current || wsRef.current.readyState !== 1)) {
        setIsConnecting(true);
        connectWs();
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background' || next === 'inactive') {
        stopCountdown();
        if (wsRef.current) {
          wsRef.current.onclose = null;
          wsRef.current.onerror = null;
          wsRef.current.onmessage = null;
          wsRef.current.close();
          wsRef.current = null;
        }
        setConnected(false);
        setRoomId('');
        setScreen("home");
        setSelectedDice([]);
        setUseRed(false);
        setUseBlue(false);
        setPendingAction(null);
        lastTimerIdRef.current = 0;
        setGameState({ phase: 'lobby', players: [], round: 1, presentation_order: [], current_presentation: 0, round_scores: {}, current_turn: '', timer_id: 0 });
      }
    });
    return () => sub.remove();
  }, []);

  // ================= BACK HANDLER =================
  const leaveRoom = useCallback(() => {
    Alert.alert("Salir de la sala", "¿Seguro que quieres salir?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Salir", style: "destructive",
        onPress: () => {
          if (roomId) safeSend({ type: "LEAVE_ROOM", room_id: roomId, client_id: myClientIdRef.current });
          setRoomId('');
          setSelectedDice([]); setUseRed(false); setUseBlue(false);
          setPendingAction(null);
          lastTimerIdRef.current = 0;
          setGameState({ phase: 'lobby', players: [], round: 1, presentation_order: [], current_presentation: 0, round_scores: {}, current_turn: '', timer_id: 0 });
          setScreen("home");
        }
      }
    ]);
  }, [roomId]);

  useEffect(() => {
    const backAction = () => {
      if (screen === "nick" || screen === "lobby") { leaveRoom(); return true; }
      if (screen === "game" || screen === "game_over") return true;
      return false;
    };
    const bh = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => bh.remove();
  }, [screen, leaveRoom]);

  // ================= HELPERS =================
  const getMe = () => gameState.players.find(p => p.client_id === myClientIdRef.current);
  const isMyTurn = () => gameState.current_turn === myClientIdRef.current;
  const getCurrentTurnNick = () => gameState.players.find(p => p.client_id === gameState.current_turn)?.nick || '';

  // ================= ACCIONES =================

  // ── FIX 4: crear sala solo guarda la intención, no manda nada al server aún ──
  const createRoom = () => {
    if (!isConnecting) {
      setPendingAction('create');
      setScreen("nick");
    }
  };

  const joinRoom = () => {
    if (!isConnecting) {
      if (!inputRoom) return Alert.alert("Error", "Ingresa código");
      setPendingAction('join');
      safeSend({ type: "JOIN_ROOM", room_id: inputRoom.toUpperCase(), client_id: myClientIdRef.current });
    }
  };

  // ── FIX 1+4: al presionar Entrar, guarda el nick y ejecuta la acción pendiente ──
  const sendNick = async () => {
    if (!nick.trim()) return Alert.alert("Error", "Ingresa nombre");

    // guardar nick localmente
    await AsyncStorage.setItem('player_nick', nick.trim());

    if (pendingAction === 'create') {
      // FIX 4: ahora sí crear la sala con el nick ya listo
      safeSend({ type: "CREATE_ROOM", client_id: myClientIdRef.current });
      // cuando llegue ROOM_CREATED, mandamos JOIN automáticamente
      // guardamos nick en ref para usarlo en onmessage
      pendingNickRef.current = nick.trim();
    } else {
      // unirse a sala existente
      safeSend({ type: "JOIN", nick: nick.trim(), client_id: myClientIdRef.current, room_id: roomId });
      setPendingAction(null);
    }
  };

  const pendingNickRef = useRef('');

  // ── FIX 4: cuando llega ROOM_CREATED con pendingNick, mandar JOIN automático ──
  // modificamos el onmessage para manejar esto
  // (esto se hace dentro del connectWs, ver abajo el bloque ROOM_CREATED actualizado)

  const toggleReady = () => safeSend({ type: "READY", room_id: roomId, client_id: myClientIdRef.current });
  const rollDice = () => safeSend({ type: "ROLL_DICE", room_id: roomId, client_id: myClientIdRef.current });
  const submitPrediction = (p) => safeSend({ type: "SUBMIT_PREDICTION", prediction: p, room_id: roomId, client_id: myClientIdRef.current });
  const returnToLobby = () => safeSend({ type: "RETURN_TO_LOBBY", room_id: roomId, client_id: myClientIdRef.current });

  const toggleDie = (index) => {
    setSelectedDice(prev => {
      if (prev.includes(index)) return prev.filter(i => i !== index);
      if (prev.length >= 3) return prev;
      return [...prev, index];
    });
  };

  const totalSelected = () => selectedDice.length + (useRed ? 1 : 0) + (useBlue ? 1 : 0);

  const confirmCombination = () => {
    const me = getMe();
    if (!me) return;
    if (totalSelected() !== 3) return Alert.alert("Error", "Selecciona exactamente 3 dados en total");
    const dice = selectedDice.map(i => me.remaining_dice[i]);
    if (useRed) dice.push(me.red_die);
    if (useBlue) dice.push(me.blue_die);
    if (dice.length !== 3) return Alert.alert("Error", "Selecciona exactamente 3 dados");
    safeSend({ type: "SUBMIT_COMBINATION", dice, use_red: useRed, use_blue: useBlue, room_id: roomId, client_id: myClientIdRef.current });
    setSelectedDice([]);
    setUseRed(false);
    setUseBlue(false);
  };

  // ================= UI =================
  if (!connected || screen === "loading") {
    return <View style={style_01.container}><ActivityIndicator size="large" color="#ff3333" /></View>;
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
          onChangeText={t => setInputRoom(t.toUpperCase())}
          style={style_01.input}
          autoCapitalize="characters"
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
        <Text style={{ color: '#aaa', textAlign: 'center', marginBottom: 8 }}>
          {pendingAction === 'create' ? 'Ingresa tu nombre para crear la sala' : 'Ingresa tu nombre para unirte'}
        </Text>
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
    const me = getMe();
    const isReady = me?.ready || false;
    const isOwner = gameState.players[0]?.client_id === myClientIdRef.current;
    const allReady = gameState.players.length >= 4 && gameState.players.every(p => p.ready);

    return (
      <View style={style_01.container}>
        <RulesModal visible={showRules} onClose={() => setShowRules(false)} />
        <View style={style_01.header}>
          <TouchableOpacity onPress={leaveRoom} style={style_01.backButton}>
            <Text style={style_01.backButtonText}>←</Text>
          </TouchableOpacity>
          <Text style={[style_01.title, { flex: 1 }]}>DADO TRIPLE</Text>
          <RulesButton onPress={() => setShowRules(true)} />
        </View>

        <Text style={style_01.screenSubtitle}>Sala de espera</Text>
        <View style={style_01.roomCodeBox}>
          <Text style={style_01.roomCodeLabel}>CÓDIGO DE SALA</Text>
          <Text style={style_01.roomCodeValue}>{roomId}</Text>
          <Text style={style_01.roomCodeHint}>Comparte este código con tus amigos</Text>
        </View>

        <Text style={style_01.playerCount}>{gameState.players.length} / 10 jugadores</Text>
        <Text style={style_01.sectionLabel}>JUGADORES</Text>

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

        {gameState.players.length < 4
          ? <Text style={style_01.statusText}>Se necesitan al menos 4 jugadores ({gameState.players.length}/4)</Text>
          : allReady ? <Text style={style_01.statusTextSuccess}>¡Todos listos!</Text>
          : <Text style={style_01.statusText}>Esperando que todos estén listos...</Text>
        }

        <TouchableOpacity onPress={toggleReady} style={isReady ? style_01.buttonReady : style_01.button}>
          <Text style={style_01.buttonText}>{isReady ? 'YA NO ESTOY LISTO' : 'ESTOY LISTO'}</Text>
        </TouchableOpacity>

        {isOwner && (allReady ? (
          <TouchableOpacity onPress={() => safeSend({ type: "START_GAME", room_id: roomId, client_id: myClientIdRef.current })} style={style_01.buttonStart}>
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
        ))}

        <TouchableOpacity onPress={leaveRoom} style={style_01.buttonLeave}>
          <Text style={style_01.buttonLeaveText}>SALIR DE LA SALA</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ================= GAME =================
  if (screen === "game") {
    const me = getMe();
    const phase = gameState.phase;
    const myTurn = isMyTurn();
    const predictedCount = gameState.players.filter(p => p.prediction_submitted).length;
    const totalPlayers = gameState.players.length;

    return (
      <ScrollView style={style_01.container}>
        <RulesModal visible={showRules} onClose={() => setShowRules(false)} />

        <View style={style_01.header}>
          <Text style={[style_01.title, { flex: 1 }]}>🎲 DADO TRIPLE</Text>
          <RulesButton onPress={() => setShowRules(true)} />
        </View>

        <Text style={style_01.screenSubtitle}>Ronda {gameState.round} • {phase.toUpperCase()}</Text>

        {/* ===== ROLLING ===== */}
        {phase === "rolling" && (
          <View style={style_01.diceContainer}>
            <TurnDisplay myTurn={myTurn} nickTurn={getCurrentTurnNick()} />
            {myTurn && <CountdownDisplay countdown={countdown} />}

            {myTurn ? (
              me?.white_dice?.length > 0 ? (
                <>
                  <Text style={style_01.sectionLabel}>TUS DADOS</Text>
                  <View style={style_01.diceRow}>
                    {me.white_dice.map((d, i) => (
                      <View key={i} style={style_01.die}>
                        <Text style={style_01.dieText}>{d}</Text>
                      </View>
                    ))}
                  </View>
                  <Text style={{ color: '#aaa', fontSize: 12, textAlign: 'center', marginTop: 4 }}>
                    🔴 Rojo: oculto • 🔵 Azul: oculto
                  </Text>
                </>
              ) : (
                <>
                  <Text style={style_01.sectionLabel}>LANZA TUS DADOS</Text>
                  <TouchableOpacity onPress={rollDice} style={style_01.button}>
                    <Text style={style_01.buttonText}>🎲 LANZAR DADOS</Text>
                  </TouchableOpacity>
                </>
              )
            ) : (
              <Text style={style_01.statusText}>Esperando que los demás lancen...</Text>
            )}

            <Text style={[style_01.sectionLabel, { marginTop: 16 }]}>DADOS DE TODOS</Text>
            {gameState.players.map((p, i) => p.white_dice?.length > 0 && (
              <View key={i} style={{ marginBottom: 8 }}>
                <Text style={{ color: '#aaa', fontSize: 12 }}>{p.nick}:</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                  {p.white_dice.map((d, j) => (
                    <View key={j} style={[style_01.die, { width: 28, height: 28, margin: 2 }]}>
                      <Text style={[style_01.dieText, { fontSize: 12 }]}>{d}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </View>
        )}

        {/* ===== PREDICTION ===== */}
        {phase === "prediction" && (
          <View>
            <Text style={style_01.sectionLabel}>ELIGE TU PREDICCIÓN</Text>
            <Text style={{ color: '#aaa', fontSize: 13, marginBottom: 12, textAlign: 'center' }}>
              {predictedCount}/{totalPlayers} jugadores enviaron predicción
            </Text>
            {me?.prediction_submitted ? (
              <Text style={style_01.statusTextSuccess}>✅ Predicción enviada: {me.prediction}</Text>
            ) : (
              <View style={style_01.predictionContainer}>
                {[
                  { key: 'ZERO', label: 'ZERO', desc: '0 puntos' },
                  { key: 'MIN', label: 'MIN', desc: '1-6 pts' },
                  { key: 'MORE', label: 'MORE', desc: '7-10 pts' },
                  { key: 'MAX', label: 'MAX', desc: '+10 pts' },
                ].map(p => (
                  <TouchableOpacity key={p.key} onPress={() => submitPrediction(p.key)}
                    style={[style_01.predictionButton, style_01[p.key.toLowerCase()]]}
                  >
                    <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 16 }}>{p.label}</Text>
                    <Text style={{ color: '#ddd', fontSize: 11, marginTop: 2 }}>{p.desc}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        )}

        {/* ===== PRESENTING ===== */}
        {phase === "presenting" && (
          <View style={style_01.diceContainer}>
            <Text style={style_01.sectionLabel}>PRESENTACIÓN {gameState.current_presentation + 1} DE 3</Text>
            <TurnDisplay myTurn={myTurn} nickTurn={getCurrentTurnNick()} />
            {myTurn && !me?.submitted_combination && <CountdownDisplay countdown={countdown} />}

            {myTurn ? (
              me?.submitted_combination ? (
                <Text style={style_01.statusTextSuccess}>✅ Combinación enviada — esperando a los demás</Text>
              ) : (
                <>
                  <Text style={{ color: '#aaa', marginBottom: 8 }}>Seleccionados: {totalSelected()}/3</Text>

                  <Text style={style_01.sectionLabel}>DADOS BLANCOS</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12 }}>
                    {me?.remaining_dice?.map((d, i) => {
                      const selected = selectedDice.includes(i);
                      return (
                        <TouchableOpacity key={i} onPress={() => toggleDie(i)}
                          style={{
                            width: 48, height: 48, margin: 4, borderRadius: 8,
                            backgroundColor: selected ? '#ff3333' : '#333',
                            borderWidth: selected ? 2 : 1,
                            borderColor: selected ? '#ff6666' : '#555',
                            justifyContent: 'center', alignItems: 'center',
                          }}
                        >
                          <Text style={{ color: '#fff', fontSize: 20, fontWeight: 'bold' }}>{d}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  <Text style={style_01.sectionLabel}>DADOS OCULTOS</Text>
                  <View style={{ flexDirection: 'row', marginBottom: 16 }}>
                    <TouchableOpacity
                      onPress={() => { if (useRed || totalSelected() < 3) setUseRed(!useRed); }}
                      style={{ flex: 1, marginRight: 8, padding: 12, borderRadius: 8, backgroundColor: useRed ? '#cc0000' : '#333', borderWidth: 2, borderColor: useRed ? '#ff4444' : '#555', alignItems: 'center' }}
                    >
                      <Text style={{ color: '#fff', fontWeight: 'bold' }}>🔴 ROJO</Text>
                      <Text style={{ color: useRed ? '#fff' : '#888', fontSize: 12, marginTop: 4 }}>{useRed ? `Valor: ${me?.red_die}` : 'Oculto'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => { if (useBlue || totalSelected() < 3) setUseBlue(!useBlue); }}
                      style={{ flex: 1, marginLeft: 8, padding: 12, borderRadius: 8, backgroundColor: useBlue ? '#0044cc' : '#333', borderWidth: 2, borderColor: useBlue ? '#4488ff' : '#555', alignItems: 'center' }}
                    >
                      <Text style={{ color: '#fff', fontWeight: 'bold' }}>🔵 AZUL</Text>
                      <Text style={{ color: useBlue ? '#fff' : '#888', fontSize: 12, marginTop: 4 }}>{useBlue ? `Valor: ${me?.blue_die}` : 'Oculto'}</Text>
                    </TouchableOpacity>
                  </View>

                  <TouchableOpacity onPress={confirmCombination} disabled={totalSelected() !== 3}
                    style={{ backgroundColor: totalSelected() === 3 ? '#ff3333' : '#555', padding: 14, borderRadius: 8, alignItems: 'center' }}
                  >
                    <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 16 }}>
                      {totalSelected() === 3 ? 'CONFIRMAR COMBINACIÓN' : `Selecciona ${3 - totalSelected()} más`}
                    </Text>
                  </TouchableOpacity>
                </>
              )
            ) : (
              <View style={{ alignItems: 'center' }}>
                {me?.submitted_combination
                  ? <Text style={style_01.statusTextSuccess}>✅ Ya enviaste tu combinación</Text>
                  : <Text style={style_01.statusText}>Esperando tu turno...</Text>
                }
              </View>
            )}

            <Text style={[style_01.sectionLabel, { marginTop: 16 }]}>COMBINACIONES ENVIADAS</Text>
            {gameState.players.map((p, i) => p.submitted_combination && (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                <Text style={{ color: '#aaa', fontSize: 13, marginRight: 8 }}>{p.nick}:</Text>
                {p.submitted_combination.map((d, j) => (
                  <View key={j} style={[style_01.die, { width: 32, height: 32, margin: 2 }]}>
                    <Text style={[style_01.dieText, { fontSize: 14 }]}>{d}</Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        )}

        {/* ===== ROUND END ===== */}
        {phase === "round_end" && (
          <View>
            <Text style={style_01.sectionLabel}>FIN DE RONDA {gameState.round - 1}</Text>
            {gameState.players.slice().sort((a, b) => b.score - a.score).map((p, i) => (
              <View key={i} style={style_01.playerCard}>
                <Text style={style_01.playerText}>{i + 1}. {p.nick}</Text>
                <Text style={{ color: '#ffaa00', fontWeight: 'bold' }}>{p.score} pts</Text>
              </View>
            ))}
          </View>
        )}

        <Text style={[style_01.sectionLabel, { marginTop: 20 }]}>PUNTAJES</Text>
        {gameState.players.map((p, i) => (
          <View key={i} style={style_01.playerCard}>
            <Text style={style_01.playerText}>{p.nick}</Text>
            <Text style={{ color: '#ffaa00' }}>{p.score} pts</Text>
          </View>
        ))}
      </ScrollView>
    );
  }

  // ================= GAME OVER =================
  if (screen === "game_over") {
    const sorted = [...gameState.players].sort((a, b) => b.score - a.score);
    return (
      <View style={style_01.container}>
        <Text style={style_01.title}>🏆 FIN DEL JUEGO</Text>
        {sorted.map((p, i) => (
          <View key={i} style={[style_01.playerCard, i === 0 && { borderColor: '#ffaa00', borderWidth: 2 }]}>
            <View style={style_01.playerRow}>
              <Text style={{ color: '#ffaa00', fontSize: 20, marginRight: 10 }}>
                {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`}
              </Text>
              <Text style={style_01.playerText}>{p.nick}</Text>
            </View>
            <Text style={{ color: '#ffaa00', fontWeight: 'bold', fontSize: 18 }}>{p.score} pts</Text>
          </View>
        ))}
        <TouchableOpacity onPress={returnToLobby} style={[style_01.buttonStart, { marginTop: 20 }]}>
          <Text style={style_01.buttonStartText}>VOLVER AL LOBBY</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return null;
};

export default AccSocket;