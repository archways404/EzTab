const listEl = document.getElementById('list');
const includePinnedEl = document.getElementById('includePinned');

// include pinned by default (in case HTML didn't set `checked`)
includePinnedEl.checked = true;

const DAEMON = 'http://127.0.0.1:29342';

let tabs = [];

async function loadTabs() {
	const query = { currentWindow: true };
	tabs = await browser.tabs.query(query);
	if (!includePinnedEl.checked) tabs = tabs.filter((t) => !t.pinned);
	render();
}

function render() {
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

		const fav = document.createElement('img');
		fav.className = 'fav';
		fav.src = t.favIconUrl || 'icons/default-favicon.png';
		fav.alt = '';
		favWrap.appendChild(fav);

		if (t.pinned) {
			const pin = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
			pin.setAttribute('viewBox', '0 0 24 24');
			pin.setAttribute('width', '14');
			pin.setAttribute('height', '14');
			pin.setAttribute('fill', 'currentColor');
			pin.classList.add('pin');

			const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
			path1.setAttribute('fill', 'none');
			path1.setAttribute('d', 'M0 0h24v24H0z');
			const path2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
			path2.setAttribute(
				'd',
				'M14 4v5c0 1.12.37 2.16 1 3H9c.65-.86 1-1.9 1-3V4h4m3-2H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3V4h1c.55 0 1-.45 1-1s-.45-1-1-1z'
			);
			pin.append(path1, path2);
			favWrap.appendChild(pin);
		}

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
	const ids = new Set(selectedIds());
	const selected = tabs.filter((t) => ids.has(t.id));

	// Build your desired shape
	return {
		tabs: selected.map((t) => ({
			tabName: t.title || t.url || '',
			tabURL: t.url || '',
		})),
	};
}

// --------  Send helpers --------

async function sendToDaemon(type, payload) {
	const reqId = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now());
	const r = await fetch(`${DAEMON}/v1/ingest`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ type, payload, reqId }),
	});
	if (!r.ok) throw new Error('daemon_ingest_failed');
	return r.json().catch(() => ({}));
}

// -------- Controls --------
document.getElementById('selectAll').onclick = () => {
	listEl.querySelectorAll('.cb').forEach((cb) => (cb.checked = true));
};
document.getElementById('clear').onclick = () => {
	listEl.querySelectorAll('.cb').forEach((cb) => (cb.checked = false));
};
includePinnedEl.onchange = loadTabs;

document.getElementById('use').onclick = async () => {
	const payload = selectedTabsAsJson(); // { tabs: [{tabName, tabURL}, ...] }
	try {
		await sendToDaemon('tabsSelected', payload);
		// Optional: also notify background script
		// await browser.runtime.sendMessage({ type: 'tabsSelected', payload });
	} catch (e) {
		console.error(e);
		alert(e, 'Failed to send to desktop app. Is the helper running?');
	}
	window.close(); // optional
};

document.getElementById('highlight').onclick = async () => {
	const currentWindow = (await browser.windows.getCurrent()).id;
	const ids = selectedIds();
	const inThisWin = tabs.filter((t) => ids.includes(t.id));
	const indices = inThisWin.map((t) => t.index);
	if (indices.length) {
		await browser.tabs.highlight({ windowId: currentWindow, tabs: indices });
	}
};

document.getElementById('close').onclick = async () => {
	const ids = selectedIds();
	if (ids.length) await browser.tabs.remove(ids);
	await loadTabs();
};

// initial load
loadTabs();
