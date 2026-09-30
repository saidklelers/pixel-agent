'use strict';

// ---------------------------------------------------------------------------
// Pantallas de los agentes.
// - Pantalla de un agente (clic en la pantalla holográfica de su mesa, o 🖥️ en
//   su ficha): lo que está haciendo en directo. El archivo que edita con sus
//   cambios, el comando que ejecuta y su salida, los tests con los que valida,
//   lo que lee o busca y lo que dice. Al lado: su plan, sus tareas
//   (pendiente → en curso → hecho), los pasos de cada tarea y lo que lleva
//   gastado.
// - Vista del equipo (clic en el tablero de la pared, o 📋): las 5 pantallas a
//   la vez y el tablero de tareas de todos.
// Todo el contenido viene de los agentes: se pinta siempre como texto
// (textContent), nunca como HTML.
// ---------------------------------------------------------------------------

(() => {
  const PT = window.PixelTeam;
  const bapi = window.boardApi;
  if (!PT || !bapi) return;

  let data = { tasks: [], spent: {} };
  const view = { open: false, member: null, task: null, step: null }; // member null = vista del equipo
  let lastSig = '';

  // ---- Utilidades -------------------------------------------------------------

  const h = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const members = () => [...PT.team.values()];
  const memberOf = (id) => PT.team.get(id);
  const accentOf = (m) => (m && m.look && m.look.accent) || '#29f0ff';
  const money = (n) => '$' + (Number(n) || 0).toFixed((Number(n) || 0) < 1 ? 3 : 2);
  const baseName = (p) => String(p || '').split(/[\\/]/).pop();
  function dur(ms) {
    const s = Math.max(0, Math.round((ms || 0) / 1000));
    if (s < 60) return `${s} s`;
    const m = Math.floor(s / 60);
    return m < 60 ? `${m} min ${s % 60} s` : `${Math.floor(m / 60)} h ${m % 60} min`;
  }
  function hhmm(t) {
    if (!t) return '';
    const d = new Date(t);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  const tasksOf = (id) => data.tasks.filter((t) => t.member === id);
  const currentOf = (id) => data.tasks.find((t) => t.member === id && t.status === 'en curso') || null;
  const DONE = new Set(['hecho', 'error', 'interrumpida', 'cancelada']);
  const STATUS = {
    pendiente: { icon: '⏳', label: 'pendiente' },
    'en curso': { icon: '▶', label: 'en curso' },
    hecho: { icon: '✅', label: 'hecha' },
    error: { icon: '⚠️', label: 'con error' },
    interrumpida: { icon: '✋', label: 'interrumpida' },
    cancelada: { icon: '⊘', label: 'cancelada' },
  };
  const KIND = {
    edit: { icon: '✏️', label: 'Editando' },
    write: { icon: '📝', label: 'Creando' },
    read: { icon: '📖', label: 'Leyendo' },
    run: { icon: '⚙️', label: 'Ejecutando' },
    validate: { icon: '🧪', label: 'Validando' },
    search: { icon: '🔎', label: 'Buscando' },
    web: { icon: '🌐', label: 'En la web' },
    plan: { icon: '🗒️', label: 'Plan' },
    delegate: { icon: '🤝', label: 'Delegando' },
    say: { icon: '💬', label: 'Dice' },
    tool: { icon: '🛠️', label: 'Herramienta' },
  };
  function stepTitle(s) {
    const k = KIND[s.kind] || KIND.tool;
    switch (s.kind) {
      case 'edit': case 'write': case 'read': return `${k.label} ${baseName(s.file)}`;
      case 'run': case 'validate': return `${k.label}: ${String(s.command || '').split('\n')[0].slice(0, 80)}`;
      case 'search': return `${k.label} «${String(s.pattern || '').slice(0, 50)}»`;
      case 'web': return `${k.label}: ${String(s.query || '').slice(0, 70)}`;
      case 'plan': return `${k.label} (${(s.todos || []).length} pasos)`;
      case 'delegate': return `${k.label}: ${s.note || ''}`;
      case 'say': return String(s.text || '').replace(/\s+/g, ' ').slice(0, 90);
      default: return `${k.label}: ${s.tool || ''}`;
    }
  }
  function stepIcon(s) {
    const k = KIND[s.kind] || KIND.tool;
    return k.icon;
  }
  // Último plan (TodoWrite) de una tarea: la lista de pasos que se ha marcado el agente.
  function planOf(t) {
    if (!t) return null;
    for (let i = t.steps.length - 1; i >= 0; i--) if (t.steps[i].kind === 'plan') return t.steps[i].todos || [];
    return null;
  }
  // Tarea que se enseña por defecto: la que está en curso, o la última.
  function defaultTask(id) {
    const cur = currentOf(id);
    if (cur) return cur;
    const all = tasksOf(id);
    return all.length ? all[all.length - 1] : null;
  }

  // ---- Contenido de una pantalla ----------------------------------------------

  function codeBlock(text, cls, prefix) {
    const pre = h('pre', 'scr-code ' + (cls || ''));
    const lines = String(text || '').split('\n');
    for (const line of lines) {
      const ln = h('span', 'ln');
      ln.textContent = (prefix || '') + line;
      pre.appendChild(ln);
    }
    return pre;
  }

  // Pinta un paso en el monitor (compact: versión corta para las mini pantallas).
  function paintStep(box, s, compact) {
    const k = KIND[s.kind] || KIND.tool;
    const head = h('div', 'scr-step-head');
    head.appendChild(h('span', 'scr-step-icon', k.icon));
    head.appendChild(h('span', 'scr-step-title', stepTitle(s)));
    if (s.kind === 'run' || s.kind === 'validate') {
      head.appendChild(h('span', 'scr-flag ' + (s.ok === true ? 'ok' : s.ok === false ? 'bad' : 'wait'),
        s.ok === true ? '✓ correcto' : s.ok === false ? '✗ falló' : '… ejecutando'));
    }
    box.appendChild(head);
    if (s.file && !compact) box.appendChild(h('div', 'scr-path', s.file));
    const tail = (txt, n) => String(txt || '').split('\n').slice(-n).join('\n');
    const headLines = (txt, n) => String(txt || '').split('\n').slice(0, n).join('\n');
    switch (s.kind) {
      case 'edit': {
        const wrap = h('div', 'scr-diff');
        if (s.before) wrap.appendChild(codeBlock(compact ? headLines(s.before, 3) : s.before, 'del', '- '));
        if (s.after) wrap.appendChild(codeBlock(compact ? headLines(s.after, 5) : s.after, 'add', '+ '));
        box.appendChild(wrap);
        break;
      }
      case 'write':
        box.appendChild(codeBlock(compact ? headLines(s.code, 7) : s.code, 'add'));
        break;
      case 'run':
      case 'validate': {
        const term = h('div', 'scr-term');
        if (s.note && !compact) term.appendChild(h('div', 'scr-note', '# ' + s.note));
        term.appendChild(codeBlock(compact ? headLines(s.command, 2) : s.command, 'cmd', '$ '));
        if (s.output) term.appendChild(codeBlock(compact ? tail(s.output, 5) : s.output, s.ok === false ? 'err' : 'out'));
        else if (s.ok == null) term.appendChild(h('div', 'scr-cursor', '▌'));
        box.appendChild(term);
        break;
      }
      case 'plan': {
        const ul = h('ul', 'scr-plan');
        for (const t of (s.todos || []).slice(0, compact ? 5 : 40)) {
          const li = h('li', t.status);
          li.appendChild(h('span', 'chk', t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '▶' : '○'));
          li.appendChild(h('span', null, t.text));
          ul.appendChild(li);
        }
        box.appendChild(ul);
        break;
      }
      case 'say':
        box.appendChild(h('div', 'scr-say', compact ? String(s.text || '').slice(0, 220) : s.text));
        break;
      case 'delegate':
      case 'tool':
        if (s.text) box.appendChild(codeBlock(compact ? headLines(s.text, 5) : s.text, 'out'));
        break;
      default:
        if (s.where && !compact) box.appendChild(h('div', 'scr-path', s.where));
        if (s.output) box.appendChild(codeBlock(compact ? headLines(s.output, 5) : s.output, s.ok === false ? 'err' : 'out'));
        else if (s.ok == null) box.appendChild(h('div', 'scr-cursor', '▌'));
    }
  }

  // Pantalla en reposo o tarea terminada.
  function paintIdle(box, m, t, compact) {
    const w = h('div', 'scr-idle');
    if (t && DONE.has(t.status)) {
      const st = STATUS[t.status];
      w.appendChild(h('div', 'scr-idle-big', `${st.icon} Tarea ${st.label}`));
      w.appendChild(h('div', 'scr-idle-sub', t.text.split('\n')[0].slice(0, 140)));
      w.appendChild(h('div', 'scr-idle-sub dim', `${dur(t.durationMs)} · ${money(t.cost)} · ${t.steps.length} pasos`));
      if (t.result && !compact) {
        const r = h('div', 'scr-result');
        r.innerHTML = PT.renderMarkdown(String(t.result).replace(/<conocimiento>[\s\S]*?<\/conocimiento>/gi, '(notas guardadas en su ficha)'));
        w.appendChild(r);
      }
    } else if (t && t.status === 'en curso') {
      w.appendChild(h('div', 'scr-idle-big', '💭 Pensando…'));
      w.appendChild(h('div', 'scr-idle-sub', t.text.split('\n')[0].slice(0, 140)));
    } else {
      w.appendChild(h('div', 'scr-idle-big name', m ? m.name : ''));
      w.appendChild(h('div', 'scr-idle-sub', '— STANDBY —'));
      if (!compact) w.appendChild(h('div', 'scr-idle-sub dim', 'Sin tareas. Dale una orden desde el panel de la derecha.'));
    }
    box.appendChild(w);
  }

  // ---- Modal ------------------------------------------------------------------

  const stage = document.getElementById('stageWrap');
  const root = h('div', 'scr');
  root.hidden = true;
  root.innerHTML = '<div class="scr-head"><div class="scr-tabs"></div><button class="icon-btn scr-close" title="Cerrar (Esc)">✕</button></div><div class="scr-body"></div>';
  stage.appendChild(root);
  const tabsEl = root.querySelector('.scr-tabs');
  const bodyEl = root.querySelector('.scr-body');
  root.querySelector('.scr-close').addEventListener('click', close);

  function open(id, taskId) {
    view.open = true;
    view.member = id && PT.team.has(id) ? id : null;
    view.task = taskId || null;
    view.step = null;
    root.hidden = false;
    lastSig = '';
    render(true);
  }
  function openTeam() { open(null); }
  function close() {
    view.open = false;
    root.hidden = true;
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && view.open) { close(); e.stopImmediatePropagation(); }
  }, true);

  function renderTabs() {
    tabsEl.innerHTML = '';
    const team = h('button', 'scr-tab' + (view.member ? '' : ' on'));
    team.appendChild(h('span', 'scr-tab-icon', '📋'));
    team.appendChild(h('span', 'scr-tab-name', 'Equipo'));
    const total = Object.values(data.spent || {}).reduce((a, b) => a + (Number(b) || 0), 0);
    team.appendChild(h('span', 'scr-tab-cost', money(total)));
    team.title = 'Las pantallas de todos y el tablero de tareas';
    team.addEventListener('click', () => open(null));
    tabsEl.appendChild(team);
    for (const m of members()) {
      const b = h('button', 'scr-tab' + (view.member === m.id ? ' on' : ''));
      b.style.setProperty('--who', accentOf(m));
      const av = PT.avatar(m);
      if (currentOf(m.id)) av.classList.add('working');
      b.appendChild(av);
      b.appendChild(h('span', 'scr-tab-name', m.name));
      b.appendChild(h('span', 'scr-tab-cost', money(data.spent[m.id])));
      b.title = `Pantalla de ${m.name} (${m.role})`;
      b.addEventListener('click', () => open(m.id));
      tabsEl.appendChild(b);
    }
  }

  // ---- Vista de un agente ------------------------------------------------------

  function renderAgent(first) {
    const m = memberOf(view.member);
    if (!m) { open(null); return; }
    const monitorScroll = bodyEl.querySelector('.scr-screen');
    const keepMon = monitorScroll ? monitorScroll.scrollTop : 0;
    const side = bodyEl.querySelector('.scr-side');
    const keepSide = side ? side.scrollTop : 0;
    const t = (view.task && data.tasks.find((x) => x.id === view.task)) || defaultTask(m.id);
    if (view.task && !t) view.task = null;
    const liveMode = view.step == null;
    const step = t ? (liveMode ? t.steps[t.steps.length - 1] : t.steps[view.step]) : null;
    const lv = PT.live.get(m.id) || {};

    bodyEl.innerHTML = '';
    const wrap = h('div', 'scr-agent');
    wrap.style.setProperty('--who', accentOf(m));

    // monitor
    const mon = h('section', 'scr-monitor');
    const bar = h('div', 'scr-bar');
    const liveTask = t && t.status === 'en curso';
    bar.appendChild(h('span', 'scr-live ' + (liveMode && liveTask ? 'on' : ''), liveMode && liveTask ? '● EN DIRECTO' : liveMode ? '■ ÚLTIMO' : '⏸ PASO ' + (view.step + 1)));
    bar.appendChild(h('span', 'scr-bar-title', t ? (t.plan && t.plan.title ? `🧭 ${t.plan.title} · ` : '') + t.text.split('\n')[0] : `${m.name} · ${m.role}`));
    if (!liveMode) {
      const back = h('button', 'mini', '▶ Seguir en directo');
      back.addEventListener('click', () => { view.step = null; render(true); });
      bar.appendChild(back);
    }
    mon.appendChild(bar);
    const screen = h('div', 'scr-screen');
    if (step && (liveMode ? !(t && DONE.has(t.status) && t.result) : true)) paintStep(screen, step, false);
    else paintIdle(screen, m, t, false);
    mon.appendChild(screen);
    const foot = h('div', 'scr-foot');
    const busy = !!currentOf(m.id);
    foot.appendChild(h('span', 'scr-dot ' + (busy ? 'busy' : '')));
    foot.appendChild(h('span', null, busy ? `${lv.emoji || '⚙️'} ${lv.label || 'trabajando'}` : 'libre · esperando órdenes'));
    if (t && t.status === 'en curso') foot.appendChild(h('span', 'scr-timer', '⏱ ' + dur(Date.now() - (t.startedAt || t.createdAt)))).dataset.since = t.startedAt || t.createdAt;
    if (t && DONE.has(t.status)) foot.appendChild(h('span', 'dim', `⏱ ${dur(t.durationMs)} · ${money(t.cost)}`));
    const grow = h('span', 'grow');
    foot.appendChild(grow);
    if (busy) {
      const stop = h('button', 'chip-btn danger', '■ Interrumpir');
      stop.addEventListener('click', () => window.teamApi.interrupt(m.id));
      foot.appendChild(stop);
    }
    const talk = h('button', 'chip-btn', '💬 Hablarle');
    talk.addEventListener('click', () => { PT.focus(m.id); document.getElementById('msg').focus(); });
    foot.appendChild(talk);
    mon.appendChild(foot);
    wrap.appendChild(mon);

    // lateral: gastado, plan, tareas y pasos
    const aside = h('aside', 'scr-side');
    const all = tasksOf(m.id);
    const done = all.filter((x) => x.status === 'hecho').length;
    const stats = h('div', 'scr-stats');
    const stat = (v, l) => { const s = h('div', 'scr-stat'); s.appendChild(h('b', null, v)); s.appendChild(h('span', null, l)); stats.appendChild(s); };
    stat(money(data.spent[m.id]), 'gastado');
    stat(String(done), done === 1 ? 'hecha' : 'hechas');
    stat(String(all.filter((x) => x.status === 'pendiente').length), 'en cola');
    aside.appendChild(stats);

    const plan = planOf(t);
    if (plan && plan.length) {
      const sec = h('div', 'scr-sec');
      const doneN = plan.filter((p) => p.status === 'completed').length;
      sec.appendChild(h('div', 'scr-sec-title', `🗒️ Su plan · ${doneN}/${plan.length}`));
      const prog = h('div', 'scr-prog');
      const fill = h('i');
      fill.style.width = `${Math.round((doneN / plan.length) * 100)}%`;
      prog.appendChild(fill);
      sec.appendChild(prog);
      const ul = h('ul', 'scr-plan small');
      for (const p of plan) {
        const li = h('li', p.status);
        li.appendChild(h('span', 'chk', p.status === 'completed' ? '✓' : p.status === 'in_progress' ? '▶' : '○'));
        li.appendChild(h('span', null, p.text));
        ul.appendChild(li);
      }
      sec.appendChild(ul);
      aside.appendChild(sec);
    }

    const tsec = h('div', 'scr-sec');
    const thead = h('div', 'scr-sec-title', '📋 Tareas');
    if (all.some((x) => DONE.has(x.status))) {
      const clear = h('button', 'mini', 'Limpiar terminadas');
      clear.addEventListener('click', () => bapi.clear(m.id));
      thead.appendChild(clear);
    }
    tsec.appendChild(thead);
    if (!all.length) tsec.appendChild(h('div', 'scr-empty', 'Aún no tiene tareas.'));
    const order = ['en curso', 'pendiente'];
    const sorted = all.filter((x) => order.includes(x.status)).sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status))
      .concat(all.filter((x) => DONE.has(x.status)).reverse());
    for (const x of sorted.slice(0, 40)) {
      const row = h('button', 'scr-task ' + x.status.replace(' ', '-') + (t && x.id === t.id ? ' sel' : ''));
      row.appendChild(h('span', 'scr-task-st', STATUS[x.status].icon));
      const txt = h('span', 'scr-task-text', (x.from && x.from !== x.member ? '🧭 ' : x.kind === 'informe' ? '📨 ' : '') + x.text.split('\n')[0]);
      row.appendChild(txt);
      row.appendChild(h('span', 'scr-task-meta', x.status === 'en curso' ? 'ahora' : x.status === 'pendiente' ? 'en cola' : `${hhmm(x.endedAt)} · ${money(x.cost)}`));
      row.title = `${STATUS[x.status].label} — ${x.text}`;
      row.addEventListener('click', () => { view.task = x.id; view.step = null; render(true); });
      tsec.appendChild(row);
    }
    aside.appendChild(tsec);

    if (t && t.steps.length) {
      const ssec = h('div', 'scr-sec');
      ssec.appendChild(h('div', 'scr-sec-title', `👣 Pasos de la tarea · ${t.steps.length}`));
      const ol = h('ol', 'scr-steps');
      const shown = liveMode ? t.steps.length - 1 : view.step;
      t.steps.forEach((s, i) => {
        const li = h('li', (i === shown ? 'sel ' : '') + (s.ok === false ? 'bad' : ''));
        li.appendChild(h('span', 'scr-step-i', stepIcon(s)));
        li.appendChild(h('span', 'scr-step-t', stepTitle(s)));
        li.appendChild(h('span', 'scr-step-at', hhmm(s.at)));
        li.addEventListener('click', () => { view.step = i === t.steps.length - 1 && t.status === 'en curso' ? null : i; render(true); });
        ol.appendChild(li);
      });
      ssec.appendChild(ol);
      aside.appendChild(ssec);
    }
    wrap.appendChild(aside);
    bodyEl.appendChild(wrap);

    // En directo, la salida de un comando se sigue por el final.
    const scr = wrap.querySelector('.scr-screen');
    if (liveMode && step && (step.kind === 'run' || step.kind === 'validate' || step.kind === 'say')) scr.scrollTop = scr.scrollHeight;
    else if (!first) scr.scrollTop = keepMon;
    const sd = wrap.querySelector('.scr-side');
    if (!first) sd.scrollTop = keepSide;
    else {
      const sel = sd.querySelector('.scr-steps .sel');
      if (sel) sel.scrollIntoView({ block: 'nearest' });
    }
  }

  // ---- Vista del equipo: las 5 pantallas + tablero ----------------------------

  function renderTeamView() {
    const keep = bodyEl.querySelector('.scr-team');
    const keepTop = keep ? keep.scrollTop : 0;
    bodyEl.innerHTML = '';
    const wrap = h('div', 'scr-team');
    const grid = h('div', 'scr-grid');
    for (const m of members()) {
      const cell = h('button', 'scr-mini');
      cell.style.setProperty('--who', accentOf(m));
      const cur = currentOf(m.id);
      const lv = PT.live.get(m.id) || {};
      const top = h('div', 'scr-mini-head');
      top.appendChild(PT.avatar(m));
      top.appendChild(h('b', null, m.name));
      top.appendChild(h('span', 'scr-dot ' + (cur ? 'busy' : '')));
      top.appendChild(h('span', 'scr-mini-state', cur ? `${lv.emoji || '⚙️'} ${lv.label || 'trabajando'}` : 'libre'));
      top.appendChild(h('span', 'scr-mini-cost', money(data.spent[m.id])));
      cell.appendChild(top);
      const scr = h('div', 'scr-screen mini');
      const t = cur || defaultTask(m.id);
      const s = t && t.steps.length ? t.steps[t.steps.length - 1] : null;
      if (cur && s) paintStep(scr, s, true);
      else paintIdle(scr, m, cur, true);
      cell.appendChild(scr);
      if (cur) cell.appendChild(h('div', 'scr-mini-task', '▶ ' + cur.text.split('\n')[0]));
      cell.title = `Abrir la pantalla de ${m.name}`;
      cell.addEventListener('click', () => open(m.id));
      grid.appendChild(cell);
      if (scr.lastChild) scr.scrollTop = scr.scrollHeight;
    }
    wrap.appendChild(grid);

    // tablero: pendiente → en curso → hecho
    const kan = h('div', 'scr-kanban');
    const cols = [
      ['pendiente', '⏳ Pendiente', (x) => x.status === 'pendiente'],
      ['en-curso', '▶ En curso', (x) => x.status === 'en curso'],
      ['hecho', '✅ Hecho', (x) => DONE.has(x.status)],
    ];
    for (const [cls, title, pred] of cols) {
      const items = data.tasks.filter(pred);
      if (cls === 'hecho') items.reverse();
      const col = h('div', 'scr-col ' + cls);
      const head = h('div', 'scr-col-head');
      head.appendChild(h('span', null, title));
      head.appendChild(h('span', 'scr-count', String(items.length)));
      if (cls === 'hecho' && items.length) {
        const clear = h('button', 'mini', 'Limpiar');
        clear.title = 'Quitar del tablero las tareas terminadas';
        clear.addEventListener('click', () => bapi.clear(null));
        head.appendChild(clear);
      }
      col.appendChild(head);
      if (!items.length) col.appendChild(h('div', 'scr-empty', cls === 'en-curso' ? 'Nadie trabajando ahora.' : '—'));
      for (const x of items.slice(0, 30)) {
        const m = memberOf(x.member);
        const card = h('button', 'scr-card ' + x.status.replace(' ', '-'));
        card.style.setProperty('--who', accentOf(m));
        const ch = h('div', 'scr-card-head');
        if (m) ch.appendChild(PT.avatar(m));
        ch.appendChild(h('b', null, m ? m.name : x.member));
        if (x.from && x.from !== x.member) ch.appendChild(h('span', 'scr-from', `🧭 de ${(memberOf(x.from) || {}).name || x.from}`));
        if (DONE.has(x.status)) ch.appendChild(h('span', 'scr-card-st', STATUS[x.status].icon));
        card.appendChild(ch);
        card.appendChild(h('div', 'scr-card-text', x.text.split('\n')[0]));
        const last = x.steps[x.steps.length - 1];
        const meta = x.status === 'en curso' ? (last ? `${stepIcon(last)} ${stepTitle(last)}` : '💭 pensando…')
          : x.status === 'pendiente' ? `en cola desde las ${hhmm(x.createdAt)}`
            : `${hhmm(x.endedAt)} · ${dur(x.durationMs)} · ${money(x.cost)}`;
        card.appendChild(h('div', 'scr-card-meta', meta));
        card.addEventListener('click', () => open(x.member, x.id));
        col.appendChild(card);
      }
      kan.appendChild(col);
    }
    wrap.appendChild(kan);
    bodyEl.appendChild(wrap);
    wrap.scrollTop = keepTop;
  }

  // ---- Refresco ---------------------------------------------------------------

  function signature() {
    const lbl = members().map((m) => { const l = PT.live.get(m.id) || {}; return `${m.id}:${m.name}:${m.look && m.look.accent}:${l.label}`; }).join('|');
    return JSON.stringify([view, data.tasks.length, data.tasks.map((t) => `${t.id}${t.status}${t.steps.length}${(t.steps[t.steps.length - 1] || {}).ok}${((t.steps[t.steps.length - 1] || {}).output || '').length}`).join(','), lbl]);
  }
  function render(force) {
    if (!view.open) return;
    const sig = signature();
    if (!force && sig === lastSig) return;
    lastSig = sig;
    renderTabs();
    if (view.member) renderAgent(!!force); else renderTeamView();
  }

  function setData(d) {
    if (!d || !Array.isArray(d.tasks)) return;
    data = { tasks: d.tasks, spent: d.spent || {} };
    window.PIXEL_BOARD = data;
    window.dispatchEvent(new CustomEvent('pixel:board'));
    render(false);
  }
  bapi.onChange(setData);
  bapi.get().then(setData).catch(() => { /* noop */ });
  if (window.office && window.office.onAgents) window.office.onAgents(() => render(false));
  // el cronómetro de la tarea en curso
  setInterval(() => {
    if (!view.open) return;
    for (const e of root.querySelectorAll('.scr-timer')) e.textContent = '⏱ ' + dur(Date.now() - Number(e.dataset.since));
  }, 1000);

  // Clic en la oficina 3D: pantalla de su mesa o tablero de la pared.
  window.addEventListener('pixel:screen', (e) => open(e.detail && e.detail.id));
  window.addEventListener('pixel:board-open', (e) => open(e.detail && e.detail.id));
  document.getElementById('boardBtn').addEventListener('click', () => (view.open && !view.member ? close() : openTeam()));

  window.PixelScreens = { open, openTeam, close, isOpen: () => view.open };
})();
