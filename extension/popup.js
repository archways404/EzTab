// popup.js

const api = globalThis.browser ?? globalThis.chrome;

const listEl = document.getElementById('list');
const includePinnedEl = document.getElementById('includePinned');
includePinnedEl.checked = true;

let snapshot = { focusedWindowId: null, windows: {} };
let tabs = []; // flattened + filtered (current window only)

function pickCurrentWindowTabs() {
	// Show only the current window’s tabs (same behavior as your original code)
	const currentWindowId = snapshot.focusedWindowId;
	const w = snapshot.windows[currentWindowId];
	const all = w ? w.tabs.slice().sort((a, b) => a.index - b.index) : [];
	return includePinnedEl.checked ? all : all.filter((t) => !t.pinned);
}

function render() {
	tabs = pickCurrentWindowTabs();
	listEl.innerHTML = '';
	for (const t of tabs) {
		const row = document.createElement('label');
		row.className = 'row';
		row.dataset.tabId = String(t.id);

		const cb = document.createElement('input');
		cb.type = 'checkbox';
		cb.className = 'cb';

		const favWrap = document.createElement('div');
		favWrap.style.display = 'flex';
		favWrap.style.alignItems = 'center';
		favWrap.style.gap = '4px';

		const title = document.createElement('div');
		title.className = 'title';
		title.title = t.title || t.url;
		title.textContent = t.title || t.url;

		const url = document.createElement('div');
		url.style.opacity = '0.7';
		url.style.fontSize = '11px';
		try {
			url.textContent = new URL(t.url).hostname;
		} catch {
			url.textContent = t.url;
		}

		row.append(cb, favWrap, title, url);
		listEl.appendChild(row);
	}
}

function selectedIds() {
	const ids = [];
	for (const row of listEl.querySelectorAll('.row')) {
		const cb = row.querySelector('.cb');
		if (cb.checked) ids.push(Number(row.dataset.tabId));
	}
	return ids;
}

function selectedTabsAsJson() {
	const sel = new Set(selectedIds());
	const selected = tabs.filter((t) => sel.has(t.id));
	return {
		tabs: selected.map((t) => ({
			tabName: t.title || t.url || '',
			tabURL: t.url || '',
			windowId: t.windowId,
			pinned: t.pinned,
			index: t.index,
		})),
	};
}

// ---- wire up controls (unchanged from yours) -------------------------------
document.getElementById('selectAll').onclick = () => {
	listEl.querySelectorAll('.cb').forEach((cb) => (cb.checked = true));
};
document.getElementById('clear').onclick = () => {
	listEl.querySelectorAll('.cb').forEach((cb) => (cb.checked = false));
};
includePinnedEl.onchange = () => render();

document.getElementById('use').onclick = async () => {
	const payload = selectedTabsAsJson();
	try {
		await fetch('http://127.0.0.1:29342/v1/ingest', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				type: 'tabsSelected',
				payload,
				reqId: crypto.randomUUID?.() || String(Date.now()),
			}),
		});
	} catch (e) {
		console.error(e);
		alert('Failed to send to desktop app. Is the helper running?');
	}
	window.close(); // optional
};

document.getElementById('highlight').onclick = async () => {
	const ids = selectedIds();
	if (!ids.length) return;
	const currentWindow = (await api.windows.getCurrent()).id;
	const inThisWin = tabs.filter((t) => ids.includes(t.id));
	const indices = inThisWin.map((t) => t.index);
	if (indices.length) await api.tabs.highlight({ windowId: currentWindow, tabs: indices });
};

document.getElementById('close').onclick = async () => {
	const ids = selectedIds();
	if (ids.length) await api.tabs.remove(ids);
};

// ---- subscribe to live updates from bg -------------------------------------
api.runtime.onMessage.addListener((msg) => {
	if (msg?.type === 'tabs_state') {
		snapshot = msg.state;
		render();
	}
});

// ask once for the current snapshot on open
api.runtime.sendMessage({ type: 'get_tabs_state' }, (res) => {
	if (res?.state) {
		snapshot = res.state;
		render();
	}
});
