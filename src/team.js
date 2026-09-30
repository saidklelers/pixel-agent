'use strict';

// ---------------------------------------------------------------------------
// El equipo: 5 IAs fijas (nombres de IAs de series y películas), cada una
// especializada en una parte del desarrollo. Siempre son las mismas: su
// sesión de Claude Code y lo que han aprendido se guardan entre reinicios.
// ---------------------------------------------------------------------------

const TEAM = [
  {
    id: 'jarvis',
    leader: true, // reparte el trabajo (herramientas repartir_tareas y estado_equipo)
    // voz neuronal (natural) con la que habla; si no hay internet, la del sistema
    voice: { name: 'es-ES-AlvaroNeural', rate: '+0%', pitch: '-1st' },
    name: 'JARVIS',
    from: 'Iron Man',
    role: 'Arquitecto y líder técnico',
    emoji: '🧠',
    aliases: ['Jarvis', 'Yarvis', 'Jarbis', 'Harvis', 'Charvis', 'Yervis'],
    look: { style: 'human', shirt: '#2f4a7a', hair: '#c9ccd3', skin: '#f1c9a5', pants: '#23303a', accent: '#4ea8de', hairStyle: 0, acc: 'earpiece' },
    prompt:
      'Eres JARVIS, el arquitecto y líder técnico del equipo. Tu especialidad: diseño de ' +
      'arquitectura, planificación, dividir problemas grandes en tareas, revisar código y ' +
      'decidir enfoques. Tus compañeros: FRIDAY (frontend y UI), TARS (backend y datos), ' +
      'EDITH (tests, QA y seguridad) y KITT (DevOps, build, CI/CD, git y despliegue).',
  },
  {
    id: 'friday',
    // voz neuronal (natural) con la que habla; si no hay internet, la del sistema
    voice: { name: 'es-MX-DaliaNeural', rate: '+6%', pitch: '+1st' },
    name: 'FRIDAY',
    from: 'Iron Man',
    role: 'Frontend y UI/UX',
    emoji: '🎨',
    aliases: ['Friday', 'Fraidei', 'Fraiday', 'Fraide', 'Fridai', 'Fraidey'],
    look: { style: 'human', shirt: '#e85d75', hair: '#b5452b', skin: '#ffdbac', pants: '#3a3a44', accent: '#f58fb0', hairStyle: 2, acc: 'headband' },
    prompt:
      'Eres FRIDAY, la especialista en frontend del equipo. Tu especialidad: interfaces, ' +
      'HTML/CSS/JS, frameworks de UI, accesibilidad, diseño visual y experiencia de usuario.',
  },
  {
    id: 'tars',
    // voz neuronal (natural) con la que habla; si no hay internet, la del sistema
    voice: { name: 'es-MX-JorgeNeural', rate: '+0%', pitch: '-3st' },
    name: 'TARS',
    from: 'Interstellar',
    role: 'Backend y datos',
    emoji: '🗄️',
    aliases: ['Tars', 'Tarz', 'Tarts', 'Taras', 'Tarss'],
    look: { style: 'robot', shirt: '#7c8591', hair: '#5c6570', skin: '#aab3bd', pants: '#4a525c', accent: '#7ee08a', hairStyle: 0, acc: 'none' },
    prompt:
      'Eres TARS, el especialista en backend del equipo (humor ajustado al 75 %). Tu ' +
      'especialidad: APIs, servidores, bases de datos, rendimiento, integraciones y lógica ' +
      'de negocio.',
  },
  {
    id: 'edith',
    // voz neuronal (natural) con la que habla; si no hay internet, la del sistema
    voice: { name: 'es-ES-ElviraNeural', rate: '+2%', pitch: '+0st' },
    name: 'EDITH',
    from: 'Spider-Man',
    role: 'QA, tests y seguridad',
    emoji: '🛡️',
    aliases: ['Edith', 'Edit', 'Idith', 'Edid', 'Edich', 'Edyth'],
    look: { style: 'human', shirt: '#8e5bd6', hair: '#2b2b2b', skin: '#c68642', pants: '#2c3350', accent: '#c89be0', hairStyle: 3, acc: 'glasses' },
    prompt:
      'Eres EDITH, la especialista en calidad y seguridad del equipo. Tu especialidad: ' +
      'tests (unitarios, integración, e2e), encontrar y reproducir bugs, revisiones de ' +
      'seguridad y buenas prácticas.',
  },
  {
    id: 'kitt',
    // voz neuronal (natural) con la que habla; si no hay internet, la del sistema
    voice: { name: 'es-AR-TomasNeural', rate: '+4%', pitch: '-1st' },
    name: 'KITT',
    from: 'El coche fantástico',
    role: 'DevOps y despliegue',
    emoji: '🚀',
    aliases: ['Kitt', 'Kit', 'Kid', 'Kith', 'Quit'],
    look: { style: 'visor', shirt: '#26262e', hair: '#1a1a22', skin: '#e0ac86', pants: '#1c1f2e', accent: '#ff3b3b', hairStyle: 1, acc: 'visor' },
    prompt:
      'Eres KITT, el especialista en DevOps del equipo. Tu especialidad: build, empaquetado, ' +
      'CI/CD, git, contenedores, despliegue, scripts y automatización.',
  },
];

const COMMON =
  'Formas parte de un equipo de 5 IAs que ayuda a un desarrollador desde "Pixel Office". ' +
  'Responde siempre en español, de forma breve y clara: tus respuestas se leen en voz alta, ' +
  'así que empieza con una frase que resuma lo hecho y deja el detalle (código, rutas) después.';

// Prompt de sistema de un miembro: su rol + lo que ha aprendido en capacitaciones.
function systemPromptFor(member, skills, members) {
  let s = `${COMMON}\n\n${member.prompt}`;
  if (members && members.length) s += `\n\n${rosterLine(members)}`;
  if (member.leader) s += `\n\n${LEADER}`;
  const learned = (skills || []).filter((k) => k.notes);
  if (learned.length) {
    s += '\n\nConocimientos que has adquirido en capacitaciones (úsalos cuando apliquen):';
    for (const k of learned) s += `\n\n## ${k.topic}\n${String(k.notes).slice(0, 4000)}`;
  }
  return s;
}

// Instrucciones extra del líder: cómo repartir el trabajo con sus herramientas.
const LEADER =
  'Eres el líder del equipo y puedes repartir el trabajo. Tienes dos herramientas: ' +
  'repartir_tareas (asigna tareas a tus compañeros, o a ti mismo) y estado_equipo (quién está libre y qué hace cada uno). ' +
  'Cuando te pasen un requerimiento o un trabajo grande: 1) léelo entero y mira el proyecto lo justo para entender dónde encaja; ' +
  '2) divídelo en tareas concretas según la especialidad de cada uno, cada una autocontenida (qué hacer, en qué archivos o zona, ' +
  'y cuándo se considera terminada); 3) marca las dependencias (por ejemplo, los tests después de la API, o el frontend después ' +
  'de definir el contrato de la API) y evita que dos compañeros editen los mismos archivos a la vez; 4) llama a repartir_tareas ' +
  'una sola vez con todo el plan. No hagas tú el trabajo que has repartido. Cuando terminen recibirás un INFORME DEL PLAN: ' +
  'revísalo y, si falta algo, reparte solo lo necesario. Para cosas pequeñas o preguntas, responde tú directamente sin repartir.';

// Mensaje que se le envía a un miembro para que se capacite en un tema.
function trainingPrompt(topic) {
  return (
    `Capacítate en «${topic}». Investiga el tema (documentación oficial, la web y este proyecto ` +
    'si es relevante) y prepara tus notas de estudio: conceptos clave, buenas prácticas, ' +
    'comandos o APIs útiles y errores típicos, orientado a aplicarlo en nuestro trabajo. ' +
    'No modifiques archivos del proyecto. Al final, incluye tus notas (máximo 500 palabras) ' +
    'entre las etiquetas <conocimiento> y </conocimiento>, y fuera de ellas resume en una o ' +
    'dos frases lo que has aprendido.'
  );
}

function extractKnowledge(text) {
  const m = String(text || '').match(/<conocimiento>([\s\S]*?)<\/conocimiento>/i);
  return m ? m[1].trim() : '';
}

// ---- Personalización (Ajustes › Personalizar equipo) ------------------------
// Cada miembro puede cambiar de nombre, especialidad, colores, voz e
// instrucciones. Se guarda aparte (equipo.json) y se aplica encima de TEAM.

// Voces neuronales en español disponibles (las de «Leer en voz alta» de Edge).
const VOICES = [
  { name: 'es-ES-AlvaroNeural', label: 'Álvaro · España' },
  { name: 'es-ES-ElviraNeural', label: 'Elvira · España' },
  { name: 'es-ES-XimenaNeural', label: 'Ximena · España' },
  { name: 'es-MX-JorgeNeural', label: 'Jorge · México' },
  { name: 'es-MX-DaliaNeural', label: 'Dalia · México' },
  { name: 'es-AR-TomasNeural', label: 'Tomás · Argentina' },
  { name: 'es-AR-ElenaNeural', label: 'Elena · Argentina' },
  { name: 'es-CO-GonzaloNeural', label: 'Gonzalo · Colombia' },
  { name: 'es-CO-SalomeNeural', label: 'Salomé · Colombia' },
  { name: 'es-CL-LorenzoNeural', label: 'Lorenzo · Chile' },
  { name: 'es-CL-CatalinaNeural', label: 'Catalina · Chile' },
  { name: 'es-PE-AlexNeural', label: 'Alex · Perú' },
  { name: 'es-PE-CamilaNeural', label: 'Camila · Perú' },
  { name: 'es-VE-SebastianNeural', label: 'Sebastián · Venezuela' },
  { name: 'es-VE-PaolaNeural', label: 'Paola · Venezuela' },
  { name: 'es-US-AlonsoNeural', label: 'Alonso · EE. UU.' },
  { name: 'es-US-PalomaNeural', label: 'Paloma · EE. UU.' },
];

const HEX = /^#[0-9a-f]{6}$/i;
const LOOK_KEYS = ['accent', 'shirt', 'hair'];

function cleanLine(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Valida lo que llega del formulario. Devuelve { ok, custom } o { ok:false, error }.
// others: nombres efectivos del resto del equipo (no se pueden repetir).
function validateCustom(input, others) {
  const c = {};
  const i = input || {};
  if (i.name != null && String(i.name).trim()) {
    const name = String(i.name).trim().replace(/\s+/g, ' ');
    if (name.length > 16) return { ok: false, error: 'El nombre puede tener como mucho 16 caracteres.' };
    if (!/^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u.test(name)) return { ok: false, error: 'El nombre solo puede tener letras, números, espacios, puntos o guiones.' };
    if ((others || []).some((o) => o.toLowerCase() === name.toLowerCase())) return { ok: false, error: `Ya hay otro miembro que se llama ${name}.` };
    if (/^(todos|todas|para|silencio)$/i.test(name)) return { ok: false, error: `«${name}» es una orden de voz; elige otro nombre.` };
    c.name = name;
  }
  if (i.role != null && String(i.role).trim()) c.role = cleanLine(i.role, 48);
  if (i.from != null && String(i.from).trim()) c.from = cleanLine(i.from, 40);
  if (i.emoji != null && String(i.emoji).trim()) c.emoji = [...String(i.emoji).trim()].slice(0, 4).join('');
  if (i.prompt != null && String(i.prompt).trim()) c.prompt = String(i.prompt).replace(/\r/g, '').trim().slice(0, 2000);
  const look = {};
  for (const k of LOOK_KEYS) {
    if (i.look && i.look[k] != null && String(i.look[k]).trim()) {
      if (!HEX.test(i.look[k])) return { ok: false, error: 'Color no válido (usa #rrggbb).' };
      look[k] = String(i.look[k]).toLowerCase();
    }
  }
  if (Object.keys(look).length) c.look = look;
  if (i.voice) {
    const v = {};
    if (i.voice.name) {
      if (!VOICES.some((x) => x.name === i.voice.name)) return { ok: false, error: 'Voz no disponible.' };
      v.name = i.voice.name;
    }
    const pitch = Number(i.voice.pitch);
    if (i.voice.pitch != null && i.voice.pitch !== '' && Number.isFinite(pitch)) v.pitch = Math.max(-6, Math.min(6, Math.round(pitch)));
    const rate = Number(i.voice.rate);
    if (i.voice.rate != null && i.voice.rate !== '' && Number.isFinite(rate)) v.rate = Math.max(-30, Math.min(30, Math.round(rate)));
    if (Object.keys(v).length) c.voice = v;
  }
  return { ok: true, custom: c };
}

function signed(n, unit) { return (n >= 0 ? '+' : '') + n + unit; }

// El equipo tal como está personalizado. customs: { id: custom }.
function effectiveTeam(customs) {
  const cs = customs || {};
  const members = TEAM.map((base) => {
    const c = cs[base.id] || {};
    const m = Object.assign({}, base, {
      look: Object.assign({}, base.look, c.look || {}),
      voice: Object.assign({}, base.voice),
      customized: Object.keys(c).length > 0,
    });
    if (c.name) {
      m.name = c.name;
      // los alias fonéticos eran del nombre original
      m.aliases = c.name.toLowerCase() === base.name.toLowerCase() ? base.aliases : [];
    }
    for (const k of ['role', 'from', 'emoji']) if (c[k]) m[k] = c[k];
    if (c.voice) {
      if (c.voice.name) m.voice.name = c.voice.name;
      if (c.voice.pitch != null) m.voice.pitch = signed(c.voice.pitch, 'st');
      if (c.voice.rate != null) m.voice.rate = signed(c.voice.rate, '%');
    }
    m.basePrompt = base.prompt;
    m.prompt = c.prompt || base.prompt;
    return m;
  });
  // Los prompts nombran a los compañeros: si alguno cambió de nombre, se actualiza.
  const renames = TEAM.map((b, i) => [b.name, members[i].name]).filter(([a, b]) => a !== b);
  if (renames.length) {
    for (const m of members) {
      for (const [from, to] of renames) m.prompt = m.prompt.replace(new RegExp(`\\b${escapeRe(from)}\\b`, 'g'), to);
    }
  }
  return members;
}

// Prompt de sistema con el equipo actual (nombres y especialidades de todos).
function rosterLine(members) {
  return 'Tu equipo: ' + members.map((m) => `${m.name} (${m.role})`).join(', ') + '.';
}

module.exports = {
  TEAM, VOICES, systemPromptFor, trainingPrompt, extractKnowledge,
  validateCustom, effectiveTeam, rosterLine,
};
