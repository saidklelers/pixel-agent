'use strict';

const { app, BrowserWindow, ipcMain, session, utilityProcess } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { randomUUID } = require('crypto');

// Carpeta donde Claude Code escribe las transcripciones de cada sesion (.jsonl).
// Se puede sobreescribir con la variable de entorno CLAUDE_PROJECTS_DIR.
const PROJECTS_DIR =
  process.env.CLAUDE_PROJECTS_DIR ||
  path.join(os.homedir(), '.claude', 'projects');

const POLL_MS = 700; // cada cuanto miramos si hay lineas nuevas

let win = null;

// ---- Estado interno --------------------------------------------------------

// filePath -> { offset, remainder } para ir leyendo solo lo nuevo de cada .jsonl
const files = new Map();
// sessionId -> objeto agente
const sessions = new Map();

// ---- Mapa de herramientas a estados ---------------------------------------

const TOOL_STATE = {
  Read: 'reading', Grep: 'reading', Glob: 'reading', LS: 'reading', NotebookRead: 'reading',
  Edit: 'coding', Write: 'coding', MultiEdit: 'coding', NotebookEdit: 'coding',
  Bash: 'running', PowerShell: 'running',
  WebSearch: 'web', WebFetch: 'web',
  Task: 'delegating', Agent: 'delegating',
};

const STATE_META = {
  idle:       { emoji: '\u{1F4A4}', label: 'descansando' },
  prompt:     { emoji: '\u{1F4E9}', label: 'nueva tarea' },
  thinking:   { emoji: '\u{1F4AD}', label: 'pensando' },
  talking:    { emoji: '\u{1F4AC}', label: 'explicando' },
  reading:    { emoji: '\u{1F4D6}', label: 'leyendo' },
  coding:     { emoji: '⌨️', label: 'escribiendo codigo' },
  running:    { emoji: '⚙️', label: 'ejecutando' },
  web:        { emoji: '\u{1F310}', label: 'buscando en la web' },
  delegating: { emoji: '\u{1F91D}', label: 'delegando' },
  working:    { emoji: '\u{1F6E0}️', label: 'trabajando' },
  waiting:    { emoji: '✋', label: 'esperandote' },
};

function meta(state) {
  return STATE_META[state] || STATE_META.working;
}

function trimText(s, max) {
  if (!s) return '';
  const clean = String(s).replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max - 1) + '…' : clean;
}

function labelForTool(tu, fallback) {
  const i = tu.input || {};
  if (i.file_path) return fallback + ': ' + path.basename(String(i.file_path));
  if (i.pattern) return fallback + ': "' + trimText(i.pattern, 18) + '"';
  if (i.query) return fallback + ': ' + trimText(i.query, 24);
  if (i.command) return fallback + ': ' + trimText(i.command, 28);
  if (i.description) return trimText(i.description, 30);
  return fallback;
}

// Traduce un evento del JSONL a un estado visible. Devuelve null si es ruido
// (attachments, queue-operation, resumenes, etc.).
function classify(e) {
  if (!e || !e.type) return null;

  if (e.type === 'user') {
    const c = e.message && e.message.content;
    if (typeof c === 'string') {
      const m = meta('prompt');
      return { state: 'prompt', emoji: m.emoji, label: m.label, text: c };
    }
    if (Array.isArray(c)) {
      if (c.some((b) => b && b.type === 'tool_result')) {
        const m = meta('working');
        return { state: 'working', emoji: m.emoji, label: m.label };
      }
      const tb = c.find((b) => b && b.type === 'text');
      if (tb) {
        const m = meta('prompt');
        return { state: 'prompt', emoji: m.emoji, label: m.label, text: tb.text };
      }
    }
    return null;
  }

  if (e.type === 'assistant') {
    const c = e.message && e.message.content;
    if (Array.isArray(c)) {
      const tu = c.find((b) => b && b.type === 'tool_use');
      if (tu) {
        const st = TOOL_STATE[tu.name] || 'working';
        const m = meta(st);
        return { state: st, emoji: m.emoji, label: labelForTool(tu, m.label) };
      }
      const txt = c.filter((b) => b && b.type === 'text').map((b) => b.text).join(' ').trim();
      if (txt) {
        const m = meta('talking');
        return { state: 'talking', emoji: m.emoji, label: m.label, text: txt };
      }
    } else if (typeof c === 'string' && c.trim()) {
      const m = meta('talking');
      return { state: 'talking', emoji: m.emoji, label: m.label, text: c };
    }
    return null;
  }

  return null;
}

// ---- Lectura incremental de los .jsonl ------------------------------------

function readNew(file) {
  const st = fs.statSync(file);
  const rec = files.get(file) || { offset: 0, remainder: '' };

  // El fichero se trunco/roto: reiniciamos.
  if (st.size < rec.offset) {
    rec.offset = 0;
    rec.remainder = '';
  }
  if (st.size === rec.offset) {
    files.set(file, rec);
    return [];
  }

  const len = st.size - rec.offset;
  const buf = Buffer.alloc(len);
  const fd = fs.openSync(file, 'r');
  try {
    fs.readSync(fd, buf, 0, len, rec.offset);
  } finally {
    fs.closeSync(fd);
  }
  rec.offset = st.size;

  const data = rec.remainder + buf.toString('utf8');
  const parts = data.split('\n');
  rec.remainder = parts.pop(); // ultima linea posiblemente incompleta
  files.set(file, rec);

  const out = [];
  for (const line of parts) {
    const s = line.trim();
    if (!s) continue;
    try {
      out.push(JSON.parse(s));
    } catch (_) {
      /* linea corrupta, la ignoramos */
    }
  }
  return out;
}

function applyEvent(file, e) {
  const id = e.sessionId || file;
  let s = sessions.get(id);
  if (!s) {
    s = {
      id,
      file,
      project: '',
      state: 'idle',
      emoji: STATE_META.idle.emoji,
      label: STATE_META.idle.label,
      text: '',
      lastTime: 0,
      order: sessions.size,
    };
    sessions.set(id, s);
  }
  if (e.cwd) s.project = path.basename(String(e.cwd));

  const t = e.timestamp ? Date.parse(e.timestamp) : 0;
  const c = classify(e);
  if (c) {
    s.state = c.state;
    s.emoji = c.emoji;
    s.label = c.label;
    if (c.text !== undefined) s.text = trimText(c.text, 90);
    if (t) s.lastTime = t;
  }
}

function listJsonl() {
  let entries;
  try {
    entries = fs.readdirSync(PROJECTS_DIR, { recursive: true });
  } catch (_) {
    return [];
  }
  return entries
    .filter((rel) => String(rel).endsWith('.jsonl'))
    .map((rel) => path.join(PROJECTS_DIR, String(rel)));
}

function poll() {
  for (const file of listJsonl()) {
    let events;
    try {
      events = readNew(file);
    } catch (_) {
      continue;
    }
    for (const e of events) applyEvent(file, e);
  }
  pushSnapshot();
}

function pushSnapshot() {
  if (!win || win.isDestroyed() || !win.webContents) return;
  const agents = Array.from(sessions.values())
    .sort((a, b) => a.order - b.order)
    .map((s) => ({
      id: s.id,
      project: s.project || 'claude',
      state: s.state,
      emoji: s.emoji,
      label: s.label,
      text: s.text,
      lastTime: s.lastTime,
    }));
  win.webContents.send('agents', { agents, now: Date.now() });
}

// ---- Centro de mando: agentes via Claude Agent SDK -------------------------
// Lanza y dirige agentes de Claude Code desde la app. Cada agente es una
// llamada query() del SDK con entrada en streaming (generador asincrono), lo
// que permite mandarle mensajes de seguimiento (conversacion multivuelta).

const AGENT_MODEL = process.env.PIXEL_OFFICE_MODEL || 'claude-opus-4-8';
const agents = new Map(); // id -> { q, input, abort, cwd }

let _sdk = null;
async function getSDK() {
  if (!_sdk) _sdk = await import('@anthropic-ai/claude-agent-sdk');
  return _sdk;
}

// Cola que se comporta como AsyncIterable<SDKUserMessage>: el agente consume
// mensajes a medida que los empujamos (asi mantenemos la sesion viva).
function createInputQueue() {
  const queue = [];
  let resolveNext = null;
  let done = false;
  async function* generator() {
    while (!done) {
      if (queue.length > 0) {
        yield queue.shift();
      } else {
        await new Promise((res) => { resolveNext = res; });
      }
    }
  }
  return {
    push(msg) { queue.push(msg); if (resolveNext) { const r = resolveNext; resolveNext = null; r(); } },
    end() { done = true; if (resolveNext) { const r = resolveNext; resolveNext = null; r(); } },
    iterable: generator(),
  };
}

function userMsg(text) {
  return { type: 'user', message: { role: 'user', content: String(text) }, parent_tool_use_id: null };
}

function sendAgentEvent(payload) {
  if (win && !win.isDestroyed() && win.webContents) win.webContents.send('agent:event', payload);
}

function handleSdkMessage(id, m) {
  if (!m || !m.type) return;
  if (m.session_id) sendAgentEvent({ id, kind: 'session', sessionId: m.session_id });

  if (m.type === 'assistant') {
    const content = m.message && m.message.content;
    if (Array.isArray(content)) {
      const texts = [];
      for (const b of content) {
        if (b.type === 'text' && b.text) texts.push(b.text);
        else if (b.type === 'tool_use') {
          sendAgentEvent({ id, kind: 'tool', name: b.name, label: labelForTool({ name: b.name, input: b.input }, b.name) });
        }
      }
      if (texts.length) sendAgentEvent({ id, kind: 'assistant', text: texts.join('\n') });
    } else if (typeof content === 'string' && content.trim()) {
      sendAgentEvent({ id, kind: 'assistant', text: content });
    }
  } else if (m.type === 'result') {
    sendAgentEvent({ id, kind: 'result', subtype: m.subtype, cost: m.total_cost_usd, text: m.result });
  }
}

async function spawnAgent({ cwd, prompt }) {
  const id = randomUUID();
  const workdir = cwd && String(cwd).trim() ? String(cwd).trim() : process.cwd();
  const input = createInputQueue();
  const abort = new AbortController();

  let q;
  try {
    const { query } = await getSDK();
    q = query({
      prompt: input.iterable,
      options: {
        cwd: workdir,
        model: AGENT_MODEL,
        permissionMode: 'bypassPermissions',
        abortController: abort,
      },
    });
  } catch (e) {
    sendAgentEvent({ id, kind: 'error', text: 'No se pudo iniciar el SDK: ' + (e && e.message ? e.message : String(e)) });
    return { id, error: String(e && e.message ? e.message : e) };
  }

  agents.set(id, { id, q, input, abort, cwd: workdir });
  sendAgentEvent({ id, kind: 'spawned', cwd: workdir, prompt });
  input.push(userMsg(prompt));

  (async () => {
    try {
      for await (const m of q) handleSdkMessage(id, m);
    } catch (e) {
      sendAgentEvent({ id, kind: 'error', text: String(e && e.message ? e.message : e) });
    } finally {
      sendAgentEvent({ id, kind: 'closed' });
      agents.delete(id);
    }
  })();

  return { id, cwd: workdir };
}

function sendToAgent(id, text) {
  const a = agents.get(id);
  if (!a) return { ok: false, error: 'ese agente ya no esta activo' };
  a.input.push(userMsg(text));
  sendAgentEvent({ id, kind: 'user', text });
  return { ok: true };
}

async function interruptAgent(id) {
  const a = agents.get(id);
  if (a && a.q && typeof a.q.interrupt === 'function') {
    try { await a.q.interrupt(); } catch (_) { /* noop */ }
  }
  return { ok: true };
}

function stopAgent(id) {
  const a = agents.get(id);
  if (a) {
    try { a.input.end(); } catch (_) { /* noop */ }
    try { a.abort.abort(); } catch (_) { /* noop */ }
    agents.delete(id);
  }
  sendAgentEvent({ id, kind: 'closed' });
  return { ok: true };
}

ipcMain.handle('agent:spawn', (_e, opts) => spawnAgent(opts || {}));
ipcMain.handle('agent:send', (_e, { id, text }) => sendToAgent(id, text));
ipcMain.handle('agent:interrupt', (_e, { id }) => interruptAgent(id));
ipcMain.handle('agent:stop', (_e, { id }) => stopAgent(id));

// ---- Voz: transcripción local con Whisper -----------------------------------
// El audio del micrófono llega del render (Float32Array, 16 kHz mono) y se
// transcribe en un utilityProcess (stt-worker.js) para no bloquear la app.
// El modelo se descarga una vez a la carpeta de datos de la app.

const WHISPER_MODEL = process.env.PIXEL_OFFICE_WHISPER || 'onnx-community/whisper-base';
let stt = null; // { proc, pending: Map<reqId, resolve>, seq, last }

function sendVoiceStatus(payload) {
  if (stt) stt.last = payload;
  if (win && !win.isDestroyed() && win.webContents) win.webContents.send('voice:status', payload);
}

function getStt() {
  if (stt) return stt;
  const proc = utilityProcess.fork(path.join(__dirname, 'stt-worker.js'), [], {
    serviceName: 'Pixel Office - voz',
    stdio: 'inherit',
  });
  const me = { proc, pending: new Map(), seq: 0, last: null };
  stt = me;

  proc.on('message', (m) => {
    if (!m || !m.type) return;
    if (m.type === 'status') {
      sendVoiceStatus({ state: m.state, progress: m.progress, text: m.text });
    } else if (m.type === 'result' || m.type === 'error') {
      const done = me.pending.get(m.reqId);
      me.pending.delete(m.reqId);
      if (done) done(m.type === 'result' ? { text: m.text || '' } : { error: m.error || 'error' });
    }
  });
  proc.on('exit', (code) => {
    for (const done of me.pending.values()) done({ error: 'el motor de voz se cerró (código ' + code + ')' });
    me.pending.clear();
    if (stt === me) stt = null;
    if (!app.isQuitting) sendVoiceStatus({ state: 'error', text: 'El motor de voz se cerró; se reiniciará al volver a hablar.' });
  });

  loadModel(me);
  return me;
}

function loadModel(s) {
  s.proc.postMessage({
    type: 'load',
    model: WHISPER_MODEL,
    cacheDir: path.join(app.getPath('userData'), 'modelos-voz'),
  });
}

function transcribe(audio) {
  if (!audio || !audio.length) return Promise.resolve({ text: '' });
  const samples = audio instanceof Float32Array ? audio : new Float32Array(audio);
  // Límite de seguridad: 2 minutos de audio.
  const clipped = samples.length > 16000 * 120 ? samples.subarray(0, 16000 * 120) : samples;
  const s = getStt();
  const reqId = ++s.seq;
  return new Promise((resolve) => {
    s.pending.set(reqId, resolve);
    s.proc.postMessage({ type: 'transcribe', reqId, audio: clipped });
  });
}

ipcMain.handle('voice:prepare', () => {
  const fresh = !stt;
  const s = getStt();
  // Si la carga anterior falló (p. ej. sin conexión), lo reintentamos.
  if (!fresh && s.last && s.last.state === 'error') {
    s.last = null;
    loadModel(s);
  }
  return s.last || { state: 'loading', progress: 0, text: 'Preparando el modelo de voz…' };
});
ipcMain.handle('voice:transcribe', (_e, audio) => transcribe(audio));

// Solo dejamos usar el micrófono (audio). Cámara y demás permisos, denegados.
function setupPermissions() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    if (permission === 'media') {
      const types = (details && details.mediaTypes) || [];
      callback(types.length > 0 && types.every((t) => t === 'audio'));
      return;
    }
    callback(false);
  });
  ses.setPermissionCheckHandler((_wc, permission, _origin, details) => {
    if (permission === 'media') return !details || details.mediaType !== 'video';
    return true;
  });
}

// ---- Ventana ---------------------------------------------------------------

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 720,
    minHeight: 480,
    title: 'Pixel Office',
    backgroundColor: '#16121f',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.removeMenu();

  // Reenviar consola/errores del render al stdout principal (diagnóstico).
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    const src = sourceId ? sourceId.split(/[\\/]/).pop() : '';
    console.log(`[render] ${message}  (${src}:${line})`);
  });
  win.webContents.on('preload-error', (_e, p, error) => {
    console.error('[preload-error]', p, error && error.stack ? error.stack : error);
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.webContents.on('did-finish-load', () => {
    poll();
    setInterval(poll, POLL_MS);
  });
}

app.whenReady().then(() => {
  setupPermissions();
  createWindow();
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (stt) { try { stt.proc.kill(); } catch (_) { /* noop */ } }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
