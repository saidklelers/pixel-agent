'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('office', {
  onAgents: (cb) => ipcRenderer.on('agents', (_e, data) => cb(data)),
});

// El equipo: 5 agentes fijos (JARVIS, FRIDAY, TARS, EDITH, KITT)
contextBridge.exposeInMainWorld('teamApi', {
  list: () => ipcRenderer.invoke('team:list'),
  // opts: { docs: [ids de adjuntos], delegate: que el líder lo reparta en el equipo }
  send: (id, text, opts) => ipcRenderer.invoke('team:send', Object.assign({ id, text }, opts || {})),
  interrupt: (id) => ipcRenderer.invoke('team:interrupt', { id }),
  reset: (id) => ipcRenderer.invoke('team:reset', { id }),
  train: (id, topic) => ipcRenderer.invoke('team:train', { id, topic }),
  forget: (id, topic) => ipcRenderer.invoke('team:forget', { id, topic }),
  setCwd: (cwd) => ipcRenderer.invoke('team:cwd', { cwd }),
  // personalizar nombre, especialidad, colores, voz… (custom = null: restaurar)
  customize: (id, custom) => ipcRenderer.invoke('team:customize', { id, custom }),
  onEvent: (cb) => ipcRenderer.on('agent:event', (_e, data) => cb(data)),
});

// Documentos adjuntos (requerimientos): el render manda los bytes y el
// proceso principal saca el texto (PDF, Word, Excel, PowerPoint, TXT…)
contextBridge.exposeInMainWorld('docsApi', {
  attach: (name, bytes) => ipcRenderer.invoke('docs:attach', { name, bytes }),
});

// Planes de reparto de JARVIS
contextBridge.exposeInMainWorld('planApi', {
  list: () => ipcRenderer.invoke('plan:list'),
  cancel: (id) => ipcRenderer.invoke('plan:cancel', { id }),
});

// Tablero de tareas y lo que hace cada agente (pantallas)
contextBridge.exposeInMainWorld('boardApi', {
  get: () => ipcRenderer.invoke('board:get'),
  clear: (id) => ipcRenderer.invoke('board:clear', { id }),
  onChange: (cb) => ipcRenderer.on('board', (_e, data) => cb(data)),
});

// Voz: transcripción local (Whisper) en el proceso principal
contextBridge.exposeInMainWorld('voiceApi', {
  // quality: 'precisa' (Whisper small) o 'rapida' (Whisper base)
  prepare: (quality) => ipcRenderer.invoke('voice:prepare', { quality }),
  // audio: Float32Array a 16 kHz mono
  transcribe: (audio, quality) => ipcRenderer.invoke('voice:transcribe', { audio, quality }),
  // voz natural de un miembro: { audio: Uint8Array (mp3) } o { error }
  speak: (id, text) => ipcRenderer.invoke('tts:speak', { id, text }),
  // probar una voz sin guardarla ({ name, pitch, rate })
  preview: (id, text, voice) => ipcRenderer.invoke('tts:speak', { id, text, voice }),
  onStatus: (cb) => ipcRenderer.on('voice:status', (_e, data) => cb(data)),
});
