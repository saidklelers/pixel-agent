'use strict';

const { app, BrowserWindow, ipcMain, session, utilityProcess } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { TEAM, VOICES, systemPromptFor, trainingPrompt, extractKnowledge, validateCustom, effectiveTeam } = require('./team');
const { synthesize } = require('./tts');
const { createBoard } = require('./board');

const SNAPSHOT_MS = 700; // cada cuanto mandamos el estado del equipo al render

let win = null;

// ---- Mapa de herramientas a estados ---------------------------------------

const TOOL_STATE = {
  Read: 'reading', Grep: 'reading', Glob: 'reading', LS: 'reading', NotebookRead: 'reading',
  Edit: 'coding', Write: 'coding', MultiEdit: 'coding', NotebookEdit: 'coding',
  Bash: 'running', PowerShell: 'running',
  WebSearch: 'web', WebFetch: 'web',
  Task: 'delegating', Agent: 'delegating',
};

const STATE_META = {
  idle:       { emoji: '\u{2615}', label: 'disponible' },
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

// ---- El equipo: 5 agentes fijos via Claude Agent SDK -----------------------
// Cada miembro (team.js) es una sesión de Claude Code con su especialidad.
// La sesión se crea al primer mensaje y se guarda (por carpeta de trabajo),
// así al reabrir la app siguen recordando la conversación. Cada agente es una
// llamada query() del SDK con entrada en streaming (generador asincrono), lo
// que permite mandarle mensajes de seguimiento (conversacion multivuelta).

const AGENT_MODEL = process.env.PIXEL_OFFICE_MODEL || 'claude-opus-4-8';
const STORE_FILE = () => path.join(app.getPath('userData'), 'equipo.json');
const BOARD_FILE = () => path.join(app.getPath('userData'), 'tareas.json');

// Datos persistentes: carpeta de trabajo, sesiones y capacitaciones.
let store = { cwd: '', members: {} };
function loadStore() {
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_FILE(), 'utf8'));
    if (raw && typeof raw === 'object') store = { cwd: raw.cwd || '', members: raw.members || {} };
  } catch (_) { /* primera vez */ }
  for (const m of TEAM) {
    const rec = store.members[m.id] || (store.members[m.id] = {});
    rec.sessions = rec.sessions || {};
    rec.skills = Array.isArray(rec.skills) ? rec.skills : [];
    rec.costs = rec.costs && typeof rec.costs === 'object' ? rec.costs : {}; // sessionId -> coste acumulado visto
    if (rec.custom && typeof rec.custom !== 'object') delete rec.custom;
    // una capacitación que se cortó al cerrar la app queda como pendiente
    for (const k of rec.skills) if (k.status === 'aprendiendo') k.status = 'pendiente';
  }
  if (!store.cwd) store.cwd = os.homedir();
  refreshMembers();
  try { board.restore(JSON.parse(fs.readFileSync(BOARD_FILE(), 'utf8'))); } catch (_) { /* primera vez */ }
}
function saveStore() {
  try {
    fs.mkdirSync(path.dirname(STORE_FILE()), { recursive: true });
    fs.writeFileSync(STORE_FILE(), JSON.stringify(store, null, 2));
  } catch (e) {
    console.error('[equipo] no se pudo guardar:', e && e.message);
  }
}

// El equipo tal como lo ha personalizado el usuario (nombre, voz, colores…).
let members = effectiveTeam({});
function refreshMembers() {
  const customs = {};
  for (const m of TEAM) customs[m.id] = (store.members[m.id] || {}).custom;
  members = effectiveTeam(customs);
}

// ---- Tablero de tareas -----------------------------------------------------
// Cada orden es una tarea con sus pasos (board.js). Se guarda en tareas.json y
// se manda al render (tablero de la pared y pantalla de cada agente).

const board = createBoard();
let boardSaveTimer = null;
let boardPushTimer = null;
function boardChanged() {
  if (!boardPushTimer) {
    boardPushTimer = setTimeout(() => {
      boardPushTimer = null;
      if (win && !win.isDestroyed() && win.webContents) win.webContents.send('board', board.snapshot());
    }, 250);
  }
  if (!boardSaveTimer) {
    boardSaveTimer = setTimeout(() => { boardSaveTimer = null; saveBoard(); }, 2000);
  }
}
function saveBoard() {
  try {
    fs.mkdirSync(path.dirname(BOARD_FILE()), { recursive: true });
    fs.writeFileSync(BOARD_FILE(), JSON.stringify(board.serialize()));
  } catch (e) {
    console.error('[tablero] no se pudo guardar:', e && e.message);
  }
}

// Estado en vivo de cada miembro (para el canvas y el panel).
const live = new Map(); // id -> { state, emoji, label, text, busy, q, input, abort, cwd, training }
for (const m of TEAM) live.set(m.id, { state: 'idle', emoji: meta('idle').emoji, label: 'disponible', text: '', busy: false });

function setState(id, state, label, text) {
  const l = live.get(id);
  if (!l) return;
  const m = meta(state);
  l.state = state;
  l.emoji = m.emoji;
  l.label = label || m.label;
  if (text !== undefined) l.text = trimText(text, 90);
}

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

function memberOf(id) { return members.find((m) => m.id === id) || null; }

function publicMember(m) {
  const rec = store.members[m.id];
  const l = live.get(m.id);
  return {
    id: m.id, name: m.name, from: m.from, role: m.role, emoji: m.emoji, aliases: m.aliases, look: m.look,
    voice: m.voice, prompt: m.prompt, customized: m.customized,
    skills: rec.skills.map((k) => ({ topic: k.topic, status: k.status || (k.notes ? 'aprendido' : 'pendiente') })),
    running: !!l.q, busy: l.busy,
  };
}

const AUTH_ERROR = /not logged in|please run \/login|invalid api key|oauth token (?:has )?expired|authentication_error/i;
const AUTH_HELP = 'Claude Code no tiene la sesión iniciada en este PC, así que el equipo no puede trabajar. ' +
  'Abre una terminal (PowerShell), escribe «claude», pulsa Enter y luego escribe «/login» para iniciar sesión con tu cuenta. ' +
  'Cuando termine, vuelve aquí y repite la orden.';

function handleSdkMessage(id, m) {
  if (!m || !m.type) return;
  const l = live.get(id);
  if (m.session_id && l && l.cwd) {
    const rec = store.members[id];
    if (rec.sessions[l.cwd] !== m.session_id) { rec.sessions[l.cwd] = m.session_id; saveStore(); }
  }

  if (m.type === 'assistant') {
    const content = m.message && m.message.content;
    if (Array.isArray(content)) {
      const texts = [];
      for (const b of content) {
        if (b.type === 'text' && b.text) texts.push(b.text);
        else if (b.type === 'tool_use') {
          const st = TOOL_STATE[b.name] || 'working';
          const label = labelForTool({ name: b.name, input: b.input }, meta(st).label);
          const step = board.tool(id, b.id, b.name, b.input);
          // los comandos de tests/lint/build: está validando
          setState(id, st, step && step.kind === 'validate' ? label.replace(meta(st).label, 'validando') : label);
          sendAgentEvent({ id, kind: 'tool', name: b.name, label });
          boardChanged();
        }
      }
      if (texts.length) {
        const text = texts.join('\n');
        // Sin sesión de Claude Code, el SDK responde con un texto en inglés
        // como si fuera el agente. Lo convertimos en un aviso claro (y así
        // tampoco se lee en voz alta).
        if (AUTH_ERROR.test(text) && text.length < 200) {
          setState(id, 'idle', 'sin sesión');
          sendAgentEvent({ id, kind: 'error', auth: true, text: AUTH_HELP });
          return;
        }
        setState(id, 'talking', null, text);
        board.say(id, text);
        boardChanged();
        sendAgentEvent({ id, kind: 'assistant', text, training: !!(l && l.training) });
      }
    }
  } else if (m.type === 'user') {
    // resultados de las herramientas (salida de comandos, archivos leídos…)
    const content = m.message && m.message.content;
    if (Array.isArray(content)) {
      let any = false;
      for (const b of content) {
        if (b && b.type === 'tool_result' && board.toolResult(b.tool_use_id, b.content, b.is_error)) any = true;
      }
      if (any) boardChanged();
    }
  } else if (m.type === 'result') {
    const cost = turnCost(id, m);
    const { next } = board.finish(id, {
      ok: m.subtype === 'success' && !m.is_error, cost, turns: m.num_turns, durationMs: m.duration_ms,
      text: m.result || (Array.isArray(m.errors) ? m.errors.join('\n') : ''),
    });
    boardChanged();
    if (l) l.busy = board.busy(id);
    if (next) setState(id, 'prompt', null, next.text);
    else setState(id, 'idle', 'disponible');
    if (l && l.training) finishTraining(id, m.result || '');
    sendAgentEvent({ id, kind: 'result', subtype: m.subtype, cost, text: m.result, busy: !!(l && l.busy) });
    // cambios de personalización pendientes: se aplican al quedar libre
    if (l && l.restartAfter && !l.busy && !l.training) { l.restartAfter = false; stopMember(id); }
  }
}

// Coste del turno. El SDK da el acumulado de la sesión; guardamos el último
// visto por sesión para restar (si el proceso empezó de cero, el total es menor).
function turnCost(id, m) {
  const total = Number(m.total_cost_usd);
  if (!Number.isFinite(total) || total < 0) return 0;
  const l = live.get(id);
  const rec = store.members[id];
  const key = m.session_id || (l && l.cwd) || '-';
  const seen = l && l.costSeen != null ? l.costSeen : (rec.costs[key] || 0);
  const cost = total >= seen ? total - seen : total;
  if (l) l.costSeen = total;
  rec.costs[key] = total;
  const keys = Object.keys(rec.costs);
  if (keys.length > 30) delete rec.costs[keys[0]];
  saveStore();
  return cost;
}

// Arranca (o reanuda) la sesión de un miembro en la carpeta de trabajo actual.
async function ensureRunning(id) {
  const member = memberOf(id);
  const l = live.get(id);
  if (!member || !l) throw new Error('ese agente no existe');
  if (l.q) return;
  const cwd = store.cwd;
  const rec = store.members[id];
  const input = createInputQueue();
  const abort = new AbortController();
  const { query } = await getSDK();
  const options = {
    cwd,
    model: AGENT_MODEL,
    permissionMode: 'bypassPermissions',
    abortController: abort,
    systemPrompt: { type: 'preset', preset: 'claude_code', append: systemPromptFor(member, rec.skills, members) },
  };
  if (rec.sessions[cwd]) options.resume = rec.sessions[cwd];
  const q = query({ prompt: input.iterable, options });
  Object.assign(l, { q, input, abort, cwd, costSeen: null, restartAfter: false });
  sendAgentEvent({ id, kind: 'spawned', cwd, resumed: !!options.resume });

  (async () => {
    try {
      for await (const m of q) handleSdkMessage(id, m);
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      // Si la sesión guardada ya no existe, la olvidamos para empezar limpia.
      if (options.resume && /session|conversation|not found|no .*encontr/i.test(msg)) {
        delete rec.sessions[cwd];
        saveStore();
      }
      const auth = AUTH_ERROR.test(msg) || /exited with code|authenticat|login/i.test(msg);
      if (!abort.signal.aborted) sendAgentEvent({ id, kind: 'error', auth, text: auth ? msg + ' — ' + AUTH_HELP : msg });
    } finally {
      if (l.q === q) {
        board.closeAll(id, 'La sesión se cerró antes de terminar.');
        boardChanged();
        Object.assign(l, { q: null, input: null, abort: null, busy: false });
        if (l.training) { l.training = null; markTraining(id, 'pendiente'); }
        setState(id, 'idle', 'disponible');
      }
      sendAgentEvent({ id, kind: 'closed' });
    }
  })();
}

async function sendToMember(id, text, kind) {
  try {
    await ensureRunning(id);
  } catch (e) {
    const msg = 'No se pudo iniciar el agente: ' + (e && e.message ? e.message : String(e));
    sendAgentEvent({ id, kind: 'error', text: msg });
    return { ok: false, error: msg };
  }
  const l = live.get(id);
  const wasBusy = board.busy(id);
  const task = board.add(id, kind === 'capacitacion' ? `🎓 Capacitarse en «${l.trainingTopic || ''}»` : text, { kind: kind || 'orden' });
  boardChanged();
  l.busy = true;
  if (!wasBusy) setState(id, 'prompt', null, text);
  l.input.push(userMsg(text));
  sendAgentEvent({ id, kind: 'user', text, queued: wasBusy });
  return { ok: true, task: task.id, queued: wasBusy };
}

async function interruptMember(id) {
  const l = live.get(id);
  if (l && l.q && typeof l.q.interrupt === 'function') {
    if (board.markInterrupted(id)) boardChanged();
    try { await l.q.interrupt(); } catch (_) { /* noop */ }
  }
  return { ok: true };
}

function stopMember(id) {
  const l = live.get(id);
  if (l && l.q) {
    try { l.input.end(); } catch (_) { /* noop */ }
    try { l.abort.abort(); } catch (_) { /* noop */ }
  }
  return { ok: true };
}

// Olvida la conversación (la próxima orden empieza de cero). Lo aprendido se queda.
function resetMember(id) {
  stopMember(id);
  const rec = store.members[id];
  if (rec) { rec.sessions = {}; saveStore(); }
  return { ok: true };
}

// ---- Capacitaciones --------------------------------------------------------

function markTraining(id, status, notes) {
  const l = live.get(id);
  const rec = store.members[id];
  const topic = l && l.trainingTopic;
  if (!rec || !topic) return;
  const k = rec.skills.find((s) => s.topic.toLowerCase() === topic.toLowerCase());
  if (!k) return;
  k.status = status;
  if (notes) { k.notes = notes; k.at = new Date().toISOString(); }
  saveStore();
  sendAgentEvent({ id, kind: 'team' });
}

function finishTraining(id, resultText) {
  const l = live.get(id);
  const notes = extractKnowledge(resultText);
  markTraining(id, notes ? 'aprendido' : 'pendiente', notes || null);
  sendAgentEvent({ id, kind: 'trained', topic: l.trainingTopic, ok: !!notes });
  l.training = null;
  // Reiniciamos la sesión para que el nuevo conocimiento entre en su prompt
  // de sistema; la conversación se reanuda igual (misma sesión guardada).
  // Si ya tiene otra orden en marcha, se reinicia cuando la termine.
  if (board.busy(id)) l.restartAfter = true;
  else stopMember(id);
}

async function trainMember(id, topic) {
  const t = String(topic || '').trim().replace(/[.。]+$/, '');
  if (!t) return { ok: false, error: 'falta el tema' };
  const l = live.get(id);
  const rec = store.members[id];
  if (!l || !rec) return { ok: false, error: 'ese agente no existe' };
  if (l.busy) return { ok: false, error: `${memberOf(id).name} está ocupado; espera a que termine o interrúmpelo` };
  let k = rec.skills.find((s) => s.topic.toLowerCase() === t.toLowerCase());
  if (!k) { k = { topic: t }; rec.skills.push(k); }
  k.status = 'aprendiendo';
  saveStore();
  l.trainingTopic = t;
  const res = await sendToMember(id, trainingPrompt(t), 'capacitacion');
  if (!res.ok) { k.status = 'pendiente'; saveStore(); return res; }
  l.training = { topic: t };
  setState(id, 'reading', `capacitándose: ${t}`);
  sendAgentEvent({ id, kind: 'team' });
  return { ok: true };
}

function forgetSkill(id, topic) {
  const rec = store.members[id];
  if (!rec) return { ok: false };
  rec.skills = rec.skills.filter((s) => s.topic.toLowerCase() !== String(topic).toLowerCase());
  saveStore();
  sendAgentEvent({ id, kind: 'team' });
  return { ok: true };
}

// Cambiar la carpeta de trabajo: las sesiones abiertas se cierran y cada
// miembro retoma (o empieza) la conversación de esa carpeta.
function setCwd(cwd) {
  const c = String(cwd || '').trim();
  if (!c) return { ok: false, error: 'carpeta vacía' };
  if (!fs.existsSync(c)) return { ok: false, error: 'esa carpeta no existe' };
  if (c === store.cwd) return { ok: true, cwd: c };
  store.cwd = c;
  saveStore();
  for (const m of TEAM) stopMember(m.id);
  return { ok: true, cwd: c };
}

function pushSnapshot() {
  if (!win || win.isDestroyed() || !win.webContents) return;
  const now = Date.now();
  const agents = members.map((m) => {
    const l = live.get(m.id);
    return {
      id: m.id, name: m.name, role: m.role, look: m.look, project: m.name,
      state: l.state, emoji: l.emoji, label: l.label, text: l.text, busy: l.busy, lastTime: now,
    };
  });
  win.webContents.send('agents', { agents, now });
}

ipcMain.handle('team:list', () => ({ cwd: store.cwd, members: members.map(publicMember), voices: VOICES }));
ipcMain.handle('team:send', (_e, { id, text }) => sendToMember(id, text));
ipcMain.handle('team:interrupt', (_e, { id }) => interruptMember(id));
ipcMain.handle('team:reset', (_e, { id }) => resetMember(id));
ipcMain.handle('team:train', (_e, { id, topic }) => trainMember(id, topic));
ipcMain.handle('team:forget', (_e, { id, topic }) => forgetSkill(id, topic));
ipcMain.handle('team:cwd', (_e, { cwd }) => setCwd(cwd));
ipcMain.handle('team:customize', (_e, { id, custom } = {}) => customizeMember(id, custom));
ipcMain.handle('board:get', () => board.snapshot());
ipcMain.handle('board:clear', (_e, { id } = {}) => { board.clearDone(id || null); boardChanged(); return { ok: true }; });

// Personalizar a un miembro (custom = null lo devuelve a su versión original).
function customizeMember(id, custom) {
  const rec = store.members[id];
  if (!rec || !memberOf(id)) return { ok: false, error: 'ese agente no existe' };
  if (custom == null) {
    delete rec.custom;
  } else {
    const others = members.filter((m) => m.id !== id).map((m) => m.name);
    const v = validateCustom(custom, others);
    if (!v.ok) return v;
    rec.custom = v.custom;
  }
  saveStore();
  refreshMembers();
  // El prompt de sistema cambia: la sesión se reinicia (retomando la
  // conversación) en cuanto el miembro esté libre. Y los compañeros también,
  // porque el prompt de todos incluye los nombres del equipo.
  for (const m of TEAM) {
    const l = live.get(m.id);
    if (!l || !l.q) continue;
    if (l.busy || l.training) l.restartAfter = true;
    else stopMember(m.id);
  }
  if (stt && !stt.replaced) stt.proc.postMessage({ type: 'names', names: members.map((m) => m.name) });
  sendAgentEvent({ id, kind: 'team' });
  return { ok: true, member: publicMember(memberOf(id)) };
}

// ---- Voz: transcripción local con Whisper -----------------------------------
// El audio del micrófono llega del render (Float32Array, 16 kHz mono) y se
// transcribe en un utilityProcess (stt-worker.js) para no bloquear la app.
// El modelo se descarga una vez a la carpeta de datos de la app.

// Precisión del reconocimiento (se elige en el panel): "precisa" usa Whisper
// small (mucho mejor en español, ~500 MB la primera vez) y "rapida" Whisper
// base (~130 MB, más rápido en PCs modestos). PIXEL_OFFICE_WHISPER manda.
const WHISPER_MODELS = {
  precisa: 'onnx-community/whisper-small',
  rapida: 'onnx-community/whisper-base',
};
function whisperModel(quality) {
  return process.env.PIXEL_OFFICE_WHISPER || WHISPER_MODELS[quality] || WHISPER_MODELS.precisa;
}
let stt = null; // { proc, model, pending: Map<reqId, resolve>, seq, last }

function sendVoiceStatus(payload) {
  if (stt) stt.last = payload;
  if (win && !win.isDestroyed() && win.webContents) win.webContents.send('voice:status', payload);
}

function getStt(quality) {
  const model = whisperModel(quality);
  if (stt && stt.model !== model) {
    // cambio de precisión: cerramos el motor y arrancamos con el otro modelo
    stt.replaced = true;
    try { stt.proc.kill(); } catch (_) { /* noop */ }
    stt = null;
  }
  if (stt) return stt;
  const proc = utilityProcess.fork(path.join(__dirname, 'stt-worker.js'), [], {
    serviceName: 'Pixel Office - voz',
    stdio: 'inherit',
  });
  const me = { proc, model, pending: new Map(), seq: 0, last: null };
  stt = me;

  proc.on('message', (m) => {
    if (!m || !m.type) return;
    if (m.type === 'status') {
      if (m.state !== 'loading') console.log(`[voz] ${m.state}: ${m.text || ''}`);
      sendVoiceStatus({ state: m.state, progress: m.progress, text: m.text });
    } else if (m.type === 'result' || m.type === 'error') {
      const done = me.pending.get(m.reqId);
      me.pending.delete(m.reqId);
      if (m.type === 'result') console.log(`[voz] transcrito: «${m.text || ''}»`);
      else console.error('[voz] error al transcribir:', m.error);
      if (done) done(m.type === 'result' ? { text: m.text || '' } : { error: m.error || 'error' });
    }
  });
  proc.on('exit', (code) => {
    for (const done of me.pending.values()) done({ error: 'el motor de voz se cerró (código ' + code + ')' });
    me.pending.clear();
    if (stt === me) stt = null;
    if (!app.isQuitting && !me.replaced) sendVoiceStatus({ state: 'error', text: 'El motor de voz se cerró; se reiniciará al volver a hablar.' });
  });

  loadModel(me);
  return me;
}

function loadModel(s) {
  s.proc.postMessage({
    type: 'load',
    model: s.model,
    cacheDir: path.join(app.getPath('userData'), 'modelos-voz'),
    names: members.map((m) => m.name), // pista para que Whisper escriba bien los nombres
  });
}

function transcribe(audio, quality) {
  if (!audio || !audio.length) return Promise.resolve({ text: '' });
  const samples = audio instanceof Float32Array ? audio : new Float32Array(audio);
  // Límite de seguridad: 2 minutos de audio (slice copia solo ese trozo).
  const MAX = 16000 * 120;
  const clipped = samples.length > MAX ? samples.slice(0, MAX) : samples;
  const s = getStt(quality);
  const reqId = ++s.seq;
  const ready = !!(s.last && s.last.state === 'ready');
  return new Promise((resolve) => {
    // Nunca dejamos el micro bloqueado: si el motor se cuelga, lo reiniciamos;
    // si aún descarga el modelo, avisamos para reintentar luego.
    const timer = setTimeout(() => {
      if (!s.pending.has(reqId)) return;
      s.pending.delete(reqId);
      if (ready) {
        try { s.proc.kill(); } catch (_) { /* noop */ }
        resolve({ error: 'la transcripción tardó demasiado; se ha reiniciado el motor de voz' });
      } else {
        resolve({ error: 'el modelo de voz aún se está descargando; inténtalo cuando termine' });
      }
    }, ready ? 60000 : 180000);
    s.pending.set(reqId, (r) => { clearTimeout(timer); resolve(r); });
    s.proc.postMessage({ type: 'transcribe', reqId, audio: clipped });
  });
}

ipcMain.handle('voice:prepare', (_e, opts) => {
  const quality = opts && opts.quality;
  const fresh = !stt || stt.model !== whisperModel(quality);
  const s = getStt(quality);
  // Si la carga anterior falló (p. ej. sin conexión), lo reintentamos.
  if (!fresh && s.last && s.last.state === 'error') {
    s.last = null;
    loadModel(s);
  }
  return s.last || { state: 'loading', progress: 0, text: 'Preparando el modelo de voz…' };
});
ipcMain.handle('voice:transcribe', (_e, { audio, quality } = {}) => transcribe(audio, quality));

// Voz natural de un miembro del equipo: devuelve el MP3 (o un error, y el
// render usa entonces la voz del sistema).
ipcMain.handle('tts:speak', async (_e, { id, text, voice } = {}) => {
  const member = memberOf(id);
  // voice: prueba de una voz desde «Personalizar equipo» (sin guardar)
  let v = member && member.voice;
  if (voice) {
    const t = validateCustom({ voice }, []);
    if (!t.ok) return { error: t.error };
    v = (effectiveTeam({ [id]: t.custom }).find((m) => m.id === id) || {}).voice || t.custom.voice;
  }
  try {
    const audio = await synthesize(text, v);
    return { audio: new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength) };
  } catch (e) {
    console.error('[voz natural]', e && e.message ? e.message : e);
    return { error: String(e && e.message ? e.message : e) };
  }
});

// Solo la propia app (file://) puede usar el micrófono, y solo audio.
// Cámara y demás permisos, denegados.
function isAppUrl(u) { return String(u || '').startsWith('file://'); }

function setupPermissions() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    if (permission === 'media' && isAppUrl(details && details.requestingUrl)) {
      const types = (details && details.mediaTypes) || [];
      callback(types.length > 0 && types.every((t) => t === 'audio'));
      return;
    }
    callback(false);
  });
  ses.setPermissionCheckHandler((_wc, permission, origin, details) => {
    if (permission === 'media') return isAppUrl(origin) && !(details && details.mediaType === 'video');
    return false;
  });
}

// ---- Ventana ---------------------------------------------------------------

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
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

  // La ventana solo muestra la app: nada de navegar a otras páginas (p. ej.
  // al soltar un archivo o un enlace), que heredarían agentApi/voiceApi.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

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
    pushSnapshot();
    win.webContents.send('board', board.snapshot());
  });
}

app.whenReady().then(() => {
  loadStore();
  setupPermissions();
  createWindow();
  setInterval(pushSnapshot, SNAPSHOT_MS);
});

app.on('before-quit', () => {
  app.isQuitting = true;
  for (const m of TEAM) stopMember(m.id);
  saveBoard();
  if (stt) { try { stt.proc.kill(); } catch (_) { /* noop */ } }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
