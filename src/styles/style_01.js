import { StyleSheet } from 'react-native';

export const style_01 = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f0f',
    padding: 15,
  },

  // 🔥 TÍTULOS
  title: {
    fontSize: 34,
    color: '#ff3333',
    textAlign: 'center',
    marginVertical: 15,
    fontWeight: 'bold',
  },

  subtitle: {
    fontSize: 18,
    color: '#cccccc',
    textAlign: 'center',
    marginBottom: 20,
  },

  // 🔥 TEXTOS GENERALES
  text: {
    color: '#ffffff',
    fontSize: 16,
  },

  // 🔥 INPUTS
  input: {
    backgroundColor: '#1f1f1f',
    color: '#ffffff',
    padding: 15,
    borderRadius: 12,
    marginVertical: 10,
    borderWidth: 2,
    borderColor: '#444',
    fontSize: 16,
  },

  // 🔥 BOTONES
  button: {
    backgroundColor: '#ff3333',
    padding: 16,
    borderRadius: 12,
    marginVertical: 10,
    alignItems: 'center',
  },

  buttonText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 16,
  },

  buttonReady: {
    backgroundColor: '#00aa33',
    padding: 16,
    borderRadius: 12,
    marginVertical: 10,
    alignItems: 'center',
  },

  buttonStart: {
    backgroundColor: '#ffaa00',
    padding: 16,
    borderRadius: 12,
    marginVertical: 6,
    alignItems: 'center',
  },

  buttonStartText: {
    color: '#000000',
    fontWeight: 'bold',
    fontSize: 16,
  },

  buttonLeave: {
    borderWidth: 2,
    borderColor: '#444',
    borderRadius: 12,
    padding: 13,
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 20,
  },

  buttonLeaveText: {
    color: '#888888',
    fontSize: 14,
  },

  buttonDisabled: {
    borderWidth: 2,
    borderColor: '#333',
    borderRadius: 12,
    padding: 13,
    alignItems: 'center',
    marginTop: 6,
  },

  buttonDisabledText: {
    color: '#555555',
    fontSize: 13,
  },

  // 🔥 PREDICCIONES
  predictionContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
    marginVertical: 15,
  },

  predictionButton: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    minWidth: 85,
    alignItems: 'center',
  },

  zero: { backgroundColor: '#555' },
  min: { backgroundColor: '#3366ff' },
  more: { backgroundColor: '#ffaa00' },
  max: { backgroundColor: '#ff3333' },

  selected: {
    borderWidth: 3,
    borderColor: '#ffff00',
  },

  // 🔥 DADOS
  diceContainer: {
    backgroundColor: '#1a1a1a',
    padding: 15,
    borderRadius: 12,
    marginVertical: 15,
  },

  diceRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 12,
  },

  die: {
    width: 55,
    height: 55,
    backgroundColor: '#ffffff',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#333',
  },

  dieSelected: {
    backgroundColor: '#ffee00',
    borderColor: '#ffff00',
  },

  dieText: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#000',
  },

  // 🔥 BOTÓN ENVIAR
  sendButton: {
    backgroundColor: '#00cc00',
    padding: 18,
    borderRadius: 12,
    marginVertical: 15,
  },

  sendButtonText: {
    color: '#000',
    textAlign: 'center',
    fontWeight: 'bold',
    fontSize: 18,
  },

  // 🔥 LOBBY — JUGADORES
  playerCard: {
    backgroundColor: '#222',
    padding: 15,
    marginBottom: 8,
    borderRadius: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  playerCardMe: {
    backgroundColor: '#222',
    padding: 15,
    marginBottom: 8,
    borderRadius: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderColor: '#ff3333',
    borderWidth: 1.5,
  },

  playerText: {
    color: '#fff',
    fontSize: 18,
  },

  playerTag: {
    fontSize: 10,
    color: '#ff3333',
    letterSpacing: 0.5,
  },

  ownerTag: {
    fontSize: 10,
    color: '#ffaa00',
    letterSpacing: 0.5,
  },

  playerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#444',
    justifyContent: 'center',
    alignItems: 'center',
  },

  playerAvatarMe: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#ff3333',
    justifyContent: 'center',
    alignItems: 'center',
  },

  playerAvatarText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 15,
  },

  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  readyBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: '#1a3a1a',
    borderWidth: 1,
    borderColor: '#00cc44',
  },

  waitingBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: '#2a2a2a',
    borderWidth: 1,
    borderColor: '#444',
  },

  readyBadgeText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#00cc44',
  },

  waitingBadgeText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#888',
  },

  readyText: {
    color: '#00ff00',
    fontWeight: 'bold',
  },

  // 🔥 LOBBY — CÓDIGO DE SALA
  roomCodeBox: {
    backgroundColor: '#1a1a1a',
    borderWidth: 2,
    borderColor: '#ff3333',
    borderStyle: 'dashed',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 20,
  },

  roomCodeLabel: {
    color: '#aaaaaa',
    fontSize: 11,
    letterSpacing: 1,
    marginBottom: 6,
  },

  roomCodeValue: {
    color: '#ff3333',
    fontSize: 36,
    fontWeight: 'bold',
    letterSpacing: 8,
  },

  roomCodeHint: {
    color: '#555555',
    fontSize: 12,
    marginTop: 6,
  },

  // 🔥 LOBBY — TEXTOS DE ESTADO
  statusText: {
    color: '#555555',
    textAlign: 'center',
    fontSize: 13,
    marginVertical: 10,
  },

  statusTextSuccess: {
    color: '#00cc44',
    textAlign: 'center',
    fontSize: 13,
    marginVertical: 10,
  },

  playerCount: {
    color: '#666666',
    fontSize: 12,
    textAlign: 'right',
    marginBottom: 8,
  },

  sectionLabel: {
    color: '#888888',
    fontSize: 13,
    marginBottom: 10,
    letterSpacing: 0.5,
  },

  screenSubtitle: {
    color: '#888888',
    textAlign: 'center',
    fontSize: 13,
    marginBottom: 20,
  },

  // 🔥 HEADER CON RETROCESO
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },

  backButton: {
    padding: 8,
  },

  backButtonText: {
    color: '#aaaaaa',
    fontSize: 22,
  },

  headerSpacer: {
    width: 40,
  },

  // 🔥 LOG
  logContainer: {
    backgroundColor: '#000',
    padding: 12,
    borderRadius: 8,
    height: 180,
    marginTop: 10,
  },

  logText: {
    color: '#00ff00',
    fontSize: 13,
  },
});