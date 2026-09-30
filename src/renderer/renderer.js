'use strict';

// ---------------------------------------------------------------------------
// Pixel Office - oficina en 2.5D (isometrica) dibujada en un canvas.
// Cada agente de Claude Code = un personaje en su puesto de trabajo.
// - Mundo en baldosas: x crece hacia abajo-derecha, y hacia abajo-izquierda y
//   z (px) hacia arriba. iso() lo proyecta a la pantalla.
// - Suelo y paredes se pintan con transformaciones afines del canvas: la
//   pizarra, las ventanas o la puerta quedan "pegadas" al plano de la pared.
// - Fondo estatico cacheado; cielo por las ventanas y luz segun la hora real.
// - Los objetos (mesas, sillas, personajes, gato, muebles) se ordenan por
//   profundidad (x + y) para que se tapen correctamente.
// - Clic en un personaje: lo elige como destino en el Centro de mando
//   (evento 'pixel:pick'); Ctrl/Mayus+clic lo marca para difusion.
// Lee de chat.js: PIXEL_TARGET_SESSIONS (destino) y
// PIXEL_SPEAKING_SESSION (quien esta hablando en voz alta).
// ---------------------------------------------------------------------------

const VW = 1000; // ancho logico del contenido
const VH = 740;  // alto logico del contenido
const HEADER_H = 48;
const GW = 12;   // baldosas en x
const GH = 12;   // baldosas en y
const TW = 76;   // ancho en pantalla de una baldosa
const TH = 38;   // alto en pantalla de una baldosa
const WALL_H = 140; // alto de las paredes (px)
const WL = 40;   // px de pared por baldosa (coordenadas locales de la pared)
const BASE_OY = 226; // y de la esquina del fondo sin estirar la sala
const CHAR_SCALE = 1.5;

const canvas = document.getElementById('stage');
const mainCtx = canvas.getContext('2d');
let ctx = mainCtx; // se cambia temporalmente al pintar el fondo cacheado

let view = { scale: 1, ox: 0, oy: 0, dpr: 1 };
let lastW = 0, lastH = 0;
// Extension visible (en coordenadas logicas): el contenido VW x VH queda
// centrado en horizontal; si sobra alto, la sala se centra en vertical.
const ROOM = { x0: 0, x1: VW, y1: VH };
let OX = VW / 2;
let OY = BASE_OY;
let bgCanvas = null; // fondo estatico cacheado (ver buildStatic)

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || window.innerWidth;
  const H = canvas.clientHeight || window.innerHeight;
  if (!(W > 0 && H > 0)) return; // ventana minimizada: nada que recalcular
  canvas.width = Math.max(1, Math.floor(W * dpr));
  canvas.height = Math.max(1, Math.floor(H * dpr));
  const s = Math.min(W / VW, H / VH);
  const ex = Math.max(0, (W / s - VW) / 2);
  const eh = Math.max(0, H / s - VH);
  view.scale = s * dpr;
  view.ox = ex * s * dpr;
  view.oy = 0;
  view.dpr = dpr;
  const x0 = -Math.ceil(ex), x1 = VW + Math.ceil(ex), y1 = VH + Math.ceil(eh);
  const oy = BASE_OY + Math.round(eh / 2);
  if (x0 !== ROOM.x0 || x1 !== ROOM.x1 || y1 !== ROOM.y1 || oy !== OY) {
    ROOM.x0 = x0; ROOM.x1 = x1; ROOM.y1 = y1;
    OY = oy;
    bgCanvas = null; // se repinta el fondo con el nuevo tamaño
  }
  lastW = W;
  lastH = H;
}
window.addEventListener('resize', resize);
resize();

// ---- Paletas --------------------------------------------------------------

const SHIRTS = ['#e85d75', '#4ea8de', '#f4a259', '#6bbf59', '#b56bd6', '#3fc1c9',
                '#f2c14e', '#ef8354', '#7c9eb2', '#d65db1', '#5c80bc', '#88d498'];
const HAIRS = ['#2b2b2b', '#5a3825', '#8a5a2b', '#c9a227', '#1f1f2e', '#6e4b3a', '#b5651d', '#d9d4cf'];
const SKINS = ['#f1c9a5', '#e0ac86', '#c68642', '#8d5524', '#ffdbac'];
const PANTS = ['#2c3350', '#3a3a44', '#2f4a5c', '#4a3a2f', '#23303a'];
const RUGS  = ['#2f4a4a', '#43394f', '#3a4a2f', '#4a3a2f', '#2f3a4a'];
const OUTLINE = '#1a1424';

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function shade(hex, f) {
  const [r, g, b] = hexToRgb(hex).map((v) => Math.max(0, Math.min(255, Math.round(v * f))));
  return `rgb(${r},${g},${b})`;
}
function alpha(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
function mix(h1, h2, f) {
  const a = hexToRgb(h1), b = hexToRgb(h2);
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * f));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}
function hash(str) {
  let h = 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
function pick(arr, n) { return arr[Math.abs(hash(n)) % arr.length]; }
// pseudoaleatorio determinista en [0,1)
function rnd(seed) { const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

// Aspecto de un agente a partir de su id (lo usa tambien chat.js para los avatares).
function lookFor(id) {
  return {
    shirt: pick(SHIRTS, id),
    hair: pick(HAIRS, id + 'h'),
    skin: pick(SKINS, id + 's'),
    pants: pick(PANTS, id + 'p2'),
    accent: '#7ee08a',
    hairStyle: Math.abs(hash(id + 'hs')) % 4,
    style: 'human',
  };
}
window.PixelOffice = { lookFor };

const AT_WORK = new Set(['reading', 'coding', 'running', 'web', 'working', 'thinking', 'delegating']);

const STATE_COLOR = {
  idle: '#6b7280', prompt: '#f4a259', thinking: '#b56bd6', talking: '#4ea8de',
  reading: '#3fc1c9', coding: '#6bbf59', running: '#f2c14e', web: '#5c80bc',
  delegating: '#d65db1', working: '#9aa0a6', waiting: '#e85d75',
};
const SCREEN_COLOR = {
  running: '#f2c14e', web: '#7aa2dd', reading: '#3fc1c9', thinking: '#c89be0', delegating: '#f58fb0',
};
const TARGET_COLOR = '#7ee08a';

// ---- Proyeccion isometrica ---------------------------------------------------

function iso(x, y, z) {
  return { x: OX + (x - y) * (TW / 2), y: OY + (x + y) * (TH / 2) - (z || 0) };
}
// De pantalla (logica) al suelo (z = 0).
function toFloor(sx, sy) {
  const a = (sx - OX) / (TW / 2);
  const b = (sy - OY) / (TH / 2);
  return { x: (a + b) / 2, y: (b - a) / 2 };
}
// Transformaciones: dentro, se dibuja en coordenadas del plano.
// Suelo: unidades = baldosas.
function floorT() { ctx.transform(TW / 2, TH / 2, -TW / 2, TH / 2, OX, OY); }
// Pared del fondo-derecha (y = 0): u a lo largo (WL px por baldosa), v hacia abajo desde arriba.
function wallRightT() { ctx.transform(TW / 2 / WL, TH / 2 / WL, 0, 1, OX, OY - WALL_H); }
// Pared del fondo-izquierda (x = 0): u desde la esquina delantera hacia el fondo.
function wallLeftT() { ctx.transform(TW / 2 / WL, -TH / 2 / WL, 0, 1, OX - GH * TW / 2, OY + GH * TH / 2 - WALL_H); }

// ---- Distribucion de puestos -------------------------------------------------

// Un puesto por miembro del equipo (en el orden de team.js): JARVIS al fondo
// en el centro, y los demás a los lados de la mesa holográfica.
const SLOTS = [[6.6, 3.0], [3.2, 6.1], [10.0, 6.1], [3.2, 9.3], [10.0, 9.3]]
  .map(([cx, cy]) => ({ cx, cy, seatX: cx - 0.7, seatY: cy - 0.85 }));
const MAX_DESKS = SLOTS.length;
const HOLO = { x: 6.6, y: 7.6 };
const DOOR = { x: 0.15, y: 10.6 };
const FRONT_Y = 10.95; // pasillo delantero

// Camino desde la puerta hasta la silla por los pasillos.
function pathTo(slot) {
  const ax = Math.min(slot.cx + 1.35, GW - 0.3);
  return [
    { x: 0.9, y: DOOR.y },
    { x: 0.9, y: FRONT_Y },
    { x: ax, y: FRONT_Y },
    { x: ax, y: slot.seatY },
    { x: slot.seatX, y: slot.seatY },
  ];
}

// ---- Estado de render ------------------------------------------------------

const display = new Map();
let agentCount = 0;
let serverNow = Date.now();
let clientStamp = performance.now();
let hoverId = null;

function syncAgents(payload) {
  serverNow = payload.now;
  clientStamp = performance.now();
  const incoming = payload.agents.slice(0, MAX_DESKS);
  agentCount = payload.agents.length;

  const seen = new Set();
  for (const a of incoming) {
    seen.add(a.id);
    let d = display.get(a.id);
    if (!d) {
      // cada miembro tiene su puesto fijo; entran por la puerta uno detrás de otro
      const slotIndex = Math.min(incoming.indexOf(a), SLOTS.length - 1);
      const slot = SLOTS[slotIndex];
      const look = a.look || lookFor(a.id);
      d = Object.assign({
        id: a.id,
        slot,
        slotIndex,
        x: DOOR.x,
        y: DOOR.y,
        path: pathTo(slot),
        startAt: performance.now() + 400 + slotIndex * 1100,
        arrived: false,
        back: false,
        phase: Math.abs(hash(a.id)) % 1000,
        rug: pick(RUGS, a.id + 'r'),
        hasPlant: Math.abs(hash(a.id + 'p')) % 3 === 0,
        hasMug: Math.abs(hash(a.id + 'm')) % 2 === 0,
        hasLamp: Math.abs(hash(a.id + 'l')) % 2 === 0,
        emitAt: 0,
      }, look);
      display.set(a.id, d);
    }
    d.project = a.project;
    d.name = a.name || a.project;
    d.role = a.role || '';
    d.busy = !!a.busy;
    d.state = a.state;
    d.emoji = a.emoji;
    d.label = a.label;
    d.text = a.text;
    d.lastTime = a.lastTime;
  }
  for (const id of Array.from(display.keys())) {
    if (!seen.has(id)) display.delete(id);
  }
}

if (window.office) window.office.onAgents(syncAgents);

// ---- Helpers de dibujo -----------------------------------------------------

function rect(x, y, w, h, color) { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); }
// rectangulo con contorno oscuro de 1px (estilo pixel-art)
function orect(x, y, w, h, color) { rect(x - 1, y - 1, w + 2, h + 2, OUTLINE); rect(x, y, w, h, color); }

function roundPath(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function roundRect(x, y, w, h, r, color) { ctx.fillStyle = color; roundPath(x, y, w, h, r); ctx.fill(); }

function poly(pts, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fill();
}

// Caja isometrica. base: color de la cara izquierda; o { top, left, right }.
// Cara "left" = la que mira a +y (abajo-izquierda); "right" = la que mira a +x.
function box(x, y, z, w, d, h, base, noOutline) {
  const c = typeof base === 'string' ? { top: shade(base, 1.14), left: base, right: shade(base, 0.76) } : base;
  const A = iso(x, y, z + h), B = iso(x + w, y, z + h), C = iso(x + w, y + d, z + h), D = iso(x, y + d, z + h);
  const Bz = iso(x + w, y, z), Cz = iso(x + w, y + d, z), Dz = iso(x, y + d, z);
  poly([Dz, Cz, C, D], c.left);
  poly([Cz, Bz, B, C], c.right);
  poly([A, B, C, D], c.top);
  if (!noOutline) {
    ctx.strokeStyle = 'rgba(20,14,30,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.lineTo(Bz.x, Bz.y); ctx.lineTo(Cz.x, Cz.y);
    ctx.lineTo(Dz.x, Dz.y); ctx.lineTo(D.x, D.y); ctx.closePath();
    ctx.stroke();
    // arista delantera iluminada
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath(); ctx.moveTo(D.x, D.y); ctx.lineTo(C.x, C.y); ctx.lineTo(B.x, B.y); ctx.stroke();
  }
}

function now() { return serverNow + (performance.now() - clientStamp); }
function isStale(d) { return !d.lastTime || (now() - d.lastTime > 120000); }

function targetSet() { return window.PIXEL_TARGET_SESSIONS instanceof Set ? window.PIXEL_TARGET_SESSIONS : null; }
function isTarget(d) { const s = targetSet(); return !!(s && s.has(d.id)); }
function isSpeaking(d) { return window.PIXEL_SPEAKING_SESSION === d.id; }
function screenOn(d) { return AT_WORK.has(d.state) && d.arrived && !isStale(d); }

// ---- Cielo y luz segun la hora --------------------------------------------

const SKY_KEYS = [
  { h: 0,    top: '#070b1f', bot: '#1a2150', dark: 0.40, stars: 1 },
  { h: 5.5,  top: '#070b1f', bot: '#1a2150', dark: 0.40, stars: 1 },
  { h: 7,    top: '#f39c6b', bot: '#9ab4e0', dark: 0.16, stars: 0 },
  { h: 9,    top: '#4b9be0', bot: '#bfe3ff', dark: 0.00, stars: 0 },
  { h: 17.5, top: '#4b9be0', bot: '#bfe3ff', dark: 0.00, stars: 0 },
  { h: 19.5, top: '#3a2a6b', bot: '#f08a5d', dark: 0.18, stars: 0.2 },
  { h: 21,   top: '#070b1f', bot: '#1a2150', dark: 0.40, stars: 1 },
  { h: 24,   top: '#070b1f', bot: '#1a2150', dark: 0.40, stars: 1 },
];

function skyInfo() {
  const dt = new Date(now());
  const h = dt.getHours() + dt.getMinutes() / 60;
  let i = 0;
  while (i < SKY_KEYS.length - 2 && SKY_KEYS[i + 1].h <= h) i++;
  const a = SKY_KEYS[i], b = SKY_KEYS[i + 1];
  const f = b.h === a.h ? 0 : (h - a.h) / (b.h - a.h);
  return {
    top: mix(a.top, b.top, f),
    bot: mix(a.bot, b.bot, f),
    dark: a.dark + (b.dark - a.dark) * f,
    stars: a.stars + (b.stars - a.stars) * f,
  };
}

// Ventanas en coordenadas locales de cada pared.
const WIN_RIGHT = { u: 200, v: 22, w: 140, h: 62 };
const WIN_LEFT = { u: 150, v: 22, w: 140, h: 62 };

function drawWindowSky(t, sky, w, seed, moon) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(w.u, w.v, w.w, w.h);
  ctx.clip();

  const g = ctx.createLinearGradient(0, w.v, 0, w.v + w.h);
  g.addColorStop(0, sky.top);
  g.addColorStop(1, sky.bot);
  ctx.fillStyle = g;
  ctx.fillRect(w.u, w.v, w.w, w.h);

  if (sky.stars > 0.05) {
    for (let i = 0; i < 26; i++) {
      const tw = (Math.sin(t / 500 + i * 1.7 + seed) + 1) / 2;
      ctx.fillStyle = `rgba(255,255,230,${(0.35 + tw * 0.65) * sky.stars})`;
      ctx.fillRect(Math.round(w.u + rnd(seed + i) * w.w), Math.round(w.v + rnd(seed + i + 50) * w.h * 0.6), 1, 1);
    }
    if (moon) {
      ctx.fillStyle = `rgba(245,240,215,${sky.stars})`;
      ctx.beginPath(); ctx.arc(w.u + w.w * 0.72, w.v + 16, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = alpha(sky.top, sky.stars);
      ctx.beginPath(); ctx.arc(w.u + w.w * 0.72 + 4, w.v + 13, 7, 0, Math.PI * 2); ctx.fill();
    }
  }

  const day = 1 - sky.stars;
  if (day > 0.05) {
    for (let i = 0; i < 3; i++) {
      const span = w.w + 90;
      const cx = w.u - 45 + ((rnd(seed + i + 7) * span + t * (0.005 + rnd(seed + i + 3) * 0.006)) % span);
      const cy = w.v + 8 + rnd(seed + i + 11) * 20;
      const s = 0.7 + rnd(seed + i + 5) * 0.7;
      const col = `rgba(255,255,255,${0.78 * day})`;
      roundRect(cx, cy, 34 * s, 8 * s, 4 * s, col);
      roundRect(cx + 8 * s, cy - 5 * s, 16 * s, 9 * s, 4.5 * s, col);
    }
  }

  // ciudad con ventanas encendidas de noche
  for (let i = 0; i < 12; i++) {
    const bx = w.u + i * 13 - 4 + Math.floor(rnd(seed + i + 50) * 6);
    const bw = 10 + Math.floor(rnd(seed + i + 70) * 8);
    const bh = 10 + Math.floor(rnd(seed + i + 90) * 26);
    const by = w.v + w.h - bh;
    ctx.fillStyle = mix('#2c3a5c', '#10142a', sky.stars);
    ctx.fillRect(bx, by, bw, bh);
    if (sky.stars > 0.3) {
      for (let wy = by + 3; wy < w.v + w.h - 2; wy += 5) {
        for (let wx = bx + 2; wx < bx + bw - 2; wx += 4) {
          if (rnd(wx * 3.1 + wy * 7.7 + seed) > 0.6) {
            ctx.fillStyle = `rgba(255,214,120,${0.8 * sky.stars})`;
            ctx.fillRect(wx, wy, 2, 2);
          }
        }
      }
    }
  }
  ctx.restore();
}

function drawSky(t, sky) {
  ctx.save(); wallRightT(); drawWindowSky(t, sky, WIN_RIGHT, 1, true); ctx.restore();
  ctx.save(); wallLeftT(); drawWindowSky(t, sky, WIN_LEFT, 40, false); ctx.restore();
}

// ---- Fondo estatico (cacheado) ---------------------------------------------

const BG_SCALE = 2;

function buildStatic() {
  bgCanvas = document.createElement('canvas');
  bgCanvas.width = (ROOM.x1 - ROOM.x0) * BG_SCALE;
  bgCanvas.height = ROOM.y1 * BG_SCALE;
  const g = bgCanvas.getContext('2d');
  g.scale(BG_SCALE, BG_SCALE);
  g.translate(-ROOM.x0, 0);
  ctx = g;
  try {
    drawVoid();
    drawFloor();
    ctx.save(); wallLeftT(); drawLeftWall(); ctx.restore();
    ctx.save(); wallRightT(); drawRightWall(); ctx.restore();
    drawWallCaps();
  } finally {
    ctx = mainCtx;
  }
}

// Lo que rodea a la sala: degradado oscuro con un leve brillo bajo el suelo.
function drawVoid() {
  const w = ROOM.x1 - ROOM.x0;
  const g = ctx.createRadialGradient(OX, OY + GH * TH / 2, 60, OX, OY + GH * TH / 2, Math.max(w, ROOM.y1) * 0.75);
  g.addColorStop(0, '#2a2140');
  g.addColorStop(1, '#120e1a');
  ctx.fillStyle = g;
  ctx.fillRect(ROOM.x0, 0, w, ROOM.y1);
  // sombra suave bajo la losa del suelo
  const f = iso(0, GH, 0), r = iso(GW, 0, 0), b = iso(GW, GH, 0);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.moveTo(f.x, f.y + 12); ctx.lineTo(b.x, b.y + 12); ctx.lineTo(r.x, r.y + 12);
  ctx.lineTo(r.x + 10, r.y + 22); ctx.lineTo(b.x, b.y + 30); ctx.lineTo(f.x - 10, f.y + 22);
  ctx.closePath(); ctx.fill();
}

function drawFloor() {
  // canto del suelo (grosor de la losa)
  const slab = 12;
  poly([iso(0, GH, 0), iso(GW, GH, 0), iso(GW, GH, -slab), iso(0, GH, -slab)], '#3b2c20');
  poly([iso(GW, 0, 0), iso(GW, GH, 0), iso(GW, GH, -slab), iso(GW, 0, -slab)], '#2c2118');

  ctx.save();
  floorT();
  // tablones de madera (unidades = baldosas)
  const tones = ['#5a4632', '#624c36', '#5d4833', '#68523a'];
  const pl = 1.6, pw = 0.25;
  for (let row = 0; row * pw < GH; row++) {
    const y = row * pw;
    const shift = (row % 4) * 0.4;
    for (let x = -shift, col = 0; x < GW; x += pl, col++) {
      const x0 = Math.max(0, x), x1 = Math.min(GW, x + pl);
      if (x1 <= x0) continue;
      const base = tones[Math.abs(hash(row * 131 + col)) % tones.length];
      rect(x0, y, x1 - x0, pw, base);
      rect(x0, y, x1 - x0, 0.02, shade(base, 1.18));
      rect(x0, y + pw - 0.025, x1 - x0, 0.025, shade(base, 0.72));
      if (x1 < GW) rect(x1 - 0.03, y, 0.03, pw, shade(base, 0.68));
      if (Math.abs(hash(row * 17 + col * 3)) % 11 === 0) rect(x0 + 0.5, y + 0.1, 0.12, 0.05, 'rgba(0,0,0,0.2)');
    }
  }
  // sombras al pie de las paredes
  let g = ctx.createLinearGradient(0, 0, 1.2, 0);
  g.addColorStop(0, 'rgba(0,0,0,0.38)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1.2, GH);
  g = ctx.createLinearGradient(0, 0, 0, 1.2);
  g.addColorStop(0, 'rgba(0,0,0,0.38)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, GW, 1.2);
  // felpudo de la entrada
  roundRect(0.08, DOOR.y - 0.7, 0.9, 1.4, 0.12, '#6e3b3b');
  roundRect(0.16, DOOR.y - 0.6, 0.74, 1.2, 0.08, '#8a4d4d');
  ctx.restore();
}

// Base comun de las paredes (u de 0 a len, v de 0 a WALL_H).
function drawWallBase(len, color) {
  rect(0, 0, len, WALL_H, color);
  for (let x = 0; x < len; x += 24) rect(x, 4, 12, 94, 'rgba(255,255,255,0.025)');
  rect(0, 0, len, 4, '#2a2238');
  rect(0, 4, len, 1, '#51446a');
  // zocalo de madera
  rect(0, 98, len, 38, shade(color, 1.18));
  rect(0, 98, len, 2, shade(color, 1.4));
  for (let x = 8; x < len - 50; x += 58) {
    rect(x, 104, 50, 26, shade(color, 1.06));
    rect(x, 104, 50, 1, shade(color, 0.85));
    rect(x, 129, 50, 1, shade(color, 1.35));
  }
  rect(0, 136, len, 4, '#241d30');
}

function drawWindowFrame(w) {
  rect(w.u - 6, w.v - 6, w.w + 12, w.h + 12, '#241d30');
  rect(w.u - 4, w.v - 4, w.w + 8, w.h + 8, '#d9d2e6');
  ctx.clearRect(w.u, w.v, w.w, w.h); // cristal: el cielo se ve por detras
  rect(w.u + w.w / 2 - 2, w.v, 4, w.h, '#d9d2e6');
  rect(w.u, w.v + Math.round(w.h * 0.45) - 1, w.w, 3, '#d9d2e6');
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  ctx.moveTo(w.u + 8, w.v + w.h); ctx.lineTo(w.u + 30, w.v); ctx.lineTo(w.u + 44, w.v); ctx.lineTo(w.u + 22, w.v + w.h);
  ctx.closePath(); ctx.fill();
  rect(w.u - 10, w.v + w.h + 4, w.w + 20, 5, '#5b4a70');
  rect(w.u - 10, w.v + w.h + 9, w.w + 20, 2, '#2a2238');
  rect(w.u - 14, w.v - 8, w.w + 28, 3, '#1c1626');
  for (const side of [-1, 1]) {
    const cx = side < 0 ? w.u - 14 : w.u + w.w + 4;
    rect(cx, w.v - 6, 10, w.h + 12, '#8a4f7d');
    for (let i = 0; i < 3; i++) rect(cx + 1 + i * 3, w.v - 6, 1, w.h + 12, '#733f68');
  }
}

function drawLeftWall() {
  drawWallBase(GH * WL, '#3a3150');
  drawDoor(22, 34);
  drawWindowFrame(WIN_LEFT);
  drawBookshelf(326, 46);
}

function drawRightWall() {
  drawWallBase(GW * WL, '#433960');
  drawWhiteboard(22, 24);
  drawWindowFrame(WIN_RIGHT);
  drawClockFace();
  drawPoster(404, 22);
}

// Grosor de las paredes (remate superior y cantos).
function drawWallCaps() {
  const t = 0.22, H = WALL_H;
  poly([iso(0, 0, H), iso(GW, 0, H), iso(GW, -t, H), iso(-t, -t, H)], '#241d30');
  poly([iso(0, GH, H), iso(0, 0, H), iso(-t, -t, H), iso(-t, GH, H)], '#1f1929');
  poly([iso(GW, 0, 0), iso(GW, -t, 0), iso(GW, -t, H), iso(GW, 0, H)], '#2a2238');
  poly([iso(0, GH, 0), iso(-t, GH, 0), iso(-t, GH, H), iso(0, GH, H)], '#30283f');
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const a = iso(0, GH, H), b = iso(0, 0, H), c = iso(GW, 0, H);
  ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y);
  ctx.stroke();
}

function drawDoor(u, v) {
  const w = 64, h = WALL_H - v;
  rect(u - 5, v - 5, w + 10, h + 5, '#241d30');
  rect(u - 3, v - 3, w + 6, h + 3, '#8a6a4a');
  rect(u, v, w, h, '#6e4c36');
  rect(u + 6, v + 8, w - 12, 38, '#5d3f2d');
  rect(u + 6, v + 54, w - 12, h - 62, '#5d3f2d');
  rect(u + 10, v + 12, w - 20, 16, 'rgba(160,210,255,0.35)'); // ventanuco
  rect(u + w - 12, v + h / 2, 5, 5, '#f2c14e');
  // cartel de entrada
  roundRect(u + 4, v - 20, w - 8, 12, 3, '#1f6f4a');
  ctx.fillStyle = '#d9ffe0';
  ctx.font = 'bold 8px Consolas, "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('ENTRADA', u + w / 2, v - 13.5);
  ctx.textAlign = 'left';
}

function drawBookshelf(x, y) {
  const w = 78, h = WALL_H - 4 - y;
  rect(x - 1, y - 1, w + 2, h + 2, OUTLINE);
  rect(x, y, w, h, '#5a3d2b');
  rect(x + 3, y + 3, w - 6, h - 6, '#3d2a1e');
  const colors = ['#e85d75', '#4ea8de', '#f2c14e', '#6bbf59', '#b56bd6', '#ef8354', '#3fc1c9', '#d9d2e6'];
  const shelves = Math.floor((h - 6) / 29);
  for (let s = 0; s < shelves; s++) {
    const sy = y + 5 + s * 29;
    rect(x + 3, sy + 24, w - 6, 3, '#6e4c36');
    let bx = x + 5;
    let i = 0;
    while (bx < x + w - 9) {
      const bw = 4 + (Math.abs(hash(s * 50 + i)) % 4);
      const bh = 14 + (Math.abs(hash(s * 70 + i)) % 9);
      const c = colors[Math.abs(hash(s * 90 + i * 7)) % colors.length];
      if (Math.abs(hash(s + i * 13)) % 7 === 0) {
        bx += 5;
      } else {
        rect(bx, sy + 24 - bh, bw, bh, c);
        rect(bx, sy + 24 - bh + 3, bw, 1, 'rgba(255,255,255,0.35)');
        rect(bx + bw - 1, sy + 24 - bh, 1, bh, 'rgba(0,0,0,0.25)');
      }
      bx += bw + 1;
      i++;
    }
  }
}

function drawWhiteboard(x, y) {
  const w = 160, h = 56;
  rect(x - 3, y - 3, w + 6, h + 6, '#8e93a0');
  rect(x - 2, y - 2, w + 4, h + 4, '#c9ccd3');
  rect(x, y, w, h, '#eef0f3');
  ctx.strokeStyle = '#4ea8de';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 10, y + 10, 30, 14);
  ctx.strokeRect(x + 62, y + 10, 30, 14);
  ctx.strokeStyle = '#e85d75';
  ctx.strokeRect(x + 36, y + 34, 30, 12);
  ctx.beginPath();
  ctx.moveTo(x + 40, y + 17); ctx.lineTo(x + 62, y + 17);
  ctx.moveTo(x + 25, y + 24); ctx.lineTo(x + 45, y + 34);
  ctx.moveTo(x + 77, y + 24); ctx.lineTo(x + 60, y + 34);
  ctx.stroke();
  ctx.strokeStyle = '#3a3f4a';
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(x + 104, y + 12 + i * 8);
    for (let k = 0; k < 6; k++) ctx.lineTo(x + 104 + k * 6, y + 12 + i * 8 + (k % 2 ? -1.5 : 1.5));
    ctx.stroke();
  }
  rect(x + 136, y + 30, 14, 14, '#f2c14e');
  rect(x + 118, y + 36, 12, 12, '#f58fb0');
  rect(x + 138, y + 33, 9, 1, 'rgba(0,0,0,0.3)');
  rect(x + 138, y + 36, 7, 1, 'rgba(0,0,0,0.3)');
  rect(x + 20, y + h + 2, w - 40, 3, '#8e93a0');
  rect(x + 30, y + h, 10, 2, '#e85d75');
  rect(x + 44, y + h, 10, 2, '#4ea8de');
}

function drawPoster(x, y) {
  const w = 52, h = 64;
  rect(x - 1, y - 1, w + 2, h + 2, OUTLINE);
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, '#1f6f8b');
  g.addColorStop(1, '#16324f');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  const cx = x + w / 2;
  rect(cx - 4, y + 12, 8, 20, '#eef0f3');
  rect(cx - 2, y + 8, 4, 4, '#eef0f3');
  rect(cx - 1, y + 6, 2, 2, '#eef0f3');
  rect(cx - 2, y + 17, 4, 4, '#4ea8de');
  rect(cx - 8, y + 26, 4, 8, '#e85d75');
  rect(cx + 4, y + 26, 4, 8, '#e85d75');
  rect(cx - 3, y + 33, 6, 3, '#f2c14e');
  rect(cx - 2, y + 36, 4, 3, '#ef8354');
  for (let i = 0; i < 6; i++) rect(x + 4 + ((i * 17) % 44), y + 4 + ((i * 11) % 30), 1, 1, '#fff');
  ctx.fillStyle = '#f2c14e';
  ctx.font = 'bold 9px Consolas, "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('SHIP IT', cx, y + 52);
  ctx.textAlign = 'left';
}

const CLOCK = { x: 374, y: 50, r: 16 }; // en la pared derecha
function drawClockFace() {
  ctx.fillStyle = OUTLINE;
  ctx.beginPath(); ctx.arc(CLOCK.x, CLOCK.y, CLOCK.r + 3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#c9a227';
  ctx.beginPath(); ctx.arc(CLOCK.x, CLOCK.y, CLOCK.r + 2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fbf7ef';
  ctx.beginPath(); ctx.arc(CLOCK.x, CLOCK.y, CLOCK.r, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const r1 = CLOCK.r - (i % 3 === 0 ? 5 : 3);
    ctx.strokeStyle = '#3a2f2f';
    ctx.lineWidth = i % 3 === 0 ? 1.5 : 1;
    ctx.beginPath();
    ctx.moveTo(CLOCK.x + Math.sin(a) * r1, CLOCK.y - Math.cos(a) * r1);
    ctx.lineTo(CLOCK.x + Math.sin(a) * (CLOCK.r - 1), CLOCK.y - Math.cos(a) * (CLOCK.r - 1));
    ctx.stroke();
  }
}
function drawClockHands() {
  const dt = new Date(now());
  const m = dt.getMinutes() + dt.getSeconds() / 60;
  const h = (dt.getHours() % 12) + m / 60;
  ctx.save();
  wallRightT();
  const hand = (a, len, w, color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(CLOCK.x, CLOCK.y);
    ctx.lineTo(CLOCK.x + Math.sin(a) * len, CLOCK.y - Math.cos(a) * len);
    ctx.stroke();
  };
  hand((h / 12) * Math.PI * 2, 8, 2.2, '#2a2433');
  hand((m / 60) * Math.PI * 2, 12, 1.5, '#2a2433');
  hand((dt.getSeconds() / 60) * Math.PI * 2, 13, 0.8, '#e85d75');
  ctx.fillStyle = '#2a2433';
  ctx.beginPath(); ctx.arc(CLOCK.x, CLOCK.y, 1.6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// ---- Luces -----------------------------------------------------------------

// Manchas de sol en el suelo que entran por las ventanas.
function drawDaylight(sky) {
  const day = 1 - sky.stars;
  if (day < 0.05) return;
  ctx.save();
  floorT();
  ctx.globalCompositeOperation = 'lighter';
  const a0 = WIN_RIGHT.u / WL, a1 = (WIN_RIGHT.u + WIN_RIGHT.w) / WL;
  let g = ctx.createLinearGradient(0, 0, 0, 3);
  g.addColorStop(0, `rgba(255,236,190,${0.16 * day})`);
  g.addColorStop(1, 'rgba(255,236,190,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(a0, 0); ctx.lineTo(a1, 0); ctx.lineTo(a1 + 1.4, 3); ctx.lineTo(a0 + 1.4, 3);
  ctx.closePath(); ctx.fill();
  const b0 = GH - (WIN_LEFT.u + WIN_LEFT.w) / WL, b1 = GH - WIN_LEFT.u / WL;
  g = ctx.createLinearGradient(0, 0, 3, 0);
  g.addColorStop(0, `rgba(255,236,190,${0.14 * day})`);
  g.addColorStop(1, 'rgba(255,236,190,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, b0); ctx.lineTo(0, b1); ctx.lineTo(3, b1 + 1.4); ctx.lineTo(3, b0 + 1.4);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawNightLights(sky, ds) {
  if (sky.dark < 0.02) return;
  ctx.fillStyle = `rgba(8,10,34,${sky.dark})`;
  ctx.fillRect(ROOM.x0, HEADER_H, ROOM.x1 - ROOM.x0, ROOM.y1 - HEADER_H);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const k = sky.dark / 0.4;
  const glow = (p, r, rgb, a) => {
    const g = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, r);
    g.addColorStop(0, `rgba(${rgb},${a * k})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
  };
  for (const d of ds) {
    const s = d.slot;
    if (screenOn(d)) {
      const [r, g, b] = hexToRgb(SCREEN_COLOR[d.state] || '#7ee08a');
      glow(iso(s.seatX + 0.55, s.cy - 0.1, 40), 80, `${r},${g},${b}`, 0.3);
    }
    if (d.hasLamp) glow(iso(s.cx + 0.55, s.cy + 0.05, 46), 70, '255,200,120', 0.3);
  }
  // luz junto a la puerta y en la zona del cafe
  glow(iso(0.3, DOOR.y, 60), 90, '255,214,150', 0.18);
  glow(iso(9.4, 0.5, 50), 80, '255,214,150', 0.16);
  ctx.restore();
}

// ---- Puestos de trabajo -----------------------------------------------------

function drawRug(d) {
  const s = d.slot;
  const hl = hoverId === d.id;
  const tg = isTarget(d);
  ctx.save();
  floorT();
  ctx.globalAlpha = 0.92;
  roundRect(s.cx - 1.05, s.cy - 1.35, 2.1, 2.0, 0.2, tg ? shade(d.rug, 1.25) : d.rug);
  roundRect(s.cx - 0.95, s.cy - 1.25, 1.9, 1.8, 0.15, shade(d.rug, hl ? 1.4 : 1.2));
  roundRect(s.cx - 0.85, s.cy - 1.15, 1.7, 1.6, 0.12, hl ? shade(d.rug, 1.15) : d.rug);
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawDesk(d, t) {
  const { cx, cy } = d.slot;
  const on = screenOn(d);
  const TOP = 22;
  // paneles (tapan las piernas) y tablero
  box(cx - 0.76, cy + 0.26, 0, 1.52, 0.06, TOP, '#5d3f2d');
  box(cx + 0.7, cy - 0.3, 0, 0.06, 0.56, TOP, '#5d3f2d');
  box(cx - 0.8, cy - 0.35, TOP, 1.6, 0.7, 4, { top: '#a0744d', left: '#7a5436', right: '#664530' });
  const Z = TOP + 4;

  // portatil: base con teclado y tapa (la pantalla mira al agente; vemos el dorso)
  const lx = d.slot.seatX + 0.55, ly = cy - 0.34;
  box(lx - 0.28, ly, Z, 0.56, 0.36, 2, { top: '#c7ccd4', left: '#9aa0aa', right: '#878d97' }, true);
  // teclas (en el plano de la mesa)
  ctx.save();
  ctx.translate(0, -(Z + 2));
  floorT();
  const typing = on && (d.state === 'coding' || d.state === 'running' || d.state === 'working');
  for (let r = 0; r < 3; r++) {
    for (let k = 0; k < 6; k++) {
      const pressed = typing && Math.abs(hash(Math.floor(t / 110) + k * 3 + r + d.phase)) % 9 === 0;
      rect(lx - 0.24 + k * 0.08, ly + 0.04 + r * 0.07, 0.06, 0.05, pressed ? '#7ee08a' : '#6b717c');
    }
  }
  ctx.restore();
  const lidC = on ? (SCREEN_COLOR[d.state] || '#7ee08a') : '#4a4f5a';
  box(lx - 0.3, ly + 0.36, Z, 0.6, 0.04, 20, { top: '#2a2d38', left: '#3a3f4a', right: '#2a2d38' });
  // logo luminoso en el dorso y halo de la pantalla
  const lp = iso(lx, ly + 0.4, Z + 10);
  if (on) {
    const pulse = 0.55 + Math.sin(t / 300 + d.phase) * 0.2;
    ctx.fillStyle = alpha(lidC, 0.25 * pulse);
    ctx.beginPath(); ctx.ellipse(lp.x, lp.y - 3, 22, 14, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = on ? lidC : '#5a606b';
  ctx.beginPath(); ctx.arc(lp.x, lp.y, 2.4, 0, Math.PI * 2); ctx.fill();

  // objetos deterministas
  if (d.hasMug) {
    box(cx - 0.72, cy + 0.02, Z, 0.14, 0.14, 8, '#d65b5b');
    const m = iso(cx - 0.65, cy + 0.09, Z + 8);
    ctx.fillStyle = '#3b2418';
    ctx.beginPath(); ctx.ellipse(m.x, m.y, 3.5, 2, 0, 0, Math.PI * 2); ctx.fill();
  }
  if (d.hasLamp) {
    box(cx + 0.46, cy - 0.02, Z, 0.16, 0.16, 2, '#2a2d38', true);
    const b = iso(cx + 0.54, cy + 0.06, Z + 2);
    const h = iso(cx + 0.54, cy + 0.06, Z + 22);
    ctx.strokeStyle = '#2a2d38';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(h.x, h.y); ctx.lineTo(h.x + 8, h.y + 2); ctx.stroke();
    ctx.fillStyle = '#f2c14e';
    ctx.beginPath(); ctx.moveTo(h.x + 3, h.y - 2); ctx.lineTo(h.x + 14, h.y + 1); ctx.lineTo(h.x + 11, h.y + 8); ctx.lineTo(h.x + 2, h.y + 5); ctx.closePath(); ctx.fill();
  } else {
    box(cx + 0.35, cy + 0.0, Z, 0.3, 0.22, 3, { top: '#fbf7ef', left: '#d7dade', right: '#c2c6cc' });
  }
  if (d.hasPlant) {
    box(cx + 0.52, cy - 0.3, Z, 0.16, 0.16, 7, '#b06a3a');
    const p = iso(cx + 0.6, cy - 0.22, Z + 12);
    ctx.fillStyle = '#4e8d4a';
    ctx.beginPath(); ctx.ellipse(p.x, p.y, 7, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#5fa85a';
    ctx.beginPath(); ctx.ellipse(p.x - 2, p.y - 3, 4, 4, 0, 0, Math.PI * 2); ctx.fill();
  }
}

function drawChair(d) {
  const x = d.slot.seatX, y = d.slot.seatY;
  const base = iso(x, y, 0);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(base.x, base.y, 16, 8, 0, 0, Math.PI * 2); ctx.fill();
  box(x - 0.05, y - 0.05, 0, 0.1, 0.1, 12, '#262b38', true);
  box(x - 0.28, y - 0.28, 12, 0.56, 0.56, 5, '#3c435c');
  box(x - 0.28, y - 0.36, 12, 0.56, 0.1, 36, '#2c3142');
}

// ---- Personaje (chibi) -----------------------------------------------------
// Cabeza grande, cuerpo pequeño. Cada miembro tiene su estilo (look.style):
// 'human', 'robot' (TARS) o 'visor' (KITT, con su escáner rojo) y un
// accesorio (look.acc): auricular, diadema, gafas… (px, py) = pies en pantalla.

function drawCharacter(d, t, px, py, seated) {
  const x = Math.round(px);
  const feet = Math.round(py);
  const walking = !d.arrived;
  const working = d.arrived && AT_WORK.has(d.state);
  const bob = walking
    ? Math.abs(Math.sin(t / 110 + d.phase)) * 1.6
    : working ? Math.sin(t / 160 + d.phase) * 0.8 : Math.sin(t / 620 + d.phase) * 0.6;
  const top = Math.round(feet - 38 + bob); // parte de arriba de la cabeza
  const back = walking && d.back;
  const robot = d.style === 'robot';

  if (!seated) {
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.beginPath();
    ctx.ellipse(x, feet + 1, 16, 6, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.save();
  ctx.translate(x, feet);
  ctx.scale(CHAR_SCALE, CHAR_SCALE);
  ctx.translate(-x, -feet);

  // piernas cortitas
  const step = walking ? Math.sin(t / 85 + d.phase) : 0;
  const lA = Math.round(Math.max(0, step) * 2);
  const lB = Math.round(Math.max(0, -step) * 2);
  const legH = seated ? 3 : 5;
  orect(x - 5, top + 32, 4, legH - lA, d.pants);
  orect(x + 1, top + 32, 4, legH - lB, d.pants);
  if (!seated) {
    orect(x - 6, top + 36 - lA, 5, 2, robot ? '#3a3f4a' : '#1c1f2e');
    orect(x + 1, top + 36 - lB, 5, 2, robot ? '#3a3f4a' : '#1c1f2e');
  }

  // cuerpo
  roundRect(x - 8, top + 20, 16, 14, 5, OUTLINE);
  roundRect(x - 7, top + 21, 14, 12, 4, d.shirt);
  rect(x - 7, top + 28, 14, 5, shade(d.shirt, 0.72));
  if (!back) {
    if (d.acc === 'earpiece') { // traje con corbata
      rect(x - 1, top + 21, 2, 7, d.accent);
      rect(x - 3, top + 21, 2, 2, '#eef0f3');
      rect(x + 1, top + 21, 2, 2, '#eef0f3');
    } else if (robot) {
      rect(x - 4, top + 23, 8, 4, '#2a2d38');
      rect(x - 3, top + 24, 2, 2, Math.floor(t / 400) % 2 ? d.accent : '#3a3f4a');
      rect(x + 1, top + 24, 2, 2, '#f2c14e');
    } else if (d.acc === 'glasses') {
      rect(x - 2, top + 23, 4, 4, d.accent); // escudo
      rect(x - 1, top + 24, 2, 2, '#eef0f3');
    } else if (d.acc === 'visor') {
      rect(x - 7, top + 26, 14, 1, d.accent);
    } else {
      rect(x - 2, top + 22, 4, 3, shade(d.shirt, 1.25));
    }
  }

  // bracitos (teclean cuando trabaja)
  const typing = working && (d.state === 'coding' || d.state === 'running' || d.state === 'working');
  const armOff = typing && Math.sin(t / 90 + d.phase) > 0 ? 1 : 0;
  const swing = walking ? Math.round(step * 2) : 0;
  orect(x - 10, top + 22 + armOff + swing, 3, 7, d.shirt);
  orect(x + 7, top + 22 + armOff - swing, 3, 7, d.shirt);
  rect(x - 10, top + 28 + armOff + swing, 3, 2, robot ? '#aab3bd' : d.skin);
  rect(x + 7, top + 28 + armOff - swing, 3, 2, robot ? '#aab3bd' : d.skin);

  // cabezota
  if (robot) drawRobotHead(d, t, x, top, back);
  else drawHumanHead(d, t, x, top, back);
  ctx.restore();
}

function drawHumanHead(d, t, x, top, back) {
  roundRect(x - 12, top - 1, 24, 22, 8, OUTLINE);
  roundRect(x - 11, top, 22, 20, 7, d.skin);
  rect(x - 12, top + 9, 1, 5, d.skin); // orejas
  rect(x + 11, top + 9, 1, 5, d.skin);
  drawHair(d, x, top, back);
  if (back) return;

  const visor = d.style === 'visor';
  if (visor) {
    // visor con el escáner rojo de KITT barriendo de lado a lado
    roundRect(x - 11, top + 8, 22, 6, 2, '#15131c');
    const k = (Math.sin(t / 260) + 1) / 2;
    const sx = x - 9 + k * 16;
    ctx.fillStyle = alpha(d.accent, 0.35);
    ctx.fillRect(sx - 4, top + 9, 8, 4);
    rect(sx - 1.5, top + 9, 3, 4, d.accent);
  } else {
    const blink = ((t + d.phase * 37) % 4300) < 130;
    if (blink) {
      rect(x - 7, top + 11, 4, 1, '#1a1a1a');
      rect(x + 3, top + 11, 4, 1, '#1a1a1a');
    } else {
      // ojazos con brillo
      rect(x - 7, top + 8, 4, 5, '#1a1a1a');
      rect(x + 3, top + 8, 4, 5, '#1a1a1a');
      rect(x - 6, top + 9, 2, 2, '#ffffff');
      rect(x + 4, top + 9, 2, 2, '#ffffff');
      rect(x - 5, top + 12, 1, 1, alpha(d.accent, 0.9));
      rect(x + 5, top + 12, 1, 1, alpha(d.accent, 0.9));
    }
    if (d.acc === 'glasses') {
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x - 5, top + 10.5, 4, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(x + 5, top + 10.5, 4, 0, Math.PI * 2); ctx.stroke();
      rect(x - 1, top + 10, 2, 1, '#1a1a1a');
    }
  }
  // mofletes
  rect(x - 10, top + 14, 3, 2, 'rgba(232,120,120,0.55)');
  rect(x + 7, top + 14, 3, 2, 'rgba(232,120,120,0.55)');
  drawMouth(d, t, x, top + 16, '#7a2e2e');

  if (d.acc === 'earpiece') {
    rect(x + 11, top + 10, 2, 4, '#2a2d38');
    rect(x + 12, top + 9, 1, 1, Math.floor(t / 500) % 2 ? d.accent : '#2a2d38');
  }
}

function drawRobotHead(d, t, x, top, back) {
  // cabeza metálica con pantalla y antena
  rect(x, top - 6, 1, 5, '#5c6570');
  rect(x - 1, top - 8, 3, 3, Math.floor(t / 600) % 2 ? d.accent : '#e85d75');
  roundRect(x - 12, top - 1, 24, 22, 4, OUTLINE);
  roundRect(x - 11, top, 22, 20, 3, d.skin);
  rect(x - 11, top, 22, 3, shade(d.skin, 1.15));
  rect(x - 13, top + 7, 2, 6, '#5c6570'); // tuercas
  rect(x + 11, top + 7, 2, 6, '#5c6570');
  if (back) {
    for (let i = 0; i < 3; i++) rect(x - 7, top + 6 + i * 4, 14, 1, shade(d.skin, 0.8));
    return;
  }
  roundRect(x - 9, top + 4, 18, 13, 2, '#15131c');
  const blink = ((t + d.phase * 37) % 3900) < 120;
  const eh = blink ? 1 : 4;
  rect(x - 6, top + 8 + (blink ? 2 : 0), 4, eh, d.accent);
  rect(x + 2, top + 8 + (blink ? 2 : 0), 4, eh, d.accent);
  // boca de LEDs (se mueve al hablar)
  const speaking = isSpeaking(d);
  for (let i = 0; i < 5; i++) {
    const h = speaking ? 1 + Math.round(Math.abs(Math.sin(t / 80 + i)) * 2) : 1;
    rect(x - 5 + i * 2, top + 14 - h + 1, 1, h, alpha(d.accent, 0.8));
  }
  if (speaking) drawWaves(t, x, top);
}

function drawMouth(d, t, x, y, color) {
  if (isSpeaking(d)) {
    const open = Math.abs(Math.sin(t / 75)) > 0.4;
    rect(x - 2, y, 4, open ? 3 : 1, color);
    drawWaves(t, x, y - 8);
  } else if (d.state === 'talking' || d.state === 'prompt') {
    rect(x - 2, y, 4, 2, color);
  } else {
    rect(x - 2, y, 1, 1, color);
    rect(x - 1, y + 1, 2, 1, color);
    rect(x + 1, y, 1, 1, color);
  }
}

function drawWaves(t, x, y) {
  ctx.strokeStyle = alpha(TARGET_COLOR, 0.85);
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 2; i++) {
    const r = 5 + i * 5 + ((t / 90) % 5);
    ctx.globalAlpha = Math.max(0, 1 - r / 16);
    ctx.beginPath();
    ctx.arc(x + 13, y + 8, r, -0.7, 0.7);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawHair(d, x, top, back) {
  const h = d.hair;
  const hl = shade(h, 1.35);
  if (back) { // de espaldas: casi toda la cabeza es pelo
    roundRect(x - 11, top - 1, 22, 17, 7, h);
    rect(x - 6, top, 8, 1, hl);
    if (d.hairStyle === 2) roundRect(x - 12, top + 4, 24, 20, 5, h);
    if (d.hairStyle === 3) { roundRect(x - 5, top - 7, 10, 7, 3, OUTLINE); roundRect(x - 4, top - 6, 8, 5, 2, h); }
    if (d.acc === 'headband') rect(x - 11, top + 3, 22, 2, d.accent);
    return;
  }
  roundRect(x - 12, top - 2, 24, 9, 6, OUTLINE);
  roundRect(x - 11, top - 1, 22, 7, 5, h);
  switch (d.hairStyle) {
    case 0: // peinado hacia atrás
      rect(x - 11, top + 2, 3, 6, h);
      rect(x + 8, top + 2, 3, 6, h);
      rect(x - 4, top + 4, 8, 2, h);
      break;
    case 1: // de punta
      rect(x - 9, top - 5, 3, 4, h);
      rect(x - 3, top - 6, 3, 5, h);
      rect(x + 3, top - 5, 3, 4, h);
      rect(x - 11, top + 2, 3, 5, h);
      rect(x + 8, top + 2, 3, 5, h);
      break;
    case 2: // melena larga
      rect(x - 13, top + 1, 4, 22, OUTLINE);
      rect(x + 9, top + 1, 4, 22, OUTLINE);
      rect(x - 12, top + 1, 3, 21, h);
      rect(x + 9, top + 1, 3, 21, h);
      rect(x - 11, top + 4, 6, 3, h); // flequillo
      break;
    case 3: // moño
      roundRect(x - 5, top - 8, 10, 7, 3, OUTLINE);
      roundRect(x - 4, top - 7, 8, 5, 2, h);
      rect(x - 11, top + 2, 3, 7, h);
      rect(x + 8, top + 2, 3, 7, h);
      break;
  }
  rect(x - 6, top, 7, 1, hl); // brillo
  if (d.acc === 'headband') rect(x - 11, top + 3, 22, 2, d.accent);
}

// Pies del personaje en pantalla (sentado, un poco mas arriba).
function charFeet(d) {
  return iso(d.x, d.y, d.arrived ? 12 : 0);
}
function headTop(d) {
  return charFeet(d).y - 44 * CHAR_SCALE;
}

// ---- Mobiliario comun ------------------------------------------------------

function drawPlant(x, y, s) {
  box(x - 0.2 * s, y - 0.2 * s, 0, 0.4 * s, 0.4 * s, 16 * s, '#b06a3a');
  const p = iso(x, y, 16 * s);
  const leaves = [[-9, -14, 8, 14], [6, -18, 8, 16], [-2, -26, 7, 15], [11, -8, 8, 9], [-13, -6, 8, 8]];
  for (const [lx, ly, rx, ry] of leaves) {
    ctx.fillStyle = OUTLINE;
    ctx.beginPath(); ctx.ellipse(p.x + lx * s, p.y + ly * s, (rx + 1) * s, (ry + 1) * s, lx * 0.03, 0, Math.PI * 2); ctx.fill();
  }
  for (const [lx, ly, rx, ry] of leaves) {
    ctx.fillStyle = Math.abs(hash(lx * 7 + ly)) % 2 ? '#4e8d4a' : '#5fa85a';
    ctx.beginPath(); ctx.ellipse(p.x + lx * s, p.y + ly * s, rx * s, ry * s, lx * 0.03, 0, Math.PI * 2); ctx.fill();
  }
}

function drawCooler() {
  const x = 1.5, y = 0.22;
  box(x, y, 0, 0.42, 0.42, 30, '#d7dade');
  const f = iso(x + 0.21, y + 0.42, 20);
  rect(f.x - 5, f.y - 4, 3, 4, '#4ea8de');
  rect(f.x + 1, f.y - 2, 3, 4, '#e85d75');
  box(x + 0.06, y + 0.06, 30, 0.3, 0.3, 22, { top: 'rgba(150,205,255,0.8)', left: 'rgba(120,190,255,0.6)', right: 'rgba(95,160,230,0.6)' }, true);
}

function drawCounter() {
  box(8.7, 0.08, 0, 3.0, 0.62, 20, '#6e4c36');
  box(8.66, 0.06, 20, 3.08, 0.66, 3, { top: '#d9d2e6', left: '#b8b0c8', right: '#9d95ad' });
  // cafetera, microondas, tazas y frutero
  box(9.0, 0.14, 23, 0.44, 0.36, 24, '#2a2d38');
  const led = iso(9.22, 0.5, 38);
  rect(led.x - 1, led.y - 1, 3, 3, '#e85d75');
  box(10.5, 0.12, 23, 0.62, 0.44, 16, '#d7dade');
  const door = iso(10.7, 0.56, 31);
  rect(door.x - 6, door.y - 4, 10, 7, '#3a3f4a');
  const cups = ['#e85d75', '#4ea8de', '#f2c14e'];
  for (let i = 0; i < 3; i++) box(9.6 + i * 0.22, 0.34, 23, 0.12, 0.12, 7, cups[i]);
  const bowl = iso(11.45, 0.4, 26);
  ctx.fillStyle = '#eef0f3';
  ctx.beginPath(); ctx.ellipse(bowl.x, bowl.y, 9, 4, 0, 0, Math.PI * 2); ctx.fill();
  for (const [dx, c] of [[-4, '#e85d75'], [1, '#f2c14e'], [5, '#6bbf59']]) {
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.arc(bowl.x + dx, bowl.y - 3, 3, 0, Math.PI * 2); ctx.fill();
  }
}

function drawSofa() {
  const x = 0.14, y = 3.6, len = 1.8;
  box(x, y, 0, 0.78, len, 12, '#4a6aa0');
  box(x, y + 0.12, 12, 0.7, len - 0.24, 5, { top: '#86a6de', left: '#6b8fcf', right: '#5c80bc' });
  box(x, y, 12, 0.24, len, 22, '#5c80bc');
  box(x, y, 12, 0.78, 0.14, 12, '#4a6aa0');
  box(x, y + len - 0.14, 12, 0.78, 0.14, 12, '#4a6aa0');
  box(x + 0.26, y + 0.3, 17, 0.14, 0.4, 12, '#f2c14e');
}

// Mesa holográfica en el centro: un anillo por miembro del equipo que se
// ilumina con su color cuando está trabajando.
function drawHolo(t, ds) {
  const { x, y } = HOLO;
  box(x - 0.45, y - 0.45, 0, 0.9, 0.9, 14, '#2a2d38');
  const c = iso(x, y, 14);
  const rx = 0.55 * TW / Math.SQRT2, ry = 0.55 * TH / Math.SQRT2;
  ctx.fillStyle = '#15131c';
  ctx.beginPath(); ctx.ellipse(c.x, c.y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createLinearGradient(0, c.y - 70, 0, c.y);
  g.addColorStop(0, 'rgba(90,200,255,0)');
  g.addColorStop(1, 'rgba(90,200,255,0.22)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(c.x - rx * 0.8, c.y); ctx.lineTo(c.x - rx * 0.5, c.y - 70); ctx.lineTo(c.x + rx * 0.5, c.y - 70); ctx.lineTo(c.x + rx * 0.8, c.y);
  ctx.closePath(); ctx.fill();
  const n = Math.max(1, ds.length);
  ds.forEach((d, i) => {
    const a = t / 1400 + (i / n) * Math.PI * 2;
    const hy = c.y - 38 + Math.sin(t / 700 + i) * 3;
    const px = c.x + Math.cos(a) * rx * 0.55;
    const py = hy + Math.sin(a) * ry * 0.55;
    const col = d.accent || '#7ee08a';
    ctx.fillStyle = alpha(col, d.busy ? 0.95 : 0.35);
    ctx.beginPath(); ctx.arc(px, py, d.busy ? 4 : 3, 0, Math.PI * 2); ctx.fill();
    if (d.busy) {
      ctx.fillStyle = alpha(col, 0.2);
      ctx.beginPath(); ctx.arc(px, py, 9, 0, Math.PI * 2); ctx.fill();
    }
  });
  ctx.strokeStyle = 'rgba(120,210,255,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.ellipse(c.x, c.y - 38, rx * 0.55, ry * 0.55, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

// ---- Gato de la oficina ----------------------------------------------------
// Pasea por los pasillos (rejilla entre las mesas), se sienta y duerme.

const CAT_XS = [1.05, 4.55, 8.1, 11.6];
const CAT_YS = [1.35, 4.6, 7.7, FRONT_Y];
const cat = { x: 8.1, y: FRONT_Y, gx: 2, gy: 3, tx: 8.1, ty: FRONT_Y, mode: 'sit', until: 0, dir: 1 };

function updateCat(t, dt) {
  if (cat.mode === 'walk') {
    const dx = cat.tx - cat.x, dy = cat.ty - cat.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.02) {
      cat.x = cat.tx; cat.y = cat.ty;
      const r = Math.random();
      cat.mode = r < 0.55 ? 'pause' : r < 0.85 ? 'sit' : 'sleep';
      cat.until = t + (cat.mode === 'sleep' ? 9000 + Math.random() * 9000 : cat.mode === 'sit' ? 1500 + Math.random() * 4000 : 0);
    } else {
      const sp = 0.0011 * dt;
      cat.x += (dx / dist) * Math.min(sp, dist);
      cat.y += (dy / dist) * Math.min(sp, dist);
      const sdx = dx - dy; // direccion en pantalla
      if (Math.abs(sdx) > 0.01) cat.dir = sdx > 0 ? 1 : -1;
    }
  }
  if (cat.mode !== 'walk' && t >= cat.until) {
    const moves = [];
    if (cat.gx > 0) moves.push([-1, 0]);
    if (cat.gx < CAT_XS.length - 1) moves.push([1, 0]);
    if (cat.gy > 0) moves.push([0, -1]);
    if (cat.gy < CAT_YS.length - 1) moves.push([0, 1]);
    const [mx, my] = moves[Math.floor(Math.random() * moves.length)];
    cat.gx += mx; cat.gy += my;
    cat.tx = CAT_XS[cat.gx]; cat.ty = CAT_YS[cat.gy];
    cat.mode = 'walk';
  }
}

function drawCat(t) {
  const p = iso(cat.x, cat.y, 0);
  const x = Math.round(p.x), y = Math.round(p.y);
  const f = cat.dir;
  const C = '#e0a458', D = '#b97a3a';
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath(); ctx.ellipse(x, y + 1, 11, 4, 0, 0, Math.PI * 2); ctx.fill();
  if (cat.mode === 'sleep') {
    roundRect(x - 10, y - 8, 20, 9, 4, OUTLINE);
    roundRect(x - 9, y - 7, 18, 7, 3, C);
    rect(x - 5, y - 7, 2, 7, D);
    rect(x + 1, y - 7, 2, 7, D);
    rect(x + 5 * f - 3, y - 10, 6, 5, C);
    rect(x + 5 * f - 3, y - 12, 2, 2, C);
    rect(x + 5 * f + 1, y - 12, 2, 2, C);
    return;
  }
  const walking = cat.mode === 'walk';
  const leg = walking ? Math.round(Math.sin(t / 70) * 1.5) : 0;
  const sw = Math.sin(t / 300) * 3;
  rect(x - 11 * f + (f > 0 ? 0 : -2), y - 12 + sw, 2, 8 - sw, C);
  rect(x - 7, y - 3 + leg, 2, 3 - leg, D);
  rect(x - 3, y - 3 - leg, 2, 3 + leg, D);
  rect(x + 3, y - 3 + leg, 2, 3 - leg, D);
  rect(x + 6, y - 3 - leg, 2, 3 + leg, D);
  const bh = cat.mode === 'sit' ? 10 : 7;
  roundRect(x - 10, y - 3 - bh, 20, bh + 1, 3, OUTLINE);
  roundRect(x - 9, y - 2 - bh, 18, bh - 1, 3, C);
  rect(x - 4, y - 2 - bh, 2, bh - 2, D);
  rect(x + 1, y - 2 - bh, 2, bh - 2, D);
  const hx = x + 8 * f;
  const hy = y - 6 - bh;
  rect(hx - 5, hy - 5, 10, 9, OUTLINE);
  rect(hx - 4, hy - 4, 8, 7, C);
  rect(hx - 4, hy - 7, 2, 3, C);
  rect(hx + 2, hy - 7, 2, 3, C);
  rect(hx - 3, hy - 6, 1, 2, '#f58fb0');
  rect(hx + 3, hy - 6, 1, 2, '#f58fb0');
  const blink = (t % 3800) < 140;
  rect(hx - 3, hy - 2, 2, blink ? 1 : 2, '#1a1a1a');
  rect(hx + 1, hy - 2, 2, blink ? 1 : 2, '#1a1a1a');
  rect(hx - 1, hy + 1, 2, 1, '#f58fb0');
}

// ---- Particulas (vapor, zzz, codigo, ideas…) -------------------------------

const particles = [];

function emit(p) {
  if (particles.length > 260) return;
  particles.push(Object.assign({ vx: 0, vy: -0.02, life: 0, max: 1600, size: 10, color: '#fff' }, p));
}

function emitters(ds, t) {
  for (const d of ds) {
    if (!d.arrived || t < d.emitAt) continue;
    const stale = isStale(d);
    const f = charFeet(d);
    const head = headTop(d);
    const lid = iso(d.slot.seatX + 0.55, d.slot.cy + 0.02, 48);
    if (/^capacit/.test(d.label || '')) {
      emit({ x: f.x + (Math.random() - 0.5) * 30, y: head - 4, vx: (Math.random() - 0.5) * 0.02, vy: -0.022, text: ['📚', '🎓', '💡'][Math.floor(Math.random() * 3)], emoji: true, size: 12, max: 1800 });
      d.emitAt = t + 700 + Math.random() * 500;
    } else if (stale) {
      emit({ x: f.x + 12, y: head + 4, vx: 0.012, vy: -0.018, text: 'z', color: '#cfc8de', size: 9 + Math.random() * 4, max: 2400 });
      d.emitAt = t + 1400 + Math.random() * 600;
    } else if (d.state === 'coding' || d.state === 'working') {
      const glyphs = ['{ }', '</>', ';', '=>', '()', '01', '#'];
      emit({ x: lid.x - 14 + Math.random() * 28, y: lid.y, vx: (Math.random() - 0.5) * 0.02, vy: -0.025, text: glyphs[Math.floor(Math.random() * glyphs.length)], color: '#7ee08a', size: 9, max: 1400 });
      d.emitAt = t + 500 + Math.random() * 500;
    } else if (d.state === 'thinking') {
      emit({ x: f.x + 14, y: head - 2, vx: 0.01, vy: -0.02, text: Math.random() < 0.5 ? '?' : '…', color: '#d9b8f0', size: 12, max: 1600 });
      d.emitAt = t + 900 + Math.random() * 500;
    } else if (d.state === 'running') {
      emit({ x: lid.x + (Math.random() - 0.5) * 30, y: lid.y, vx: (Math.random() - 0.5) * 0.03, vy: -0.03, text: '⚙', color: '#f2c14e', size: 10, max: 1200 });
      d.emitAt = t + 600 + Math.random() * 500;
    } else if (d.state === 'web') {
      emit({ x: lid.x + (Math.random() - 0.5) * 30, y: lid.y, vx: (Math.random() - 0.5) * 0.03, vy: -0.025, dot: true, color: '#7aa2dd', size: 3, max: 1200 });
      d.emitAt = t + 300 + Math.random() * 300;
    } else if (d.state === 'waiting') {
      emit({ x: f.x, y: head - 6, vy: -0.02, text: '!', color: '#e85d75', size: 13, max: 1200 });
      d.emitAt = t + 1200;
    } else {
      d.emitAt = t + 800;
    }
    if (d.hasMug && !stale && Math.random() < 0.5) {
      const m = iso(d.slot.cx - 0.65, d.slot.cy + 0.09, 36);
      emit({ x: m.x + (Math.random() - 0.5) * 3, y: m.y, vx: (Math.random() - 0.5) * 0.006, vy: -0.012, dot: true, color: '#e9e4f0', size: 2.5, max: 1500, fade: 0.35 });
    }
  }
  // cafetera humeante y burbujas del dispensador
  if (Math.random() < 0.03) { const c = iso(9.22, 0.32, 50); emit({ x: c.x + (Math.random() - 0.5) * 4, y: c.y, vy: -0.012, dot: true, color: '#e9e4f0', size: 2.5, max: 1600, fade: 0.3 }); }
  if (Math.random() < 0.01) { const w = iso(1.71, 0.43, 34); emit({ x: w.x - 3 + Math.random() * 6, y: w.y, vy: -0.012, dot: true, color: '#cfe8ff', size: 1.8, max: 1100, fade: 0.8 }); }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life += dt;
    if (p.life >= p.max) { particles.splice(i, 1); continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.text === 'z') p.x += Math.sin(p.life / 250) * 0.15;
  }
}

function drawParticles() {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const p of particles) {
    const k = p.life / p.max;
    const a = (k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85) * (p.fade || 0.9);
    ctx.globalAlpha = Math.max(0, a);
    if (p.dot) {
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1 + k * 0.6), 0, Math.PI * 2); ctx.fill();
    } else if (p.emoji) {
      ctx.font = `${p.size}px "Segoe UI Emoji", system-ui`;
      ctx.fillText(p.text, p.x, p.y);
    } else if (p.heart) {
      ctx.font = `${p.size}px "Segoe UI Emoji", system-ui`;
      ctx.fillText('❤️', p.x, p.y);
    } else {
      ctx.font = `bold ${p.size}px Consolas, "Courier New", monospace`;
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y);
    }
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
}

// ---- Marcadores de destino y bocadillo -------------------------------------

// Anillo en el suelo (elipse isometrica) bajo el puesto elegido o señalado.
function drawMarker(d, t) {
  const tg = isTarget(d);
  if (!tg && hoverId !== d.id) return;
  const p = iso(d.x, d.y, 0);
  const pulse = (Math.sin(t / 260) + 1) / 2;
  const r = 0.62 + pulse * 0.06;
  ctx.strokeStyle = tg ? alpha(TARGET_COLOR, 0.55 + pulse * 0.45) : 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, r * TW / Math.SQRT2, r * TH / Math.SQRT2, 0, 0, Math.PI * 2);
  ctx.stroke();
}

function drawArrow(d, t) {
  if (!isTarget(d)) return;
  const x = Math.round(charFeet(d).x);
  const ay = bubbleBox(d).y - 12 + Math.sin(t / 200) * 2;
  ctx.fillStyle = OUTLINE;
  ctx.beginPath(); ctx.moveTo(x - 7, ay - 1); ctx.lineTo(x + 7, ay - 1); ctx.lineTo(x, ay + 8); ctx.closePath(); ctx.fill();
  ctx.fillStyle = TARGET_COLOR;
  ctx.beginPath(); ctx.moveTo(x - 5, ay); ctx.lineTo(x + 5, ay); ctx.lineTo(x, ay + 6); ctx.closePath(); ctx.fill();
}

function nameOf(d) {
  return { name: d.name || d.project || 'agente', custom: false };
}

// Caja del bocadillo (nombre + estado) sobre la cabeza.
function bubbleBox(d) {
  const stale = isStale(d);
  const speaking = isSpeaking(d);
  const { name, custom } = nameOf(d);
  const emoji = speaking ? '\u{1F50A}' : stale ? '\u{1F4A4}' : d.emoji;
  const label = speaking ? 'hablando…' : stale ? 'inactivo' : (d.label || '');
  ctx.font = 'bold 11px Consolas, "Courier New", monospace';
  const nw = ctx.measureText(clip(name, 16)).width;
  ctx.font = '10px Consolas, "Courier New", monospace';
  const lw = ctx.measureText(label).width;
  const w = Math.round(Math.min(150, Math.max(84, Math.max(nw + 30, lw + 34))));
  const h = 32;
  const cx = Math.round(charFeet(d).x);
  const y = Math.round(headTop(d) - h - 12);
  return { x: cx - Math.round(w / 2), y, w, h, cx, name, custom, emoji, label, stale, speaking };
}

function drawBubble(d) {
  const b = bubbleBox(d);
  const tg = isTarget(d);
  const accent = b.speaking || tg ? TARGET_COLOR : (STATE_COLOR[d.state] || '#999');
  ctx.globalAlpha = b.stale && !b.speaking && !tg ? 0.72 : 1;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;
  roundRect(b.x, b.y, b.w, b.h, 9, tg ? '#f1fff2' : '#fbf7ef');
  ctx.restore();
  ctx.fillStyle = tg ? '#f1fff2' : '#fbf7ef';
  ctx.beginPath();
  ctx.moveTo(b.cx - 6, b.y + b.h - 1);
  ctx.lineTo(b.cx + 6, b.y + b.h - 1);
  ctx.lineTo(b.cx, b.y + b.h + 7);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = alpha(accent, 0.95);
  ctx.lineWidth = tg ? 2 : 1.5;
  roundPath(b.x + 0.75, b.y + 0.75, b.w - 1.5, b.h - 1.5, 8.5);
  ctx.stroke();

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  // linea 1: punto de estado + nombre (+ auriculares si se le puede hablar)
  ctx.fillStyle = b.stale ? '#6b7280' : (STATE_COLOR[d.state] || '#9aa0a6');
  ctx.beginPath(); ctx.arc(b.x + 10, b.y + 10, 3.2, 0, Math.PI * 2); ctx.fill();
  ctx.font = 'bold 11px Consolas, "Courier New", monospace';
  ctx.fillStyle = '#231d2d';
  ctx.fillText(clip(b.name, 16), b.x + 18, b.y + 10.5);
  if (b.custom) {
    ctx.font = '9px "Segoe UI Emoji", system-ui';
    ctx.textAlign = 'right';
    ctx.fillText('\u{1F3A7}', b.x + b.w - 5, b.y + 10);
    ctx.textAlign = 'left';
  }
  // linea 2: emoji + que esta haciendo
  ctx.font = '11px "Segoe UI Emoji", system-ui';
  ctx.fillText(b.emoji, b.x + 6, b.y + 23);
  ctx.font = '10px Consolas, "Courier New", monospace';
  clipText(b.label, b.x + 22, b.y + 23, b.w - 28);
  ctx.globalAlpha = 1;
}

function clipText(text, x, y, maxW) {
  let t = text;
  while (t.length > 1 && ctx.measureText(t).width > maxW) t = t.slice(0, -1);
  if (t !== text) t = t.slice(0, -1) + '…';
  ctx.fillStyle = '#4a4257';
  ctx.fillText(t, x, y);
}
function clip(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

// ---- Cabecera --------------------------------------------------------------

function pill(x, y, text, color) {
  ctx.font = '11px Consolas, "Courier New", monospace';
  const w = ctx.measureText(text).width + 22;
  roundRect(x, y, w, 20, 10, 'rgba(255,255,255,0.06)');
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x + 10, y + 10, 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#d8d1e6';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 17, y + 10.5);
  return w;
}

function drawHeader() {
  const L = ROOM.x0, R = ROOM.x1;
  const g = ctx.createLinearGradient(L, 0, R, 0);
  g.addColorStop(0, '#2a1f3d');
  g.addColorStop(0.5, '#211a31');
  g.addColorStop(1, '#2a1f3d');
  ctx.fillStyle = g;
  ctx.fillRect(L, 0, R - L, HEADER_H);
  rect(L, HEADER_H - 2, R - L, 2, '#5a4a6e');
  rect(L, HEADER_H - 3, R - L, 1, 'rgba(255,255,255,0.05)');

  const lx = Math.max(L, -40);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = '22px "Segoe UI Emoji", system-ui';
  ctx.fillText('\u{1F3E2}', lx + 16, HEADER_H / 2);
  ctx.fillStyle = '#f3eefb';
  ctx.font = 'bold 19px Consolas, "Courier New", monospace';
  ctx.fillText('Pixel Office', lx + 48, HEADER_H / 2);

  const all = Array.from(display.values());
  const busy = all.filter((d) => d.busy).length;
  let px = lx + 200;
  px += pill(px, 14, `equipo: ${agentCount} IAs`, '#9aa0a6') + 8;
  px += pill(px, 14, busy ? `${busy} trabajando` : 'todos disponibles', busy ? '#f2c14e' : '#6bbf59') + 8;
  const speaking = all.find((d) => isSpeaking(d));
  if (speaking) pill(px, 14, `\u{1F50A} ${clip(nameOf(speaking).name, 12)}`, TARGET_COLOR);

  const dt = new Date(now());
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  const rx = Math.min(R, VW + 40);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#cfc8de';
  ctx.font = 'bold 17px Consolas, "Courier New", monospace';
  ctx.fillText(`${hh}:${mm}`, rx - 16, HEADER_H / 2);
  ctx.fillStyle = '#8a83a0';
  ctx.font = '10px Consolas, "Courier New", monospace';
  ctx.fillText('clic en un personaje para hablarle', rx - 80, HEADER_H / 2 + 1);
  ctx.textAlign = 'left';
}

function drawEmpty() {
  const w = 440, h = 118;
  const c = iso(GW / 2, GH / 2, 0);
  const x = c.x - w / 2, y = c.y - h / 2;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 18;
  roundRect(x, y, w, h, 14, 'rgba(28,23,38,0.92)');
  ctx.restore();
  ctx.strokeStyle = 'rgba(126,224,138,0.35)';
  ctx.lineWidth = 1.5;
  roundPath(x + 0.75, y + 0.75, w - 1.5, h - 1.5, 13);
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '28px "Segoe UI Emoji", system-ui';
  ctx.fillText('\u{1F4BC}', c.x, y + 28);
  ctx.fillStyle = '#f3eefb';
  ctx.font = 'bold 16px Consolas, "Courier New", monospace';
  ctx.fillText('La oficina está vacía', c.x, y + 60);
  ctx.fillStyle = '#a79fbd';
  ctx.font = '11.5px Consolas, "Courier New", monospace';
  ctx.fillText('Lanza un agente desde el Centro de mando (o dilo: "nuevo agente…")', c.x, y + 84);
  ctx.fillText('o abre una sesión de Claude Code en una terminal.', c.x, y + 100);
  ctx.textAlign = 'left';
}

// ---- Raton: hover y clic en personajes --------------------------------------

function toLogical(e) {
  const r = canvas.getBoundingClientRect();
  const px = (e.clientX - r.left) * view.dpr;
  const py = (e.clientY - r.top) * view.dpr;
  return { x: (px - view.ox) / view.scale, y: (py - view.oy) / view.scale };
}

// Id del agente bajo el puntero: su bocadillo, su cuerpo o su puesto.
function hitTest(p) {
  const ds = Array.from(display.values()).sort((a, b) => (b.x + b.y) - (a.x + a.y));
  for (const d of ds) {
    const b = bubbleBox(d);
    if (d.arrived && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h + 6) return d.id;
  }
  for (const d of ds) {
    const f = charFeet(d);
    if (Math.abs(p.x - f.x) < 20 && p.y > f.y - 64 && p.y < f.y + 6) return d.id;
  }
  const fl = toFloor(p.x, p.y);
  for (const d of ds) {
    const s = d.slot;
    if (d.arrived && Math.abs(fl.x - s.cx) < 1.05 && fl.y > s.cy - 1.35 && fl.y < s.cy + 0.65) return d.id;
  }
  return null;
}

function hitCat(p) {
  const c = iso(cat.x, cat.y, 0);
  return Math.abs(p.x - c.x) < 15 && p.y > c.y - 24 && p.y < c.y + 4;
}

canvas.addEventListener('mousemove', (e) => {
  const p = toLogical(e);
  hoverId = hitTest(p);
  canvas.style.cursor = hoverId || hitCat(p) ? 'pointer' : 'default';
});
canvas.addEventListener('mouseleave', () => { hoverId = null; canvas.style.cursor = 'default'; });
canvas.addEventListener('click', (e) => {
  const p = toLogical(e);
  if (hitCat(p)) {
    const c = iso(cat.x, cat.y, 0);
    for (let i = 0; i < 3; i++) emit({ x: c.x + (Math.random() - 0.5) * 12, y: c.y - 26, vx: (Math.random() - 0.5) * 0.02, vy: -0.03, heart: true, size: 10, max: 1300 });
    if (cat.mode === 'sleep') cat.until = 0;
    return;
  }
  const id = hitTest(p);
  if (!id) return;
  window.dispatchEvent(new CustomEvent('pixel:pick', { detail: { sessionId: id, additive: e.ctrlKey || e.shiftKey || e.metaKey } }));
});

// ---- Bucle de animacion ----------------------------------------------------

let lastT = 0;

function update(t, dt) {
  for (const d of display.values()) {
    if (d.arrived || t < (d.startAt || 0)) continue;
    let step = 0.0028 * dt; // baldosas por ms
    while (step > 0 && d.path.length) {
      const wp = d.path[0];
      const dx = wp.x - d.x, dy = wp.y - d.y;
      const dist = Math.hypot(dx, dy);
      d.back = (dx + dy) < -0.001; // se aleja de la camara: de espaldas
      if (dist <= step) { d.x = wp.x; d.y = wp.y; step -= dist; d.path.shift(); }
      else { d.x += (dx / dist) * step; d.y += (dy / dist) * step; step = 0; }
    }
    if (!d.path.length) { d.arrived = true; d.back = false; }
  }
  updateCat(t, dt);
  emitters(display.values(), t);
  updateParticles(dt);
}

function frame(t) {
  // Pedimos el siguiente cuadro primero: un error puntual no congela la oficina.
  requestAnimationFrame(frame);
  const dt = Math.min(50, lastT ? t - lastT : 16);
  lastT = t;
  if (!(view.scale > 0)) return;
  if (canvas.clientWidth !== lastW || canvas.clientHeight !== lastH) resize();
  if (!bgCanvas) buildStatic();
  update(t, dt);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#16121f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(view.scale, 0, 0, view.scale, view.ox, view.oy);
  ctx.imageSmoothingEnabled = false;

  const sky = skyInfo();
  drawSky(t, sky);
  ctx.drawImage(bgCanvas, ROOM.x0, 0, ROOM.x1 - ROOM.x0, ROOM.y1);
  drawClockHands();
  drawDaylight(sky);

  const ds = Array.from(display.values());
  for (const d of ds) if (d.arrived) drawRug(d);
  for (const d of ds) drawMarker(d, t);

  // Todo lo que tiene volumen, ordenado por profundidad (x + y).
  const items = [
    { k: 0.5 + 3.6 + 0.9, draw: drawSofa },
    { k: 1.7 + 0.45, draw: drawCooler },
    { k: 10.2 + 0.4, draw: drawCounter },
    { k: 1.0, draw: () => drawPlant(0.5, 0.5, 1.1) },
    { k: 0.5 + 9.2, draw: () => drawPlant(0.45, 9.2, 0.9) },
    { k: 23, draw: () => drawPlant(11.5, 11.5, 1.2) },
    { k: 11.9 + 3.2, draw: () => drawPlant(11.6, 3.2, 0.8) },
    { k: cat.x + cat.y, draw: () => drawCat(t) },
    { k: HOLO.x + HOLO.y, draw: () => drawHolo(t, ds) },
  ];
  for (const d of ds) {
    const s = d.slot;
    if (d.arrived) items.push({ k: s.seatX + s.seatY - 0.3, draw: () => drawChair(d) });
    const f = charFeet(d);
    if (d.arrived || t >= (d.startAt || 0)) items.push({ k: d.x + d.y + 0.01, draw: () => drawCharacter(d, t, f.x, f.y, d.arrived) });
    items.push({ k: s.cx + s.cy + 0.1, draw: () => drawDesk(d, t) });
  }
  items.sort((a, b) => a.k - b.k);
  for (const it of items) it.draw();

  drawNightLights(sky, ds);
  drawParticles();

  const arrived = ds.filter((d) => d.arrived).sort((a, b) => (a.x + a.y) - (b.x + b.y));
  for (const d of arrived) drawBubble(d);
  for (const d of arrived) drawArrow(d, t);

  drawHeader();
  if (ds.length === 0) drawEmpty();
}

requestAnimationFrame(frame);
