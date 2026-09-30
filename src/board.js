'use strict';

// ---------------------------------------------------------------------------
// Tablero de tareas del equipo: cada orden que recibe un miembro es una tarea
// (pendiente → en curso → hecha) con los pasos que ha dado (archivos que lee
// o edita, comandos y su salida, búsquedas…) y lo que ha costado. De aquí
// salen el tablero de la pared y la pantalla de cada agente.
// Sin dependencias de Electron para poder probarlo con node --test.
// ---------------------------------------------------------------------------

const MAX_TASKS = 200;      // en total (se descartan las terminadas más antiguas)
const MAX_STEPS = 150;      // por tarea
const LIMITS = { text: 4000, code: 6000, output: 4000, result: 6000 };

const ACTIVE = new Set(['pendiente', 'en curso']);
// Comandos que cuentan como "validar" (tests, lint, build, comprobaciones de tipos…)
const VALIDATE = /\b(test|tests|jest|vitest|mocha|pytest|playwright|cypress|lint|eslint|prettier --check|tsc|typecheck|build|check|verify|go vet|cargo (?:test|check|clippy)|dotnet test|mvn (?:test|verify)|gradle(?:w)? (?:test|check))\b/i;

function clip(s, max) {
  const t = String(s == null ? '' : s);
  return t.length > max ? t.slice(0, max) + `\n… (${t.length - max} caracteres más)` : t;
}
// Para salidas de comandos lo interesante suele estar al final.
function clipTail(s, max) {
  const t = String(s == null ? '' : s);
  return t.length > max ? `… (${t.length - max} caracteres antes)\n` + t.slice(-max) : t;
}

function resultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c) => (c && c.type === 'text' ? c.text : '')).filter(Boolean).join('\n');
  return '';
}

// Resume la entrada de una herramienta en lo que se enseña en la pantalla.
function describeTool(name, input) {
  const i = input || {};
  const s = { tool: name, kind: 'tool' };
  switch (name) {
    case 'Edit':
      Object.assign(s, { kind: 'edit', file: i.file_path, before: clip(i.old_string, LIMITS.code), after: clip(i.new_string, LIMITS.code) });
      break;
    case 'MultiEdit':
      Object.assign(s, {
        kind: 'edit', file: i.file_path,
        before: clip((i.edits || []).map((e) => e.old_string).join('\n⋯\n'), LIMITS.code),
        after: clip((i.edits || []).map((e) => e.new_string).join('\n⋯\n'), LIMITS.code),
      });
      break;
    case 'Write':
      Object.assign(s, { kind: 'write', file: i.file_path, code: clip(i.content, LIMITS.code) });
      break;
    case 'NotebookEdit':
      Object.assign(s, { kind: 'write', file: i.notebook_path, code: clip(i.new_source, LIMITS.code) });
      break;
    case 'Read':
    case 'NotebookRead':
      Object.assign(s, { kind: 'read', file: i.file_path || i.notebook_path });
      break;
    case 'Bash':
    case 'PowerShell':
      Object.assign(s, { kind: VALIDATE.test(String(i.command || '')) ? 'validate' : 'run', command: clip(i.command, 2000), note: i.description || '' });
      break;
    case 'Grep':
    case 'Glob':
    case 'LS':
      Object.assign(s, { kind: 'search', pattern: i.pattern || i.path || '', where: i.path || i.glob || '' });
      break;
    case 'WebSearch':
      Object.assign(s, { kind: 'web', query: i.query || '' });
      break;
    case 'WebFetch':
      Object.assign(s, { kind: 'web', query: i.url || '', note: i.prompt || '' });
      break;
    case 'TodoWrite':
      Object.assign(s, {
        kind: 'plan',
        todos: (i.todos || []).slice(0, 40).map((t) => ({ text: String(t.content || t.activeForm || ''), status: t.status || 'pending' })),
      });
      break;
    case 'mcp__equipo__repartir_tareas':
      Object.assign(s, {
        kind: 'delegate', note: `reparto: ${i.titulo || ''}`,
        text: clip((i.tareas || []).map((t, n) => `${t.id || 't' + (n + 1)} → ${t.miembro}: ${t.tarea}` +
          (t.depende_de && t.depende_de.length ? `  (después de ${t.depende_de.join(', ')})` : '')).join('\n'), LIMITS.text),
      });
      break;
    case 'mcp__equipo__estado_equipo':
      Object.assign(s, { kind: 'search', pattern: 'estado del equipo', where: '' });
      break;
    case 'Task':
    case 'Agent':
      Object.assign(s, { kind: 'delegate', note: i.description || '', text: clip(i.prompt, LIMITS.text) });
      break;
    default:
      try { s.text = clip(JSON.stringify(i, null, 2), LIMITS.text); } catch (_) { s.text = ''; }
  }
  return s;
}

function createBoard(opts) {
  const now = (opts && opts.now) || (() => Date.now());
  let seq = 0;
  const state = { tasks: [], spent: {} };
  const byToolUse = new Map(); // tool_use_id -> step

  const newId = () => `t${now().toString(36)}${(++seq).toString(36)}`;
  const tasksOf = (member) => state.tasks.filter((t) => t.member === member);
  const current = (member) => state.tasks.find((t) => t.member === member && t.status === 'en curso') || null;

  function prune() {
    if (state.tasks.length <= MAX_TASKS) return;
    const extra = state.tasks.length - MAX_TASKS;
    let removed = 0;
    state.tasks = state.tasks.filter((t) => {
      if (removed < extra && !ACTIVE.has(t.status)) { removed += 1; return false; }
      return true;
    });
  }

  function start(t) {
    t.status = 'en curso';
    t.startedAt = now();
  }

  function startNext(member) {
    if (current(member)) return null;
    const next = state.tasks.find((t) => t.member === member && t.status === 'pendiente');
    if (next) start(next);
    return next || null;
  }

  // Nueva orden. Si el miembro ya está con otra, queda pendiente (el SDK
  // procesa los mensajes en orden).
  function add(member, text, extra) {
    const t = {
      id: newId(), member, text: clip(text, LIMITS.text), kind: (extra && extra.kind) || 'orden',
      plan: (extra && extra.plan) || null, from: (extra && extra.from) || null, docs: (extra && extra.docs) || [],
      status: 'pendiente', createdAt: now(), startedAt: null, endedAt: null,
      cost: 0, turns: 0, durationMs: 0, steps: [], result: '',
    };
    state.tasks.push(t);
    if (!current(member)) start(t);
    prune();
    return t;
  }

  function pushStep(member, step) {
    const t = current(member);
    if (!t) return null;
    step.at = now();
    t.steps.push(step);
    if (t.steps.length > MAX_STEPS) t.steps.splice(0, t.steps.length - MAX_STEPS);
    return step;
  }

  function tool(member, toolUseId, name, input) {
    const step = pushStep(member, describeTool(name, input));
    if (step && toolUseId) byToolUse.set(toolUseId, step);
    return step;
  }

  // Resultado de una herramienta (salida de un comando, contenido leído…).
  function toolResult(toolUseId, content, isError) {
    const step = byToolUse.get(toolUseId);
    if (!step) return null;
    byToolUse.delete(toolUseId);
    step.ok = !isError;
    const text = resultText(content);
    if (step.kind === 'run' || step.kind === 'validate') step.output = clipTail(text, LIMITS.output);
    else if (step.kind !== 'edit' && step.kind !== 'write' && step.kind !== 'plan') step.output = clip(text, LIMITS.output);
    else if (isError) step.output = clip(text, 800);
    return step;
  }

  function say(member, text) {
    return pushStep(member, { kind: 'say', text: clip(text, LIMITS.text) });
  }

  // Fin del turno: la tarea en curso se cierra y empieza la siguiente pendiente.
  function finish(member, info) {
    const t = current(member);
    const i = info || {};
    const cost = Math.max(0, Number(i.cost) || 0);
    state.spent[member] = (state.spent[member] || 0) + cost;
    if (!t) return { done: null, next: startNext(member) };
    t.status = t.interrupted ? 'interrumpida' : i.ok === false ? 'error' : 'hecho';
    t.endedAt = now();
    t.cost = cost;
    t.turns = Number(i.turns) || 0;
    t.durationMs = Number(i.durationMs) || (t.endedAt - (t.startedAt || t.createdAt));
    t.result = clip(i.text, LIMITS.result);
    return { done: t, next: startNext(member) };
  }

  function markInterrupted(member) {
    const t = current(member);
    if (t) t.interrupted = true;
    return t;
  }

  // La sesión se cerró (reinicio, cambio de carpeta, error): lo que quedaba se corta.
  function closeAll(member, reason) {
    const closed = [];
    for (const t of state.tasks) {
      if (t.member !== member || !ACTIVE.has(t.status)) continue;
      t.status = t.status === 'en curso' ? 'interrumpida' : 'cancelada';
      t.endedAt = now();
      if (reason && !t.result) t.result = reason;
      closed.push(t);
    }
    return closed;
  }

  function clearDone(member) {
    state.tasks = state.tasks.filter((t) => (member && t.member !== member) || ACTIVE.has(t.status));
  }

  function busy(member) { return !!current(member); }

  // Guardar en disco: sin los contenidos grandes de los pasos.
  function serialize() {
    return {
      spent: state.spent,
      tasks: state.tasks.map((t) => Object.assign({}, t, {
        steps: t.steps.slice(-40).map((s) => {
          const c = Object.assign({}, s);
          for (const k of ['before', 'after', 'code', 'output', 'text']) if (c[k] && c[k].length > 600) c[k] = c[k].slice(0, 600) + '\n…';
          return c;
        }),
      })),
    };
  }

  // Al abrir la app: lo que estaba a medias se cerró con la app.
  function restore(saved) {
    if (!saved || typeof saved !== 'object') return;
    state.spent = saved.spent && typeof saved.spent === 'object' ? Object.assign({}, saved.spent) : {};
    state.tasks = Array.isArray(saved.tasks) ? saved.tasks.filter((t) => t && t.id && t.member) : [];
    for (const t of state.tasks) {
      t.steps = Array.isArray(t.steps) ? t.steps : [];
      if (t.status === 'en curso') { t.status = 'interrumpida'; t.result = t.result || 'Se cerró la app mientras trabajaba.'; }
      else if (t.status === 'pendiente') t.status = 'cancelada';
    }
    prune();
  }

  function snapshot() { return { tasks: state.tasks, spent: state.spent }; }

  return { add, tool, toolResult, say, finish, markInterrupted, closeAll, clearDone, current, busy, tasksOf, serialize, restore, snapshot };
}

module.exports = { createBoard, describeTool, VALIDATE };
