'use strict';

// ---------------------------------------------------------------------------
// Pixel Office - render de la oficina en un canvas con resolucion logica fija.
// Cada agente de Claude Code = un personaje en su escritorio.
// ---------------------------------------------------------------------------

const VW = 1000; // ancho logico
const VH = 680;  // alto logico
const HEADER_H = 60;
const COLS = 4;
const ROWS = 3;
const MAX_DESKS = COLS * ROWS;

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');

let view = { scale: 1, ox: 0, oy: 0 };
let lastW = 0, lastH = 0;

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || window.innerWidth;
  const H = canvas.clientHeight || window.innerHeight;
  canvas.width = Math.max(1, Math.floor(W * dpr));
  canvas.height = Math.max(1, Math.floor(H * dpr));
  const s = Math.min(W / VW, H / VH);
  view.scale = s * dpr;
  view.ox = ((W - VW * s) / 2) * dpr;
  view.oy = ((H - VH * s) / 2) * dpr;
  lastW = W;
  lastH = H;
}
window.addEventListener('resize', resize);
resize();

// ---- Paletas --------------------------------------------------------------

const SHIRTS = ['#e85d75', '#4ea8de', '#f4a259', '#6bbf59', '#b56bd6', '#3fc1c9',
                '#f2c14e', '#ef8354', '#7c9eb2', '#d65db1', '#5c80bc', '#88d498'];
const HAIRS = ['#2b2b2b', '#5a3825', '#8a5a2b', '#c9a227', '#1f1f2e', '#6e4b3a', '#b5651d'];
const SKINS = ['#f1c9a5', '#e0ac86', '#c68642', '#8d5524', '#ffdbac'];
const RUGS  = ['#2f4a4a', '#43394f', '#3a4a2f', '#4a3a2f', '#2f3a4a'];

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = Math.max(0, Math.min(255, Math.round(r * f)));
  g = Math.max(0, Math.min(255, Math.round(g * f)));
  b = Math.max(0, Math.min(255, Math.round(b * f)));
  return `rgb(${r},${g},${b})`;
}
function pick(arr, n) { return arr[Math.abs(hash(n)) % arr.length]; }
function hash(str) {
  let h = 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

const AT_WORK = new Set(['reading', 'coding', 'running', 'web', 'working', 'thinking', 'delegating']);

const STATE_COLOR = {
  idle: '#6b7280', prompt: '#f4a259', thinking: '#b56bd6', talking: '#4ea8de',
  reading: '#3fc1c9', coding: '#6bbf59', running: '#f2c14e', web: '#5c80bc',
  delegating: '#d65db1', working: '#9aa0a6', waiting: '#e85d75',
};

// ---- Distribucion de escritorios ------------------------------------------

function deskSlots() {
  const areaX = 50;
  const areaW = VW - 100;
  const cw = areaW / COLS;
  const startY = 76;
  const rowH = (VH - startY - 12) / ROWS;
  const slots = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      slots.push({
        cx: Math.round(areaX + cw * c + cw / 2),
        deskY: Math.round(startY + 62 + r * rowH),
      });
    }
  }
  return slots;
}
const SLOTS = deskSlots();

// ---- Estado de render ------------------------------------------------------

const display = new Map();
let order = [];
let agentCount = 0;
let serverNow = Date.now();
let clientStamp = performance.now();

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
      const slotIndex = order.length % SLOTS.length;
      order.push(a.id);
      const slot = SLOTS[slotIndex];
      d = {
        id: a.id,
        slot,
        seatX: slot.cx,
        seatY: slot.deskY + 96,
        x: VW / 2,
        y: VH - 6,
        arrived: false,
        phase: Math.abs(hash(a.id)) % 1000,
        shirt: pick(SHIRTS, a.id),
        hair: pick(HAIRS, a.id + 'h'),
        skin: pick(SKINS, a.id + 's'),
        hairStyle: Math.abs(hash(a.id + 'hs')) % 4,
        rug: pick(RUGS, a.id + 'r'),
        hasPlant: Math.abs(hash(a.id + 'p')) % 3 === 0,
        hasMug: Math.abs(hash(a.id + 'm')) % 2 === 0,
      };
      display.set(a.id, d);
    }
    d.project = a.project;
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

function now() { return serverNow + (performance.now() - clientStamp); }
function isStale(d) { return !d.lastTime || (now() - d.lastTime > 120000); }

// ---- Fondo de la oficina ---------------------------------------------------

function drawFloor() {
  // pared superior con moldura
  rect(0, 0, VW, HEADER_H + 22, '#332b40');
  rect(0, HEADER_H + 18, VW, 4, '#241d30');
  rect(0, HEADER_H + 22, VW, 3, '#5a4a6e');

  // suelo de madera por tablones
  const tw = 56, th = 28;
  for (let y = HEADER_H + 25; y < VH; y += th) {
    const rowShift = (((y / th) | 0) % 2) * (tw / 2);
    for (let x = -tw; x < VW + tw; x += tw) {
      const base = ((((x + rowShift) / tw) | 0) % 2) === 0 ? '#4a3a2c' : '#52432f';
      rect(x + rowShift, y, tw, th, base);
      rect(x + rowShift, y, tw, 1, shade(base, 1.18));
      rect(x + rowShift, y + th - 1, tw, 1, shade(base, 0.78));
    }
  }
}

function drawRug(d) {
  const cx = d.slot.cx;
  const top = d.slot.deskY - 6;
  const w = 184, h = 150;
  ctx.globalAlpha = 0.9;
  roundRect(cx - w / 2, top, w, h, 14, d.rug);
  roundRect(cx - w / 2 + 6, top + 6, w - 12, h - 12, 10, shade(d.rug, 1.18));
  roundRect(cx - w / 2 + 12, top + 12, w - 24, h - 24, 8, d.rug);
  ctx.globalAlpha = 1;
}

function drawWorkstation(d, t) {
  const cx = d.slot.cx;
  const deskY = d.slot.deskY;
  const dw = 138;
  const dx = cx - dw / 2;

  // monitor (detras del escritorio)
  const mw = 50, mx = cx - mw / 2, my = deskY - 32;
  rect(mx - 3, my - 3, mw + 6, 36, '#15131c');
  const on = AT_WORK.has(d.state) && d.arrived;
  rect(mx, my, mw, 30, on ? '#0e1a2b' : '#11141b');
  if (on) {
    for (let i = 0; i < 4; i++) {
      const flick = (Math.sin(t / 180 + i + d.phase) + 1) / 2;
      const lw = 8 + Math.floor(flick * (mw - 16));
      const col = d.state === 'running' ? '#f2c14e'
        : d.state === 'web' ? '#7aa2dd'
        : d.state === 'reading' ? '#3fc1c9' : '#7ee08a';
      rect(mx + 5, my + 5 + i * 6, lw, 3, col);
    }
    rect(mx, my, mw, 30, 'rgba(120,180,255,0.05)');
  }
  rect(mx + mw - 6, my + 2, 2, 2, '#3a3f4a'); // webcam
  rect(cx - 4, my + 30, 8, 5, '#15131c');
  rect(cx - 11, my + 34, 22, 3, '#15131c');

  // sombra del escritorio
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(dx + 6, deskY + 38, dw, 9);

  // tablero
  roundRect(dx, deskY, dw, 40, 6, '#7a5436');
  roundRect(dx + 3, deskY + 3, dw - 6, 10, 4, '#9a6e49');
  // veta
  for (let i = 1; i < 4; i++) rect(dx + 6, deskY + 6 + i * 8, dw - 12, 1, 'rgba(0,0,0,0.12)');

  // teclado
  rect(cx - 19, deskY + 22, 38, 11, '#d7dade');
  rect(cx - 17, deskY + 24, 34, 2, '#aeb3ba');
  // raton
  rect(cx + 24, deskY + 24, 7, 9, '#d7dade');

  // props deterministas
  if (d.hasMug) {
    rect(dx + 14, deskY + 8, 9, 9, '#d65b5b');
    rect(dx + 23, deskY + 10, 3, 5, '#d65b5b');
  }
  if (d.hasPlant) {
    rect(dx + dw - 22, deskY + 6, 11, 8, '#b06a3a'); // maceta
    rect(dx + dw - 21, deskY + 1, 9, 6, '#4e8d4a');  // hojas
    rect(dx + dw - 18, deskY - 3, 4, 6, '#5fa85a');
  }
}

function drawChair(d) {
  const x = d.seatX;
  const y = d.seatY;
  // base con ruedas
  rect(x - 14, y + 6, 28, 3, '#1c1f29');
  rect(x - 2, y - 2, 4, 10, '#262b38');
  // asiento + respaldo
  roundRect(x - 16, y - 34, 32, 34, 7, '#2c3142');
  roundRect(x - 13, y - 31, 26, 22, 5, '#3c435c');
}

// dibuja un personaje mirando al frente
function drawCharacter(d, t) {
  const x = Math.round(d.x);
  const feet = Math.round(d.y);
  const working = d.arrived && AT_WORK.has(d.state);
  const bob = d.arrived
    ? (working ? Math.sin(t / 160 + d.phase) * 1.1 : Math.sin(t / 520 + d.phase) * 0.7)
    : Math.abs(Math.sin(t / 90 + d.phase)) * 2.2;
  const top = Math.round(feet - 40 + bob);
  const dark = shade(d.shirt, 0.6);

  // sombra
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(x, feet + 1, 13, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  // piernas
  rect(x - 7, top + 26, 5, 14, '#2c3350');
  rect(x + 2, top + 26, 5, 14, '#2c3350');
  rect(x - 8, top + 39, 7, 3, '#1c1f2e'); // zapatos
  rect(x + 1, top + 39, 7, 3, '#1c1f2e');

  // cuerpo con contorno y sombreado
  rect(x - 11, top + 13, 22, 18, dark);
  roundRect(x - 10, top + 14, 20, 16, 4, d.shirt);
  rect(x - 10, top + 24, 20, 6, shade(d.shirt, 0.82));

  // brazos
  const typing = d.arrived && (d.state === 'coding' || d.state === 'running' || d.state === 'working');
  const armOff = typing && Math.sin(t / 90 + d.phase) > 0 ? 1 : 0;
  rect(x - 14, top + 18 + armOff, 4, 10, d.shirt);
  rect(x + 10, top + 18 + armOff, 4, 10, d.shirt);
  rect(x - 14, top + 27 + armOff, 4, 3, d.skin);
  rect(x + 10, top + 27 + armOff, 4, 3, d.skin);

  // cabeza
  rect(x - 9, top - 1, 18, 16, shade(d.skin, 0.7));
  rect(x - 8, top, 16, 14, d.skin);
  rect(x - 8, top + 10, 16, 4, shade(d.skin, 0.9));

  // pelo segun estilo
  drawHair(d, x, top);

  // cara
  const stale = isStale(d);
  if (stale || d.state === 'idle') {
    rect(x - 5, top + 7, 3, 1, '#3a2f2f');
    rect(x + 2, top + 7, 3, 1, '#3a2f2f');
  } else {
    rect(x - 5, top + 6, 2, 2, '#1a1a1a');
    rect(x + 3, top + 6, 2, 2, '#1a1a1a');
    rect(x - 6, top + 9, 2, 1, 'rgba(232,120,120,0.5)');
    rect(x + 4, top + 9, 2, 1, 'rgba(232,120,120,0.5)');
    if (d.state === 'talking' || d.state === 'prompt') rect(x - 2, top + 10, 4, 2, '#7a2e2e');
    else rect(x - 1, top + 11, 2, 1, '#5a3a3a');
  }
}

function drawHair(d, x, top) {
  const h = d.hair;
  // base comun
  rect(x - 9, top - 3, 18, 6, h);
  switch (d.hairStyle) {
    case 0: // corto
      rect(x - 9, top - 3, 4, 9, h);
      rect(x + 5, top - 3, 4, 9, h);
      break;
    case 1: // puntiagudo
      rect(x - 7, top - 6, 3, 4, h);
      rect(x - 1, top - 7, 3, 5, h);
      rect(x + 4, top - 6, 3, 4, h);
      break;
    case 2: // largo
      rect(x - 10, top - 2, 4, 16, h);
      rect(x + 6, top - 2, 4, 16, h);
      break;
    case 3: // moño
      rect(x - 3, top - 8, 6, 5, h);
      rect(x - 9, top - 3, 3, 7, h);
      rect(x + 6, top - 3, 3, 7, h);
      break;
  }
}

// ---- Bocadillo de estado ---------------------------------------------------

function drawBubble(d) {
  const stale = isStale(d);
  const emoji = stale ? '\u{1F4A4}' : d.emoji;
  const label = stale ? 'inactivo' : (d.label || '');
  const cx = d.slot.cx;
  const bottom = d.slot.deskY - 40;

  ctx.font = '11px Consolas, "Courier New", monospace';
  const textW = ctx.measureText(label).width;
  const w = Math.min(200, Math.max(74, textW + 38));
  const h = 26;
  const x = Math.round(cx - w / 2);
  const y = Math.round(bottom - h);
  const accent = STATE_COLOR[d.state] || '#999';

  ctx.globalAlpha = stale ? 0.72 : 1;
  // sombra
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  roundRect(x, y, w, h, 9, '#fbf7ef');
  ctx.restore();
  // pico
  ctx.fillStyle = '#fbf7ef';
  ctx.beginPath();
  ctx.moveTo(cx - 6, y + h - 1);
  ctx.lineTo(cx + 6, y + h - 1);
  ctx.lineTo(cx, y + h + 7);
  ctx.closePath();
  ctx.fill();
  // barra de acento
  roundRect(x + 4, y + 5, 4, h - 10, 2, accent);

  // contenido
  ctx.textBaseline = 'middle';
  ctx.font = '13px "Segoe UI Emoji", system-ui';
  ctx.fillStyle = '#2a2433';
  ctx.fillText(emoji, x + 12, y + h / 2 + 1);
  ctx.font = '11px Consolas, "Courier New", monospace';
  clipText(label, x + 31, y + h / 2 + 1, w - 37);
  ctx.globalAlpha = 1;
}

function clipText(text, x, y, maxW) {
  let t = text;
  while (t.length > 1 && ctx.measureText(t).width > maxW) t = t.slice(0, -1);
  if (t !== text) t = t.slice(0, -1) + '…';
  ctx.fillStyle = '#2a2433';
  ctx.fillText(t, x, y);
}

function drawNameTag(d) {
  const custom = window.PIXEL_AGENT_NAMES ? window.PIXEL_AGENT_NAMES[d.id] : null;
  const name = clip(custom || d.project || 'claude', 13);
  ctx.font = '10px Consolas, "Courier New", monospace';
  const w = Math.max(54, ctx.measureText(name).width + 14);
  const x = d.seatX - w / 2;
  const y = d.seatY + 4;
  roundRect(x, y, w, 14, 7, 'rgba(20,16,28,0.78)');
  // punto de estado
  ctx.fillStyle = isStale(d) ? '#6b7280' : (STATE_COLOR[d.state] || '#9aa0a6');
  ctx.beginPath();
  ctx.arc(x + 8, y + 7, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e9e4f0';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, x + 15, y + 8);
}
function clip(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

// ---- Viñeteado -------------------------------------------------------------

function drawVignette() {
  const g = ctx.createRadialGradient(VW / 2, VH / 2 + 40, VH * 0.25, VW / 2, VH / 2, VH * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(10,6,18,0.4)');
  ctx.fillStyle = g;
  ctx.fillRect(0, HEADER_H, VW, VH - HEADER_H);
}

// ---- Cabecera --------------------------------------------------------------

function drawHeader() {
  const g = ctx.createLinearGradient(0, 0, 0, HEADER_H);
  g.addColorStop(0, '#241d33');
  g.addColorStop(1, '#1b1527');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VW, HEADER_H);
  rect(0, HEADER_H - 2, VW, 2, '#5a4a6e');

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = '24px "Segoe UI Emoji", system-ui';
  ctx.fillText('\u{1F3E2}', 18, HEADER_H / 2);
  ctx.fillStyle = '#f3eefb';
  ctx.font = 'bold 20px Consolas, "Courier New", monospace';
  ctx.fillText('Pixel Office', 52, HEADER_H / 2 - 8);
  const active = Array.from(display.values()).filter((d) => !isStale(d)).length;
  ctx.fillStyle = '#9b93b0';
  ctx.font = '11px Consolas, "Courier New", monospace';
  ctx.fillText(`${agentCount} agente(s)  ·  ${active} activo(s)`, 52, HEADER_H / 2 + 10);

  const dt = new Date(now());
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  ctx.textAlign = 'right';
  ctx.fillStyle = '#cfc8de';
  ctx.font = '17px Consolas, "Courier New", monospace';
  ctx.fillText(`${hh}:${mm}`, VW - 18, HEADER_H / 2);
  ctx.textAlign = 'left';
}

function drawEmpty() {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#7a7290';
  ctx.font = '30px "Segoe UI Emoji", system-ui';
  ctx.fillText('\u{1F4BC}', VW / 2, VH / 2 - 28);
  ctx.fillStyle = '#cfc8de';
  ctx.font = '16px Consolas, "Courier New", monospace';
  ctx.fillText('La oficina esta vacia', VW / 2, VH / 2 + 6);
  ctx.fillStyle = '#8a83a0';
  ctx.font = '12px Consolas, "Courier New", monospace';
  ctx.fillText('Abre una sesion de Claude Code y veras aparecer a tu primer agente.', VW / 2, VH / 2 + 30);
  ctx.textAlign = 'left';
}

// ---- Bucle de animacion ----------------------------------------------------

function update() {
  for (const d of display.values()) {
    if (!d.arrived) {
      const dx = d.seatX - d.x;
      const dy = d.seatY - d.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 2.5) { d.x = d.seatX; d.y = d.seatY; d.arrived = true; }
      else { const sp = 2.6; d.x += (dx / dist) * sp; d.y += (dy / dist) * sp; }
    }
  }
}

function frame(t) {
  if (canvas.clientWidth !== lastW || canvas.clientHeight !== lastH) resize();
  update();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#16121f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(view.scale, 0, 0, view.scale, view.ox, view.oy);
  ctx.imageSmoothingEnabled = false;

  drawFloor();

  const ds = Array.from(display.values());
  for (const d of ds) drawRug(d);
  for (const d of ds) drawWorkstation(d, t);
  for (const d of ds) if (d.arrived) drawChair(d);

  ds.sort((a, b) => a.y - b.y);
  for (const d of ds) drawCharacter(d, t);

  drawVignette();

  for (const d of ds) if (d.arrived) drawNameTag(d);
  for (const d of ds) if (d.arrived) drawBubble(d);

  drawHeader();
  if (ds.length === 0) drawEmpty();

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
