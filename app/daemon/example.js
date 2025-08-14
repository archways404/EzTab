// example.js
import WebSocket from 'ws'; // npm install ws

const WS_URL = 'ws://127.0.0.1:29342/v1/ws';

const ws = new WebSocket(WS_URL);

ws.on('open', () => {
	console.log('[client] connected to', WS_URL);
});

ws.on('message', (data) => {
	try {
		const msg = JSON.parse(data);
		console.log('[client] message:', JSON.stringify(msg, null, 2));
	} catch (err) {
		console.log('[client] raw message:', data.toString());
	}
});

ws.on('close', () => {
	console.log('[client] connection closed');
});

ws.on('error', (err) => {
	console.error('[client] error:', err);
});
