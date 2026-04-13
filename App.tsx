import React from 'react';
import AccSocket from './src/components/accSocket';

export const WS_IP = '100.31.185.145';   

export const createWs = () => new WebSocket(`ws://${WS_IP}:5000`);

const App = () => {
  return <AccSocket />;
};

export default App;