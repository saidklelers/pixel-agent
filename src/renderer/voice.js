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
      return { audio: out, seconds: out.length / SAMPLE_RATE, rms: out.length ? Math.sqrt(sum / out.length) : 0 };
    } finally {
      ac.close().catch(() => { /* noop */ });
    }
  }

  // ---- Voz de los agentes ------------------------------------------------------

  const synth = window.speechSynthesis || null;
  const PITCHES = [1, 1.18, 0.86, 1.32, 0.74];
  const sp = {
    enabled: true,
    voices: [],
    queue: [], // { key, text, index }
    current: null, // { item, u, timer }
    listeners: [],
  };

  try { sp.enabled = localStorage.getItem('pixel.voz.leer') !== '0'; } catch (_) { /* noop */ }

  function refreshVoices() {
    if (!synth) return;
    const all = synth.getVoices();
    const es = all.filter((v) => /^es([-_]|$)/i.test(v.lang));
    // primero es-ES y voces locales (no dependen de red)
    es.sort((a, b) => (/^es[-_]ES/i.test(b.lang) - /^es[-_]ES/i.test(a.lang)) || (b.localService - a.localService));
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

  function next() {
    const item = sp.queue.shift();
    if (!item) { sp.current = null; notify(); return; }
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
    const done = () => {
      if (!sp.current || sp.current.u !== u) return;
      clearTimeout(sp.current.timer);
      sp.current = null;
      next();
    };
    u.onend = done;
    u.onerror = done;
    // Chromium a veces no dispara onend: vigilante por si acaso.
    const timer = setTimeout(done, 4000 + item.text.length * 110);
    sp.current = { item, u, timer };
    notify();
    synth.speak(u);
  }

  const speaker = {
    available: !!synth,
    // Encola un texto; por agente solo guardamos el último pendiente.
    say(key, text, index) {
      if (!synth || !sp.enabled || !text) return;
      sp.queue = sp.queue.filter((q) => q.key !== key);
      sp.queue.push({ key, text: String(text), index: Math.max(0, index | 0) });
      if (!sp.current) next();
    },
    // Corta lo que suena y vacía la cola.
    stopAll() {
      if (!synth) return;
      sp.queue = [];
      if (sp.current) clearTimeout(sp.current.timer);
      sp.current = null;
      synth.cancel();
      notify();
    },
    // Salta al siguiente de la cola.
    skip() {
      if (!synth || !sp.current) return;
      const cur = sp.current;
      clearTimeout(cur.timer);
      sp.current = null;
      synth.cancel();
      next();
    },
    // Quita de la cola (y corta si está sonando) lo de un agente concreto.
    forget(key) {
      sp.queue = sp.queue.filter((q) => q.key !== key);
      if (sp.current && sp.current.item.key === key) speaker.skip();
    },
    setEnabled(on) {
      sp.enabled = !!on;
      try { localStorage.setItem('pixel.voz.leer', on ? '1' : '0'); } catch (_) { /* noop */ }
      if (!on) speaker.stopAll();
    },
    isEnabled() { return sp.enabled; },
    speakingKey() { return sp.current ? sp.current.item.key : null; },
    voiceCount() { return sp.voices.length; },
    onChange(cb) { sp.listeners.push(cb); },
  };

  window.PixelVoice = {
    recorder: { start, stop, cancel, isRecording },
    speaker,
  };
})();
