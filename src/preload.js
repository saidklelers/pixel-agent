'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('office', {
  onAgents: (cb) => ipcRenderer.on('agents', (_e, data) => cb(data)),
});

// El equipo: 5 agentes fijos (JARVIS, FRIDAY, TARS, EDITH, KITT)
contextBridge.exposeInMainWorld('teamApi', {
  list: () => ipcRenderer.invoke('team:list'),
  send: (id, text) => ipcRenderer.invoke('team:send', { id, text }),
  interrupt: (id) => ipcRenderer.invoke('team:interrupt', { id }),
  reset: (id) => ipcRenderer.invoke('team:reset', { id }),
  train: (id, topic) => ipcRenderer.invoke('team:train', { id, topic }),
  forget: (id, topic) => ipcRenderer.invoke('team:forget', { id, topic }),
  setCwd: (cwd) => ipcRenderer.invoke('team:cwd', { cwd }),
  onEvent: (cb) => ipcRenderer.on('agent:event', (_e, data) => cb(data)),
});

// Voz: transcripción local (Whisper) en el proceso principal
contextBridge.exposeInMainWorld('voiceApi', {
  // quality: 'precisa' (Whisper small) o 'rapida' (Whisper base)
  prepare: (quality) => ipcRenderer.invoke('voice:prepare', { quality }),
  // audio: Float32Array a 16 kHz mono
  transcribe: (audio, quality) => ipcRenderer.invoke('voice:transcribe', { audio, quality }),
  // voz natural de un miembro: { audio: Uint8Array (mp3) } o { error }
  speak: (id, text) => ipcRenderer.invoke('tts:speak', { id, text }),
  onStatus: (cb) => ipcRenderer.on('voice:status', (_e, data) => cb(data)),
});
