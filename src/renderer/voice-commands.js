'use strict';

// ---------------------------------------------------------------------------
// Órdenes por voz: convierte lo que dijo el usuario (ya transcrito) en una
// acción para el Centro de mando. Es código puro, sin DOM ni Electron, para
// poder probarlo con Node (test/voice-commands.test.js).
//
//   "Ana, revisa los tests"            -> send     a Ana
//   "Ana y Beto: haced un commit"      -> send     a Ana y Beto
//   "todos, paren"                     -> interrupt a todos
//   "para, Leo" / "detén a Leo"        -> interrupt a Leo
//   "despide a Leo"                    -> stop     a Leo (cierra la sesión)
//   "nuevo agente llamado Leo: …"      -> spawn    (nombre Leo, tarea …)
//   "silencio"                         -> silence  (corta la voz de los agentes)
//   "Ana"                              -> select   (Ana pasa a ser el destino)
//   cualquier otra cosa                -> send     al destino actual
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
  const INTERRUPT = '(?:para|paren|parad|parate|pare|detente|deteneos|detenganse|deten|alto|basta|stop|espera|esperad|esperen|quieto|quietos|quieta|frena|frenad|pausa|cancela|cancelad)';
  const KILL = '(?:despide|despedid|despidelo|despidela|elimina|eliminad|eliminalo|eliminala|cierra|cerrad|cierralo|cierrala|apaga|apagad|termina|terminad|finaliza|echa)';
  const SILENCE = /^(?:silencio|callate|callaos|callense|calla|shh+|chis+|deja de hablar|dejad de hablar|no hables|no habl[eé]is|mute|silencia)$/;
  const ALL_WORDS = '(?:a\\s+)?(?:todos los agentes|todo el mundo|todos|todas|equipo|chicos|chicas|gente|agentes)';
  const SPAWN = /^(?:(?:crea|crear|creame|lanza|lanzar|lanzame|pon|ponme|anade|anademe|contrata|quiero|necesito|dame|abre)\s+)?(?:(?:un|una|otro|otra)\s+)?(?:(?:nuevo|nueva)\s+agente|agente\s+(?:nuevo|nueva))\b|^(?:crea|crear|creame|lanza|lanzar|lanzame|anade|contrata|abre)\s+(?:(?:un|una|otro)\s+)?agente\b/;
  const NAMED = /^[\s,]*(?:que\s+se\s+llame|que\s+se\s+llama|llamado|llamada|de\s+nombre|con\s+(?:el\s+)?nombre(?:\s+de)?|se\s+llama|nombre)\s+/;

  function trimPunct(s) {
    return String(s || '').replace(/^[\s,.:;!?¡¿…\-–—"'«»]+|[\s,.:;!?¡¿…\-–—"'«»]+$/g, '');
  }

  // Intenta leer uno o varios nombres ("Ana", "Ana y Beto", "a Leo") al
  // principio del texto plegado. Devuelve { names, end } o null.
  function readNames(f, names) {
    const list = (names || [])
      .filter((n) => n && String(n).trim())
      .map((n) => ({ name: String(n).trim(), words: String(n).trim().split(/\s+/) }))
      .sort((a, b) => b.words.length - a.words.length);
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

    let hit = null;
    for (const cand of list) {
      const k = cand.words.length;
      if (words.length < k) continue;
      const said = phonKey(words.slice(0, k).map((w) => w.text).join(' '));
      if (said && said === phonKey(cand.name)) { hit = { name: cand.name, end: words[k - 1].end }; break; }
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

    // Nuevo agente
    const sp = f.match(SPAWN);
    if (sp) {
      let i = sp[0].length;
      let name = null;
      const nm = f.slice(i).match(NAMED);
      if (nm) {
        i += nm[0].length;
        const w = t.slice(i).match(/^[^\s,.:;!?¡¿]+/);
        if (w) { name = w[0]; i += w[0].length; }
      } else {
        // "nuevo agente Leo: …" (nombre en mayúscula seguido de puntuación)
        const w = t.slice(i).match(/^\s+([A-ZÁÉÍÓÚÑÜ][^\s,.:;!?¡¿]*)\s*[,.:;]/);
        if (w) { name = w[1]; i += w[0].length; }
      }
      let task = trimPunct(t.slice(i));
      task = task.replace(/^(?:y\s+)?(?:que\s+)?(?:para\s+que\s+)?/i, '');
      if (name) name = name.charAt(0).toUpperCase() + name.slice(1);
      return { type: 'spawn', name, text: task.trim() };
    }

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
    if (isOnly(INTERRUPT, frest)) return { type: 'interrupt', to };
    if (isOnly(KILL, frest)) return { type: 'stop', to };

    // "para, Ana" / "detén a Ana" / "despide a Leo" / "paren todos"
    if (!to) {
      const m = frest.match(new RegExp('^(' + INTERRUPT + '|' + KILL + ')\\b[\\s,]*(?:a\\s+)?'));
      if (m) {
        const ftail = frest.slice(m[0].length);
        const a = readAddress(ftail, names);
        if (a && !trimPunct(ftail.slice(a.end)).replace(POLITE, '').trim()) {
          const kill = new RegExp('^' + KILL + '$').test(m[1]);
          return { type: kill ? 'stop' : 'interrupt', to: a.to };
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

  // Frases que Whisper "alucina" con silencio o ruido de fondo.
  function isNoise(text) {
    const f = fold(trimPunct(text)).replace(/\s+/g, ' ');
    if (!f) return true;
    if (/^[\[(].*[\])]$/.test(f)) return true; // [musica], (risas), [BLANK_AUDIO]
    if (!/[a-z0-9]/.test(f)) return true;
    if (/amara\.org|subtitulos (?:realizados|por)|subtitulado por|suscribete|gracias por ver(?: el video)?$|^musica$/.test(f)) return true;
    return false;
  }

  const api = { parseCommand, speechText, isNoise, fold, phonKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VoiceCommands = api;
})(typeof window !== 'undefined' ? window : this);
