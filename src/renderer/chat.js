'use strict';

// ---------------------------------------------------------------------------
// Centro de mando: lanza y dirige agentes de Claude Code desde la oficina.
// - Casilla por agente: elige quiénes reciben la orden (difusión a varios).
// - "Todos / Ninguno": atajos de selección.
// - Enviar manda la misma instrucción a todos los marcados a la vez; si no
//   hay ninguno marcado, va al agente que estás viendo.
// - Voz: 🎤 (o Ctrl+Espacio) graba, Whisper transcribe en local y la frase se
//   interpreta como orden (voice-commands.js): "Ana, revisa…", "todos, paren",
//   "nuevo agente llamado Leo: …". Las respuestas se leen en voz alta.
// - Clic en un personaje del canvas: pasa a ser el destino.
// Habla con el proceso principal por IPC (window.agentApi / window.voiceApi).
// ---------------------------------------------------------------------------

const el = (id) => document.getElementById(id);
const agentListEl = el('agentList');
const convoEl = el('convo');
const cwdEl = el('cwd');
const msgEl = el('msg');
const hintEl = el('hint');
const targetInfoEl = el('targetInfo');
const agentNameEl = el('agentName');
const micBtn = el('micBtn');
const ttsBtn = el('ttsBtn');
const skipBtn = el('skipBtn');
const voiceStatusEl = el('voiceStatus');

const VC = window.VoiceCommands;
const PV = window.PixelVoice;
const voiceIpc = window.voiceApi;

// Estado compartido con el canvas (renderer.js):
// - PIXEL_AGENT_NAMES: sessionId -> nombre (etiqueta del personaje)
// - PIXEL_TARGET_SESSIONS: sessionIds que recibirán la próxima orden
// - PIXEL_SPEAKING_SESSION: sessionId del agente que está hablando
window.PIXEL_AGENT_NAMES = window.PIXEL_AGENT_NAMES || {};
window.PIXEL_TARGET_SESSIONS = new Set();
window.PIXEL_SPEAKING_SESSION = null;

window.addEventListener('error', (e) => {
  console.error('CHAT-ERROR:', e.message, '@', (e.filename || '').split(/[\\/]/).pop() + ':' + e.lineno);
});

const NAME_POOL = ['Ana', 'Beto', 'Carla', 'Diego', 'Elena', 'Fran', 'Gabi', 'Hugo',
  'Iris', 'Javi', 'Kira', 'Leo', 'Marta', 'Nico', 'Olga', 'Pablo', 'Quim', 'Rosa',
  'Sergio', 'Tania', 'Uxía', 'Vera', 'Wendy', 'Ximo', 'Yago', 'Zoe'];

const agents = new Map(); // id -> { num, name, cwd, sessionId, status, messages: [] }
const selected = new Set(); // ids marcados para difusión
let activeId = null;
let counter = 0;

function usedNames() {
  return new Set([...agents.values()].map((a) => (a.name || '').toLowerCase()));
}
function suggestName() {
  const used = usedNames();
  for (const n of NAME_POOL) if (!used.has(n.toLowerCase())) return n;
  return 'Agente ' + (agents.size + 1);
}
// Evita dos agentes con nombres iguales o que SUENAN igual (Ana/Anna,
// Gabi/Gaby): por voz no se podrían distinguir.
function nameKey(n) { return VC ? VC.phonKey(n) : String(n).toLowerCase(); }
function uniqueName(name) {
  const used = new Set([...agents.values()].filter((a) => a.name).map((a) => nameKey(a.name)));
  if (!used.has(nameKey(name))) return name;
  for (let i = 2; ; i++) if (!used.has(nameKey(`${name} ${i}`))) return `${name} ${i}`;
}

function hint(text, isErr) {
  hintEl.textContent = text || '';
  hintEl.classList.toggle('err', !!isErr);
}

function shortName(a) {
  if (a.name) return a.name;
  const base = a.cwd ? a.cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() : 'claude';
  return `#${a.num} ${base || 'claude'}`;
}

function isLive(a) { return a && a.status !== 'closed'; }

// Agentes que recibirán el próximo Enviar.
function targets() {
  if (selected.size) return [...selected].filter((id) => agents.has(id));
  if (activeId && agents.has(activeId)) return [activeId];
  return [];
}

function syncCanvas() {
  const s = new Set();
  for (const id of targets()) {
    const a = agents.get(id);
    if (a && a.sessionId) s.add(a.sessionId);
  }
  window.PIXEL_TARGET_SESSIONS = s;
  const speakingKey = PV ? PV.speaker.speakingKey() : null;
  const sp = speakingKey && agents.get(speakingKey);
  window.PIXEL_SPEAKING_SESSION = sp ? sp.sessionId : null;
}

function updateTargetInfo() {
  const t = targets();
  let txt;
  let broadcast = false;
  if (selected.size) {
    txt = `🎯 ${t.length} agente(s) a la vez`;
    broadcast = t.length > 1;
  } else if (activeId && agents.has(activeId)) {
    txt = `🎯 ${shortName(agents.get(activeId))}`;
  } else {
    txt = '🎯 Nuevo agente';
  }
  targetInfoEl.textContent = txt;
  targetInfoEl.classList.toggle('broadcast', broadcast);
  syncCanvas();
}

// Círculo con la inicial y el color de camiseta del personaje.
function avatar(a) {
  const av = document.createElement('span');
  av.className = 'avatar';
  const look = a.sessionId && window.PixelOffice ? window.PixelOffice.lookFor(a.sessionId) : null;
  av.style.background = look ? look.shirt : `hsl(${(a.num * 67) % 360} 45% 55%)`;
  av.textContent = (shortName(a).replace(/^#\d+\s*/, '') || '?').charAt(0).toUpperCase();
  return av;
}

function renderAgentList() {
  agentListEl.innerHTML = '';
  const speakingKey = PV ? PV.speaker.speakingKey() : null;
  for (const a of agents.values()) {
    const chip = document.createElement('div');
    chip.className = 'agent-chip' + (a.id === activeId ? ' active' : '') +
      (selected.has(a.id) ? ' picked' : '') + (a.id === speakingKey ? ' speaking' : '') +
      (a.status === 'closed' ? ' closed' : '');
    chip.title = a.cwd;

    const pick = document.createElement('input');
    pick.type = 'checkbox';
    pick.className = 'pick';
    pick.checked = selected.has(a.id);
    pick.title = 'Marcar para difusión';
    pick.addEventListener('click', (e) => e.stopPropagation());
    pick.addEventListener('change', () => {
      if (pick.checked) selected.add(a.id); else selected.delete(a.id);
      renderAgentList();
    });

    const dot = document.createElement('span');
    dot.className = 'dot ' + (a.status === 'busy' ? 'busy' : a.status === 'live' ? 'live' : '');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = shortName(a);

    const del = document.createElement('span');
    del.className = 'chip-del';
    del.textContent = '✕';
    del.title = 'Eliminar agente';
    del.addEventListener('click', (e) => { e.stopPropagation(); deleteAgent(a.id); });

    chip.appendChild(pick);
    chip.appendChild(avatar(a));
    chip.appendChild(name);
    chip.appendChild(dot);
    chip.appendChild(del);
    chip.addEventListener('click', () => { activeId = a.id; renderAgentList(); renderConvo(); hint(`Seleccionado: ${shortName(a)} (Enviar le hablará a este)`); });
    agentListEl.appendChild(chip);
  }
  updateTargetInfo();
}

function renderConvo() {
  convoEl.innerHTML = '';
  const a = agents.get(activeId);
  if (!a) {
    const d = document.createElement('div');
    d.className = 'empty-convo';
    d.innerHTML = '<div class="empty-icon">🎙️</div>Selecciona o lanza un agente para ver su conversación.' +
      '<br><br>Escribe una tarea y pulsa <b>＋ Agente</b>, o mantén <b>🎤</b> y di<br>' +
      '<i>«Nuevo agente llamado Leo: revisa los tests»</i>.';
    convoEl.appendChild(d);
    return;
  }
  for (const m of a.messages) {
    if (m.role === 'assistant') {
      const row = document.createElement('div');
      row.className = 'msg-row';
      row.appendChild(avatar(a));
      const b = document.createElement('div');
      b.className = 'bubble assistant';
      b.textContent = m.text;
      row.appendChild(b);
      convoEl.appendChild(row);
      continue;
    }
    const div = document.createElement('div');
    if (m.role === 'user') {
      div.className = 'bubble user' + (m.voice ? ' voice' : '');
      div.textContent = (m.voice ? '🎤 ' : '') + m.text;
    } else if (m.role === 'tool') { div.className = 'line-tool'; div.textContent = '⚙️ ' + m.text; }
    else if (m.role === 'error') { div.className = 'line-error'; div.textContent = '⚠️ ' + m.text; }
    else { div.className = 'line-system'; div.textContent = m.text; }
    convoEl.appendChild(div);
  }
  convoEl.scrollTop = convoEl.scrollHeight;
}

function push(id, role, text, extra) {
  const a = agents.get(id);
  if (!a) return;
  a.messages.push(Object.assign({ role, text }, extra || {}));
  if (id === activeId) renderConvo();
}

function setStatus(id, status) {
  const a = agents.get(id);
  if (a) { a.status = status; renderAgentList(); }
}

// ---- Acciones --------------------------------------------------------------

// opts: { prompt, name, voice } — sin prompt usa la caja de texto.
async function spawn(opts) {
  const o = opts && typeof opts === 'object' && !(opts instanceof Event) ? opts : {};
  const fromBox = o.prompt == null;
  const prompt = String(fromBox ? msgEl.value : o.prompt).trim();
  console.log('spawn(): texto=' + prompt.length + ' chars, api=' + !!(window.agentApi && window.agentApi.spawn));
  if (!prompt) { msgEl.focus(); hint('✍️ Escribe primero una tarea en la caja grande, luego pulsa ＋ Agente.', true); return; }
  const cwd = cwdEl.value.trim();
  const name = uniqueName(o.name || agentNameEl.value.trim() || suggestName());
  hint('Lanzando agente…');
  try {
    const res = await window.agentApi.spawn({ cwd, prompt });
    if (!res || res.error) { hint('Error: ' + ((res && res.error) || 'desconocido'), true); return; }
    if (!agents.has(res.id)) {
      counter += 1;
      agents.set(res.id, { id: res.id, num: counter, name, cwd: res.cwd || cwd, sessionId: null, status: 'busy', messages: [] });
    } else {
      agents.get(res.id).name = name;
    }
    activeId = res.id;
    push(res.id, 'user', prompt, { voice: !!o.voice });
    renderAgentList();
    renderConvo();
    if (fromBox) msgEl.value = '';
    agentNameEl.value = suggestName();
    hint(`Agente "${name}" lanzado. Aparecerá caminando a su escritorio.`);
  } catch (e) {
    hint('Error al lanzar: ' + (e && e.message ? e.message : e), true);
  }
}

// Manda el mismo texto a varios agentes. Devuelve cuántos lo recibieron.
async function sendTo(ids, text, extra) {
  let sent = 0;
  for (const id of ids) {
    try {
      const res = await window.agentApi.send(id, text);
      if (res && res.ok === false) continue;
      push(id, 'user', text, extra);
      setStatus(id, 'busy');
      sent += 1;
    } catch (_) { /* sigue con los demás */ }
  }
  return sent;
}

async function send() {
  const t = targets();
  if (!t.length) { spawn(); return; }
  const text = msgEl.value.trim();
  if (!text) { msgEl.focus(); return; }
  const sent = await sendTo(t, text);
  msgEl.value = '';
  hint(sent > 1 ? `Orden enviada a ${sent} agentes a la vez.` : sent === 1 ? '' : 'No se pudo enviar.', sent === 0);
}

async function stopIds(ids) {
  for (const id of ids) {
    if (PV) PV.speaker.forget(id);
    try { await window.agentApi.stop(id); } catch (_) { /* noop */ }
  }
}

async function interruptIds(ids) {
  for (const id of ids) {
    if (PV) PV.speaker.forget(id);
    try { await window.agentApi.interrupt(id); } catch (_) { /* noop */ }
  }
}

async function stop() {
  await stopIds(targets());
}

async function deleteAgent(id) {
  await stopIds([id]);
  const a = agents.get(id);
  if (a && a.sessionId) delete window.PIXEL_AGENT_NAMES[a.sessionId];
  agents.delete(id);
  selected.delete(id);
  if (activeId === id) activeId = agents.size ? agents.keys().next().value : null;
  renderAgentList();
  renderConvo();
  hint('Agente eliminado.');
}

function selectAll() {
  for (const id of agents.keys()) selected.add(id);
  renderAgentList();
}
function selectNone() {
  selected.clear();
  renderAgentList();
}

// Elige destino: uno solo pasa a ser el activo; varios quedan marcados.
function selectIds(ids) {
  selected.clear();
  if (ids.length === 1) activeId = ids[0];
  else for (const id of ids) selected.add(id);
  renderAgentList();
  renderConvo();
}

el('spawnBtn').addEventListener('click', () => spawn());
el('sendBtn').addEventListener('click', send);
el('newAgent').addEventListener('click', () => { msgEl.focus(); hint('Escribe la tarea y pulsa ＋ Agente (o dila con 🎤).'); });
el('stopBtn').addEventListener('click', stop);
el('selAll').addEventListener('click', selectAll);
el('selNone').addEventListener('click', selectNone);
msgEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
});

// ---- Clic en un personaje del canvas ---------------------------------------

window.addEventListener('pixel:pick', (e) => {
  const d = e.detail || {};
  const a = [...agents.values()].find((x) => x.sessionId && x.sessionId === d.sessionId);
  if (!a) {
    hint('Ese personaje es una sesión de Claude Code abierta fuera de la app: solo puedes dar órdenes a los agentes lanzados desde aquí.', true);
    return;
  }
  if (d.additive) {
    if (selected.has(a.id)) selected.delete(a.id); else selected.add(a.id);
    hint(`${selected.has(a.id) ? 'Marcado' : 'Desmarcado'}: ${shortName(a)} (${selected.size} para difusión)`);
  } else {
    selected.clear();
    activeId = a.id;
    hint(`🎯 Hablando con ${shortName(a)}: mantén 🎤 (o Ctrl+Espacio) y habla, o escribe.`);
  }
  renderAgentList();
  renderConvo();
});

// ---- Voz: órdenes habladas -------------------------------------------------

let pendingSpawn = null; // { name, until } tras "nuevo agente llamado X" sin tarea
const PENDING_SPAWN_MS = 30000;

function liveAgents() { return [...agents.values()].filter(isLive); }

function resolveTo(to) {
  if (to === 'all') return { ids: liveAgents().map((a) => a.id), missing: [] };
  const ids = [];
  const missing = [];
  for (const n of to || []) {
    const k = VC.phonKey(n);
    const a = liveAgents().find((x) => VC.phonKey(shortName(x)) === k);
    if (a && !ids.includes(a.id)) ids.push(a.id);
    else if (!a) missing.push(n);
  }
  return { ids, missing };
}

function namesOf(ids) {
  return ids.map((id) => shortName(agents.get(id))).join(', ');
}

async function runVoiceCommand(text) {
  const heard = `🎤 «${text}»`;
  const cmd = VC.parseCommand(text, liveAgents().map(shortName));
  console.log('voz: ' + JSON.stringify(cmd));

  // "nuevo agente llamado Leo" + (siguiente frase) "revisa los tests"
  if (pendingSpawn && Date.now() > pendingSpawn.until) pendingSpawn = null;
  if (pendingSpawn && cmd.type === 'send' && !cmd.to && cmd.text) {
    const name = pendingSpawn.name;
    pendingSpawn = null;
    await spawn({ prompt: cmd.text, name, voice: true });
    return;
  }
  pendingSpawn = null;

  switch (cmd.type) {
    case 'empty':
      hint('🎤 No te he entendido. Prueba otra vez.', true);
      return;

    case 'silence':
      if (PV) PV.speaker.stopAll();
      hint(`${heard} → 🔇 silencio`);
      return;

    case 'spawn':
      if (!cmd.text) {
        pendingSpawn = { name: cmd.name, until: Date.now() + PENDING_SPAWN_MS };
        if (cmd.name) agentNameEl.value = cmd.name;
        hint(`${heard} → ¿Qué tiene que hacer ${cmd.name || 'el nuevo agente'}? Dímelo ahora.`);
        return;
      }
      await spawn({ prompt: cmd.text, name: cmd.name, voice: true });
      return;

    case 'select': {
      const r = resolveTo(cmd.to);
      if (!r.ids.length) { hint(`${heard} → no hay ningún agente activo con ese nombre.`, true); return; }
      selectIds(r.ids);
      hint(`${heard} → 🎯 ahora hablas con ${namesOf(r.ids)}`);
      return;
    }

    case 'interrupt':
    case 'stop': {
      const r = cmd.to ? resolveTo(cmd.to) : { ids: targets(), missing: [] };
      if (!r.ids.length) { hint(`${heard} → no hay a quién detener.`, true); return; }
      if (cmd.type === 'stop') {
        // Cerrar sesiones no se deshace: pedimos confirmación.
        if (!window.confirm(`¿Cerrar la sesión de ${namesOf(r.ids)}?\n\n(Has dicho: «${text}»)`)) {
          hint(`${heard} → cancelado, no se ha cerrado nada.`);
          return;
        }
        await stopIds(r.ids);
        for (const id of r.ids) push(id, 'system', '■ sesión cerrada por voz');
        hint(`${heard} → ■ cerrado: ${namesOf(r.ids)}`);
      } else {
        await interruptIds(r.ids);
        for (const id of r.ids) push(id, 'system', '✋ interrumpido por voz');
        hint(`${heard} → ✋ interrumpido: ${namesOf(r.ids)}`);
      }
      return;
    }

    case 'send':
    default: {
      let ids;
      if (cmd.to) {
        const r = resolveTo(cmd.to);
        if (!r.ids.length) { hint(`${heard} → no hay ningún agente activo llamado ${r.missing.join(', ')}.`, true); return; }
        ids = r.ids;
        if (ids.length === 1 && !selected.size) { activeId = ids[0]; renderAgentList(); renderConvo(); }
      } else {
        ids = targets();
      }
      if (!ids.length) {
        // Sin destino no lanzamos agentes "a ciegas": lo dejamos en la caja.
        msgEl.value = cmd.text;
        hint(`${heard} → no hay destino. Pulsa ＋ Agente para lanzarlo con esa tarea, di «nuevo agente…» o elige un personaje.`, true);
        return;
      }
      const sent = await sendTo(ids, cmd.text, { voice: true });
      if (!sent) hint(`${heard} → no se pudo enviar.`, true);
      else hint(`${heard} → ${sent > 1 ? `enviado a ${sent} agentes` : `enviado a ${namesOf(ids)}`}`);
    }
  }
}

// ---- Voz: micrófono ----------------------------------------------------------

let micMode = null;   // null | 'hold' | 'toggle' | 'key'
let micPressAt = 0;
let micBusy = false;  // parando la grabación o transcribiendo
let micReq = 0;       // id de la transcripción en curso (Esc la invalida)
let micTimer = 0;     // auto-parada de seguridad
const MIC_MAX_MS = 120000;
let voicePrepared = false;
let voiceStatusTimer = 0;

function setMicUi(state) { micBtn.dataset.state = state; }
function setLevel(v) { micBtn.style.setProperty('--lvl', (v || 0).toFixed(3)); }

function showVoiceStatus(s) {
  if (!s || !s.state) return;
  clearTimeout(voiceStatusTimer);
  const txt = voiceStatusEl.querySelector('.vs-text');
  const fill = voiceStatusEl.querySelector('.vs-fill');
  voiceStatusEl.hidden = false;
  voiceStatusEl.dataset.state = s.state;
  txt.textContent = s.text || '';
  if (s.state === 'loading') {
    fill.style.width = Math.max(3, Math.min(100, s.progress || 0)) + '%';
  } else if (s.state === 'ready') {
    fill.style.width = '100%';
    txt.textContent = '✅ Voz lista: mantén 🎤 y habla';
    voiceStatusTimer = setTimeout(() => { voiceStatusEl.hidden = true; }, 2500);
  } else if (s.state === 'error') {
    voicePrepared = false; // la próxima pulsación lo reintenta
    fill.style.width = '100%';
    txt.textContent = '⚠️ ' + (s.text || 'Error en el motor de voz');
  }
}

// Arranca (una vez) la carga del modelo de Whisper en segundo plano.
function prepareVoice() {
  if (voicePrepared || !voiceIpc) return;
  voicePrepared = true;
  voiceIpc.prepare().then(showVoiceStatus).catch(() => { voicePrepared = false; });
}

function micErrorText(e) {
  const n = e && e.name;
  if (n === 'NotAllowedError' || n === 'SecurityError') {
    return '🎤 Permiso de micrófono denegado. En Windows: Configuración › Privacidad › Micrófono › "Permitir que las aplicaciones de escritorio accedan".';
  }
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return '🎤 No se encontró ningún micrófono.';
  if (n === 'NotReadableError') return '🎤 El micrófono está ocupado por otra aplicación.';
  return '🎤 No se pudo abrir el micrófono: ' + (e && e.message ? e.message : e);
}

async function micStart(mode) {
  if (micMode || micBusy) return;
  if (!voiceIpc || !PV || !VC) { hint('La voz no está disponible en esta versión.', true); return; }
  micMode = mode;
  micPressAt = performance.now();
  // Si hablas tú, los agentes callan y no vuelven a hablar hasta que acabes
  // (si no, el micro recogería su voz como si fuera una orden tuya).
  PV.speaker.stopAll();
  PV.speaker.hold(true);
  prepareVoice();
  setMicUi('listening');
  hint(mode === 'key' ? '🎤 Escuchando… suelta Ctrl+Espacio para enviar (Esc cancela)' : '🎤 Escuchando… suelta para enviar (Esc cancela)');
  clearTimeout(micTimer);
  micTimer = setTimeout(() => { if (micMode) { hint('🎤 Máximo 2 minutos por mensaje.'); micStop(); } }, MIC_MAX_MS);
  try {
    const ok = await PV.recorder.start(setLevel);
    // No se abrió y nadie lo paró por el camino: volvemos a reposo.
    if (!ok && micMode === mode) micReset();
  } catch (e) {
    if (micMode === mode) micReset();
    hint(micErrorText(e), true);
  }
}

function micReset() {
  micMode = null;
  clearTimeout(micTimer);
  setMicUi('idle');
  if (PV) PV.speaker.hold(false);
}

async function micStop() {
  if (!micMode) return;
  micMode = null;
  clearTimeout(micTimer);
  micBusy = true; // hasta terminar no se puede volver a grabar
  const req = ++micReq;
  setMicUi('busy');
  try {
    const res = await PV.recorder.stop();
    if (req !== micReq) return;
    if (!res) { hint(''); return; }
    if (res.seconds < 0.35) { hint('🎤 Muy corto: mantén pulsado mientras hablas.', true); return; }
    if (res.rms < 0.003) { hint('🎤 No te he oído (¿micro silenciado?).', true); return; }

    hint('✍️ Transcribiendo… (Esc cancela)');
    const r = await voiceIpc.transcribe(res.audio);
    if (req !== micReq) return; // cancelado con Esc mientras esperábamos
    if (r && r.error) { hint('🎤 Error al transcribir: ' + r.error, true); return; }
    const text = String((r && r.text) || '').trim();
    if (VC.isNoise(text)) { hint('🎤 No te he entendido. Prueba otra vez.', true); return; }
    await runVoiceCommand(text);
  } catch (e) {
    if (req === micReq) hint('🎤 Error: ' + (e && e.message ? e.message : e), true);
  } finally {
    if (req === micReq) {
      micBusy = false;
      setMicUi('idle');
      PV.speaker.hold(false);
    }
  }
}

// Esc: descarta lo que estás grabando o deja de esperar la transcripción.
function micCancel() {
  if (micMode) {
    micMode = null;
    clearTimeout(micTimer);
    PV.recorder.cancel();
  } else if (micBusy) {
    micReq++; // la transcripción pendiente se ignorará al llegar
    micBusy = false;
  } else {
    return false;
  }
  setMicUi('idle');
  PV.speaker.hold(false);
  hint('🎤 Cancelado.');
  return true;
}

micBtn.addEventListener('pointerenter', prepareVoice);
micBtn.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  if (micMode === 'toggle') { micStop(); return; }
  try { micBtn.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
  micStart('hold');
});
micBtn.addEventListener('pointerup', () => {
  if (micMode !== 'hold') return;
  // Clic corto: sigue grabando hasta el siguiente clic.
  if (performance.now() - micPressAt < 350) {
    micMode = 'toggle';
    hint('🎤 Escuchando… pulsa 🎤 otra vez para enviar (Esc cancela)');
    return;
  }
  micStop();
});
micBtn.addEventListener('pointercancel', () => { if (micMode === 'hold') micStop(); });

document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && e.ctrlKey) {
    e.preventDefault();
    if (e.repeat) return;
    if (micMode === 'toggle') micStop(); else micStart('key');
  } else if (e.key === 'Escape') {
    if (!micCancel() && PV) PV.speaker.stopAll();
  }
});
document.addEventListener('keyup', (e) => {
  if (micMode === 'key' && (e.code === 'Space' || e.key === 'Control')) micStop();
});
// Al cambiar de ventana no dejamos el micro abierto.
window.addEventListener('blur', () => { if (micMode) micStop(); });

if (voiceIpc && voiceIpc.onStatus) voiceIpc.onStatus(showVoiceStatus);

// ---- Voz: respuestas habladas ----------------------------------------------

function speakReply(id, text) {
  if (!PV || !VC || !PV.speaker.isEnabled()) return;
  const a = agents.get(id);
  if (!a) return;
  const s = VC.speechText(text);
  if (!s) return;
  // Con varios agentes decimos quién habla.
  const prefix = liveAgents().length > 1 ? `${shortName(a)}: ` : '';
  PV.speaker.say(id, prefix + s, a.num - 1);
}

function renderTtsBtn() {
  const on = PV && PV.speaker.available && PV.speaker.isEnabled();
  ttsBtn.textContent = on ? '🔊' : '🔈';
  ttsBtn.classList.toggle('off', !on);
  ttsBtn.title = !PV || !PV.speaker.available
    ? 'Este sistema no tiene síntesis de voz'
    : on ? 'Leyendo respuestas en voz alta (clic para desactivar)' : 'Voz desactivada (clic para leer las respuestas en voz alta)';
}

ttsBtn.addEventListener('click', () => {
  if (!PV) return;
  PV.speaker.setEnabled(!PV.speaker.isEnabled());
  renderTtsBtn();
  hint(PV.speaker.isEnabled() ? '🔊 Los agentes leerán sus respuestas.' : '🔈 Voz de los agentes desactivada.');
});
skipBtn.addEventListener('click', () => { if (PV) PV.speaker.stopAll(); });

if (PV) {
  PV.speaker.onChange((key) => {
    skipBtn.classList.toggle('live', !!key);
    renderAgentList(); // resalta quién habla y actualiza el canvas
  });
}

// ---- Eventos del agente (desde el proceso principal) -----------------------

if (window.agentApi && window.agentApi.onEvent) {
  window.agentApi.onEvent((ev) => {
    if (!ev || !ev.id) return;
    const a = agents.get(ev.id);
    switch (ev.kind) {
      case 'spawned':
        if (!agents.has(ev.id)) {
          counter += 1;
          agents.set(ev.id, { id: ev.id, num: counter, cwd: ev.cwd, sessionId: null, status: 'busy', messages: [] });
          renderAgentList();
        }
        break;
      case 'session':
        if (a && a.sessionId !== ev.sessionId) {
          a.sessionId = ev.sessionId;
          if (a.name && ev.sessionId) window.PIXEL_AGENT_NAMES[ev.sessionId] = a.name;
          renderAgentList(); // avatar con su color y anillo de destino en el canvas
        }
        break;
      case 'assistant':
        push(ev.id, 'assistant', ev.text);
        setStatus(ev.id, 'busy');
        speakReply(ev.id, ev.text);
        break;
      case 'tool':
        push(ev.id, 'tool', ev.label || ev.name);
        setStatus(ev.id, 'busy');
        break;
      case 'user':
        // ya lo añadimos localmente al enviar; lo ignoramos para no duplicar
        break;
      case 'result': {
        const cost = typeof ev.cost === 'number' ? ` · $${ev.cost.toFixed(4)}` : '';
        push(ev.id, 'system', `✅ turno completado${cost}`);
        setStatus(ev.id, 'live');
        break;
      }
      case 'error':
        push(ev.id, 'error', ev.text || 'error');
        setStatus(ev.id, 'live');
        break;
      case 'closed':
        if (PV) PV.speaker.forget(ev.id);
        setStatus(ev.id, 'closed');
        break;
    }
  });
}

renderAgentList();
renderConvo();
renderTtsBtn();
agentNameEl.value = suggestName();
console.log('CHAT-INIT ok; api=' + !!(window.agentApi && window.agentApi.spawn) +
  ' voz=' + !!(voiceIpc && PV && VC) +
  ' spawnBtn=' + !!document.getElementById('spawnBtn') +
  ' sendBtn=' + !!document.getElementById('sendBtn'));
