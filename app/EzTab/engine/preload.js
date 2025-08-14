import { contextBridge } from 'electron';

// Keep preload minimal; you can expose APIs later via IPC
contextBridge.exposeInMainWorld('eztab', {
	version: '0.0.1',
});
