'use strict';

// ---------------------------------------------------------------------------
// Voz en el render:
// - PixelVoice.recorder: graba el micrófono mientras pulsas y devuelve el
//   audio a 16 kHz mono (Float32Array) listo para Whisper (voiceApi).
// - PixelVoice.speaker: lee en voz alta las respuestas de los agentes con
//   speechSynthesis; una voz distinta por agente, en cola para no pisarse.
// chat.js decide qué grabar y qué leer; aquí no hay lógica de órdenes.
// ---------------------------------------------------------------------------

(function () {
  const SAMPLE_RATE = 16000;

  // ---- Grabación ------------------------------------------------------------

  const rec = {
    stream: null,
    recorder: null,
    chunks: [],
    ctx: null,
    raf: 0,
    starting: false,
    cancelled: false,
    onLevel: null,
  };

  function cleanup() {
    cancelAnimationFrame(rec.raf);
    rec.raf = 0;
    if (rec.stream) rec.stream.getTracks().forEach((tr) => tr.stop());
    if (rec.ctx) rec.ctx.close().catch(() => { /* noop */ });
    rec.stream = null;
    rec.recorder = null;
    rec.ctx = null;
    if (rec.onLevel) rec.onLevel(0);
    rec.onLevel = null;
  }

  // Empieza a grabar. Devuelve true si el micro está abierto.
  async function start(onLevel) {
    if (rec.recorder || rec.starting) return false;
    rec.starting = true;
    rec.cancelled = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (rec.cancelled) { stream.getTracks().forEach((tr) => tr.stop()); return false; }
      rec.stream = stream;
      rec.onLevel = onLevel || null;
      const mime = window.MediaRecorder && MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
      rec.recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      rec.chunks = [];
      rec.recorder.ondataavailable = (e) => { if (e.data && e.data.size) rec.chunks.push(e.data); };
      rec.recorder.start(250);

      // Medidor de nivel para animar el botón del micro.
      if (rec.onLevel) {
        rec.ctx = new AudioContext();
        const src = rec.ctx.createMediaStreamSource(stream);
        const an = rec.ctx.createAnalyser();
        an.fftSize = 512;
        src.connect(an);
        const buf = new Float32Array(an.fftSize);
        const tick = () => {
          an.getFloatTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
          if (rec.onLevel) rec.onLevel(Math.min(1, Math.sqrt(sum / buf.length) * 7));
          rec.raf = requestAnimationFrame(tick);
        };
        tick();
      }
      return true;
    } catch (e) {
      cleanup();
      throw e;
    } finally {
      rec.starting = false;
    }
  }

  // Para y devuelve { audio: Float32Array, seconds, rms } o null.
  function stop() {
    if (!rec.recorder) {
      if (rec.starting) rec.cancelled = true;
      cleanup();
      return Promise.resolve(null);
    }
    const r = rec.recorder;
    return new Promise((resolve) => {
      r.onstop = async () => {
        const blob = new Blob(rec.chunks, { type: r.mimeType || 'audio/webm' });
        rec.chunks = [];
        cleanup();
        try {
          resolve(await decode(blob));
        } catch (e) {
          console.error('voz: no se pudo decodificar el audio:', e && e.message ? e.message : e);
          resolve(null);
        }
      };
      try { r.stop(); } catch (_) { cleanup(); resolve(null); }
    });
  }

  // Descarta lo grabado (Escape).
  function cancel() {
    if (rec.starting) rec.cancelled = true;
    if (rec.recorder) {
      rec.recorder.onstop = null;
      try { rec.recorder.stop(); } catch (_) { /* noop */ }
    }
    rec.chunks = [];
    cleanup();
  }

  function isRecording() { return !!rec.recorder || rec.starting; }

  // Mejora lo que oye Whisper: quita el silencio del principio y del final
  // (deja 0,3 s de margen) y sube el volumen hasta un pico de 0,9.
  function cleanUp(x) {
    if (!x.length) return x;
    let peak = 0;
    for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i]); if (v > peak) peak = v; }
    if (peak < 1e-4) return x;
    const win = 320; // 20 ms
    const thr = Math.max(0.006, peak * 0.08);
    const loud = (w) => {
      let s = 0;
      const end = Math.min(x.length, w + win);
      for (let i = w; i < end; i++) s += x[i] * x[i];
      return Math.sqrt(s / Math.max(1, end - w)) > thr;
    };
    let a = 0;
    while (a < x.length && !loud(a)) a += win;
    let b = x.length - win;
    while (b > a && !loud(b)) b -= win;
    const pad = SAMPLE_RATE * 0.3;
    a = Math.max(0, a - pad);
    b = Math.min(x.length, b + win + pad);
    const out = b - a >= SAMPLE_RATE * 0.3 ? x.slice(a, b) : x.slice();
    const g = Math.min(8, 0.9 / peak);
    if (g > 1.05) for (let i = 0; i < out.length; i++) out[i] *= g;
    return out;
  }

  // webm/opus -> PCM a 16 kHz mono (decodeAudioData remuestrea al ritmo del contexto).
  async function decode(blob) {
    if (!blob.size) return null;
    const data = await blob.arrayBuffer();
    const ac = new AudioContext({ sampleRate: SAMPLE_RATE });
    try {
      const buf = await ac.decodeAudioData(data);
      const out = new Float32Array(buf.length);
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const ch = buf.getChannelData(c);
        for (let i = 0; i < ch.length; i++) out[i] += ch[i] / buf.numberOfChannels;
      }
      let sum = 0;
      for (let i = 0; i < out.length; i++) sum += out[i] * out[i];
      const rms = out.length ? Math.sqrt(sum / out.length) : 0;
      const audio = cleanUp(out);
      return { audio, seconds: audio.length / SAMPLE_RATE, rms };
    } finally {
      ac.close().catch(() => { /* noop */ });
    }
  }

  // ---- Voz de los agentes ------------------------------------------------------
  // Modo "natural": voces neuronales (MP3 desde el proceso principal, tts.js),
  // con una voz propia por miembro. Si fallan (sin internet), se usa la voz
  // del sistema (speechSynthesis), que suena más robótica.

  const synth = window.speechSynthesis || null;
  const vApi = window.voiceApi && window.voiceApi.speak ? window.voiceApi : null;
  const PITCHES = [1, 1.18, 0.86, 1.32, 0.74];
  const sp = {
    enabled: true,
    mode: 'natural', // 'natural' | 'sistema'
    held: false, // mientras grabas, nada suena (el micro lo captaría como orden)
    voices: [],
    queue: [], // { key, text, index, audioP }
    current: null, // { item, u, audio, url, timer }
    fails: 0, // fallos seguidos de la voz natural
    listeners: [],
    notices: [],
  };

  try {
    sp.enabled = localStorage.getItem('pixel.voz.leer') !== '0';
    if (localStorage.getItem('pixel.voz.modo') === 'sistema') sp.mode = 'sistema';
  } catch (_) { /* noop */ }

  function refreshVoices() {
    if (!synth) return;
    const all = synth.getVoices();
    const es = all.filter((v) => /^es([-_]|$)/i.test(v.lang));
    // primero las voces "Natural"/"Online" si el sistema las tiene, luego es-ES
    const score = (v) => (/natural|neural|online/i.test(v.name) ? 4 : 0) + (/^es[-_]ES/i.test(v.lang) ? 2 : 0) + (v.localService ? 1 : 0);
    es.sort((a, b) => score(b) - score(a));
    sp.voices = es;
  }
  if (synth) {
    refreshVoices();
    synth.addEventListener('voiceschanged', refreshVoices);
  }

  function notify() {
    const key = sp.current ? sp.current.item.key : null;
    for (const cb of sp.listeners) { try { cb(key); } catch (_) { /* noop */ } }
  }
  function notice(text) {
    for (const cb of sp.notices) { try { cb(text); } catch (_) { /* noop */ } }
  }

  function useNatural() { return !!vApi && sp.mode === 'natural' && sp.fails < 3; }

  // Pide el MP3 en cuanto llega el texto (así, al tocarle, suena sin espera).
  function fetchAudio(item) {
    return vApi.speak(item.key, item.text)
      .then((r) => {
        if (!r || r.error || !r.audio || !r.audio.length) return { error: (r && r.error) || 'sin audio' };
        const url = URL.createObjectURL(new Blob([r.audio], { type: 'audio/mpeg' }));
        if (item.discarded) { URL.revokeObjectURL(url); return { error: 'descartado' }; }
        return { url };
      })
      .catch((e) => ({ error: String(e && e.message ? e.message : e) }));
  }

  function release(cur) {
    clearTimeout(cur.timer);
    if (cur.audio) { cur.audio.onended = cur.audio.onerror = null; try { cur.audio.pause(); } catch (_) { /* noop */ } }
    if (cur.url) URL.revokeObjectURL(cur.url);
  }

  function finish(cur) {
    if (sp.current !== cur) return;
    release(cur);
    sp.current = null;
    next();
  }

  async function next() {
    if (sp.held || sp.current) { if (!sp.current) notify(); return; }
    const item = sp.queue.shift();
    if (!item) { notify(); return; }
    const cur = { item };
    sp.current = cur;
    notify();

    if (item.audioP) {
      const res = await item.audioP;
      if (sp.current !== cur) { if (res.url) URL.revokeObjectURL(res.url); return; }
      if (res.url) {
        sp.fails = 0;
        cur.url = res.url;
        cur.audio = new Audio(res.url);
        cur.audio.onended = () => finish(cur);
        cur.audio.onerror = () => finish(cur);
        cur.timer = setTimeout(() => finish(cur), 90000);
        cur.audio.play().catch(() => { release(cur); speakSystem(cur); });
        return;
      }
      sp.fails += 1;
      if (sp.fails === 3) notice('🔈 No hay conexión con las voces naturales; uso la voz del sistema.');
    }
    speakSystem(cur);
  }

  function speakSystem(cur) {
    if (sp.current !== cur) return;
    if (!synth) { finish(cur); return; }
    const item = cur.item;
    const u = new SpeechSynthesisUtterance(item.text);
    const n = sp.voices.length;
    if (n) {
      u.voice = sp.voices[item.index % n];
      u.lang = u.voice.lang;
    } else {
      u.lang = 'es-ES';
    }
    // Si hay menos voces que agentes, cambiamos el tono para distinguirlos.
    u.pitch = PITCHES[Math.floor(item.index / Math.max(1, n)) % PITCHES.length];
    u.rate = 1.05;
    u.onend = () => finish(cur);
    u.onerror = () => finish(cur);
    cur.u = u;
    // Chromium a veces no dispara onend: vigilante por si acaso.
    cur.timer = setTimeout(() => finish(cur), 4000 + item.text.length * 110);
    synth.speak(u);
  }

  function cancelCurrent() {
    const cur = sp.current;
    sp.current = null;
    if (cur) {
      release(cur);
      if (cur.u && synth) synth.cancel();
    }
  }

  function discard(items) {
    for (const q of items) q.discarded = true;
  }

  const speaker = {
    available: !!synth || !!vApi,
    // Encola un texto; por agente solo guardamos el último pendiente.
    say(key, text, index) {
      if (!sp.enabled || !text || (!synth && !vApi)) return;
      discard(sp.queue.filter((q) => q.key === key));
      sp.queue = sp.queue.filter((q) => q.key !== key);
      const item = { key, text: String(text), index: Math.max(0, index | 0) };
      if (useNatural()) item.audioP = fetchAudio(item);
      sp.queue.push(item);
      if (!sp.current && !sp.held) next();
    },
    // Retiene la cola (on) o la reanuda (off). Lo que llegue mientras tanto
    // se lee después.
    hold(on) {
      sp.held = !!on;
      if (!sp.held && !sp.current) next();
    },
    // Corta lo que suena y vacía la cola.
    stopAll() {
      discard(sp.queue);
      sp.queue = [];
      cancelCurrent();
      if (synth) synth.cancel();
      notify();
    },
    // Salta al siguiente de la cola.
    skip() {
      if (!sp.current) return;
      cancelCurrent();
      next();
    },
    // Quita de la cola (y corta si está sonando) lo de un agente concreto.
    forget(key) {
      discard(sp.queue.filter((q) => q.key === key));
      sp.queue = sp.queue.filter((q) => q.key !== key);
      if (sp.current && sp.current.item.key === key) speaker.skip();
    },
    setEnabled(on) {
      sp.enabled = !!on;
      try { localStorage.setItem('pixel.voz.leer', on ? '1' : '0'); } catch (_) { /* noop */ }
      if (!on) speaker.stopAll();
    },
    isEnabled() { return sp.enabled; },
    // 'natural' (voces neuronales, necesita internet) o 'sistema'
    setMode(mode) {
      sp.mode = mode === 'sistema' ? 'sistema' : 'natural';
      sp.fails = 0;
      try { localStorage.setItem('pixel.voz.modo', sp.mode); } catch (_) { /* noop */ }
    },
    mode() { return sp.mode; },
    hasNatural() { return !!vApi; },
    speakingKey() { return sp.current ? sp.current.item.key : null; },
    voiceCount() { return sp.voices.length; },
    onChange(cb) { sp.listeners.push(cb); },
    onNotice(cb) { sp.notices.push(cb); },
  };

  window.PixelVoice = {
    recorder: { start, stop, cancel, isRecording },
    speaker,
  };
})();
