export function connectDaemon(onMessage) {
	const WS_URL = 'ws://127.0.0.1:29342/v1/ws';
	let ws, timer;

	function open() {
		ws = new WebSocket(WS_URL);
		ws.onopen = () => {};
		ws.onmessage = (ev) => {
			try {
				onMessage(JSON.parse(ev.data));
			} catch {}
		};
		ws.onclose = () => {
			timer = setTimeout(open, 1000);
		};
		ws.onerror = () => {
			try {
				ws.close();
			} catch {}
		};
	}

	open();
	return () => {
		clearTimeout(timer);
		try {
			ws && ws.close();
		} catch {}
	};
}
