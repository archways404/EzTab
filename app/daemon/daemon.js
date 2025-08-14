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

const tty = process.stdout.isTTY;

function ellipsize(str, n) {
	if (!str) return '';
	return str.length <= n ? str : str.slice(0, n - 1) + '…';
}

function hostOf(u) {
	try {
		return new URL(u).hostname;
	} catch {
		return '';
	}
}

function color(code, s) {
	if (!tty) return String(s);
	return `\x1b[${code}m${s}\x1b[0m`;
}
const dim = (s) => color('2', s);
const bold = (s) => color('1', s);
const green = (s) => color('32', s);
const cyan = (s) => color('36', s);
const gray = (s) => color('90', s);

function summarizeTabsState(payload) {
	const winIds = Object.keys(payload.windows || {});
	const totalTabs = winIds.reduce((sum, wid) => sum + (payload.windows[wid]?.tabs?.length || 0), 0);
	return { winCount: winIds.length, totalTabs };
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

		const { type, payload, reqId } = body;
		if (typeof type !== 'string') return json(res, 400, { error: 'type_required' });

		// ---- Pretty print tabsState + fallback for other types -------------------
		if (type === 'tabsState' && payload && payload.windows) {
			const { winCount, totalTabs } = summarizeTabsState(payload);
			const header = `[ingest] ${green('tabsState')} ${dim(`reqId=${reqId || '-'}`)} ${dim(
				new Date().toLocaleTimeString()
			)}`;
			console.log(header);
			console.log(
				`  windows: ${bold(winCount)}  tabs: ${bold(totalTabs)}  focusedWindowId: ${bold(
					String(payload.focusedWindowId)
				)}`
			);

			// Per-window table
			for (const [wid, w] of Object.entries(payload.windows)) {
				const isFocused = w.focused ? green('●') : dim('○');
				console.log(
					`\n  ${cyan('Window ' + wid)} ${isFocused}  ${dim(`${w.tabs?.length || 0} tabs`)}`
				);

				// Build a compact table for this window’s tabs
				const rows = (w.tabs || [])
					.slice()
					.sort((a, b) => a.index - b.index)
					.map((t) => ({
						idx: t.index,
						id: t.id,
						a: t.active ? '▶' : '',
						pin: t.pinned ? 'Y' : '',
						title: ellipsize(t.title || t.url || '', 60),
						host: ellipsize(hostOf(t.url || ''), 30),
					}));

				// Print as a simple aligned table
				if (rows.length) {
					const pad = (s, n) => String(s).padEnd(n);
					const head = `    ${pad('idx', 4)} ${pad('id', 5)} ${pad('a', 1)} ${pad('pin', 3)}  ${pad(
						'title',
						60
					)}  ${pad('host', 30)}`;
					console.log(gray(head));
					for (const r of rows) {
						console.log(
							`    ${pad(r.idx, 4)} ${pad(r.id, 5)} ${pad(r.a, 1)} ${pad(r.pin, 3)}  ${pad(
								r.title,
								60
							)}  ${pad(r.host, 30)}`
						);
					}
				} else {
					console.log(dim('    (no tabs)'));
				}
			}
			console.log(); // trailing newline
		} else {
			// Generic pretty-print for other message types
			console.log(
				`[ingest] ${bold(type)} ${dim(`reqId=${reqId || '-'}`)} ${dim(new Date().toISOString())}`
			);
			console.dir(payload, { depth: null, colors: true });
		}
		// -------------------------------------------------------------------------

		// --- Broadcast to WS clients -------------------------------------------------
		let outPayload = payload;

		if (type === 'tabsState' && payload && payload.windows) {
			outPayload = {
				focusedWindowId: payload.focusedWindowId ?? null,
				windows: {},
			};

			for (const [wid, w] of Object.entries(payload.windows)) {
				const tabs = Array.isArray(w.tabs) ? w.tabs : [];
				outPayload.windows[wid] = {
					id: w.id,
					focused: !!w.focused,
					tabs: tabs
						.slice()
						.sort((a, b) => a.index - b.index)
						.map((t) => {
							const title = t.title || t.url || '';
							const urlStr = t.url || '';
							return {
								id: t.id,
								index: t.index,
								active: !!t.active,
								pinned: !!t.pinned,
								title,
								url: urlStr,
								host: hostOf(urlStr),
								favIconUrl: t.favIconUrl || '',
							};
						}),
				};
			}

			// optional summary
			const ids = Object.keys(outPayload.windows);
			outPayload.summary = {
				windows: ids.length,
				tabs: ids.reduce((n, id) => n + (outPayload.windows[id].tabs?.length || 0), 0),
			};
		}

		const packet = JSON.stringify({
			from: 'http',
			type,
			payload: outPayload,
			ts: Date.now(),
			reqId,
		});

		for (const ws of clients) {
			if (ws.readyState === WebSocket.OPEN) ws.send(packet);
		}

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
