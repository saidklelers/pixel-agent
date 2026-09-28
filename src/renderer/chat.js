'use strict';

// ---------------------------------------------------------------------------
// Centro de mando: lanza y dirige agentes de Claude Code desde la oficina.
// - Casilla por agente: elige quiénes reciben la orden (difusión a varios).
// - "Todos / Ninguno": atajos de selección.
// - Enviar manda la misma instrucción a todos los marcados a la vez; si no
//   hay ninguno marcado, va al agente que estás viendo.
// Habla con el proceso principal por IPC (window.agentApi).
// ---------------------------------------------------------------------------

const el = (id) => document.getElementById(id);
const agentListEl = el('agentList');
const convoEl = el('convo');
const cwdEl = el('cwd');
const msgEl = el('msg');
const hintEl = el('hint');
const targetInfoEl = el('targetInfo');
const agentNameEl = el('agentName');

// Mapa sessionId -> nombre, compartido con el canvas (renderer.js lo lee en
// la etiqueta del personaje).
window.PIXEL_AGENT_NAMES = window.PIXEL_AGENT_NAMES || {};

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

function hint(text, isErr) {
  hintEl.textContent = text || '';
  hintEl.classList.toggle('err', !!isErr);
}

function shortName(a) {
  if (a.name) return a.name;
  const base = a.cwd ? a.cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() : 'claude';
  return `#${a.num} ${base || 'claude'}`;
}

// Agentes que recibirán el próximo Enviar.
function targets() {
  if (selected.size) return [...selected].filter((id) => agents.has(id));
  if (activeId && agents.has(activeId)) return [activeId];
  return [];
}

function updateTargetInfo() {
  const t = targets();
  let txt;
  let broadcast = false;
  if (selected.size) {
    txt = `Destino: ${t.length} agente(s) a la vez`;
    broadcast = t.length > 1;
  } else if (activeId && agents.has(activeId)) {
    txt = `Destino: ${shortName(agents.get(activeId))}`;
  } else {
    txt = 'Destino: nuevo agente';
  }
  targetInfoEl.textContent = txt;
  targetInfoEl.classList.toggle('broadcast', broadcast);
}

function renderAgentList() {
  agentListEl.innerHTML = '';
  for (const a of agents.values()) {
    const chip = document.createElement('div');
    chip.className = 'agent-chip' + (a.id === activeId ? ' active' : '');
    chip.title = a.cwd;

    const pick = document.createElement('input');
    pick.type = 'checkbox';
    pick.className = 'pick';
    pick.checked = selected.has(a.id);
    pick.addEventListener('click', (e) => e.stopPropagation());
    pick.addEventListener('change', () => {
      if (pick.checked) selected.add(a.id); else selected.delete(a.id);
      updateTargetInfo();
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
    chip.appendChild(dot);
    chip.appendChild(name);
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
    d.textContent = 'Selecciona o lanza un agente para ver su conversación.';
    convoEl.appendChild(d);
    return;
  }
  for (const m of a.messages) {
    const div = document.createElement('div');
    if (m.role === 'user') { div.className = 'bubble user'; div.textContent = m.text; }
    else if (m.role === 'assistant') { div.className = 'bubble assistant'; div.textContent = m.text; }
    else if (m.role === 'tool') { div.className = 'line-tool'; div.textContent = '⚙️ ' + m.text; }
    else if (m.role === 'error') { div.className = 'line-error'; div.textContent = '⚠️ ' + m.text; }
    else { div.className = 'line-system'; div.textContent = m.text; }
    convoEl.appendChild(div);
  }
  convoEl.scrollTop = convoEl.scrollHeight;
}

function push(id, role, text) {
  const a = agents.get(id);
  if (!a) return;
  a.messages.push({ role, text });
  if (id === activeId) renderConvo();
}

function setStatus(id, status) {
  const a = agents.get(id);
  if (a) { a.status = status; renderAgentList(); }
}

// ---- Acciones --------------------------------------------------------------

async function spawn() {
  const prompt = msgEl.value.trim();
  console.log('spawn(): texto=' + prompt.length + ' chars, api=' + !!(window.agentApi && window.agentApi.spawn));
  if (!prompt) { msgEl.focus(); hint('✍️ Escribe primero una tarea en la caja grande, luego pulsa ＋ Agente.', true); return; }
  const cwd = cwdEl.value.trim();
  const name = agentNameEl.value.trim() || suggestName();
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
    push(res.id, 'user', prompt);
    renderAgentList();
    renderConvo();
    msgEl.value = '';
    agentNameEl.value = suggestName();
    hint(`Agente "${name}" lanzado. Aparecerá caminando a su escritorio.`);
  } catch (e) {
    hint('Error al lanzar: ' + (e && e.message ? e.message : e), true);
  }
}

async function send() {
  const t = targets();
  if (!t.length) { spawn(); return; }
  const text = msgEl.value.trim();
  if (!text) { msgEl.focus(); return; }

  let sent = 0;
  for (const id of t) {
    try {
      const res = await window.agentApi.send(id, text);
      if (res && res.ok === false) continue;
      push(id, 'user', text);
      setStatus(id, 'busy');
      sent += 1;
    } catch (_) { /* sigue con los demás */ }
  }
  msgEl.value = '';
  hint(sent > 1 ? `Orden enviada a ${sent} agentes a la vez.` : sent === 1 ? '' : 'No se pudo enviar.', sent === 0);
}

async function stop() {
  const t = targets();
  for (const id of t) { try { await window.agentApi.stop(id); } catch (_) { /* noop */ } }
}

async function deleteAgent(id) {
  try { await window.agentApi.stop(id); } catch (_) { /* noop */ }
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

el('spawnBtn').addEventListener('click', spawn);
el('sendBtn').addEventListener('click', send);
el('newAgent').addEventListener('click', () => { msgEl.focus(); hint('Escribe la tarea y pulsa ＋ Agente.'); });
el('stopBtn').addEventListener('click', stop);
el('selAll').addEventListener('click', selectAll);
el('selNone').addEventListener('click', selectNone);
msgEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
});

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
        if (a) {
          a.sessionId = ev.sessionId;
          if (a.name && ev.sessionId) window.PIXEL_AGENT_NAMES[ev.sessionId] = a.name;
        }
        break;
      case 'assistant':
        push(ev.id, 'assistant', ev.text);
        setStatus(ev.id, 'busy');
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
        setStatus(ev.id, 'closed');
        break;
    }
  });
}

renderAgentList();
renderConvo();
agentNameEl.value = suggestName();
console.log('CHAT-INIT ok; api=' + !!(window.agentApi && window.agentApi.spawn) +
  ' spawnBtn=' + !!document.getElementById('spawnBtn') +
  ' sendBtn=' + !!document.getElementById('sendBtn'));
