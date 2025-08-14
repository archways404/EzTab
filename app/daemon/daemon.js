import http from 'http';
import { WebSocketServer } from 'ws';
import { loadConfig, saveConfig, makeShortCode } from './util.js';
import url from 'url';

const PORT = 29342;
const HOST = '127.0.0.1';

const cfg = loadConfig();

const clients = new Set();

function setCors(res, origin) {
	res.setHeader('Access-Control-Allow-Origin', origin || '*');
	res.setHeader('Vary', 'Origin');
	res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Auth-Token');
	res.setHeader('Access-Control-Max-Age', '600'); // cache preflight 10 min
}

function handlePreflight(req, res) {
	// You can restrict allowed origins if you want; '*' is fine since we don't use credentials
	setCors(res, req.headers.origin || '*');
	res.writeHead(204).end();
}

function json(res, status, body) {
	const buf = Buffer.from(JSON.stringify(body));
	res.writeHead(status, {
		'Content-Type': 'application/json',
		'Content-Length': buf.length,
		'Cache-Control': 'no-store',
	});
	res.end(buf);
}

function unauthorized(res) {
	res.writeHead(401).end();
}

function notFound(res) {
	res.writeHead(404).end();
}

function readBody(req) {
	return new Promise((resolve, reject) => {
		let data = '';
		req.on('data', (c) => (data += c));
		req.on('end', () => {
			try {
				resolve(data ? JSON.parse(data) : {});
			} catch (e) {
				reject(e);
			}
		});
		req.on('error', reject);
	});
}

const server = http.createServer(async (req, res) => {
	const { pathname, query } = url.parse(req.url, true);

	// Always set CORS on any response that might be read by the browser
	const origin = req.headers.origin || '*';
	setCors(res, origin);

	// Handle preflight for all routes you expect to be called from the extension
	if (req.method === 'OPTIONS') {
		return handlePreflight(req, res);
	}

	// Health/status
	if (req.method === 'GET' && pathname === '/status') {
		return json(res, 200, { ok: true, proto: 1 });
	}

	// One-shot ingress (extension or Electron -> daemon)
	if (req.method === 'POST' && pathname === '/v1/ingest') {
		const body = await readBody(req).catch(() => null);
		if (!body || typeof body !== 'object') return json(res, 400, { error: 'bad_json' });

		// Minimal schema
		const { type, payload, reqId } = body;
		if (typeof type !== 'string') return json(res, 400, { error: 'type_required' });

		console.log('body', body.payload);

		// Broadcast to WS clients
		const packet = JSON.stringify({ from: 'http', type, payload, ts: Date.now(), reqId });
		for (const ws of clients) if (ws.readyState === ws.OPEN) ws.send(packet);

		// Optionally do local handling here…
		return json(res, 200, { ok: true });
	}

	// Anything else
	return notFound(res);
});

// WebSocket for push/bidirectional messaging
const wss = new WebSocketServer({ server, path: '/v1/ws' });

wss.on('connection', (ws, req) => {
	clients.add(ws);
	ws.on('close', () => clients.delete(ws));

	ws.on('message', (data) => {
		// Fan-out messages from a WS client to others (optional)
		let msg;
		try {
			msg = JSON.parse(String(data));
		} catch {
			return;
		}
		const packet = JSON.stringify({ from: 'ws', ...msg, ts: Date.now() });
		for (const peer of clients) if (peer !== ws && peer.readyState === peer.OPEN) peer.send(packet);
	});

	// greet
	ws.send(JSON.stringify({ type: 'hello', ts: Date.now(), proto: 1 }));
});

server.listen(PORT, HOST, () => {
	console.log(`[daemon] listening on http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
	server.close(() => process.exit(0));
});
process.on('SIGTERM', () => {
	server.close(() => process.exit(0));
});
