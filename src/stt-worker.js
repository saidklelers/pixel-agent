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

function load() {
  if (asrPromise) return asrPromise;
  if (!config) return Promise.reject(new Error('motor de voz sin configurar'));
  asrPromise = (async () => {
    const { pipeline, env } = await import('@huggingface/transformers');
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

async function transcribe(audio) {
  const asr = await load();
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
    config = { model: msg.model, cacheDir: msg.cacheDir };
    load().catch(() => { /* ya se avisó con status 'error' */ });
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
