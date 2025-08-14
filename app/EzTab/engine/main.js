import { app, BrowserWindow, nativeTheme } from 'electron';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isDev = !!process.env.VITE_DEV_SERVER_URL; // set by your "dev" script
let win = null;

async function createWindow() {
	win = new BrowserWindow({
		width: 1100,
		height: 720,
		backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b0b0b' : '#ffffff',
		webPreferences: {
			preload: join(__dirname, 'preload.js'),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});

	if (isDev) {
		await win.loadURL(process.env.VITE_DEV_SERVER_URL);
		win.webContents.openDevTools({ mode: 'detach' });
	} else {
		// Vite builds to ./dist (relative to EzTab/)
		await win.loadFile(join(__dirname, '../dist/index.html'));
	}

	win.on('closed', () => (win = null));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
	if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
