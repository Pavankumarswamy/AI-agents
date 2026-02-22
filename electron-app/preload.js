/**
 * preload.js – Secure context bridge between renderer and main process
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    /** Get the backend base URL (always http://127.0.0.1:8000) */
    getBackendUrl: () => ipcRenderer.invoke('get-backend-url'),

    /** Utility: open a URL in the system browser */
    openExternal: url => ipcRenderer.send('open-external', url),
});
