'use strict';

// ---------------------------------------------------------------------------
// Planes de reparto: JARVIS divide un requerimiento en tareas para el equipo
// (herramienta repartir_tareas). Cada tarea va a un miembro y puede depender
// de otras (p. ej. los tests de EDITH después de la API de TARS). Las que
// pueden empezar se envían ya; las demás esperan. Si una falla, las que
// dependen de ella quedan bloqueadas. Cuando no queda nada en marcha, el plan
// termina y JARVIS recibe el informe para revisarlo.
// Sin dependencias de Electron para poder probarlo con node --test.
// ---------------------------------------------------------------------------

const MAX_TASKS = 12;
const MAX_DEPTH = 3; // rondas de reparto encadenadas (informe → nuevo reparto → …)

function fold(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function createPlans(opts) {
  const now = (opts && opts.now) || (() => Date.now());
  let seq = 0;
  const plans = [];

  // members: [{ id, name }] — acepta el id o el nombre (sin tildes ni mayúsculas).
  function resolveMember(who, members) {
    const f = fold(who);
    return members.find((m) => fold(m.id) === f || fold(m.name) === f) || null;
  }

  // Crea un plan. Devuelve { ok, plan } o { ok:false, error }.
  function create(input, members, info) {
    const i = input || {};
    const list = Array.isArray(i.tareas) ? i.tareas : [];
    if (!list.length) return { ok: false, error: 'El plan no tiene tareas.' };
    if (list.length > MAX_TASKS) return { ok: false, error: `Demasiadas tareas (máximo ${MAX_TASKS}); agrúpalas.` };
    const depth = (info && info.depth) || 0;
    if (depth > MAX_DEPTH) {
      return { ok: false, error: `Ya van ${MAX_DEPTH} rondas de reparto para este requerimiento. No repartas más: explica al usuario qué falta y pregúntale cómo seguir.` };
    }
    const tasks = [];
    const refs = new Set();
    for (let n = 0; n < list.length; n++) {
      const t = list[n] || {};
      const m = resolveMember(t.miembro, members);
      if (!m) return { ok: false, error: `No hay nadie llamado «${t.miembro}» en el equipo. Miembros: ${members.map((x) => x.name).join(', ')}.` };
      const text = String(t.tarea || '').trim();
      if (!text) return { ok: false, error: `La tarea ${n + 1} está vacía.` };
      let ref = String(t.id || `t${n + 1}`).trim() || `t${n + 1}`;
      while (refs.has(ref)) ref += "'";
      refs.add(ref);
      tasks.push({ ref, member: m.id, text: text.slice(0, 4000), deps: (Array.isArray(t.depende_de) ? t.depende_de : []).map(String), status: 'espera', boardTask: null, result: '' });
    }
    // dependencias: solo las que existen, sin ciclos
    for (const t of tasks) t.deps = t.deps.filter((d) => refs.has(d) && d !== t.ref);
    const byRef = new Map(tasks.map((t) => [t.ref, t]));
    const visiting = new Set();
    const done = new Set();
    const hasCycle = (t) => {
      if (done.has(t.ref)) return false;
      if (visiting.has(t.ref)) return true;
      visiting.add(t.ref);
      const c = t.deps.some((d) => hasCycle(byRef.get(d)));
      visiting.delete(t.ref);
      done.add(t.ref);
      return c;
    };
    if (tasks.some((t) => hasCycle(t))) return { ok: false, error: 'Las dependencias forman un ciclo (A espera a B y B a A). Corrígelas.' };

    const plan = {
      id: `p${now().toString(36)}${(++seq).toString(36)}`,
      title: String(i.titulo || 'Plan del equipo').trim().slice(0, 120),
      summary: String(i.resumen || '').trim().slice(0, 2000),
      doc: (info && info.doc) || null,
      depth, parent: (info && info.parent) || null,
      status: 'en marcha', createdAt: now(), endedAt: null, tasks,
    };
    plans.push(plan);
    if (plans.length > 50) plans.splice(0, plans.length - 50);
    return { ok: true, plan };
  }

  const get = (id) => plans.find((p) => p.id === id) || null;

  // Tareas que ya pueden empezar (sus dependencias están hechas).
  function ready(plan) {
    if (!plan || plan.status !== 'en marcha') return [];
    const byRef = new Map(plan.tasks.map((t) => [t.ref, t]));
    return plan.tasks.filter((t) => t.status === 'espera' && t.deps.every((d) => byRef.get(d).status === 'hecho'));
  }

  function markSent(plan, ref, boardTask) {
    const t = plan.tasks.find((x) => x.ref === ref);
    if (t) { t.status = 'enviada'; t.boardTask = boardTask || null; t.sentAt = now(); }
    return t;
  }

  // Resultado de una tarea del tablero. status: 'hecho' | 'error' | 'interrumpida' | 'cancelada'.
  // Devuelve { plan, task, finished } o null si no era de ningún plan.
  function taskEnded(boardTaskId, status, result) {
    for (const plan of plans) {
      const t = plan.tasks.find((x) => x.boardTask === boardTaskId);
      if (!t) continue;
      if (t.status !== 'enviada') return { plan, task: t, finished: false };
      t.status = status === 'hecho' ? 'hecho' : 'fallida';
      t.detail = status;
      t.result = String(result || '').slice(0, 6000);
      t.endedAt = now();
      if (t.status === 'fallida') block(plan);
      return { plan, task: t, finished: checkFinished(plan) };
    }
    return null;
  }

  // Lo que depende (directa o indirectamente) de una tarea fallida queda bloqueado.
  function block(plan) {
    let changed = true;
    while (changed) {
      changed = false;
      const byRef = new Map(plan.tasks.map((t) => [t.ref, t]));
      for (const t of plan.tasks) {
        if (t.status === 'espera' && t.deps.some((d) => ['fallida', 'bloqueada', 'cancelada'].includes(byRef.get(d).status))) {
          t.status = 'bloqueada';
          changed = true;
        }
      }
    }
  }

  function checkFinished(plan) {
    if (plan.status !== 'en marcha') return false;
    if (plan.tasks.some((t) => t.status === 'espera' || t.status === 'enviada')) return false;
    plan.status = plan.tasks.every((t) => t.status === 'hecho') ? 'terminado' : 'con problemas';
    plan.endedAt = now();
    return true;
  }

  // Cancelar: lo que aún no ha empezado ya no se envía.
  function cancel(id) {
    const plan = get(id);
    if (!plan || plan.status !== 'en marcha') return null;
    for (const t of plan.tasks) if (t.status === 'espera') t.status = 'cancelada';
    plan.status = 'cancelado';
    plan.endedAt = now();
    return plan;
  }

  // Plan al que pertenece una tarea del tablero (para saber la ronda).
  function planOfTask(boardTaskId) {
    return plans.find((p) => p.tasks.some((t) => t.boardTask === boardTaskId) || p.reportTask === boardTaskId) || null;
  }

  function snapshot() { return plans; }

  return { create, get, ready, markSent, taskEnded, cancel, planOfTask, snapshot, resolveMember };
}

// Mensaje para el miembro que recibe una tarea del plan.
function taskPrompt(plan, task, members, leaderName) {
  const nameOf = (id) => (members.find((m) => m.id === id) || {}).name || id;
  const byRef = new Map(plan.tasks.map((t) => [t.ref, t]));
  let s = `${leaderName} te ha asignado una tarea del plan «${plan.title}».\n`;
  if (plan.summary) s += `\nObjetivo del plan: ${plan.summary}\n`;
  if (plan.doc) s += `\nEl requerimiento original está en: ${plan.doc.textPath || plan.doc.path}${plan.doc.path && plan.doc.textPath ? ` (original: ${plan.doc.path})` : ''}. Consúltalo si necesitas detalles.\n`;
  s += `\nTU TAREA (${task.ref}):\n${task.text}\n`;
  const deps = task.deps.map((d) => byRef.get(d)).filter(Boolean);
  if (deps.length) {
    s += '\nYa han terminado lo que necesitabas:';
    for (const d of deps) s += `\n- ${nameOf(d.member)} (${d.ref}): ${d.result ? d.result.slice(0, 1500) : 'hecho'}`;
    s += '\n';
  }
  const others = plan.tasks.filter((t) => t !== task && t.member !== task.member);
  if (others.length) {
    s += '\nEn paralelo, tus compañeros hacen:';
    for (const t of others) s += `\n- ${nameOf(t.member)}: ${t.text.split('\n')[0].slice(0, 160)}`;
    s += '\nNo toques su parte; si necesitas algo de ellos, dilo en tu resumen.\n';
  }
  s += `\nAl terminar, responde con un resumen breve para ${leaderName}: qué has hecho, qué archivos has cambiado y si queda algo pendiente o algún problema.`;
  return s;
}

// Informe para el líder cuando termina el plan.
function reportPrompt(plan, members) {
  const nameOf = (id) => (members.find((m) => m.id === id) || {}).name || id;
  const icon = { hecho: '✅', fallida: '⚠️', bloqueada: '⛔', cancelada: '⊘' };
  let s = `INFORME DEL PLAN «${plan.title}» (${plan.status}).\n`;
  for (const t of plan.tasks) {
    s += `\n${icon[t.status] || '•'} ${t.ref} · ${nameOf(t.member)} · ${t.status}${t.detail && t.detail !== 'hecho' ? ` (${t.detail})` : ''}\nTarea: ${t.text.split('\n')[0].slice(0, 200)}\n`;
    if (t.result) s += `Su resumen: ${t.result.slice(0, 1800)}\n`;
  }
  s += '\nRevisa el resultado frente al requerimiento (puedes mirar el código y ejecutar los tests). ' +
    'Si falta algo o hay fallos, vuelve a repartir lo necesario con repartir_tareas. ' +
    'Si está completo, da al usuario un resumen final breve de lo que ha hecho el equipo.';
  return s;
}

module.exports = { createPlans, taskPrompt, reportPrompt, MAX_TASKS, MAX_DEPTH, fold };
