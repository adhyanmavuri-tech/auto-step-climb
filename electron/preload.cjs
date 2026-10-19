'use strict'
// Runs in the window before its page does, and gives the page the one thing it may use: `window.autostep`.
// The page can read the app's state and press its buttons through it, and nothing else of Electron or of
// Node reaches the page.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('autostep', {
  /** The app's state, once. */
  getState: () => ipcRenderer.invoke('autostep:state'),
  /** Calls `callback` with the state about once a second, and straight after a button. */
  onState: (callback) => {
    ipcRenderer.on('autostep:state', (_event, state) => callback(state))
  },
  /** Presses a button. Resolves with what the app answered, rejects with what went wrong. */
  act: async (action, body) => {
    const reply = await ipcRenderer.invoke('autostep:act', String(action), body && typeof body === 'object' ? body : {})
    if (!reply || reply.ok !== true) throw new Error(reply && reply.error ? reply.error : 'The app did not answer')
    return reply.result
  }
})
