import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

export function appDirs() {
	const home = os.homedir();
	const platform = process.platform;
	if (platform === 'win32') {
		const base = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
		return {
			data: path.join(base, 'MyApp'),
			config: path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'MyApp'),
		};
	} else if (platform === 'darwin') {
		return {
			data: path.join(home, 'Library', 'Application Support', 'MyApp'),
			config: path.join(home, 'Library', 'Application Support', 'MyApp'),
		};
	}
	// linux & others
	return {
		data: path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'MyApp'),
		config: path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'MyApp'),
	};
}

export function ensureDir(p) {
	fs.mkdirSync(p, { recursive: true });
}

export function loadConfig() {
	const { config } = appDirs();
	ensureDir(config);
	const fp = path.join(config, 'config.json');
	if (!fs.existsSync(fp)) {
		const cfg = { authToken: crypto.randomBytes(32).toString('hex') };
		fs.writeFileSync(fp, JSON.stringify(cfg, null, 2));
		return { ...cfg, _path: fp };
	}
	const cfg = JSON.parse(fs.readFileSync(fp, 'utf8'));
	return { ...cfg, _path: fp };
}

export function saveConfig(cfg) {
	const { _path, ...rest } = cfg;
	fs.writeFileSync(_path, JSON.stringify(rest, null, 2));
}

export function makeShortCode() {
	// 6-digit numeric pairing code
	return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}
