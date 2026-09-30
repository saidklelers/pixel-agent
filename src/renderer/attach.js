'use strict';

// ---------------------------------------------------------------------------
// Adjuntar documentos (requerimientos) a una orden: botón 📎 o arrastrar y
// soltar sobre la ventana. El texto lo saca el proceso principal (docsApi);
// aquí se muestran los adjuntos como chips hasta que se envía la orden.
// Si el destino es el líder (JARVIS), «🧭 Que lo reparta» hace que divida el
// requerimiento en tareas para el equipo.
// ---------------------------------------------------------------------------

(() => {
  const PT = window.PixelTeam;
  const dapi = window.docsApi;
  if (!PT || !dapi) return;

  const MAX = 30 * 1024 * 1024;
  const ACCEPT = '.pdf,.docx,.docm,.xlsx,.xlsm,.pptx,.odt,.ods,.odp,.rtf,.txt,.md,.csv,.tsv,.json,.xml,.yaml,.yml,.html,.htm,.log,.sql,.png,.jpg,.jpeg,.gif,.webp,.js,.ts,.py,.java,.cs,.go,.php,.rb,.css';
  const box = document.getElementById('attachList');
  const btn = document.getElementById('attachBtn');
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = ACCEPT;
  input.hidden = true;
  document.body.appendChild(input);

  const items = []; // { key, name, size, status: 'leyendo'|'ok'|'error', doc, error }
  let delegate = true;
  let seq = 0;

  const h = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const kb = (n) => (n > 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  const icon = (name) => (/\.pdf$/i.test(name) ? '📕' : /\.(docx?|odt|rtf)$/i.test(name) ? '📘' : /\.(xlsx?|ods|csv|tsv)$/i.test(name) ? '📗'
    : /\.(pptx?|odp)$/i.test(name) ? '📙' : /\.(png|jpe?g|gif|webp)$/i.test(name) ? '🖼️' : '📄');

  function leaderInTargets() {
    const t = PT.targets();
    return t.some((id) => (PT.team.get(id) || {}).leader);
  }
  function leaderName() {
    const m = [...PT.team.values()].find((x) => x.leader);
    return m ? m.name : 'JARVIS';
  }

  function render() {
    box.innerHTML = '';
    box.hidden = !items.length;
    const msg = document.getElementById('msg');
    if (!items.length) {
      if (/indicaciones|documento/.test(msg.placeholder)) msg.placeholder = 'Escribe una orden… o habla con 🎤';
      return;
    }
    const chips = h('div', 'attach-chips');
    for (const it of items) {
      const c = h('span', 'attach-chip ' + it.status);
      c.appendChild(h('span', 'attach-ic', it.status === 'leyendo' ? '⏳' : it.status === 'error' ? '⚠️' : icon(it.name)));
      const txt = h('span', 'attach-txt');
      txt.appendChild(h('b', null, it.name));
      let info = kb(it.size);
      if (it.status === 'leyendo') info = 'leyendo…';
      else if (it.status === 'error') info = it.error;
      else if (it.doc) {
        const d = it.doc;
        info = d.image ? 'imagen (la verá él)' : d.scanned ? 'PDF escaneado (lo verá como imagen)'
          : `${d.kind}${d.pages ? ` · ${d.pages} págs` : ''} · ${d.chars.toLocaleString('es')} caracteres`;
      }
      txt.appendChild(h('span', null, info));
      c.appendChild(txt);
      c.title = it.status === 'error' ? it.error : it.doc && it.doc.preview ? `Empieza así:\n${it.doc.preview}…` : it.name;
      const x = h('button', 'attach-x', '✕');
      x.type = 'button';
      x.title = 'Quitar';
      x.addEventListener('click', () => { items.splice(items.indexOf(it), 1); render(); });
      c.appendChild(x);
      chips.appendChild(c);
    }
    box.appendChild(chips);
    if (items.some((i) => i.status === 'ok') && leaderInTargets()) {
      const lab = h('label', 'attach-delegate');
      const cb = h('input');
      cb.type = 'checkbox';
      cb.checked = delegate;
      cb.addEventListener('change', () => { delegate = cb.checked; });
      lab.appendChild(cb);
      lab.appendChild(h('span', null, `🧭 Que ${leaderName()} lo reparta en el equipo`));
      lab.title = `${leaderName()} lee el requerimiento, lo divide en tareas según la especialidad de cada uno y se las asigna (con su orden si unas dependen de otras). Cuando terminan, lo revisa.`;
      box.appendChild(lab);
    }
    if (!msg.value.trim()) {
      msg.placeholder = leaderInTargets() && delegate ? 'Añade indicaciones (opcional) y pulsa Enter para enviarlo…' : 'Escribe qué quieres que haga con el documento…';
    }
  }

  async function addFiles(files) {
    for (const f of files) {
      const it = { key: ++seq, name: f.name, size: f.size, status: 'leyendo' };
      items.push(it);
      render();
      if (f.size > MAX) { Object.assign(it, { status: 'error', error: 'demasiado grande (máximo 30 MB)' }); render(); continue; }
      try {
        const r = await dapi.attach(f.name, new Uint8Array(await f.arrayBuffer()));
        if (r && r.ok) Object.assign(it, { status: 'ok', doc: r.doc });
        else Object.assign(it, { status: 'error', error: (r && r.error) || 'no se pudo leer' });
      } catch (e) {
        Object.assign(it, { status: 'error', error: String(e && e.message ? e.message : e) });
      }
      render();
    }
    const ok = items.filter((i) => i.status === 'ok').length;
    if (ok) PT.hint(`📎 ${ok} documento(s) listo(s). ${leaderInTargets() && delegate ? `Pulsa Enter y ${leaderName()} lo repartirá en el equipo.` : 'Escribe la orden y pulsa Enter.'}`);
    document.getElementById('msg').focus();
  }

  btn.addEventListener('click', () => input.click());
  input.addEventListener('change', () => { addFiles([...input.files]); input.value = ''; });

  // Arrastrar y soltar en cualquier parte de la ventana.
  const zone = h('div', 'drop-zone');
  zone.innerHTML = '<div><b>Suelta aquí el documento</b><span></span></div>';
  zone.hidden = true;
  document.getElementById('chat').appendChild(zone);
  let depth = 0;
  const hasFiles = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth += 1;
    zone.querySelector('span').textContent = `PDF, Word, Excel, PowerPoint, TXT, Markdown, imágenes… ${leaderName()} lo leerá y podrá repartirlo en el equipo.`;
    zone.hidden = false;
  });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) zone.hidden = true;
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    zone.hidden = true;
    addFiles([...e.dataTransfer.files]);
  });

  window.PixelAttach = {
    count: () => items.filter((i) => i.status === 'ok').length,
    busy: () => items.some((i) => i.status === 'leyendo'),
    ids: () => items.filter((i) => i.status === 'ok').map((i) => i.doc.id),
    names: () => items.filter((i) => i.status === 'ok').map((i) => i.name),
    delegate: () => delegate && leaderInTargets(),
    clear: () => { items.length = 0; render(); },
    render,
    addFiles, // para pruebas
  };
})();
