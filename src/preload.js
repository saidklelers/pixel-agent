'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('office', {
  onAgents: (cb) => ipcRenderer.on('agents', (_e, data) => cb(data)),
});

// Centro de mando: lanzar y dirigir agentes de Claude Code
contextBridge.exposeInMainWorld('agentApi', {
  spawn: (opts) => ipcRenderer.invoke('agent:spawn', opts),
  send: (id, text) => ipcRenderer.invoke('agent:send', { id, text }),
  interrupt: (id) => ipcRenderer.invoke('agent:interrupt', { id }),
  stop: (id) => ipcRenderer.invoke('agent:stop', { id }),
  onEvent: (cb) => ipcRenderer.on('agent:event', (_e, data) => cb(data)),
});

// Voz: transcripción local (Whisper) en el proceso principal
contextBridge.exposeInMainWorld('voiceApi', {
  prepare: () => ipcRenderer.invoke('voice:prepare'),
  // audio: Float32Array a 16 kHz mono
  transcribe: (audio) => ipcRenderer.invoke('voice:transcribe', audio),
  onStatus: (cb) => ipcRenderer.on('voice:status', (_e, data) => cb(data)),
});
