// bg.js (MV3 service worker)
const DAEMON = 'http://127.0.0.1:29342'; // your local HTTP bridge

const api = globalThis.browser ?? globalThis.chrome;

// --- state model -------------------------------------------------------------
let state = {
	focusedWindowId: null,
	windows: {}, // windowId -> { id, focused, tabs: [TabInfo] }
};

function tabToInfo(t) {
	return {
		id: t.id,
		index: t.index,
		windowId: t.windowId,
		active: !!t.active,
		pinned: !!t.pinned,
		discarded: !!t.discarded,
		audible: !!t.audible,
		muted: t.mutedInfo?.muted ?? false,
		title: t.title || t.url || '',
		url: t.url || '',
		favIconUrl: t.favIconUrl || '',
		// groupId: t.groupId, // if using tabGroups permission
	};
}

async function fullSnapshot() {
	const wins = await api.windows.getAll({ populate: true });
	const next = { focusedWindowId: (await api.windows.getCurrent())?.id ?? null, windows: {} };
	for (const w of wins) {
		next.windows[w.id] = {
			id: w.id,
			focused: w.focused,
			tabs: (w.tabs || []).map(tabToInfo),
		};
	}
	state = next;
}

/*
async function fullSnapshot() {
  const wins = await chrome.windows.getAll({ populate: true });
  const focused = await chrome.windows.getLastFocused().catch(() => null);
  const next = { focusedWindowId: focused?.id ?? null, windows: {} };
  for (const w of wins) {
    next.windows[w.id] = {
      id: w.id,
      focused: !!w.focused,
      tabs: (w.tabs || []).map(tabToInfo),
    };
  }
  state = next;
}
*/

// --- emit logic --------------------------------------------------------------
let emitTimer = null;
function debounceEmit() {
	if (emitTimer) clearTimeout(emitTimer);
	emitTimer = setTimeout(emitNow, 200);
}
async function emitNow() {
	emitTimer = null;
	// 1) Broadcast to extension UIs
	api.runtime.sendMessage({ type: 'tabs_state', state }).catch(() => {});
	// 2) Send to your desktop daemon (best-effort)
	try {
		const payload = {
			type: 'tabsState',
			payload: state,
			ts: Date.now(),
		};
		await fetch(`${DAEMON}/v1/ingest`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
		});
	} catch (_) {
		// swallow; your daemon might be down
	}
}

// --- event wiring ------------------------------------------------------------
async function boot() {
	await fullSnapshot();
	emitNow();
}
boot();

// tabs lifecycle
api.tabs.onCreated.addListener((tab) => {
	const w =
		state.windows[tab.windowId] ||
		(state.windows[tab.windowId] = { id: tab.windowId, focused: false, tabs: [] });
	w.tabs.push(tabToInfo(tab));
	debounceEmit();
});

api.tabs.onRemoved.addListener((tabId, removeInfo) => {
	const w = state.windows[removeInfo.windowId];
	if (w) {
		w.tabs = w.tabs.filter((t) => t.id !== tabId);
	}
	debounceEmit();
});

api.tabs.onUpdated.addListener(
	(tabId, changeInfo, tab) => {
		const w = state.windows[tab.windowId];
		if (!w) return;
		const i = w.tabs.findIndex((t) => t.id === tabId);
		if (i === -1) {
			// occasionally events race; ensure presence
			w.tabs.push(tabToInfo(tab));
		} else {
			// update only changed fields
			const tgt = w.tabs[i];
			const updated = tabToInfo(tab);
			// cheap shallow merge:
			Object.assign(tgt, updated);
		}
		debounceEmit();
	},
	{
		properties: [
			'status',
			'title',
			'url',
			'favIconUrl',
			'audible',
			'discarded',
			'mutedInfo',
			'pinned',
		],
	}
);

api.tabs.onMoved.addListener((tabId, moveInfo) => {
	const w = state.windows[moveInfo.windowId];
	if (!w) return;
	// re-sort by index
	w.tabs.sort((a, b) => a.index - b.index);
	debounceEmit();
});

api.tabs.onActivated.addListener(({ tabId, windowId }) => {
	const w = state.windows[windowId];
	if (!w) return;
	for (const t of w.tabs) t.active = t.id === tabId;
	debounceEmit();
});

api.tabs.onDetached.addListener((tabId, detachInfo) => {
	const w = state.windows[detachInfo.oldWindowId];
	if (!w) return;
	w.tabs = w.tabs.filter((t) => t.id !== tabId);
	debounceEmit();
});

api.tabs.onAttached.addListener((tabId, attachInfo) => {
	const w =
		state.windows[attachInfo.newWindowId] ||
		(state.windows[attachInfo.newWindowId] = {
			id: attachInfo.newWindowId,
			focused: false,
			tabs: [],
		});
	// We need the tab details:
	api.tabs.get(tabId, (tab) => {
		if (api.runtime.lastError) return;
		w.tabs.push(tabToInfo(tab));
		w.tabs.sort((a, b) => a.index - b.index);
		debounceEmit();
	});
});

// windows lifecycle
api.windows.onCreated.addListener(async (win) => {
	state.windows[win.id] = { id: win.id, focused: !!win.focused, tabs: [] };
	try {
		const tabs = await api.tabs.query({ windowId: win.id });
		state.windows[win.id].tabs = tabs.map(tabToInfo);
	} catch {}
	debounceEmit();
});

api.windows.onRemoved.addListener((windowId) => {
	delete state.windows[windowId];
	debounceEmit();
});

api.windows.onFocusChanged.addListener((windowId) => {
	state.focusedWindowId = windowId > 0 ? windowId : null;
	for (const w of Object.values(state.windows)) w.focused = w.id === windowId;
	debounceEmit();
});

// respond to UI asking for current state
api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
	if (msg?.type === 'get_tabs_state') {
		sendResponse({ state });
		return true;
	}
});
