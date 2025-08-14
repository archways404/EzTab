import React from 'react';
import { connectDaemon } from '@/lib/connection';

export default function App() {
	const [state, setState] = React.useState(null);

	React.useEffect(() => {
		return connectDaemon((msg) => {
			if (msg?.type === 'tabsState') setState(msg.payload);
		});
	}, []);

	if (!state) {
		return <div className="p-4 text-zinc-400">Waiting for tabs…</div>;
	}

	const windows = Object.values(state.windows || {});

	return (
		<div className="p-4 space-y-4">
			<header className="flex items-center gap-3">
				<h1 className="text-xl font-semibold">EzTab</h1>
				{state.summary ? (
					<span className="text-sm text-zinc-400">
						windows: {state.summary.windows} • tabs: {state.summary.tabs}
					</span>
				) : null}
			</header>

			{windows.map((w) => (
				<section
					key={w.id}
					className="bg-zinc-800/60 rounded-2xl shadow p-3">
					<div className="flex items-center gap-2 mb-2">
						<div
							className={`w-2 h-2 rounded-full ${w.focused ? 'bg-emerald-400' : 'bg-zinc-600'}`}
						/>
						<div className="font-medium">Window {w.id}</div>
						<div className="text-xs text-zinc-400 ml-auto">{w.tabs.length} tabs</div>
					</div>

					<ul className="grid md:grid-cols-2 gap-2">
						{w.tabs.map((t) => (
							<li
								key={t.id}
								className="flex items-center gap-3 p-2 rounded-lg hover:bg-zinc-700/60">
								<img
									src={t.icon || t.favIconUrl}
									alt=""
									width="16"
									height="16"
									className="shrink-0"
								/>
								<div className="min-w-0">
									<div className="truncate">{t.title || t.url}</div>
									<div className="text-xs text-zinc-400 truncate">{t.host || t.url}</div>
								</div>
								{t.pinned && (
									<span className="text-xs ml-auto px-1.5 py-0.5 rounded bg-zinc-700">pin</span>
								)}
								{t.active && (
									<span className="text-xs ml-1 px-1.5 py-0.5 rounded bg-emerald-600/40">
										active
									</span>
								)}
							</li>
						))}
					</ul>
				</section>
			))}
		</div>
	);
}
