'use strict';

// ---------------------------------------------------------------------------
// Motor de voz: transcribe audio con Whisper en local (sin claves ni nube).
// Corre en un utilityProcess aparte para que la inferencia no congele la
// ventana. Habla con main.js por process.parentPort:
//   <- { type: 'load', model, cacheDir }
//   <- { type: 'transcribe', reqId, audio: Float32Array (16 kHz, mono) }
//   -> { type: 'status', state: 'loading'|'ready'|'error', progress?, text? }
//   -> { type: 'result', reqId, text } | { type: 'error', reqId, error }
// La primera vez descarga el modelo de Hugging Face y lo guarda en cacheDir.
// ---------------------------------------------------------------------------

const port = process.parentPort;

let config = null;
let asrPromise = null;
let chain = Promise.resolve(); // una transcripción detrás de otra

function status(state, extra) {
  port.postMessage(Object.assign({ type: 'status', state }, extra || {}));
}

// transformers carga "sharp" (procesado de imágenes) al arrancar aunque la voz
// no lo use. Si su binario nativo falla (pasa en algunos Windows), ponemos un
// sustituto para que la transcripción funcione igual.
function loadTransformers() {
  try {
    require('sharp');
  } catch (e) {
    console.warn('[voz] sharp no disponible (' + (e && e.message) + '); se usa un sustituto');
    const Module = require('module');
    const origLoad = Module._load;
    Module._load = function (request, ...rest) {
      if (request === 'sharp') return function sharpNoDisponible() { throw new Error('sharp no disponible'); };
      return origLoad.call(this, request, ...rest);
    };
  }
  return require('@huggingface/transformers');
}

function load() {
  if (asrPromise) return asrPromise;
  if (!config) return Promise.reject(new Error('motor de voz sin configurar'));
  asrPromise = (async () => {
    const { pipeline, env } = loadTransformers();
    env.cacheDir = config.cacheDir;
    env.allowLocalModels = false;

    let lastPct = -1;
    status('loading', { progress: 0, text: 'Preparando el modelo de voz…' });
    const asr = await pipeline('automatic-speech-recognition', config.model, {
      device: 'cpu',
      // Codificador en fp32 (mejor calidad) y decodificador cuantizado (rápido).
      dtype: { encoder_model: 'fp32', decoder_model_merged: 'q8' },
      progress_callback: (p) => {
        if (!p || p.status !== 'progress_total') return;
        const pct = Math.floor(p.progress || 0);
        if (pct === lastPct) return;
        lastPct = pct;
        const mb = p.total ? ` (${Math.round(p.loaded / 1e6)}/${Math.round(p.total / 1e6)} MB)` : '';
        status('loading', { progress: pct, text: `Descargando modelo de voz… ${pct}%${mb}` });
      },
    });
    status('ready', { text: 'Voz lista' });
    return asr;
  })();
  asrPromise.catch((e) => {
    asrPromise = null; // se podrá reintentar en la siguiente pulsación
    status('error', { text: 'No se pudo cargar el modelo de voz: ' + (e && e.message ? e.message : String(e)) });
  });
  return asrPromise;
}

// Pista para Whisper con los nombres del equipo: se la damos como "lo dicho
// antes" (<|startofprev|>) y así escribe JARVIS/KITT en vez de "Y Arvis" o
// "¿Qué?". En forma de frases cortas, porque una lista suelta hace que con
// ruido se invente la lista. Solo vale para audios de hasta 30 s (una ventana).
const MAX_PROMPTED = 16000 * 30;
let promptCache = null; // { key, init: number[] }

function promptTokens(asr) {
  const names = (config && config.names) || [];
  if (!names.length) return null;
  const key = names.join('|');
  if (promptCache && promptCache.key === key) return promptCache.init;
  const tk = asr.tokenizer;
  const one = (t) => {
    const ids = tk.encode(t, { add_special_tokens: false });
    if (ids.length !== 1) throw new Error('token especial desconocido: ' + t);
    return ids[0];
  };
  const GREET = ['Hola', 'Oye', 'Vale', 'Gracias', 'Venga'];
  const text = ' ' + names.map((n, i) => `${GREET[i % GREET.length]} ${n}.`).join(' ');
  const init = [
    one('<|startofprev|>'),
    ...tk.encode(text, { add_special_tokens: false }),
    one('<|startoftranscript|>'), one('<|es|>'), one('<|transcribe|>'), one('<|notimestamps|>'),
  ];
  promptCache = { key, init };
  return init;
}

async function transcribePrompted(asr, audio, init) {
  const inputs = await asr.processor(audio);
  const out = await asr.model.generate({
    ...inputs,
    decoder_input_ids: init,
    max_new_tokens: 160,
    no_repeat_ngram_size: 3, // evita bucles tipo "¿Qué tal? ¿Qué tal? …"
  });
  const seq = (out.tolist ? out.tolist()[0] : out[0]).map(Number).slice(init.length);
  return asr.tokenizer.decode(seq, { skip_special_tokens: true }).trim();
}

async function transcribe(audio) {
  const asr = await load();
  if (audio.length <= MAX_PROMPTED) {
    let init = null;
    try { init = promptTokens(asr); } catch (e) { console.warn('[voz] sin pista de nombres:', e && e.message); }
    if (init) return transcribePrompted(asr, audio, init);
  }
  const out = await asr(audio, {
    language: 'spanish',
    task: 'transcribe',
    chunk_length_s: 30,
    stride_length_s: 5,
  });
  const text = Array.isArray(out) ? out.map((o) => o.text).join(' ') : (out && out.text) || '';
  return text.trim();
}

port.on('message', (e) => {
  const msg = e && e.data;
  if (!msg || !msg.type) return;

  if (msg.type === 'load') {
    config = { model: msg.model, cacheDir: msg.cacheDir, names: Array.isArray(msg.names) ? msg.names.map(String) : [] };
    load().catch(() => { /* ya se avisó con status 'error' */ });
    return;
  }

  // el usuario ha renombrado a alguien del equipo: nueva pista de nombres
  if (msg.type === 'names') {
    if (config && Array.isArray(msg.names)) config.names = msg.names.map(String);
    return;
  }

  if (msg.type === 'transcribe') {
    const audio = msg.audio instanceof Float32Array ? msg.audio : new Float32Array(msg.audio || []);
    chain = chain.then(async () => {
      try {
        port.postMessage({ type: 'result', reqId: msg.reqId, text: await transcribe(audio) });
      } catch (err) {
        port.postMessage({ type: 'error', reqId: msg.reqId, error: err && err.message ? err.message : String(err) });
      }
    });
  }
});
