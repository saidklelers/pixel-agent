'use strict';

// ---------------------------------------------------------------------------
// Voces naturales: síntesis neuronal de Microsoft (la de "Leer en voz alta"
// de Edge) mediante msedge-tts. Suena como una persona, no necesita clave y
// devuelve MP3. Necesita internet: si falla, el render usa la voz del sistema.
// ---------------------------------------------------------------------------

const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

const TIMEOUT_MS = 20000;

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Devuelve un Buffer con el MP3 de `text` dicho con la voz `voice`
// ({ name, rate, pitch }).
async function synthesize(text, voice) {
  const clean = String(text || '').trim().slice(0, 1500);
  if (!clean) return Buffer.alloc(0);
  const v = voice || {};
  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(v.name || 'es-ES-ElviraNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(escapeXml(clean), { rate: v.rate || '+0%', pitch: v.pitch || '+0Hz' });
    return await new Promise((resolve, reject) => {
      const chunks = [];
      const timer = setTimeout(() => reject(new Error('la voz natural tardó demasiado')), TIMEOUT_MS);
      audioStream.on('data', (c) => chunks.push(c));
      audioStream.on('error', (e) => { clearTimeout(timer); reject(e); });
      audioStream.on('end', () => {
        clearTimeout(timer);
        const buf = Buffer.concat(chunks);
        if (buf.length) resolve(buf); else reject(new Error('la voz natural no devolvió audio'));
      });
    });
  } finally {
    try { tts.close(); } catch (_) { /* noop */ }
  }
}

module.exports = { synthesize };
