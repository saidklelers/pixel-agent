'use strict';

// ---------------------------------------------------------------------------
// Documentos adjuntos (requerimientos): se saca el texto para dárselo al
// equipo. PDF (unpdf), Word/Excel/PowerPoint (.docx/.xlsx/.pptx),
// OpenDocument (.odt/.ods/.odp), RTF, HTML y cualquier texto o código.
// Las imágenes (mockups, capturas) no tienen texto: el agente las abre con
// su herramienta de lectura, que sí las ve.
// Sin dependencias de Electron para poder probarlo con node --test.
// ---------------------------------------------------------------------------

const { unzipSync, strFromU8 } = require('fflate');

const MAX_BYTES = 30 * 1024 * 1024;

const TEXT_EXT = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'xml', 'yaml', 'yml', 'ini', 'toml', 'log', 'sql', 'env',
  'js', 'mjs', 'cjs', 'ts', 'jsx', 'tsx', 'vue', 'svelte', 'py', 'java', 'kt', 'cs', 'go', 'rb', 'php', 'rs',
  'c', 'h', 'cpp', 'hpp', 'swift', 'dart', 'sh', 'ps1', 'bat', 'css', 'scss', 'less', 'graphql', 'proto',
  'feature', 'gherkin', 'rst', 'adoc', 'tex',
]);
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);
const KIND = {
  pdf: 'PDF', docx: 'Word', docm: 'Word', dotx: 'Word', xlsx: 'Excel', xlsm: 'Excel', pptx: 'PowerPoint',
  odt: 'OpenDocument', ods: 'OpenDocument', odp: 'OpenDocument', rtf: 'RTF', html: 'HTML', htm: 'HTML',
};

function extOf(name) {
  const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] != null ? ENTITIES[e.toLowerCase()] : m;
  });
}
function stripTags(xml) {
  return decodeEntities(xml.replace(/<[^>]+>/g, ''));
}
function tidy(text) {
  return text.replace(/\r\n?/g, '\n').replace(/[ \t ]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function decodeText(bytes) {
  const b = bytes;
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
  const utf8 = new TextDecoder('utf-8').decode(b);
  // si no era UTF-8 (muchos .txt de Windows son ANSI), probamos windows-1252
  if (utf8.includes('�')) {
    try { return new TextDecoder('windows-1252').decode(b); } catch (_) { /* noop */ }
  }
  return utf8.replace(/^﻿/, '');
}

function unzip(bytes) {
  try {
    return unzipSync(bytes);
  } catch (e) {
    throw new Error('el archivo está dañado o no es un documento de Office válido');
  }
}
const numbered = (files, re) => Object.keys(files).filter((k) => re.test(k))
  .sort((a, b) => Number(a.match(re)[1]) - Number(b.match(re)[1]));

function docxText(files) {
  const main = files['word/document.xml'];
  if (!main) throw new Error('no parece un documento de Word');
  const xml = strFromU8(main)
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<\/w:tc>/g, ' | ')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<\/w:p>/g, '\n');
  return stripTags(xml);
}

function pptxText(files) {
  const slides = numbered(files, /^ppt\/slides\/slide(\d+)\.xml$/);
  if (!slides.length) throw new Error('no parece una presentación de PowerPoint');
  return slides.map((k, i) => {
    const xml = strFromU8(files[k]).replace(/<a:br\/>/g, '\n').replace(/<\/a:p>/g, '\n');
    return `## Diapositiva ${i + 1}\n${stripTags(xml)}`;
  }).join('\n\n');
}

function colIndex(ref) {
  const letters = String(ref || '').replace(/\d+/g, '');
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return Math.max(0, n - 1);
}
function xlsxText(files) {
  const shared = [];
  if (files['xl/sharedStrings.xml']) {
    const xml = strFromU8(files['xl/sharedStrings.xml']);
    for (const si of xml.match(/<si>[\s\S]*?<\/si>/g) || []) shared.push(stripTags(si.replace(/<rPh[\s\S]*?<\/rPh>/g, '')));
  }
  const names = [];
  if (files['xl/workbook.xml']) {
    for (const m of strFromU8(files['xl/workbook.xml']).matchAll(/<sheet [^>]*name="([^"]*)"/g)) names.push(decodeEntities(m[1]));
  }
  const sheets = numbered(files, /^xl\/worksheets\/sheet(\d+)\.xml$/);
  if (!sheets.length) throw new Error('no parece una hoja de Excel');
  return sheets.map((k, i) => {
    const xml = strFromU8(files[k]);
    const rows = [];
    for (const row of xml.match(/<row[\s\S]*?<\/row>/g) || []) {
      const cells = [];
      for (const c of row.match(/<c [^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []) {
        const ref = (c.match(/ r="([A-Z]+\d+)"/) || [])[1];
        const type = (c.match(/ t="(\w+)"/) || [])[1];
        const v = (c.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        let val = '';
        if (type === 's' && v != null) val = shared[Number(v)] || '';
        else if (type === 'inlineStr') val = stripTags((c.match(/<is>([\s\S]*?)<\/is>/) || [])[1] || '');
        else if (v != null) val = decodeEntities(v);
        cells[colIndex(ref)] = val.replace(/\s+/g, ' ').trim();
      }
      if (cells.some(Boolean)) rows.push(Array.from(cells, (x) => x || '').join('\t'));
    }
    return `## Hoja: ${names[i] || i + 1}\n${rows.join('\n')}`;
  }).join('\n\n');
}

function odfText(files) {
  const content = files['content.xml'];
  if (!content) throw new Error('no parece un documento OpenDocument');
  const xml = strFromU8(content)
    .replace(/<text:tab\/>/g, '\t')
    .replace(/<text:line-break\/>/g, '\n')
    .replace(/<text:s(?: text:c="(\d+)")?\/>/g, (_m, n) => ' '.repeat(Number(n) || 1))
    .replace(/<\/table:table-cell>/g, '\t')
    .replace(/<\/table:table-row>/g, '\n')
    .replace(/<\/text:(?:p|h)>/g, '\n');
  return stripTags(xml);
}

// RTF: suficiente para requerimientos escritos en WordPad/Word.
function rtfText(raw) {
  let s = raw;
  // grupos que no son texto (tablas de fuentes, colores, imágenes, metadatos)
  s = s.replace(/\{\\\*[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, '');
  s = s.replace(/\{\\(?:fonttbl|colortbl|stylesheet|info|pict)[^{}]*(?:\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}[^{}]*)*\}/g, '');
  s = s.replace(/\\'([0-9a-f]{2})/gi, (_m, h) => new TextDecoder('windows-1252').decode(Uint8Array.of(parseInt(h, 16))));
  s = s.replace(/\\u(-?\d+)\??/g, (_m, n) => String.fromCharCode(Number(n) < 0 ? Number(n) + 65536 : Number(n)));
  s = s.replace(/\\(?:par|line|row)\b ?/g, '\n').replace(/\\tab\b ?/g, '\t').replace(/\\cell\b ?/g, ' | ');
  s = s.replace(/\\[a-z]+-?\d* ?/gi, '').replace(/\\([{}\\])/g, '$1').replace(/[{}]/g, '');
  return s;
}

function htmlText(raw) {
  return decodeEntities(raw
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article|header|footer)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/t[dh]>/gi, '\t')
    .replace(/<[^>]+>/g, ''));
}

let _unpdf = null;
async function pdfText(bytes) {
  if (!_unpdf) _unpdf = await import('unpdf');
  const { getDocumentProxy, extractText } = _unpdf;
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(bytes));
  } catch (e) {
    throw new Error(/password/i.test(String(e && e.message)) ? 'el PDF tiene contraseña' : 'el PDF está dañado o no se puede leer');
  }
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [String(text || '')];
  return { pages: totalPages, text: pages.map((p, i) => (pages.length > 1 ? `## Página ${i + 1}\n` : '') + p).join('\n\n') };
}

// Devuelve { kind, text, pages?, image? } o lanza un Error con un mensaje claro.
async function extractDocument(name, data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data || []);
  if (!bytes.length) throw new Error('el archivo está vacío');
  if (bytes.length > MAX_BYTES) throw new Error(`es demasiado grande (máximo ${MAX_BYTES / 1024 / 1024} MB)`);
  const ext = extOf(name);
  let out;
  if (ext === 'pdf') {
    out = await pdfText(bytes);
    if (!out.text.replace(/\s|## Página \d+/g, '')) {
      out.text = '';
      out.scanned = true; // PDF escaneado (solo imágenes): el agente lo leerá como imagen
    }
  } else if (['docx', 'docm', 'dotx'].includes(ext)) out = { text: docxText(unzip(bytes)) };
  else if (['xlsx', 'xlsm'].includes(ext)) out = { text: xlsxText(unzip(bytes)) };
  else if (ext === 'pptx') out = { text: pptxText(unzip(bytes)) };
  else if (['odt', 'ods', 'odp'].includes(ext)) out = { text: odfText(unzip(bytes)) };
  else if (ext === 'rtf') out = { text: rtfText(decodeText(bytes)) };
  else if (ext === 'html' || ext === 'htm') out = { text: htmlText(decodeText(bytes)) };
  else if (IMAGE_EXT.has(ext)) out = { text: '', image: true };
  else if (ext === 'doc' || ext === 'xls' || ext === 'ppt') {
    throw new Error(`el formato .${ext} antiguo no se puede leer; guárdalo como .${ext}x (Archivo › Guardar como)`);
  } else if (TEXT_EXT.has(ext) || !ext || looksLikeText(bytes)) out = { text: decodeText(bytes) };
  else throw new Error(`no sé leer archivos .${ext}`);
  out.text = tidy(out.text || '');
  out.kind = out.image ? 'Imagen' : KIND[ext] || 'Texto';
  return out;
}

function looksLikeText(bytes) {
  const n = Math.min(bytes.length, 4096);
  let bad = 0;
  for (let i = 0; i < n; i++) {
    const c = bytes[i];
    if (c === 0) return false;
    if (c < 9 || (c > 13 && c < 32)) bad += 1;
  }
  return bad / n < 0.02;
}

module.exports = { extractDocument, extOf, MAX_BYTES, IMAGE_EXT };
