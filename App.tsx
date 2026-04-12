import React from 'react';
import AccSocket from './src/components/accSocket';

export const WS_IP = '3.239.205.216';   // ← CAMBIA ESTA IP por la IP WiFi real de tu laptop

export const createWs = () => new WebSocket(`ws://${WS_IP}:5000`);

const App = () => {
  return <AccSocket />;
};

export default App;