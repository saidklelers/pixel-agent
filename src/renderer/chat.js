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
const sttQualityEl = el('sttQuality');
const ttsModeEl = el('ttsMode');

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

const team = new Map(); // id -> { id, name, role, from, emoji, aliases, look, voice, skills, index, status, messages }
let voices = []; // voces naturales disponibles (para Personalizar equipo)
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

// Estado en vivo de cada miembro (lo que hace ahora), del mismo canal que la oficina.
const live = new Map(); // id -> { state, label, emoji, busy }
if (window.office && window.office.onAgents) {
  window.office.onAgents((p) => {
    let changed = false;
    for (const a of (p && p.agents) || []) {
      const prev = live.get(a.id);
      const next = { state: a.state, label: a.label, emoji: a.emoji, busy: !!a.busy };
      if (!prev || prev.label !== next.label || prev.busy !== next.busy) changed = true;
      live.set(a.id, next);
    }
    if (changed) { renderTeamStatus(); renderProfile(); renderTyping(); }
  });
}

function renderTeamStatus() {
  const el2 = el('teamStatus');
  const busy = [...team.values()].filter((m) => (live.get(m.id) || {}).busy || m.status === 'busy');
  el2.textContent = busy.length ? `${busy.length} trabajando: ${busy.map((m) => m.name).join(', ')}` : 'Tu equipo de 5 IAs · todos libres';
  el2.classList.toggle('busy', busy.length > 0);
}

function updateTargetInfo() {
  const t = targets();
  const broadcast = selected.size > 1;
  targetInfoEl.innerHTML = '';
  targetInfoEl.classList.toggle('broadcast', broadcast);
  for (const id of t) {
    const m = team.get(id);
    if (!m) continue;
    const chip = document.createElement('span');
    chip.className = 'target-chip';
    chip.appendChild(avatar(m));
    chip.appendChild(document.createTextNode(m.name));
    if (selected.size) {
      const x = document.createElement('span');
      x.className = 'x';
      x.textContent = '✕';
      x.title = 'Quitar';
      x.addEventListener('click', () => { selected.delete(id); if (!selected.size) activeId = id; renderTeam(); renderConvo(); });
      chip.appendChild(x);
    }
    targetInfoEl.appendChild(chip);
  }
  syncCanvas();
  if (window.PixelAttach) window.PixelAttach.render();
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

// Plantilla: los 5 en fila. Clic = hablar con él; Ctrl/Mayús+clic = marcar varios.
function renderTeam() {
  teamListEl.innerHTML = '';
  const speakingKey = PV ? PV.speaker.speakingKey() : null;
  for (const m of team.values()) {
    const lv = live.get(m.id) || {};
    const busy = lv.busy || m.status === 'busy';
    const item = document.createElement('button');
    item.className = 'dock-item' + (m.id === activeId && !selected.size ? ' active' : '') +
      (selected.has(m.id) ? ' picked' : '') + (m.id === speakingKey ? ' speaking' : '') +
      (busy ? ' busy' : '') + (m.status === 'error' ? ' error' : '');
    item.title = `${m.name} — ${m.role} (IA de «${m.from}»)\nClic: hablarle · Ctrl+clic: marcar para difusión`;
    const av = document.createElement('span');
    av.className = 'dock-av';
    av.style.background = `radial-gradient(circle at 35% 30%, ${m.look ? m.look.shirt : '#555'}, #0e0c19 130%)`;
    av.style.color = m.look && m.look.accent ? m.look.accent : '#fff';
    av.textContent = m.name.charAt(0);
    const em = document.createElement('span');
    em.className = 'dock-emoji';
    em.textContent = m.emoji;
    av.appendChild(em);
    item.appendChild(av);
    const name = document.createElement('span');
    name.className = 'dock-name';
    name.textContent = m.name;
    item.appendChild(name);
    const learned = skillsDone(m);
    if (learned) {
      const b = document.createElement('span');
      b.className = 'dock-badge';
      b.textContent = `🎓${learned}`;
      b.title = `${learned} capacitación(es)`;
      item.appendChild(b);
    }
    if (selected.has(m.id)) {
      const c = document.createElement('span');
      c.className = 'dock-check';
      c.textContent = '✓';
      item.appendChild(c);
    }
    item.addEventListener('click', (e) => focusMember(m.id, e.ctrlKey || e.shiftKey || e.metaKey));
    teamListEl.appendChild(item);
  }
  updateTargetInfo();
  renderTeamStatus();
}

function focusMember(id, additive) {
  if (!team.has(id)) return;
  if (additive) {
    if (!selected.size && activeId && activeId !== id) selected.add(activeId);
    if (selected.has(id)) selected.delete(id); else selected.add(id);
  } else {
    selected.clear();
    activeId = id;
  }
  renderTeam();
  renderConvo();
}

// Ficha del miembro activo: especialidad, qué hace ahora y capacitaciones.
function renderProfile() {
  const box = el('profile');
  const m = team.get(activeId);
  box.innerHTML = '';
  if (!m) return;
  const lv = live.get(m.id) || {};
  const top = document.createElement('div');
  top.className = 'profile-top';
  const av = avatar(m, true);
  top.appendChild(av);
  const main = document.createElement('div');
  main.className = 'profile-main';
  main.innerHTML = '<div class="profile-name"><span></span><span class="profile-from"></span></div>' +
    '<div class="profile-role"></div><div class="profile-state"><i></i><span></span></div>';
  main.querySelector('.profile-name span').textContent = m.name;
  main.querySelector('.profile-from').textContent = `IA de «${m.from}»`;
  main.querySelector('.profile-role').textContent = `${m.emoji} ${m.role}`;
  const st = main.querySelector('.profile-state');
  const busy = lv.busy || m.status === 'busy';
  st.classList.toggle('busy', busy);
  st.classList.toggle('error', m.status === 'error');
  st.querySelector('span').textContent = m.status === 'error' ? 'con un problema (mira el chat)'
    : busy ? (lv.busy && lv.label && lv.label !== 'disponible' ? `${lv.emoji || '⚙️'} ${lv.label}` : '⚙️ trabajando…')
      : 'libre · esperando órdenes';
  top.appendChild(main);
  const screenBtn = document.createElement('button');
  screenBtn.className = 'icon-btn';
  screenBtn.textContent = '🖥️';
  screenBtn.title = `Ver la pantalla de ${m.name}: qué está haciendo, sus tareas y lo que lleva gastado`;
  screenBtn.addEventListener('click', () => window.PixelScreens && window.PixelScreens.open(m.id));
  top.appendChild(screenBtn);
  const editBtn = document.createElement('button');
  editBtn.className = 'icon-btn';
  editBtn.textContent = '✎';
  editBtn.title = `Personalizar a ${m.name}: nombre, especialidad, colores y voz`;
  editBtn.addEventListener('click', () => window.PixelEditor && window.PixelEditor.open(m.id));
  top.appendChild(editBtn);
  const reset = document.createElement('button');
  reset.className = 'icon-btn';
  reset.textContent = '↺';
  reset.title = 'Reiniciar conversación (lo aprendido se conserva)';
  reset.addEventListener('click', () => resetIds([m.id]));
  top.appendChild(reset);
  box.appendChild(top);

  const skills = document.createElement('div');
  skills.className = 'skills';
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
  const add = document.createElement('span');
  add.className = 'skill add';
  add.textContent = '＋ Capacitar';
  add.title = `Escribe un tema en la caja y pulsa 🎓 Capacitar (o di «${m.name}, capacítate en …»)`;
  add.addEventListener('click', () => {
    msgEl.focus();
    msgEl.placeholder = `Tema en el que se capacitará ${m.name} (p. ej. Docker)… y pulsa 🎓 Capacitar`;
    hint(`🎓 Escribe el tema y pulsa «🎓 Capacitar».`);
  });
  skills.appendChild(add);
  box.appendChild(skills);
}

// Markdown mínimo y seguro: se escapa todo y luego se añaden etiquetas.
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function renderMarkdown(text) {
  const parts = String(text || '').split(/```/);
  return parts.map((p, i) => {
    if (i % 2) {
      const code = p.replace(/^[\w+-]*\n/, '');
      return `<pre><code>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`;
    }
    return escapeHtml(p)
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/^#{1,6}\s*(.+)$/gm, '<strong>$1</strong>');
  }).join('');
}

function hhmm(t) {
  const d = new Date(t || Date.now());
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const SUGGESTIONS = {
  jarvis: ['Planifica las próximas tareas', 'Revisa la arquitectura del proyecto'],
  friday: ['Mejora el diseño de la página principal', 'Revisa la accesibilidad'],
  tars: ['Revisa la API y la base de datos', 'Optimiza las consultas lentas'],
  edith: ['Ejecuta los tests y dime qué falla', 'Haz una revisión de seguridad'],
  kitt: ['Prepara el build de producción', 'Revisa el estado de git'],
};

function nearBottom() { return convoEl.scrollHeight - convoEl.scrollTop - convoEl.clientHeight < 80; }

function renderConvo(forceBottom) {
  const stick = forceBottom || nearBottom();
  convoEl.innerHTML = '';
  renderProfile();
  const m = team.get(activeId);
  if (!m) return;
  const who = m.look ? m.look.accent || '#29f0ff' : '#29f0ff';
  if (!m.messages.length) {
    const d = document.createElement('div');
    d.className = 'empty-convo';
    d.innerHTML = `<div class="empty-icon">${escapeHtml(m.emoji)}</div>Habla o escribe a <b>${escapeHtml(m.name)}</b>.<br>` +
      'Mantén <b>🎤</b> (o Ctrl+Espacio), o haz un clic y habla: se envía solo al callarte.';
    const sug = document.createElement('div');
    sug.className = 'suggestions';
    for (const s of SUGGESTIONS[m.id] || []) {
      const b = document.createElement('button');
      b.className = 'suggestion';
      b.textContent = s;
      b.addEventListener('click', () => { msgEl.value = s; autoGrow(); msgEl.focus(); });
      sug.appendChild(b);
    }
    d.appendChild(sug);
    convoEl.appendChild(d);
  }
  let tools = null; // acciones seguidas se agrupan en un desplegable
  for (const msg of m.messages) {
    if (msg.role === 'tool') {
      if (!tools) {
        tools = document.createElement('details');
        tools.className = 'tools';
        tools.innerHTML = '<summary></summary><ol></ol>';
        convoEl.appendChild(tools);
      }
      const li = document.createElement('li');
      li.textContent = msg.text;
      li.title = msg.text;
      tools.querySelector('ol').appendChild(li);
      const n = tools.querySelectorAll('li').length;
      tools.querySelector('summary').textContent = `⚙ ${n} ${n === 1 ? 'acción' : 'acciones'} · ${msg.text}`;
      continue;
    }
    tools = null;
    if (msg.role === 'assistant' || msg.role === 'user') {
      const wrap = document.createElement('div');
      wrap.className = `msg ${msg.role}` + (msg.voice ? ' voice' : '');
      const meta = document.createElement('div');
      meta.className = 'msg-meta';
      if (msg.role === 'assistant') {
        meta.appendChild(avatar(m));
        const b = document.createElement('b');
        b.textContent = m.name;
        meta.appendChild(b);
      } else {
        const who2 = document.createElement('span');
        who2.textContent = msg.voice ? '🎤 tú (voz)' : 'tú';
        meta.appendChild(who2);
      }
      const time = document.createElement('span');
      time.textContent = hhmm(msg.at);
      meta.appendChild(time);
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      if (msg.role === 'assistant') {
        bubble.style.setProperty('--who', who);
        bubble.innerHTML = renderMarkdown(msg.text);
      } else {
        bubble.textContent = msg.text;
      }
      wrap.appendChild(meta);
      wrap.appendChild(bubble);
      if (msg.docs && msg.docs.length) {
        const dl = document.createElement('div');
        dl.className = 'msg-docs';
        for (const n of msg.docs) {
          const c = document.createElement('span');
          c.className = 'msg-doc';
          c.textContent = '📎 ' + n;
          dl.appendChild(c);
        }
        if (msg.delegate) {
          const c = document.createElement('span');
          c.className = 'msg-doc delegate';
          c.textContent = '🧭 para repartir';
          dl.appendChild(c);
        }
        wrap.appendChild(dl);
      }
      convoEl.appendChild(wrap);
      continue;
    }
    if (msg.role === 'plan') { convoEl.appendChild(planCard(msg.planId)); continue; }
    if (msg.role === 'delegated') {
      // una tarea que le ha asignado el líder
      const from = team.get(msg.fromId) || {};
      const d = document.createElement('div');
      d.className = 'delegated';
      d.style.setProperty('--who', (from.look && from.look.accent) || '#29f0ff');
      const head = document.createElement('div');
      head.className = 'delegated-head';
      if (from.name) head.appendChild(avatar(from));
      const b = document.createElement('b');
      b.textContent = `${from.name || 'El líder'} te asigna`;
      head.appendChild(b);
      const pl = document.createElement('span');
      pl.textContent = msg.plan && msg.plan.title ? `· ${msg.plan.title}` : '';
      head.appendChild(pl);
      const tm = document.createElement('span');
      tm.className = 'time';
      tm.textContent = hhmm(msg.at);
      head.appendChild(tm);
      d.appendChild(head);
      const body = document.createElement('div');
      body.className = 'delegated-text';
      body.textContent = msg.text;
      d.appendChild(body);
      convoEl.appendChild(d);
      continue;
    }
    const div = document.createElement('div');
    if (msg.role === 'error') { div.className = 'line-error'; div.textContent = '⚠️ ' + msg.text; }
    else { div.className = 'line-system'; div.textContent = msg.text; }
    convoEl.appendChild(div);
  }
  renderTyping();
  if (stick) convoEl.scrollTop = convoEl.scrollHeight;
  updateToBottom();
}

// ---- Planes de reparto (JARVIS reparte un requerimiento en el equipo) --------------

const plansById = new Map();
const PLAN_ST = {
  espera: ['⏳', 'en espera'], enviada: ['▶', 'en marcha'], hecho: ['✅', 'hecha'],
  fallida: ['⚠️', 'falló'], bloqueada: ['⛔', 'bloqueada'], cancelada: ['⊘', 'cancelada'],
};

function planCard(planId) {
  const plan = plansById.get(planId);
  const card = document.createElement('div');
  card.className = 'plan-card';
  card.dataset.planId = planId;
  if (!plan) { card.textContent = '🧭 Plan de reparto'; return card; }
  const boardTasks = (window.PIXEL_BOARD && window.PIXEL_BOARD.tasks) || [];
  const done = plan.tasks.filter((t) => t.status === 'hecho').length;
  const head = document.createElement('div');
  head.className = 'plan-head';
  const title = document.createElement('b');
  title.textContent = `🧭 ${plan.title}`;
  head.appendChild(title);
  const st = document.createElement('span');
  st.className = 'plan-st ' + plan.status.replace(' ', '-');
  st.textContent = `${plan.status} · ${done}/${plan.tasks.length}`;
  head.appendChild(st);
  card.appendChild(head);
  if (plan.summary) {
    const sm = document.createElement('div');
    sm.className = 'plan-sum';
    sm.textContent = plan.summary;
    card.appendChild(sm);
  }
  const prog = document.createElement('div');
  prog.className = 'plan-prog';
  const fill = document.createElement('i');
  fill.style.width = `${Math.round((done / plan.tasks.length) * 100)}%`;
  prog.appendChild(fill);
  card.appendChild(prog);
  const ol = document.createElement('ol');
  ol.className = 'plan-tasks';
  const byRef = new Map(plan.tasks.map((t) => [t.ref, t]));
  for (const t of plan.tasks) {
    const m = team.get(t.member) || { name: t.member };
    const li = document.createElement('li');
    li.className = t.status;
    li.style.setProperty('--who', (m.look && m.look.accent) || '#29f0ff');
    li.appendChild(avatar(m));
    const body = document.createElement('div');
    body.className = 'plan-task';
    const top = document.createElement('div');
    const nm = document.createElement('b');
    nm.textContent = m.name;
    top.appendChild(nm);
    let [ic, label] = PLAN_ST[t.status] || ['•', t.status];
    if (t.status === 'enviada') {
      const bt = boardTasks.find((x) => x.id === t.boardTask);
      if (bt && bt.status === 'pendiente') [ic, label] = ['⏳', 'en su cola'];
      else if (bt && bt.status === 'en curso') [ic, label] = ['▶', 'trabajando'];
    }
    if (t.status === 'espera' && t.deps.length) label = `espera a ${t.deps.map((d) => (team.get((byRef.get(d) || {}).member) || {}).name || d).join(', ')}`;
    const stl = document.createElement('span');
    stl.className = 'plan-task-st';
    stl.textContent = `${ic} ${label}`;
    top.appendChild(stl);
    body.appendChild(top);
    const tx = document.createElement('div');
    tx.className = 'plan-task-text';
    tx.textContent = t.text;
    body.appendChild(tx);
    li.appendChild(body);
    li.title = 'Ver su pantalla';
    li.addEventListener('click', () => window.PixelScreens && window.PixelScreens.open(t.member, t.boardTask));
    ol.appendChild(li);
  }
  card.appendChild(ol);
  const act = document.createElement('div');
  act.className = 'plan-actions';
  const see = document.createElement('button');
  see.className = 'chip-btn';
  see.textContent = '📋 Ver pantallas del equipo';
  see.addEventListener('click', () => window.PixelScreens && window.PixelScreens.openTeam());
  act.appendChild(see);
  if (plan.status === 'en marcha' && plan.tasks.some((t) => t.status === 'espera')) {
    const cancel = document.createElement('button');
    cancel.className = 'chip-btn danger';
    cancel.textContent = '✕ Cancelar lo que falta';
    cancel.title = 'Las tareas que aún no han empezado ya no se envían (las que están en marcha siguen)';
    cancel.addEventListener('click', async () => {
      if (!window.confirm(`¿Cancelar las tareas pendientes del plan «${plan.title}»?`)) return;
      await window.planApi.cancel(plan.id);
    });
    act.appendChild(cancel);
  }
  card.appendChild(act);
  return card;
}

// Si cambia el tablero o el plan, se rehacen solo sus tarjetas (sin mover la conversación).
let planRefresh = 0;
function refreshPlanCards() {
  clearTimeout(planRefresh);
  planRefresh = setTimeout(() => {
    for (const card of convoEl.querySelectorAll('.plan-card')) card.replaceWith(planCard(card.dataset.planId));
  }, 200);
}
window.addEventListener('pixel:board', refreshPlanCards);

// "JARVIS está trabajando…" con lo que hace ahora, al final de la conversación.
function renderTyping() {
  const old = convoEl.querySelector('.typing');
  if (old) old.remove();
  const m = team.get(activeId);
  if (!m) return;
  const lv = live.get(m.id) || {};
  if (!(lv.busy || m.status === 'busy')) return;
  const stick = nearBottom();
  const t = document.createElement('div');
  t.className = 'typing';
  t.innerHTML = '<span class="dots"><i></i><i></i><i></i></span><span></span>';
  t.lastChild.textContent = `${m.name} · ${lv.busy && lv.label && lv.label !== 'disponible' ? `${lv.emoji || ''} ${lv.label}` : 'trabajando…'}`;
  convoEl.appendChild(t);
  if (stick) convoEl.scrollTop = convoEl.scrollHeight;
}

const toBottomBtn = el('toBottom');
function updateToBottom() { toBottomBtn.hidden = nearBottom(); }
convoEl.addEventListener('scroll', updateToBottom);
toBottomBtn.addEventListener('click', () => { convoEl.scrollTop = convoEl.scrollHeight; });

function push(id, role, text, extra) {
  const m = team.get(id);
  if (!m) return;
  m.messages.push(Object.assign({ role, text, at: Date.now() }, extra || {}));
  if (m.messages.length > 300) m.messages.splice(0, m.messages.length - 300);
  if (id === activeId) renderConvo(role === 'user');
}

function setStatus(id, status) {
  const m = team.get(id);
  if (m && m.status !== status) {
    m.status = status;
    renderTeam();
    if (id === activeId) { renderProfile(); renderTyping(); }
  }
}

async function refreshTeam() {
  if (!api) return;
  const data = await api.list();
  if (data.cwd && document.activeElement !== cwdEl) cwdEl.value = data.cwd;
  if (Array.isArray(data.voices)) voices = data.voices;
  data.members.forEach((pm, index) => {
    const m = team.get(pm.id);
    // nombre, colores, voz… pueden haber cambiado (Personalizar equipo)
    if (m) Object.assign(m, pm, { index, status: m.status, messages: m.messages });
    else team.set(pm.id, Object.assign({}, pm, { index, status: pm.busy ? 'busy' : 'live', messages: [] }));
  });
  const helpTeam = document.querySelector('.help-team');
  if (helpTeam) helpTeam.textContent = [...team.values()].map((m) => `${m.emoji} ${m.name} ${m.role}`).join(' · ');
  renderTeam();
  renderConvo();
}

// ---- Acciones --------------------------------------------------------------

async function sendTo(ids, text, extra) {
  let sent = 0;
  // documentos adjuntos (📎): van con esta orden
  const A = window.PixelAttach;
  if (A && A.busy()) { hint('📎 Espera un momento: todavía estoy leyendo el documento.', true); return 0; }
  const docs = A ? A.ids() : [];
  const opts = docs.length ? { docs, delegate: A.delegate() } : undefined;
  const extra2 = docs.length ? Object.assign({}, extra, { docs: A.names(), delegate: opts.delegate }) : extra;
  for (const id of ids) {
    try {
      const res = await api.send(id, text, opts);
      if (res && res.ok === false) { push(id, 'error', res.error || 'no se pudo enviar'); continue; }
      push(id, 'user', text || (opts && opts.delegate ? 'Reparte este requerimiento en el equipo.' : 'Te paso este documento.'), extra2);
      if (res && res.queued) push(id, 'system', '⏳ En cola: empezará cuando termine lo que está haciendo (míralo en su 🖥️ pantalla).');
      setStatus(id, 'busy');
      sent += 1;
    } catch (e) {
      push(id, 'error', String(e && e.message ? e.message : e));
    }
  }
  if (sent && docs.length) A.clear();
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
      // solo muletillas ("hola", "vale"…): es un saludo, se lo mandamos tal cual
      if (String(text).trim()) {
        const ids = targets();
        const sent = await sendTo(ids, String(text).trim(), extra);
        if (sent) hint(`${heard} → enviado a ${namesOf(ids)}`);
        return;
      }
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
  const A = window.PixelAttach;
  if (!text && A && (A.count() || A.busy())) {
    // solo el documento: se lo mandamos al destino tal cual
    const ids = targets();
    const n = await sendTo(ids, '', { voice: false });
    if (n) { msgEl.placeholder = 'Escribe una orden… o habla con 🎤'; hint(`📎 Enviado a ${namesOf(ids)}.`); }
    return;
  }
  if (!text) { msgEl.focus(); return; }
  msgEl.value = '';
  autoGrow();
  msgEl.placeholder = 'Escribe una orden… o habla con 🎤';
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
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
});
function autoGrow() {
  msgEl.style.height = 'auto';
  msgEl.style.height = Math.min(160, msgEl.scrollHeight) + 'px';
}
msgEl.addEventListener('input', autoGrow);

// ---- Paneles de ajustes y ayuda --------------------------------------------

const drawers = { settings: el('settingsDrawer'), help: el('helpDrawer') };
const drawerBtns = { settings: el('settingsBtn'), help: el('helpBtn') };
function toggleDrawer(name, open) {
  for (const [k, d] of Object.entries(drawers)) {
    const show = k === name ? (open == null ? d.hidden : open) : false;
    d.hidden = !show;
    drawerBtns[k].classList.toggle('open', show);
  }
}
drawerBtns.settings.addEventListener('click', () => toggleDrawer('settings'));
drawerBtns.help.addEventListener('click', () => toggleDrawer('help'));
for (const d of Object.values(drawers)) {
  d.querySelector('[data-close]').addEventListener('click', () => toggleDrawer(null));
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && Object.values(drawers).some((d) => !d.hidden)) { toggleDrawer(null); e.stopImmediatePropagation(); }
}, true);

// ---- Ancho del panel (arrastrando su borde) --------------------------------

(() => {
  const chatEl = el('chat');
  const handle = el('chatResize');
  const KEY = 'pixel.panel.ancho';
  const setW = (w) => document.documentElement.style.setProperty('--chat-w', Math.round(Math.max(320, Math.min(620, w))) + 'px');
  try { const w = +localStorage.getItem(KEY); if (w) setW(w); } catch (_) { /* noop */ }
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
    const move = (ev) => setW(window.innerWidth - ev.clientX);
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.classList.remove('dragging');
      try { localStorage.setItem(KEY, String(chatEl.getBoundingClientRect().width)); } catch (_) { /* noop */ }
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
  handle.addEventListener('dblclick', () => { setW(380); try { localStorage.removeItem(KEY); } catch (_) { /* noop */ } });
})();
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

// ---- Voz: elegir micrófono -------------------------------------------------
// Windows puede tener de predeterminado un micro mudo (el del portátil
// silenciado, uno virtual de Steam…) aunque hables por los auriculares. Aquí
// eliges cuál usar y se recuerda.

const micSelect = el('micSelect');
const micField = el('micField');
const MIC_KEY = 'pixel.voz.micro';
let micPref = '';
try { micPref = localStorage.getItem(MIC_KEY) || ''; } catch (_) { /* noop */ }

function saveMicPref(id) {
  micPref = id || '';
  try { localStorage.setItem(MIC_KEY, micPref); } catch (_) { /* noop */ }
}

function micLabelOf(id) {
  const o = [...micSelect.options].find((x) => x.value === id);
  return o ? o.textContent : '';
}

async function refreshMics() {
  if (!PV || !PV.mics) return;
  try {
    const [list, defLabel] = await Promise.all([PV.mics.list(), PV.mics.defaultLabel()]);
    micSelect.innerHTML = '';
    const def = document.createElement('option');
    def.value = '';
    def.textContent = defLabel ? `Windows: ${defLabel}` : 'Micrófono de Windows';
    micSelect.appendChild(def);
    for (const m of list) {
      const o = document.createElement('option');
      o.value = m.id;
      o.textContent = m.label;
      micSelect.appendChild(o);
    }
    // Si el elegido no está conectado ahora, usamos el de Windows sin
    // olvidar la preferencia (volverá al reconectarlo).
    micSelect.value = list.some((m) => m.id === micPref) ? micPref : '';
    micField.title = 'Micrófono con el que hablas al equipo: ' + micSelect.options[micSelect.selectedIndex].textContent;
  } catch (e) {
    console.warn('voz: no se pudieron listar los micros:', e && e.message ? e.message : e);
  }
}

function nudgeMicField() {
  toggleDrawer('settings', true);
  micField.classList.remove('nudge');
  void micField.offsetWidth; // reinicia la animación
  micField.classList.add('nudge');
  setTimeout(() => micField.classList.remove('nudge'), 3000);
}

// La grabación salió en silencio digital: ese micro está mudo. Buscamos otro
// que sí capte sonido y, si lo hay, lo elegimos. Devuelve su nombre o ''.
async function findLiveMic(deadLabel) {
  if (!PV || !PV.mics) return '';
  let list = [];
  try { list = await PV.mics.list(); } catch (_) { return ''; }
  for (const m of list) {
    if (m.label === deadLabel) continue;
    try {
      const rms = await PV.mics.probe(m.id, 2000, 0.0005);
      if (rms > 0.0005) {
        saveMicPref(m.id);
        await refreshMics();
        return m.label;
      }
    } catch (_) { /* ese micro no se puede abrir; seguimos */ }
  }
  return '';
}

micSelect.addEventListener('change', () => {
  saveMicPref(micSelect.value);
  micField.title = 'Micrófono con el que hablas al equipo: ' + micLabelOf(micSelect.value);
  hint(`🎙️ Micrófono: ${micLabelOf(micSelect.value)}. Mantén 🎤 y habla: el anillo se mueve si te oye.`);
  if (hands.on) startHands(); // manos libres pasa a escuchar por el nuevo micro
});
if (navigator.mediaDevices) navigator.mediaDevices.addEventListener('devicechange', refreshMics);
refreshMics();
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
  voiceIpc.prepare(sttQuality()).then(showVoiceStatus).catch(() => { voicePrepared = false; });
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
  // Unos auriculares Bluetooth tardan ~2 s en pasar a modo micrófono: hasta
  // que no esté abierto no decimos "Escuchando" (lo dicho antes se perdería).
  setMicUi('busy');
  hint('🎤 Abriendo micrófono… espera a «Escuchando»');
  clearTimeout(micTimer);
  micTimer = setTimeout(() => { if (micMode) { hint('🎤 Máximo 2 minutos por mensaje.'); micStop(); } }, MIC_MAX_MS);
  try {
    const ok = await PV.recorder.start(setLevel, micSelect.value || null);
    // Tras el primer permiso ya se ven los nombres reales de los micros.
    if (ok && micSelect.options.length < 2) refreshMics();
    if (ok && micMode) {
      setMicUi('listening');
      hint(micMode === 'key' ? '🎤 Escuchando… suelta Ctrl+Espacio para enviar (Esc cancela)'
        : micMode === 'toggle' ? '🎤 Escuchando… habla y se enviará al callarte (o pulsa 🎤 otra vez). Esc cancela.'
          : '🎤 Escuchando… suelta para enviar (Esc cancela)');
    }
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
    if (res.rms < 0.0015) {
      const dead = PV.recorder.lastLabel();
      // Silencio digital (~0): ese micro está mudo o desactivado.
      if (res.rms < 0.0002) {
        hint(`🎤 El micrófono «${dead || 'de Windows'}» no da ninguna señal. Buscando otro…`, true);
        const live = await findLiveMic(dead);
        if (req !== micReq) return;
        if (live) { hint(`🎙️ He cambiado al micrófono «${live}». Vuelve a hablar.`); nudgeMicField(); return; }
      }
      hint(`🎤 No te he oído con «${dead || 'el micrófono de Windows'}». Elige otro en 🎙️ o sube su volumen.`, true);
      nudgeMicField();
      return;
    }

    hint('✍️ Transcribiendo… (Esc cancela)');
    const r = await voiceIpc.transcribe(res.audio, sttQuality());
    if (req !== micReq) return; // cancelado con Esc mientras esperábamos
    if (r && r.error) { hint('🎤 Error al transcribir: ' + r.error, true); return; }
    const text = String((r && r.text) || '').trim();
    if (VC.isNoise(text, teamNames())) { hint('🎤 No te he entendido. Prueba otra vez.', true); return; }
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
    // Si aún se está abriendo, micStart pone este aviso al terminar.
    if (micBtn.dataset.state === 'listening') hint('🎤 Escuchando… habla y se enviará al callarte (o pulsa 🎤 otra vez). Esc cancela.');
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

// ---- Voz: ajustes ----------------------------------------------------------

function sttQuality() { return sttQualityEl.value === 'rapida' ? 'rapida' : 'precisa'; }

try { sttQualityEl.value = localStorage.getItem('pixel.voz.precision') || 'precisa'; } catch (_) { /* noop */ }
sttQualityEl.addEventListener('change', () => {
  try { localStorage.setItem('pixel.voz.precision', sttQuality()); } catch (_) { /* noop */ }
  voicePrepared = false;
  prepareVoice(); // descarga/carga el otro modelo ya
  hint(sttQuality() === 'precisa' ? '🎙️ Reconocimiento preciso (Whisper small).' : '🎙️ Reconocimiento rápido (Whisper base).');
});
if (PV) {
  ttsModeEl.value = PV.speaker.mode();
  if (!PV.speaker.hasNatural()) ttsModeEl.disabled = true;
  ttsModeEl.addEventListener('change', () => {
    PV.speaker.setMode(ttsModeEl.value);
    hint(ttsModeEl.value === 'natural' ? '🔊 Voces naturales (cada miembro con la suya).' : '🔊 Voces del sistema.');
  });
  PV.speaker.onNotice((text) => hint(text, true));
}

// ---- Voz: manos libres -------------------------------------------------------
// El micro queda abierto: di un nombre ("JARVIS, revisa…", "EDITH") y la app
// sabe con quién hablas. Durante FOLLOW_MS puedes seguir sin repetirlo; lo
// que no va dirigido a nadie se ignora. La voz del propio equipo (altavoces)
// no cuenta como orden.

const handsBtn = el('handsBtn');
const HANDS_KEY = 'pixel.voz.manoslibres';
const FOLLOW_MS = 15000;
const hands = { on: false, hearing: false, pending: 0, speechAt: 0, ttsStartAt: 0, ttsEndAt: 0, followUntil: 0, deadTried: false };

function teamNames() { return [...team.values()].map((m) => ({ name: m.name, aliases: m.aliases })); }

function renderHandsBtn() {
  handsBtn.classList.toggle('live', hands.on);
  handsBtn.classList.toggle('off', !hands.on);
  handsBtn.classList.toggle('hearing', hands.on && (hands.hearing || hands.pending > 0));
  handsBtn.title = hands.on
    ? 'Manos libres activado: di un nombre y habla (clic para desactivar)'
    : 'Manos libres: el micro escucha siempre y reconoce a quién le hablas por su nombre';
}

function saveHands(on) {
  try { localStorage.setItem(HANDS_KEY, on ? '1' : '0'); } catch (_) { /* noop */ }
}

// ¿La frase empieza nombrando a alguien (o es "silencio")?
function isAddressed(cmd) { return cmd.to != null || cmd.type === 'silence'; }

// A quién hablas pasa a ser quien has nombrado: así las frases siguientes
// (sin nombre) le llegan a él o ellos.
function focusAddressed(cmd) {
  if (!cmd.to || cmd.type === 'interrupt' || cmd.type === 'reset') return;
  const ids = cmd.to === 'all' ? [...team.keys()]
    : cmd.to.map((n) => [...team.values()].find((m) => m.name === n)).filter(Boolean).map((m) => m.id);
  if (!ids.length) return;
  selected.clear();
  if (ids.length === 1) activeId = ids[0]; else ids.forEach((id) => selected.add(id));
  renderTeam();
  renderConvo();
}

async function handsSegment(audio) {
  if (!hands.on || micMode || micBusy) return; // estás usando 🎤: manda él
  // Si el equipo estaba hablando, lo oído es (o incluye) su voz: se descarta.
  if (PV.speaker.speakingKey() || hands.speechAt < hands.ttsEndAt + 400) return;
  hands.pending += 1;
  renderHandsBtn();
  try {
    const r = await voiceIpc.transcribe(audio, sttQuality());
    if (!hands.on) return;
    if (r && r.error) { hint('👂 ' + r.error, true); return; }
    const text = String((r && r.text) || '').trim();
    if (!text || VC.isNoise(text, teamNames())) return;
    const cmd = VC.parseCommand(text, teamNames());
    const following = performance.now() < hands.followUntil;
    if (!isAddressed(cmd) && !following) {
      hint(`👂 «${text.length > 60 ? text.slice(0, 59) + '…' : text}» — sin nombre, lo ignoro. Empieza por «JARVIS, …» o «Todos, …».`);
      return;
    }
    hands.followUntil = performance.now() + FOLLOW_MS;
    focusAddressed(cmd);
    await runCommand(text, true);
  } catch (e) {
    hint('👂 Error: ' + (e && e.message ? e.message : e), true);
  } finally {
    hands.pending -= 1;
    renderHandsBtn();
  }
}

async function startHands() {
  if (!voiceIpc || !PV || !PV.listener || !VC) { hint('La voz no está disponible en esta versión.', true); return; }
  hands.on = true;
  renderHandsBtn();
  prepareVoice();
  hint('👂 Abriendo micrófono…');
  try {
    const label = await PV.listener.start(micSelect.value || null, {
      onSegment: handsSegment,
      onSpeech: (on) => {
        hands.hearing = on;
        if (on) hands.speechAt = performance.now();
        renderHandsBtn();
      },
      onDead: async (dead) => {
        // Micro mudo: probamos a cambiar a uno que sí capte sonido (una vez).
        if (hands.deadTried) {
          hint(`👂 El micrófono «${dead}» no da señal. Elige otro en 🎙️.`, true);
          nudgeMicField();
          return;
        }
        hands.deadTried = true;
        hint(`👂 El micrófono «${dead}» no da ninguna señal. Buscando otro…`, true);
        PV.listener.stop();
        const live = await findLiveMic(dead);
        if (!hands.on) return;
        if (live) nudgeMicField();
        startHands();
      },
      onEnded: () => { if (hands.on) { hint('👂 Se desconectó el micrófono; vuelvo a abrirlo…', true); startHands(); } },
    });
    if (label === null || !hands.on) return; // se desactivó mientras abría
    if (micSelect.options.length < 2) refreshMics();
    hint(`👂 Manos libres (${label || 'micrófono de Windows'}): di un nombre — «JARVIS, revisa los tests» — y sigue hablando sin repetirlo.`);
  } catch (e) {
    hands.on = false;
    renderHandsBtn();
    hint(micErrorText(e), true);
  }
}

function stopHands() {
  hands.on = false;
  hands.hearing = false;
  hands.followUntil = 0;
  if (PV && PV.listener) PV.listener.stop();
  renderHandsBtn();
}

handsBtn.addEventListener('click', () => {
  if (hands.on) { stopHands(); saveHands(false); hint('👂 Manos libres desactivado.'); return; }
  hands.deadTried = false;
  saveHands(true);
  startHands();
});

if (PV) {
  PV.speaker.onChange((key) => {
    const now = performance.now();
    if (key) { hands.ttsStartAt = now; return; }
    // Terminó de hablar el equipo. Si estabas en conversación con alguien,
    // tienes otro rato para contestarle sin repetir su nombre.
    hands.ttsEndAt = now;
    if (hands.followUntil > hands.ttsStartAt) hands.followUntil = Math.max(hands.followUntil, now + FOLLOW_MS);
  });
}

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
        setStatus(ev.id, ev.busy ? 'busy' : 'live');
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
      case 'user':
        // mensajes que no has escrito tú: tareas del líder e informes de los planes
        if (ev.from && ev.from !== ev.id) {
          push(ev.id, 'delegated', ev.text, { fromId: ev.from, plan: ev.plan });
          setStatus(ev.id, 'busy');
        } else if (ev.plan) {
          push(ev.id, 'system', `${ev.text}: el equipo ha terminado y ${m.name} lo está revisando.`);
          setStatus(ev.id, 'busy');
        }
        break;
      case 'plan': {
        const first = !plansById.has(ev.plan.id);
        const prev = plansById.get(ev.plan.id);
        plansById.set(ev.plan.id, ev.plan);
        if (first) {
          push(ev.id, 'plan', '', { planId: ev.plan.id });
          const to = [...new Set(ev.plan.tasks.map((t) => t.member))];
          window.dispatchEvent(new CustomEvent('pixel:delegate', { detail: { from: ev.id, to } }));
          hint(`🧭 ${m.name} ha repartido «${ev.plan.title}» entre ${namesOf(to)}.`);
        } else refreshPlanCards();
        if (prev && prev.status === 'en marcha' && ev.plan.status !== 'en marcha' && ev.plan.status !== 'cancelado') {
          hint(ev.plan.status === 'terminado' ? `✅ Plan «${ev.plan.title}» terminado: ${m.name} lo está revisando.` : `⚠️ Plan «${ev.plan.title}» con problemas: ${m.name} lo está revisando.`, ev.plan.status !== 'terminado');
        }
        break;
      }
      case 'error':
        push(ev.id, 'error', ev.text || 'error');
        setStatus(ev.id, 'error');
        if (ev.auth) hint('🔑 ' + ev.text, true);
        break;
      case 'closed':
        if (m.status === 'busy') setStatus(ev.id, 'live');
        break;
    }
  });
}

// Para las pantallas de los agentes (screen.js) y el editor del equipo (team-editor.js).
window.PixelTeam = {
  team, live, avatar, escapeHtml, renderMarkdown, hint, targets,
  voices: () => voices,
  refresh: refreshTeam,
  focus: (id) => { focusMember(id, false); },
};

renderTtsBtn();
renderHandsBtn();
if (window.planApi) window.planApi.list().then((ps) => { for (const p of ps || []) plansById.set(p.id, p); }).catch(() => {});
refreshTeam().then(() => {
  hint('🎯 Habla con JARVIS o di el nombre de otro miembro del equipo.');
  let handsSaved = false;
  try { handsSaved = localStorage.getItem(HANDS_KEY) === '1'; } catch (_) { /* noop */ }
  if (handsSaved) startHands();
  console.log('CHAT-INIT ok; equipo=' + team.size + ' voz=' + !!(voiceIpc && PV && VC));
}).catch((e) => hint('No se pudo cargar el equipo: ' + (e && e.message), true));
