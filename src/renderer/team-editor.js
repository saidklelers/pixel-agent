'use strict';

// ---------------------------------------------------------------------------
// Personalizar el equipo (⚙️ Ajustes › 🎨 Personalizar equipo, o ✎ en la ficha):
// nombre, emoji, especialidad, instrucciones, colores y voz de cada miembro.
// Se guarda en el proceso principal (team:customize), que lo valida.
// ---------------------------------------------------------------------------

(() => {
  const PT = window.PixelTeam;
  const api = window.teamApi;
  if (!PT || !api) return;

  const h = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const num = (s) => { const n = parseInt(String(s || '0'), 10); return Number.isFinite(n) ? n : 0; };

  const stage = document.getElementById('stageWrap');
  const root = h('div', 'scr ed');
  root.hidden = true;
  root.innerHTML = '<div class="scr-head"><div class="ed-title">🎨 Personalizar equipo</div><button class="icon-btn scr-close" title="Cerrar (Esc)">✕</button></div>' +
    '<div class="scr-body"><div class="ed-wrap"><nav class="ed-list"></nav><form class="ed-form" autocomplete="off"></form></div></div>';
  stage.appendChild(root);
  const listEl = root.querySelector('.ed-list');
  const formEl = root.querySelector('.ed-form');
  root.querySelector('.scr-close').addEventListener('click', close);

  let current = null;
  let dirty = false;
  let audio = null;

  function open(id) {
    if (window.PixelScreens) window.PixelScreens.close();
    root.hidden = false;
    select(id && PT.team.has(id) ? id : PT.team.keys().next().value);
  }
  function close() {
    if (dirty && !window.confirm('Hay cambios sin guardar. ¿Cerrar igualmente?')) return;
    dirty = false;
    root.hidden = true;
    stopAudio();
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !root.hidden) { close(); e.stopImmediatePropagation(); }
  }, true);

  function renderList() {
    listEl.innerHTML = '';
    for (const m of PT.team.values()) {
      const b = h('button', 'ed-item' + (m.id === current ? ' on' : ''));
      b.type = 'button';
      b.appendChild(PT.avatar(m));
      const t = h('span', 'ed-item-text');
      t.appendChild(h('b', null, m.name));
      t.appendChild(h('span', null, m.role));
      b.appendChild(t);
      if (m.customized) b.appendChild(h('span', 'ed-mark', '✎'));
      b.addEventListener('click', () => {
        if (m.id === current) return;
        if (dirty && !window.confirm('Hay cambios sin guardar. ¿Descartarlos?')) return;
        select(m.id);
      });
      listEl.appendChild(b);
    }
  }

  function field(label, help, input) {
    const l = h('label', 'setting');
    l.appendChild(h('span', 'setting-title', label));
    if (help) l.appendChild(h('span', 'setting-help', help));
    const f = h('span', 'field grow');
    f.appendChild(input);
    l.appendChild(f);
    return l;
  }
  function input(name, value, attrs) {
    const i = h('input');
    i.name = name;
    i.value = value == null ? '' : value;
    Object.assign(i, attrs || {});
    return i;
  }

  function select(id) {
    current = id;
    dirty = false;
    stopAudio();
    renderList();
    const m = PT.team.get(id);
    formEl.innerHTML = '';
    formEl.style.setProperty('--who', (m.look && m.look.accent) || '#29f0ff');

    // vista previa
    const prev = h('div', 'ed-preview');
    const av = h('span', 'ed-av');
    const pName = h('b');
    const pRole = h('span');
    const pInfo = h('div', 'ed-prev-text');
    pInfo.appendChild(pName);
    pInfo.appendChild(pRole);
    prev.appendChild(av);
    prev.appendChild(pInfo);
    formEl.appendChild(prev);

    const cols = h('div', 'ed-cols');
    const left = h('div', 'ed-col');
    const right = h('div', 'ed-col');
    cols.appendChild(left);
    cols.appendChild(right);
    formEl.appendChild(cols);

    const name = input('name', m.name, { maxLength: 16, spellcheck: false, required: true });
    const emoji = input('emoji', m.emoji, { maxLength: 8 });
    const from = input('from', m.from, { maxLength: 40 });
    const role = input('role', m.role, { maxLength: 48 });
    const row = h('div', 'ed-row');
    row.appendChild(field('Nombre', 'Por él le llamas (también por voz).', name));
    row.appendChild(field('Emoji', null, emoji));
    left.appendChild(row);
    left.appendChild(field('Especialidad', 'Lo que se ve en su ficha y en el tablero.', role));
    left.appendChild(field('Inspirado en', 'La serie o película de la que viene su nombre.', from));
    const prompt = h('textarea');
    prompt.name = 'prompt';
    prompt.rows = 7;
    prompt.maxLength = 2000;
    prompt.value = m.prompt || '';
    prompt.spellcheck = false;
    const pf = field('Instrucciones', 'Quién es y en qué se especializa. Se le da siempre como contexto.', prompt);
    left.appendChild(pf);

    // colores
    const colors = h('div', 'ed-row colors');
    const look = m.look || {};
    const accent = input('accent', look.accent || '#29f0ff', { type: 'color' });
    const shirt = input('shirt', look.shirt || '#444444', { type: 'color' });
    const hair = input('hair', look.hair || '#222222', { type: 'color' });
    colors.appendChild(field('Neón', null, accent));
    colors.appendChild(field('Ropa', null, shirt));
    if (look.style !== 'robot') colors.appendChild(field('Pelo', null, hair));
    right.appendChild(h('div', 'ed-sub', '🎨 Colores'));
    right.appendChild(colors);

    // voz
    right.appendChild(h('div', 'ed-sub', '🔊 Voz'));
    const voice = h('select');
    voice.name = 'voice';
    const vs = PT.voices();
    for (const v of vs) {
      const o = h('option', null, v.label);
      o.value = v.name;
      voice.appendChild(o);
    }
    voice.value = (m.voice && m.voice.name) || (vs[0] && vs[0].name) || '';
    right.appendChild(field('Voz natural', null, voice));
    const pitch = input('pitch', num(m.voice && m.voice.pitch), { type: 'range', min: -6, max: 6, step: 1 });
    const rate = input('rate', num(m.voice && m.voice.rate), { type: 'range', min: -30, max: 30, step: 2 });
    const pitchF = field('Tono', null, pitch);
    const rateF = field('Velocidad', null, rate);
    const pitchV = h('span', 'ed-val');
    const rateV = h('span', 'ed-val');
    pitchF.querySelector('.field').appendChild(pitchV);
    rateF.querySelector('.field').appendChild(rateV);
    right.appendChild(pitchF);
    right.appendChild(rateF);
    const test = h('button', 'chip-btn', '▶ Probar voz');
    test.type = 'button';
    right.appendChild(test);
    right.appendChild(h('div', 'setting-help ed-note', 'La voz natural necesita internet. Si falla, se usa la del sistema.'));

    // acciones
    const actions = h('div', 'ed-actions');
    const msg = h('span', 'ed-msg');
    const restore = h('button', 'chip-btn', '↺ Volver al original');
    restore.type = 'button';
    restore.disabled = !m.customized;
    const save = h('button', 'ed-save', 'Guardar');
    save.type = 'submit';
    actions.appendChild(msg);
    actions.appendChild(restore);
    actions.appendChild(save);
    formEl.appendChild(actions);
    formEl.appendChild(h('div', 'setting-help ed-note', 'Si está trabajando, sus nuevas instrucciones se aplican cuando termine. Conserva su conversación y lo aprendido.'));

    function sync() {
      const n = name.value.trim() || m.name;
      av.textContent = n.charAt(0).toUpperCase();
      av.style.background = `radial-gradient(circle at 35% 30%, ${shirt.value}, #0e0c19 130%)`;
      av.style.color = accent.value;
      av.style.boxShadow = `0 0 0 2px ${accent.value}, 0 0 22px ${accent.value}66`;
      pName.textContent = `${emoji.value.trim()} ${n}`.trim();
      pRole.textContent = role.value.trim() || m.role;
      pitchV.textContent = (pitch.value > 0 ? '+' : '') + pitch.value;
      rateV.textContent = (rate.value > 0 ? '+' : '') + rate.value + ' %';
      formEl.style.setProperty('--who', accent.value);
    }
    sync();
    formEl.oninput = () => { dirty = true; msg.textContent = ''; sync(); };

    // Si se cambia el nombre y las instrucciones eran las de siempre, se actualizan.
    let prevName = m.name;
    name.addEventListener('change', () => {
      const n = name.value.trim();
      if (n && prevName && prompt.value.includes(prevName)) prompt.value = prompt.value.split(prevName).join(n);
      prevName = n || prevName;
    });

    test.addEventListener('click', async () => {
      stopAudio();
      test.disabled = true;
      test.textContent = '… generando';
      const text = `Hola, soy ${name.value.trim() || m.name}. ${role.value.trim() || m.role}. ¿En qué te ayudo?`;
      try {
        const r = await window.voiceApi.preview(m.id, text, { name: voice.value, pitch: +pitch.value, rate: +rate.value });
        if (r && r.audio) {
          const url = URL.createObjectURL(new Blob([r.audio], { type: 'audio/mpeg' }));
          audio = new Audio(url);
          audio.onended = () => URL.revokeObjectURL(url);
          await audio.play();
          msg.textContent = '';
        } else {
          msg.textContent = '⚠️ No se pudo generar la voz natural' + (r && r.error ? `: ${r.error}` : '');
        }
      } catch (e) {
        msg.textContent = '⚠️ ' + (e && e.message ? e.message : e);
      }
      test.disabled = false;
      test.textContent = '▶ Probar voz';
    });

    restore.addEventListener('click', async () => {
      if (!window.confirm(`¿Devolver a ${m.name} a su versión original?`)) return;
      const r = await api.customize(m.id, null);
      if (r && r.ok) { await PT.refresh(); dirty = false; select(m.id); PT.hint(`↺ ${PT.team.get(m.id).name} vuelve a ser como al principio.`); }
    });

    formEl.onsubmit = async (e) => {
      e.preventDefault();
      save.disabled = true;
      const custom = {
        name: name.value, emoji: emoji.value, from: from.value, role: role.value,
        look: { accent: accent.value, shirt: shirt.value },
        voice: { name: voice.value, pitch: +pitch.value, rate: +rate.value },
      };
      if (look.style !== 'robot') custom.look.hair = hair.value;
      // solo se guardan como propias las instrucciones que se han cambiado
      if (prompt.value.trim() !== String(m.prompt || '').trim()) custom.prompt = prompt.value;
      else if (m.customized) custom.prompt = m.prompt;
      const r = await api.customize(m.id, custom);
      save.disabled = false;
      if (!r || !r.ok) { msg.textContent = '⚠️ ' + ((r && r.error) || 'No se pudo guardar'); return; }
      dirty = false;
      await PT.refresh();
      select(m.id);
      const saved = PT.team.get(m.id);
      formEl.querySelector('.ed-msg').textContent = '✓ Guardado';
      PT.hint(`🎨 ${saved.name} actualizado.`);
    };
  }

  function stopAudio() {
    if (audio) { try { audio.pause(); } catch (_) { /* noop */ } audio = null; }
  }

  document.getElementById('editTeamBtn').addEventListener('click', () => {
    const d = document.getElementById('settingsDrawer');
    if (d) { d.hidden = true; document.getElementById('settingsBtn').classList.remove('open'); }
    open(null);
  });

  window.PixelEditor = { open, close };
})();
