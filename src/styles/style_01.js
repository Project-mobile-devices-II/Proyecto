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
    color: '#000', // 🔥 IMPORTANTE (antes faltaba esto)
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

  // 🔥 LOBBY PLAYER
  playerCard: {
    backgroundColor: '#222',
    padding: 15,
    marginBottom: 8,
    borderRadius: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },

  playerText: {
    color: '#fff',
    fontSize: 18,
  },

  readyText: {
    color: '#00ff00',
    fontWeight: 'bold',
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