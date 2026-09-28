'use strict';

// ---------------------------------------------------------------------------
// Centro de mando: tu equipo fijo de 5 IAs (JARVIS, FRIDAY, TARS, EDITH y
// KITT), cada una especializada en una parte del desarrollo.
// - Clic en una tarjeta o en su personaje: pasa a ser el destino.
// - Casillas: marca varios para mandarles la misma orden (difusión).
// - Voz: 🎤 (o Ctrl+Espacio) graba, Whisper transcribe en local y la frase se
//   interpreta como orden (voice-commands.js): "JARVIS, revisa…", "todos,
//   paren", "KITT, capacítate en Kubernetes". Las respuestas se leen en voz alta.
// - Lo escrito pasa por el mismo intérprete, así "EDITH, …" también funciona.
// Habla con el proceso principal por IPC (window.teamApi / window.voiceApi).
// ---------------------------------------------------------------------------

const el = (id) => document.getElementById(id);
const teamListEl = el('agentList');
const convoEl = el('convo');
const cwdEl = el('cwd');
const msgEl = el('msg');
const hintEl = el('hint');
const targetInfoEl = el('targetInfo');
const micBtn = el('micBtn');
const ttsBtn = el('ttsBtn');
const skipBtn = el('skipBtn');
const voiceStatusEl = el('voiceStatus');

const VC = window.VoiceCommands;
const PV = window.PixelVoice;
const api = window.teamApi;
const voiceIpc = window.voiceApi;

// Estado compartido con el canvas (renderer.js):
// - PIXEL_TARGET_SESSIONS: ids de los miembros que recibirán la próxima orden
// - PIXEL_SPEAKING_SESSION: id del miembro que está hablando en voz alta
window.PIXEL_TARGET_SESSIONS = new Set();
window.PIXEL_SPEAKING_SESSION = null;

window.addEventListener('error', (e) => {
  console.error('CHAT-ERROR:', e.message, '@', (e.filename || '').split(/[\\/]/).pop() + ':' + e.lineno);
});

const team = new Map(); // id -> { id, name, role, from, emoji, aliases, look, skills, index, status, messages }
const selected = new Set(); // ids marcados para difusión
let activeId = 'jarvis';

function hint(text, isErr) {
  hintEl.textContent = text || '';
  hintEl.classList.toggle('err', !!isErr);
}

// Destinatarios de la próxima orden (siempre hay alguno: por defecto JARVIS).
function targets() {
  if (selected.size) return [...selected].filter((id) => team.has(id));
  if (team.has(activeId)) return [activeId];
  return team.size ? [team.keys().next().value] : [];
}

function namesOf(ids) { return ids.map((id) => (team.get(id) || {}).name || id).join(', '); }

function syncCanvas() {
  window.PIXEL_TARGET_SESSIONS = new Set(targets());
  window.PIXEL_SPEAKING_SESSION = PV ? PV.speaker.speakingKey() : null;
}

function updateTargetInfo() {
  const t = targets();
  const broadcast = selected.size > 1;
  targetInfoEl.textContent = broadcast ? `🎯 ${t.length} a la vez: ${namesOf(t)}` : `🎯 ${namesOf(t)}`;
  targetInfoEl.classList.toggle('broadcast', broadcast);
  syncCanvas();
}

function avatar(m, big) {
  const av = document.createElement('span');
  av.className = 'avatar' + (big ? ' big' : '');
  av.style.background = m.look ? m.look.shirt : '#555';
  av.style.color = m.look && m.look.accent ? m.look.accent : '#fff';
  av.textContent = m.name.charAt(0);
  return av;
}

function skillsDone(m) { return (m.skills || []).filter((k) => k.status === 'aprendido').length; }

function renderTeam() {
  teamListEl.innerHTML = '';
  const speakingKey = PV ? PV.speaker.speakingKey() : null;
  for (const m of team.values()) {
    const card = document.createElement('div');
    card.className = 'member' + (m.id === activeId && !selected.size ? ' active' : '') +
      (selected.has(m.id) ? ' picked' : '') + (m.id === speakingKey ? ' speaking' : '');
    card.title = `${m.name} (${m.from}) — ${m.role}`;

    const pick = document.createElement('input');
    pick.type = 'checkbox';
    pick.className = 'pick';
    pick.checked = selected.has(m.id);
    pick.title = 'Marcar para difusión';
    pick.addEventListener('click', (e) => e.stopPropagation());
    pick.addEventListener('change', () => {
      if (pick.checked) selected.add(m.id); else selected.delete(m.id);
      renderTeam();
    });

    const info = document.createElement('div');
    info.className = 'member-info';
    const name = document.createElement('div');
    name.className = 'member-name';
    name.textContent = m.name;
    const dot = document.createElement('span');
    dot.className = 'dot ' + (m.status === 'busy' ? 'busy' : m.status === 'error' ? 'err' : 'live');
    name.appendChild(dot);
    const role = document.createElement('div');
    role.className = 'member-role';
    const learned = skillsDone(m);
    const learning = (m.skills || []).some((k) => k.status === 'aprendiendo');
    role.textContent = m.emoji + ' ' + m.role + (learned ? ` · 🎓${learned}` : '') + (learning ? ' · ⏳' : '');
    info.appendChild(name);
    info.appendChild(role);

    card.appendChild(pick);
    card.appendChild(avatar(m));
    card.appendChild(info);
    card.addEventListener('click', () => focusMember(m.id));
    teamListEl.appendChild(card);
  }
  updateTargetInfo();
}

function focusMember(id, additive) {
  if (!team.has(id)) return;
  if (additive) {
    if (selected.has(id)) selected.delete(id); else selected.add(id);
  } else {
    selected.clear();
    activeId = id;
  }
  renderTeam();
  renderConvo();
}

// Ficha del miembro activo: especialidad y capacitaciones.
function renderProfile(m) {
  const box = document.createElement('div');
  box.className = 'profile';
  const top = document.createElement('div');
  top.className = 'profile-top';
  top.appendChild(avatar(m, true));
  const txt = document.createElement('div');
  txt.innerHTML = '<div class="profile-name"></div><div class="profile-role"></div>';
  txt.querySelector('.profile-name').textContent = `${m.name}`;
  txt.querySelector('.profile-role').textContent = `${m.emoji} ${m.role} · IA de «${m.from}»`;
  top.appendChild(txt);
  const reset = document.createElement('button');
  reset.className = 'mini';
  reset.textContent = '↺';
  reset.title = 'Reiniciar conversación (lo aprendido se conserva)';
  reset.addEventListener('click', () => resetIds([m.id]));
  top.appendChild(reset);
  box.appendChild(top);

  const skills = document.createElement('div');
  skills.className = 'skills';
  if (!(m.skills || []).length) {
    skills.innerHTML = '<span class="skills-empty">🎓 Sin capacitaciones aún. Escribe un tema y pulsa 🎓, o di «' +
      m.name + ', capacítate en …».</span>';
  }
  for (const k of m.skills || []) {
    const chip = document.createElement('span');
    chip.className = 'skill ' + (k.status || '');
    const icon = k.status === 'aprendido' ? '✅' : k.status === 'aprendiendo' ? '⏳' : '⚠️';
    chip.textContent = `${icon} ${k.topic}`;
    chip.title = k.status === 'aprendido' ? 'Aprendido: lo tiene en cuenta siempre'
      : k.status === 'aprendiendo' ? 'Capacitándose…' : 'No terminó: pulsa para reintentar';
    if (k.status !== 'aprendiendo' && k.status !== 'aprendido') chip.addEventListener('click', () => trainIds([m.id], k.topic));
    const x = document.createElement('span');
    x.className = 'skill-x';
    x.textContent = '✕';
    x.title = 'Olvidar';
    x.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!window.confirm(`¿Que ${m.name} olvide «${k.topic}»?`)) return;
      await api.forget(m.id, k.topic);
      await refreshTeam();
    });
    chip.appendChild(x);
    skills.appendChild(chip);
  }
  box.appendChild(skills);
  return box;
}

function renderConvo() {
  convoEl.innerHTML = '';
  const m = team.get(activeId);
  if (!m) return;
  convoEl.appendChild(renderProfile(m));
  if (!m.messages.length) {
    const d = document.createElement('div');
    d.className = 'empty-convo';
    d.innerHTML = `Habla o escribe a <b>${m.name}</b>. Mantén <b>🎤</b> (o Ctrl+Espacio), o haz un clic y habla:` +
      ' se envía solo al callarte.<br><br><i>«' + m.name + ', …»</i> para dirigirte a alguien del equipo.';
    convoEl.appendChild(d);
  }
  for (const msg of m.messages) {
    if (msg.role === 'assistant') {
      const row = document.createElement('div');
      row.className = 'msg-row';
      row.appendChild(avatar(m));
      const b = document.createElement('div');
      b.className = 'bubble assistant';
      b.textContent = msg.text;
      row.appendChild(b);
      convoEl.appendChild(row);
      continue;
    }
    const div = document.createElement('div');
    if (msg.role === 'user') {
      div.className = 'bubble user' + (msg.voice ? ' voice' : '');
      div.textContent = (msg.voice ? '🎤 ' : '') + msg.text;
    } else if (msg.role === 'tool') { div.className = 'line-tool'; div.textContent = '⚙️ ' + msg.text; }
    else if (msg.role === 'error') { div.className = 'line-error'; div.textContent = '⚠️ ' + msg.text; }
    else { div.className = 'line-system'; div.textContent = msg.text; }
    convoEl.appendChild(div);
  }
  convoEl.scrollTop = convoEl.scrollHeight;
}

function push(id, role, text, extra) {
  const m = team.get(id);
  if (!m) return;
  m.messages.push(Object.assign({ role, text }, extra || {}));
  if (m.messages.length > 300) m.messages.splice(0, m.messages.length - 300);
  if (id === activeId) renderConvo();
}

function setStatus(id, status) {
  const m = team.get(id);
  if (m && m.status !== status) { m.status = status; renderTeam(); }
}

async function refreshTeam() {
  if (!api) return;
  const data = await api.list();
  if (data.cwd && document.activeElement !== cwdEl) cwdEl.value = data.cwd;
  data.members.forEach((pm, index) => {
    const m = team.get(pm.id);
    if (m) Object.assign(m, { skills: pm.skills });
    else team.set(pm.id, Object.assign({}, pm, { index, status: pm.busy ? 'busy' : 'live', messages: [] }));
  });
  renderTeam();
  renderConvo();
}

// ---- Acciones --------------------------------------------------------------

async function sendTo(ids, text, extra) {
  let sent = 0;
  for (const id of ids) {
    try {
      const res = await api.send(id, text);
      if (res && res.ok === false) { push(id, 'error', res.error || 'no se pudo enviar'); continue; }
      push(id, 'user', text, extra);
      setStatus(id, 'busy');
      sent += 1;
    } catch (e) {
      push(id, 'error', String(e && e.message ? e.message : e));
    }
  }
  return sent;
}

async function interruptIds(ids) {
  for (const id of ids) {
    if (PV) PV.speaker.forget(id);
    try { await api.interrupt(id); } catch (_) { /* noop */ }
    push(id, 'system', '✋ interrumpido');
  }
}

async function resetIds(ids) {
  if (!window.confirm(`¿Reiniciar la conversación de ${namesOf(ids)}?\n\nOlvidarán lo hablado en esta carpeta; lo aprendido en capacitaciones se conserva.`)) {
    hint('Cancelado.');
    return false;
  }
  for (const id of ids) {
    if (PV) PV.speaker.forget(id);
    try { await api.reset(id); } catch (_) { /* noop */ }
    const m = team.get(id);
    if (m) m.messages = [];
    push(id, 'system', '↺ conversación reiniciada');
  }
  hint(`↺ Reiniciado: ${namesOf(ids)}`);
  return true;
}

async function trainIds(ids, topic, extra) {
  const t = String(topic || '').trim();
  if (!t) { hint('🎓 Escribe primero el tema de la capacitación (p. ej. «Kubernetes»).', true); msgEl.focus(); return 0; }
  let ok = 0;
  for (const id of ids) {
    const res = await api.train(id, t);
    if (res && res.ok) {
      ok += 1;
      push(id, 'user', `🎓 Capacítate en «${t}»`, extra);
      push(id, 'system', `⏳ ${team.get(id).name} está investigando «${t}»…`);
      setStatus(id, 'busy');
    } else {
      push(id, 'error', (res && res.error) || 'no se pudo iniciar la capacitación');
    }
  }
  await refreshTeam();
  return ok;
}

// Interpreta una frase (hablada o escrita) y la ejecuta.
async function runCommand(text, voice) {
  const heard = voice ? `🎤 «${text}»` : '✍️';
  const cmd = VC ? VC.parseCommand(text, [...team.values()].map((m) => ({ name: m.name, aliases: m.aliases }))) : { type: 'send', to: null, text };
  console.log('orden: ' + JSON.stringify(cmd));
  const extra = { voice: !!voice };
  const resolve = (to) => (to === 'all' ? [...team.keys()] : to ? to.map((n) => [...team.values()].find((m) => m.name === n)).filter(Boolean).map((m) => m.id) : targets());

  switch (cmd.type) {
    case 'empty':
      hint('No te he entendido. Prueba otra vez.', true);
      return;
    case 'silence':
      if (PV) PV.speaker.stopAll();
      hint(`${heard} → 🔇 silencio`);
      return;
    case 'select': {
      const ids = resolve(cmd.to);
      selected.clear();
      if (ids.length === 1) activeId = ids[0]; else ids.forEach((id) => selected.add(id));
      renderTeam();
      renderConvo();
      hint(`${heard} → 🎯 ahora hablas con ${namesOf(ids)}`);
      return;
    }
    case 'interrupt': {
      const ids = resolve(cmd.to);
      await interruptIds(ids);
      hint(`${heard} → ✋ interrumpido: ${namesOf(ids)}`);
      return;
    }
    case 'reset':
      await resetIds(resolve(cmd.to));
      return;
    case 'train': {
      const ids = resolve(cmd.to);
      if (ids.length === 1 && !selected.size) { activeId = ids[0]; renderTeam(); }
      const n = await trainIds(ids, cmd.topic, extra);
      if (n) hint(`${heard} → 🎓 ${namesOf(ids)} se capacita en «${cmd.topic}»`);
      return;
    }
    case 'send':
    default: {
      const ids = resolve(cmd.to);
      if (cmd.to && ids.length === 1 && !selected.size) { activeId = ids[0]; renderTeam(); renderConvo(); }
      const body = cmd.text || text;
      const sent = await sendTo(ids, body, extra);
      if (!sent) hint(`${heard} → no se pudo enviar (mira el chat de ${namesOf(ids)}).`, true);
      else hint(`${heard} → enviado a ${namesOf(ids)}`);
    }
  }
}

async function send() {
  const text = msgEl.value.trim();
  if (!text) { msgEl.focus(); return; }
  msgEl.value = '';
  await runCommand(text, false);
}

async function trainFromBox() {
  const topic = msgEl.value.trim().replace(/^(?:capac[ií]tate|aprende|especial[ií]zate)\s+(?:en|sobre)?\s*/i, '');
  const ids = targets();
  const n = await trainIds(ids, topic);
  if (n) { msgEl.value = ''; hint(`🎓 ${namesOf(ids)} se capacita en «${topic}»`); }
}

async function applyCwd() {
  const res = await api.setCwd(cwdEl.value);
  if (res && res.ok) hint(`📁 Carpeta de trabajo: ${res.cwd}. Cada miembro retoma su conversación de esa carpeta.`);
  else { hint('📁 ' + ((res && res.error) || 'carpeta no válida'), true); refreshTeam(); }
}

el('sendBtn').addEventListener('click', send);
el('trainBtn').addEventListener('click', trainFromBox);
el('stopBtn').addEventListener('click', () => interruptIds(targets()));
el('selAll').addEventListener('click', () => { for (const id of team.keys()) selected.add(id); renderTeam(); });
el('selNone').addEventListener('click', () => { selected.clear(); renderTeam(); renderConvo(); });
msgEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
});
cwdEl.addEventListener('change', applyCwd);
cwdEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); cwdEl.blur(); } });

// Clic en un personaje del canvas
window.addEventListener('pixel:pick', (e) => {
  const d = e.detail || {};
  if (!team.has(d.sessionId)) return;
  focusMember(d.sessionId, d.additive);
  const m = team.get(d.sessionId);
  hint(d.additive ? `Marcados: ${namesOf(targets())}` : `🎯 Hablando con ${m.name} (${m.role}): mantén 🎤 o escribe.`);
});

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
// Nivel del micro (0..1). En modo clic, al detectar que has hablado y luego
// hay ~1,4 s de silencio, se envía solo.
const vad = { heard: false, lastLoud: 0 };
function setLevel(v) {
  micBtn.style.setProperty('--lvl', (v || 0).toFixed(3));
  if (!micMode) return;
  const t = performance.now();
  if (v > 0.12) { vad.heard = true; vad.lastLoud = t; }
  else if (micMode === 'toggle' && vad.heard && t - vad.lastLoud > 1400) {
    hint('🎤 Te he oído, enviando…');
    micStop();
  }
}

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
  vad.heard = false;
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
    if (res.rms < 0.0015) { hint('🎤 No te he oído (¿micro silenciado?).', true); return; }

    hint('✍️ Transcribiendo… (Esc cancela)');
    const r = await voiceIpc.transcribe(res.audio);
    if (req !== micReq) return; // cancelado con Esc mientras esperábamos
    if (r && r.error) { hint('🎤 Error al transcribir: ' + r.error, true); return; }
    const text = String((r && r.text) || '').trim();
    if (VC.isNoise(text)) { hint('🎤 No te he entendido. Prueba otra vez.', true); return; }
    await runCommand(text, true);
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
    hint('🎤 Escuchando… habla y se enviará al callarte (o pulsa 🎤 otra vez). Esc cancela.');
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
  const m = team.get(id);
  if (!m) return;
  const s = VC.speechText(String(text).replace(/<conocimiento>[\s\S]*?(?:<\/conocimiento>|$)/gi, ' '));
  if (!s) return;
  // Si no es a quien estás mirando, dice quién habla.
  const prefix = id !== activeId || selected.size ? `${m.name}: ` : '';
  PV.speaker.say(id, prefix + s, m.index);
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
  hint(PV.speaker.isEnabled() ? '🔊 El equipo leerá sus respuestas.' : '🔈 Voz del equipo desactivada.');
});
skipBtn.addEventListener('click', () => { if (PV) PV.speaker.stopAll(); });

if (PV) {
  PV.speaker.onChange((key) => {
    skipBtn.classList.toggle('live', !!key);
    renderTeam();
  });
}

// ---- Eventos del equipo (desde el proceso principal) -----------------------

if (api && api.onEvent) {
  api.onEvent((ev) => {
    if (!ev || !ev.id || !team.has(ev.id)) return;
    const m = team.get(ev.id);
    switch (ev.kind) {
      case 'spawned':
        push(ev.id, 'system', ev.resumed ? `↻ ${m.name} retoma la conversación` : `▶ ${m.name} empieza una conversación nueva`);
        break;
      case 'assistant':
        push(ev.id, 'assistant', ev.text);
        setStatus(ev.id, 'busy');
        if (!ev.training) speakReply(ev.id, ev.text);
        break;
      case 'tool':
        push(ev.id, 'tool', ev.label || ev.name);
        setStatus(ev.id, 'busy');
        break;
      case 'result': {
        const cost = typeof ev.cost === 'number' ? ` · $${ev.cost.toFixed(4)}` : '';
        push(ev.id, 'system', `✅ listo${cost}`);
        setStatus(ev.id, 'live');
        break;
      }
      case 'trained':
        push(ev.id, 'system', ev.ok ? `🎓 ${m.name} ha aprendido «${ev.topic}» y lo tendrá en cuenta siempre.` : `⚠️ ${m.name} no terminó la capacitación en «${ev.topic}». Pulsa el tema para reintentar.`);
        if (ev.ok && PV && PV.speaker.isEnabled()) PV.speaker.say(ev.id, `${m.name}: capacitación en ${ev.topic} completada.`, m.index);
        refreshTeam();
        break;
      case 'team':
        refreshTeam();
        break;
      case 'error':
        push(ev.id, 'error', ev.text || 'error');
        setStatus(ev.id, 'error');
        break;
      case 'closed':
        if (m.status === 'busy') setStatus(ev.id, 'live');
        break;
    }
  });
}

renderTtsBtn();
refreshTeam().then(() => {
  hint('🎯 Habla con JARVIS o di el nombre de otro miembro del equipo.');
  console.log('CHAT-INIT ok; equipo=' + team.size + ' voz=' + !!(voiceIpc && PV && VC));
}).catch((e) => hint('No se pudo cargar el equipo: ' + (e && e.message), true));
