'use strict';

// ---------------------------------------------------------------------------
// Órdenes por voz: convierte lo que dijo el usuario (ya transcrito) en una
// acción para el equipo. Es código puro, sin DOM ni Electron, para poder
// probarlo con Node (test/voice-commands.test.js).
//
//   "JARVIS, revisa la arquitectura"   -> send      a JARVIS
//   "FRIDAY y EDITH: …"                -> send      a FRIDAY y EDITH
//   "todos, paren"                     -> interrupt a todos
//   "para, KITT" / "detén a KITT"      -> interrupt a KITT
//   "KITT, capacítate en Kubernetes"   -> train     (KITT aprende Kubernetes)
//   "reinicia a TARS"                  -> reset     (TARS olvida la conversación)
//   "silencio"                         -> silence   (corta la voz de los agentes)
//   "EDITH"                            -> select    (EDITH pasa a ser el destino)
//   cualquier otra cosa                -> send      al destino actual
// ---------------------------------------------------------------------------

(function (root) {
  // Minúsculas y sin tildes, conservando la longitud (1 carácter -> 1
  // carácter) para poder recortar el texto original con los mismos índices.
  function fold(s) {
    let out = '';
    for (const ch of String(s)) {
      const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      out += base.length === ch.length ? base : ch.toLowerCase();
    }
    return out;
  }

  // Clave "fonética" para comparar nombres tal y como los escribe Whisper
  // (Beto/Veto, Javi/Jabi, Gabi/Gaby, Ximo/Chimo, Quim/Kim, Zoe/Soe…).
  function phonKey(s) {
    return fold(s)
      .replace(/[^a-z0-9]/g, '')
      .replace(/ch/g, 'x')
      .replace(/ll/g, 'y')
      .replace(/qu/g, 'k')
      .replace(/gu(?=[ei])/g, 'g')
      .replace(/g(?=[ei])/g, 'j')
      .replace(/c(?=[ei])/g, 's')
      .replace(/c/g, 'k')
      .replace(/z/g, 's')
      .replace(/v/g, 'b')
      .replace(/w/g, 'u')
      .replace(/h/g, '')
      .replace(/y$/, 'i')
      .replace(/(.)\1+/g, '$1');
  }

  const FILLERS = /^(?:oye|oiga|oigan|hey|eh|ey|hola|vale|bueno|venga|a ver|ok|okay|escucha|escuchad)\b[\s,.:;!¡]*/;
  const POLITE = /(?:[\s,]+(?:por favor|porfa|ya|ahora|ahora mismo|un momento|un segundo|de momento|gracias|inmediatamente|enseguida))+$/;
  const INTERRUPT = '(?:para|paren|parem|parad|parate|pare|detente|deteneos|detenganse|deten|alto|basta|stop|espera|esperad|esperen|quieto|quietos|quieta|frena|frenad|pausa|cancela|cancelad)';
  // Reiniciar (olvidar la conversación) solo con verbo inequívoco y SIEMPRE con
  // nombre ("reinicia a TARS"). "Reinicia el servidor" es una tarea normal.
  const KILL = '(?:reinicia|reiniciad|reinicialo|reiniciala|reiniciate|resetea|reseteala|resetealo|reseteate)';
  // Capacitación: "capacítate en X", "aprende X", "especialízate en X"…
  const TRAIN = /^(?:capacitate|capacitaos|formate|formaos|entrenate|entrenaos|especializate|especializaos|aprende(?:\s+(?:sobre|acerca de))?|estudia|documentate)\s+(?:(?:en|sobre|acerca de|a|de)\s+)?(?:el\s+|la\s+|los\s+|las\s+)?(?=\S)/;
  const SILENCE = /^(?:silencio|callate|callaos|callense|calla|shh+|chis+|deja de hablar|dejad de hablar|no hables|no habl[eé]is|mute|silencia)$/;
  const ALL_WORDS = '(?:a\\s+)?(?:todos los agentes|todo el mundo|todos|todas|equipo|chicos|chicas|gente|agentes)';

  function trimPunct(s) {
    return String(s || '').replace(/^[\s,.:;!?¡¿…\-–—"'«»]+|[\s,.:;!?¡¿…\-–—"'«»]+$/g, '');
  }

  // ¿a y b se diferencian como mucho en una letra (cambiada, sobrante o que falta)?
  function withinOne(a, b) {
    if (a === b) return true;
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
    return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
  }

  // Intenta leer uno o varios nombres ("Ana", "Ana y Beto", "a Leo") al
  // principio del texto plegado. Devuelve { names, end } o null.
  function readNames(f, names) {
    // names: textos sueltos o { name, aliases } (se devuelve siempre name)
    const list = [];
    for (const n of names || []) {
      if (!n) continue;
      const name = String(typeof n === 'object' ? n.name : n).trim();
      const forms = typeof n === 'object' ? [n.name].concat(n.aliases || []) : [n];
      for (const f of forms) {
        const w = String(f || '').trim();
        if (w) list.push({ name, words: w.split(/\s+/) });
      }
    }
    list.sort((a, b) => b.words.length - a.words.length);
    if (!list.length) return null;

    // Hasta 4 palabras seguidas (solo espacios entre ellas).
    const start = f.match(/^\s*(?:a\s+)?/)[0].length;
    const wordsRe = /[^\s,.:;!?¡¿]+/g;
    wordsRe.lastIndex = start;
    const words = [];
    let m;
    while (words.length < 4 && (m = wordsRe.exec(f))) {
      const prevEnd = words.length ? words[words.length - 1].end : start;
      if (!/^\s*$/.test(f.slice(prevEnd, m.index))) break;
      words.push({ text: m[0], end: m.index + m[0].length });
    }

    // Whisper a veces parte el nombre en dos palabras ("Y Arvis" por
    // "Jarvis"): probamos también juntando una palabra más. Primero se busca
    // la coincidencia exacta; si no hay, se tolera una letra de diferencia
    // ("Y albiz"), pero solo en nombres largos y seguidos de una pausa (como
    // cuando llamas a alguien), para no confundir "Tareas: …" con TARS.
    let hit = null;
    for (const fuzzy of [false, true]) {
      for (const cand of list) {
        const k = cand.words.length;
        const target = phonKey(cand.words.join(' '));
        if (fuzzy && target.length < 5) continue;
        for (const span of [k, k + 1]) {
          if (words.length < span) continue;
          const said = phonKey(words.slice(0, span).map((w) => w.text).join(' '));
          if (!said) continue;
          const end = words[span - 1].end;
          const ok = fuzzy
            ? said.length >= 5 && /^\s*(?:[,.:;!?…]|$)/.test(f.slice(end)) && withinOne(said, target)
            : said === target;
          if (ok) { hit = { name: cand.name, end }; break; }
        }
        if (hit) break;
      }
      if (hit) break;
    }
    if (!hit) return null;

    const found = [hit.name];
    let endPos = hit.end;
    // "Ana y Beto", "Ana, Beto": solo si detrás del separador viene otro
    // nombre; si no, el separador es parte del mensaje ("Ana, y luego…").
    const sep = f.slice(endPos).match(/^\s*(?:,\s*)?(?:y|e)\s+|^\s*,\s*(?=\S)/);
    if (sep) {
      const more = readNames(f.slice(endPos + sep[0].length), names);
      if (more) {
        for (const n of more.names) if (!found.includes(n)) found.push(n);
        endPos = endPos + sep[0].length + more.end;
      }
    }
    return { names: found, end: endPos };
  }

  // Lee el destinatario al principio: "todos" o una lista de nombres.
  function readAddress(f, names) {
    // "todos" solo cuenta como destinatario si va seguido de pausa (coma,
    // dos puntos…), fin de frase u orden de parada: "todos los tests
    // fallan" es un mensaje, no una difusión.
    const all = f.match(new RegExp('^\\s*' + ALL_WORDS + '(?=\\s*[,:;.!]|\\s*$|\\s+(?:' + INTERRUPT + '|' + KILL + ')\\b)'));
    if (all) return { to: 'all', end: all[0].length };
    const r = readNames(f, names);
    if (r) return { to: r.names, end: r.end };
    return null;
  }

  function isOnly(re, f) {
    const clean = trimPunct(f).replace(POLITE, '');
    return new RegExp('^' + re + '(?:[\\s,.!]+' + re + ')*$').test(trimPunct(clean));
  }

  function parseCommand(text, names) {
    let t = trimPunct(text);
    let f = fold(t);
    if (!t) return { type: 'empty' };

    // Muletillas iniciales ("oye", "vale", "a ver"…)
    for (let i = 0; i < 3; i++) {
      const m = f.match(FILLERS);
      if (!m || !m[0]) break;
      t = t.slice(m[0].length);
      f = f.slice(m[0].length);
    }
    if (!t.trim()) return { type: 'empty' };

    if (SILENCE.test(trimPunct(f).replace(POLITE, ''))) return { type: 'silence' };

    // Destinatario al principio ("Ana, …", "todos: …")
    let to = null;
    const addr = readAddress(f, names);
    if (addr) {
      to = addr.to;
      t = t.slice(addr.end);
      f = f.slice(addr.end);
    }
    const rest = trimPunct(t);
    const frest = fold(rest);

    if (to && !rest) return { type: 'select', to };
    const tr = frest.match(TRAIN);
    if (tr) {
      const topic = trimPunct(rest.slice(tr[0].length));
      if (topic) return { type: 'train', to, topic };
    }
    if (isOnly(INTERRUPT, frest)) return { type: 'interrupt', to };
    // "TARS, reiníciate": solo con nombres concretos (nunca "todos" ni sin nombre)
    if (Array.isArray(to) && isOnly(KILL, frest)) return { type: 'reset', to };

    // "para, KITT" / "detén a KITT" / "reinicia a TARS" / "paren todos"
    if (!to) {
      const m = frest.match(new RegExp('^(' + INTERRUPT + '|' + KILL + ')\\b[\\s,]*(?:a\\s+)?'));
      if (m) {
        const ftail = frest.slice(m[0].length);
        const a = readAddress(ftail, names);
        if (a && !trimPunct(ftail.slice(a.end)).replace(POLITE, '').trim()) {
          const kill = new RegExp('^' + KILL + '$').test(m[1]);
          if (!kill) return { type: 'interrupt', to: a.to };
          if (Array.isArray(a.to)) return { type: 'reset', to: a.to };
        }
      }
    }

    return { type: 'send', to, text: rest };
  }

  // Texto apto para leer en voz alta: sin bloques de código ni markdown, y
  // recortado en un final de frase.
  function speechText(text, max) {
    const limit = max || 320;
    let s = String(text || '');
    let hadCode = false;
    s = s.replace(/```[\s\S]*?(?:```|$)/g, () => { hadCode = true; return '. '; });
    s = s.replace(/`([^`\n]{1,60})`/g, '$1').replace(/`[^`]*`/g, () => { hadCode = true; return ' '; });
    s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
    s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    s = s.replace(/https?:\/\/\S+/g, 'un enlace');
    s = s.replace(/^\s{0,3}#{1,6}\s*/gm, '');
    s = s.replace(/^\s*(?:[-*+•]|\d+[.)])\s+/gm, '');
    s = s.replace(/^\s*>\s?/gm, '');
    s = s.replace(/^\s*\|?[\s:-]+\|[\s|:-]*$/gm, '');
    s = s.replace(/\|/g, ', ');
    s = s.replace(/(\*\*|__|\*|~~)/g, '');
    s = s.replace(/\s*\n+\s*/g, '. ').replace(/([:;,])\s*\./g, '$1');
    s = s.replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').replace(/([.!?])(?:\s*\.)+/g, '$1');
    s = s.replace(/^[\s.,;:]+/, '').trim();

    if (s.length > limit) {
      const cut = s.slice(0, limit);
      const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
      s = end > limit * 0.4 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '') + '…';
    }
    if (hadCode) s = (s ? s + ' ' : '') + 'Te dejo el código en el chat.';
    return s.trim();
  }

  // Frases que Whisper "alucina" con silencio o ruido de fondo. `names`
  // (opcional, como en parseCommand) permite descartar también una lista
  // suelta de nombres del equipo, que es lo que sale al darle la pista.
  function isNoise(text, names) {
    const f = fold(trimPunct(text)).replace(/\s+/g, ' ');
    if (!f) return true;
    if (/^[\[(].*[\])]$/.test(f)) return true; // [musica], (risas), [BLANK_AUDIO]
    if (!/[a-z0-9]/.test(f)) return true;
    if (/amara\.org|subtitulos (?:realizados|por)|subtitulado por|suscribete|gracias por ver(?: el video)?$|^musica$/.test(f)) return true;
    // "Gracias." suelto es la alucinación más típica con silencio
    if (/^(?:muchas )?gracias$/.test(f)) return true;
    // Bucles: la misma palabra 4 veces o más seguidas ("los los los los")
    if (/\b(\S+)(?:[\s,.;:!?¿¡]+\1\b){3,}/.test(f)) return true;
    // Solo nombres del equipo (3 o más) y nada más: "JARVIS, FRIDAY, TARS…"
    if (names && names.length) {
      const r = readNames(f, names);
      if (r && r.names.length >= 3 && !trimPunct(f.slice(r.end))) return true;
    }
    return false;
  }

  const api = { parseCommand, speechText, isNoise, fold, phonKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VoiceCommands = api;
})(typeof window !== 'undefined' ? window : this);
