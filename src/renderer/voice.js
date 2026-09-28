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
    label: '', // nombre del micro de la última grabación
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

  // Nombre del micro sin el prefijo de las entradas virtuales de Windows.
  function cleanLabel(track) {
    return ((track || {}).label || '').replace(/^(?:Default|Predeterminado|Communications|Comunicaciones)\s*-\s*/i, '');
  }

  // Abre el micro elegido (deviceId) o el predeterminado de Windows. Si el
  // elegido ya no está (auriculares desconectados), cae al predeterminado.
  async function openMic(deviceId) {
    const base = { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    if (deviceId) {
      try {
        return await navigator.mediaDevices.getUserMedia({ audio: Object.assign({ deviceId: { exact: deviceId } }, base) });
      } catch (e) {
        if (!e || (e.name !== 'OverconstrainedError' && e.name !== 'NotFoundError')) throw e;
        console.warn('voz: el micro elegido no está disponible; uso el predeterminado');
      }
    }
    return navigator.mediaDevices.getUserMedia({ audio: base });
  }

  // Empieza a grabar. Devuelve true si el micro está abierto.
  async function start(onLevel, deviceId) {
    if (rec.recorder || rec.starting) return false;
    rec.starting = true;
    rec.cancelled = false;
    try {
      const stream = await openMic(deviceId);
      rec.label = cleanLabel(stream.getAudioTracks()[0]);
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

  // Micrófonos disponibles (sin las entradas virtuales "default" y
  // "communications", que repiten un micro real).
  async function listInputs() {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all
      .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
      .map((d) => ({ id: d.deviceId, label: d.label || 'Micrófono' }));
  }

  // Nombre del micro predeterminado de Windows ("" si no se sabe).
  async function defaultInputLabel() {
    const all = await navigator.mediaDevices.enumerateDevices();
    const d = all.find((x) => x.kind === 'audioinput' && x.deviceId === 'default');
    return d ? d.label.replace(/^(?:Default|Predeterminado)\s*-\s*/i, '') : '';
  }

  // Escucha un micro hasta `ms` y devuelve el mayor volumen (RMS) de sus
  // tramos. Un micro silenciado o desactivado da ~0 (silencio digital), uno
  // real nunca. Termina en cuanto oye algo (`enough`). Los auriculares
  // Bluetooth tardan ~1 s en pasar a modo micrófono y hasta entonces dan
  // silencio: por eso la espera por defecto es larga.
  async function probe(deviceId, ms, enough) {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const ctx = new AudioContext();
    try {
      const an = ctx.createAnalyser();
      an.fftSize = 2048;
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Float32Array(an.fftSize);
      const stopAt = enough || Infinity;
      let best = 0;
      const end = performance.now() + (ms || 2000);
      while (performance.now() < end && best < stopAt) {
        await new Promise((r) => setTimeout(r, 40));
        an.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        best = Math.max(best, Math.sqrt(sum / buf.length));
      }
      return best;
    } finally {
      stream.getTracks().forEach((tr) => tr.stop());
      ctx.close().catch(() => { /* noop */ });
    }
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
      return { audio: out, seconds: out.length / SAMPLE_RATE, rms: out.length ? Math.sqrt(sum / out.length) : 0 };
    } finally {
      ac.close().catch(() => { /* noop */ });
    }
  }

  // ---- Manos libres: escucha continua ------------------------------------------
  // El micro queda abierto; un detector de voz por volumen corta cada frase
  // (empieza al oír voz, acaba tras ~0,9 s de silencio) y la entrega ya a
  // 16 kHz mono. Qué hacer con ella lo decide chat.js.

  const FRAME = 4096;          // muestras por tramo (~85 ms a 48 kHz)
  const PRE_SEC = 0.35;        // audio previo que se añade (no cortar la 1.ª sílaba)
  const END_SILENCE = 0.9;     // silencio que cierra la frase
  const MIN_SPEECH = 0.4;      // frases más cortas se descartan (golpes, toses)
  const MAX_SEG = 20;          // corte de seguridad
  const DEAD_SEC = 3;          // silencio digital tan largo = micro mudo

  const hf = { token: 0, stream: null, ctx: null, node: null };

  // Promedia bloques de muestras para bajar a 16 kHz (filtro sencillo que
  // basta para voz).
  function downsample(x, ratio) {
    if (ratio === 1) return Float32Array.from(x);
    const n = Math.floor(x.length / ratio);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.floor(i * ratio);
      const b = Math.min(x.length, Math.floor((i + 1) * ratio));
      let s = 0;
      for (let j = a; j < b; j++) s += x[j];
      out[i] = s / Math.max(1, b - a);
    }
    return out;
  }

  function concat(chunks) {
    let n = 0;
    for (const c of chunks) n += c.length;
    const out = new Float32Array(n);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }

  function listenStop() {
    hf.token++;
    if (hf.node) { hf.node.onaudioprocess = null; try { hf.node.disconnect(); } catch (_) { /* noop */ } }
    if (hf.stream) hf.stream.getTracks().forEach((tr) => tr.stop());
    if (hf.ctx) hf.ctx.close().catch(() => { /* noop */ });
    hf.stream = null;
    hf.ctx = null;
    hf.node = null;
  }

  // cb: { onSegment(audio16k), onSpeech(bool), onLevel(0..1), onDead(label), onEnded() }
  // Devuelve el nombre del micro abierto, o null si se paró mientras abría.
  async function listenStart(deviceId, cb) {
    listenStop();
    const token = hf.token;
    const stream = await openMic(deviceId);
    if (token !== hf.token) { stream.getTracks().forEach((tr) => tr.stop()); return null; }
    const track = stream.getAudioTracks()[0];
    const label = cleanLabel(track);
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const node = ctx.createScriptProcessor(FRAME, 1, 1);
    const ratio = ctx.sampleRate / SAMPLE_RATE;
    const frameSec = FRAME / ctx.sampleRate;
    const preFrames = Math.max(1, Math.round(PRE_SEC / frameSec));

    let noise = 0.004;   // nivel de fondo, se adapta mientras no hablas
    let speaking = false;
    let loudRun = 0;
    let quietSec = 0;
    let seg = [];
    let segSec = 0;
    const pre = [];
    let aliveSec = 0;    // tiempo escuchado
    let peak = 0;        // para detectar un micro mudo

    node.onaudioprocess = (e) => {
      if (token !== hf.token) return;
      const x = e.inputBuffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < x.length; i++) sum += x[i] * x[i];
      const rms = Math.sqrt(sum / x.length);
      const chunk = downsample(x, ratio);
      if (cb.onLevel) cb.onLevel(Math.min(1, rms * 7));

      if (aliveSec < DEAD_SEC) {
        aliveSec += frameSec;
        peak = Math.max(peak, rms);
        if (aliveSec >= DEAD_SEC && peak < 0.0002 && cb.onDead) cb.onDead(label);
      }

      const thr = Math.max(0.008, noise * 3);
      if (!speaking) {
        pre.push(chunk);
        if (pre.length > preFrames) pre.shift();
        if (rms > thr) {
          loudRun += 1;
          if (loudRun >= 2) {
            speaking = true;
            seg = pre.splice(0);
            segSec = seg.length * frameSec;
            quietSec = 0;
            if (cb.onSpeech) cb.onSpeech(true);
          }
        } else {
          loudRun = 0;
          noise = noise * 0.95 + rms * 0.05;
        }
        return;
      }

      seg.push(chunk);
      segSec += frameSec;
      if (rms > thr * 0.7) quietSec = 0; else quietSec += frameSec;
      if (quietSec >= END_SILENCE || segSec >= MAX_SEG) {
        speaking = false;
        loudRun = 0;
        const audio = concat(seg);
        const voiced = segSec - quietSec;
        seg = [];
        if (cb.onSpeech) cb.onSpeech(false);
        if (voiced >= MIN_SPEECH && cb.onSegment) cb.onSegment(audio);
      }
    };
    src.connect(node);
    node.connect(ctx.destination); // sin esto no se procesa; la salida es silencio
    if (track) track.addEventListener('ended', () => { if (token === hf.token && cb.onEnded) cb.onEnded(); });

    hf.stream = stream;
    hf.ctx = ctx;
    hf.node = node;
    return label;
  }

  // ---- Voz de los agentes ------------------------------------------------------

  const synth = window.speechSynthesis || null;
  const PITCHES = [1, 1.18, 0.86, 1.32, 0.74];
  const sp = {
    enabled: true,
    held: false, // mientras grabas, nada suena (el micro lo captaría como orden)
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
    if (sp.held) { sp.current = null; notify(); return; }
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
      if (!sp.current && !sp.held) next();
    },
    // Retiene la cola (on) o la reanuda (off). Lo que llegue mientras tanto
    // se lee después.
    hold(on) {
      sp.held = !!on;
      if (!sp.held && synth && !sp.current) next();
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
    recorder: { start, stop, cancel, isRecording, lastLabel: () => rec.label || '' },
    mics: { list: listInputs, defaultLabel: defaultInputLabel, probe },
    listener: { start: listenStart, stop: listenStop, isOn: () => !!hf.stream },
    speaker,
  };
})();
