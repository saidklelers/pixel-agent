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
