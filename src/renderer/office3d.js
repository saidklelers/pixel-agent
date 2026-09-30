// ---------------------------------------------------------------------------
// Pixel Office 3D - la oficina en 3D real con Three.js (WebGL).
// Mismo estilo que la versión 2.5D: sala acogedora vista en diagonal y el
// equipo de 5 IAs como chibis, ahora modelados en 3D, con sombras y luz que
// cambia con la hora real.
// - Mundo en metros ≈ baldosas: x hacia la derecha-abajo, z hacia la
//   izquierda-abajo, y hacia arriba. Paredes en x = 0 y z = 0.
// - Arrastra para girar la cámara, rueda para acercar, doble clic para volver.
// - Clic en un personaje o en su mesa: evento 'pixel:pick' (Ctrl = marcar).
// - Lee de chat.js: PIXEL_TARGET_SESSIONS (destino) y PIXEL_SPEAKING_SESSION.
// - Nombres, bocadillos y partículas son HTML encima del canvas (#overlay).
// Si no hay WebGL, carga la versión 2.5D (renderer.js).
// ---------------------------------------------------------------------------

import * as THREE from '../../node_modules/three/build/three.module.min.js';

const GW = 12;
const GH = 12;
const WALL_H = 3.2;
const DOOR = { x: 0.15, z: 10.6 };
const FRONT_Z = 10.95;
const HOLO = { x: 6.6, z: 7.6 };
const SLOTS = [[6.6, 3.0], [3.2, 6.1], [10.0, 6.1], [3.2, 9.3], [10.0, 9.3]]
  .map(([cx, cz]) => ({ cx, cz, seatX: cx, seatZ: cz - 0.78 }));

const STATE_COLOR = {
  idle: '#6b7280', prompt: '#f4a259', thinking: '#b56bd6', talking: '#4ea8de',
  reading: '#3fc1c9', coding: '#6bbf59', running: '#f2c14e', web: '#5c80bc',
  delegating: '#d65db1', working: '#9aa0a6', waiting: '#e85d75',
};
const SCREEN_COLOR = {
  running: '#f2c14e', web: '#7aa2dd', reading: '#3fc1c9', thinking: '#c89be0', delegating: '#f58fb0',
};
const AT_WORK = new Set(['reading', 'coding', 'running', 'web', 'working', 'thinking', 'delegating']);
const TARGET_COLOR = '#7ee08a';
const CHAR_SCALE = 1.3;

const canvas = document.getElementById('stage');
const wrap = document.getElementById('stageWrap');
const overlay = document.getElementById('overlay');

// ---- Utilidades ----------------------------------------------------------------

function hash(str) {
  let h = 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
function rnd(seed) { const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(h1, h2, f) {
  const a = hexToRgb(h1), b = hexToRgb(h2);
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * f).toString(16).padStart(2, '0')).join('');
}
function shadeHex(hex, f) {
  return '#' + hexToRgb(hex).map((v) => Math.max(0, Math.min(255, Math.round(v * f))).toString(16).padStart(2, '0')).join('');
}

const mats = new Map();
function mat(color, opts) {
  const key = color + JSON.stringify(opts || {});
  if (!mats.has(key)) {
    mats.set(key, new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.82, metalness: 0.02 }, opts || {})));
  }
  return mats.get(key);
}

function mesh(geo, material, x, y, z, parent) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x || 0, y || 0, z || 0);
  m.castShadow = true;
  m.receiveShadow = true;
  (parent || scene).add(m);
  return m;
}
// Caja por su esquina mínima (x0, y0, z0) y tamaño.
function box(x0, y0, z0, w, h, d, color, parent, opts) {
  return mesh(new THREE.BoxGeometry(w, h, d), typeof color === 'string' ? mat(color, opts) : color,
    x0 + w / 2, y0 + h / 2, z0 + d / 2, parent);
}
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.userData.canvas = c;
  return t;
}

// ---- Escena, cámara y renderer ----------------------------------------------

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
} catch (e) {
  console.error('WebGL no disponible, uso la versión 2.5D:', e && e.message);
  overlay.remove();
  const s = document.createElement('script');
  s.src = 'renderer.js';
  document.body.appendChild(s);
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#1a1426');

const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
const orbit = { az: Math.PI / 4, pol: 0.96, dist: 22.5, target: new THREE.Vector3(6.2, 0.8, 6.3) };
const ORBIT_HOME = { az: orbit.az, pol: orbit.pol, dist: orbit.dist };
function placeCamera() {
  const t = orbit.target;
  camera.position.set(
    t.x + orbit.dist * Math.sin(orbit.pol) * Math.sin(orbit.az),
    t.y + orbit.dist * Math.cos(orbit.pol),
    t.z + orbit.dist * Math.sin(orbit.pol) * Math.cos(orbit.az),
  );
  camera.lookAt(t);
}

function resize() {
  const w = wrap.clientWidth || 800;
  const h = wrap.clientHeight || 600;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // en ventanas estrechas nos alejamos un poco para que quepa la sala
  camera.fov = w / h < 1.1 ? 36 : 30;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(wrap);
resize();
placeCamera();

// Luces: cielo/suelo, sol (o luna) con sombras y un relleno suave.
const hemi = new THREE.HemisphereLight('#dfe8ff', '#5a4632', 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff1d6', 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 50 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
sun.position.set(-4, 14, -2);
sun.target.position.set(6, 0, 6);
scene.add(sun, sun.target);
const fill = new THREE.DirectionalLight('#b9c7ff', 0.35);
fill.position.set(16, 8, 18);
scene.add(fill);
// Plafones del techo (invisibles): de noche la oficina tiene la luz encendida.
const ceiling = [[3.5, 3.5], [8.5, 3.5], [3.5, 8.5], [8.5, 8.5]].map(([x, z]) => {
  const l = new THREE.PointLight('#ffd9a8', 0, 9, 1.4);
  l.position.set(x, 3.1, z);
  scene.add(l);
  return l;
});

// ---- Sala ----------------------------------------------------------------------

const WALL_L = '#5a4d7a';
const WALL_R = '#65588a';

function buildRoom() {
  // suelo de tablones
  const planks = canvasTex(1024, 1024, (g, w, h) => {
    const tones = ['#6a5238', '#735a3e', '#6d553a', '#7a6143'];
    const rows = 48, pl = 128;
    const rh = h / rows;
    for (let r = 0; r < rows; r++) {
      const shift = (r % 4) * 32;
      for (let x = -shift, c = 0; x < w; x += pl, c++) {
        const col = tones[Math.abs(hash(r * 131 + c)) % tones.length];
        g.fillStyle = col;
        g.fillRect(x, r * rh, pl, rh);
        g.fillStyle = 'rgba(255,255,255,0.06)';
        g.fillRect(x, r * rh, pl, 2);
        g.fillStyle = 'rgba(0,0,0,0.28)';
        g.fillRect(x, r * rh + rh - 2, pl, 2);
        g.fillRect(x + pl - 2, r * rh, 2, rh);
        if (Math.abs(hash(r * 17 + c * 3)) % 9 === 0) { g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x + 40, r * rh + 8, 10, 4); }
      }
    }
  });
  const floorTop = new THREE.MeshStandardMaterial({ map: planks, roughness: 0.75 });
  const floorSide = mat('#3b2c20');
  const floor = new THREE.Mesh(new THREE.BoxGeometry(GW, 0.25, GH), [floorSide, floorSide, floorTop, floorSide, floorSide, floorSide]);
  floor.position.set(GW / 2, -0.125, GH / 2);
  floor.receiveShadow = true;
  scene.add(floor);

  // paredes (no dan sombra: el sol entra "a través" y dibuja las sombras de los muebles)
  const wallTex = (base) => canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.035)';
    for (let x = 0; x < w; x += 32) g.fillRect(x, 0, 16, h);
  });
  const mkWall = (w, d, x0, z0, color) => {
    const t = wallTex(color);
    t.wrapS = THREE.RepeatWrapping;
    t.repeat.set(Math.max(w, d) / 2, 1);
    const m = box(x0, 0, z0, w, WALL_H, d, new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 }));
    m.castShadow = false;
    return m;
  };
  mkWall(0.2, GH + 0.2, -0.2, -0.2, WALL_L); // izquierda (x = 0)
  mkWall(GW, 0.2, 0, -0.2, WALL_R); // fondo (z = 0)

  // zócalo, friso y moldura
  for (const [x0, z0, w, d, c] of [[0, 0, 0.05, GH, WALL_L], [0, 0, GW, 0.05, WALL_R]]) {
    box(x0, 0, z0, w, 0.95, d, shadeHex(c, 1.25)).castShadow = false;
    box(x0, 0.95, z0, w || 0.05, 0.04, d || 0.05, shadeHex(c, 1.55)).castShadow = false;
    box(x0, 0, z0, w + 0.02, 0.1, d + 0.02, '#241d30').castShadow = false;
    box(x0, WALL_H - 0.1, z0, w, 0.1, d, '#2a2238').castShadow = false;
  }
  // remate superior de las paredes
  box(-0.2, WALL_H, -0.2, 0.2, 0.04, GH + 0.2, '#241d30').castShadow = false;
  box(-0.2, WALL_H, -0.2, GW + 0.2, 0.04, 0.2, '#241d30').castShadow = false;

  buildWindow('back', 5.0, 8.5);
  buildWindow('left', 4.75, 8.25);
  buildDoor();
  buildWhiteboard();
  buildPoster();
  buildClock();
  buildBookshelf();
  buildCounter();
  buildCooler();
  buildSofa();
  buildPlant(0.55, 0.55, 1.2);
  buildPlant(0.5, 9.1, 0.9);
  buildPlant(11.4, 11.4, 1.3);
  buildPlant(11.5, 3.3, 0.85);
  buildHolo();
}

// Ventana: cielo pintado en un lienzo (se actualiza), marco, alféizar y cortinas.
const skies = [];
function buildWindow(side, a, b) {
  const y0 = 1.25, y1 = 2.65;
  const w = b - a, h = y1 - y0;
  const tex = canvasTex(512, 256, () => {});
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  const g = new THREE.Group();
  sky.position.set(w / 2, y0 + h / 2, 0.012);
  g.add(sky);
  const frame = mat('#d9d2e6');
  box(-0.08, y0 - 0.08, 0, w + 0.16, 0.08, 0.06, frame, g);
  box(-0.08, y1, 0, w + 0.16, 0.08, 0.06, frame, g);
  box(-0.08, y0, 0, 0.08, h, 0.06, frame, g);
  box(w, y0, 0, 0.08, h, 0.06, frame, g);
  box(w / 2 - 0.03, y0, 0, 0.06, h, 0.05, frame, g);
  box(0, y0 + h * 0.45, 0, w, 0.05, 0.05, frame, g);
  box(-0.2, y0 - 0.16, 0, w + 0.4, 0.06, 0.18, '#5b4a70', g); // alféizar
  for (const cx of [-0.34, w + 0.08]) {
    box(cx, y0 - 0.15, 0.02, 0.26, h + 0.45, 0.07, '#8a4f7d', g); // cortinas
  }
  box(-0.4, y1 + 0.2, 0.04, w + 0.8, 0.04, 0.04, '#1c1626', g); // barra
  if (side === 'back') g.position.set(a, 0, 0);
  else { g.rotation.y = Math.PI / 2; g.position.set(0, 0, b); }
  g.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  scene.add(g);
  skies.push({ tex, w, h, seed: side === 'back' ? 1 : 40, moon: side === 'back' });
}

function drawSky(s, t, info) {
  const c = s.tex.userData.canvas;
  const g = c.getContext('2d');
  const W = c.width, H = c.height;
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, info.top);
  grad.addColorStop(1, info.bot);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  if (info.stars > 0.05) {
    for (let i = 0; i < 60; i++) {
      const tw = (Math.sin(t / 500 + i * 1.7 + s.seed) + 1) / 2;
      g.fillStyle = `rgba(255,255,230,${(0.35 + tw * 0.65) * info.stars})`;
      g.fillRect(rnd(s.seed + i) * W, rnd(s.seed + i + 50) * H * 0.6, 2, 2);
    }
    if (s.moon) {
      g.fillStyle = `rgba(245,240,215,${info.stars})`;
      g.beginPath(); g.arc(W * 0.72, 40, 20, 0, Math.PI * 2); g.fill();
      g.fillStyle = info.top;
      g.beginPath(); g.arc(W * 0.72 + 10, 32, 18, 0, Math.PI * 2); g.fill();
    }
  }
  const day = 1 - info.stars;
  if (day > 0.05) {
    g.fillStyle = `rgba(255,255,255,${0.8 * day})`;
    for (let i = 0; i < 4; i++) {
      const span = W + 200;
      const cx = -100 + ((rnd(s.seed + i + 7) * span + t * (0.012 + rnd(s.seed + i + 3) * 0.015)) % span);
      const cy = 20 + rnd(s.seed + i + 11) * 70;
      const k = 0.8 + rnd(s.seed + i + 5) * 0.8;
      g.beginPath();
      g.ellipse(cx, cy, 44 * k, 12 * k, 0, 0, Math.PI * 2);
      g.ellipse(cx + 16 * k, cy - 10 * k, 22 * k, 14 * k, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  for (let i = 0; i < 16; i++) {
    const bx = i * 34 - 10 + rnd(s.seed + i + 50) * 14;
    const bw = 24 + rnd(s.seed + i + 70) * 20;
    const bh = 30 + rnd(s.seed + i + 90) * 80;
    g.fillStyle = mix('#2c3a5c', '#10142a', info.stars);
    g.fillRect(bx, H - bh, bw, bh);
    if (info.stars > 0.3) {
      for (let wy = H - bh + 8; wy < H - 4; wy += 12) {
        for (let wx = bx + 5; wx < bx + bw - 5; wx += 9) {
          if (rnd(wx * 3.1 + wy * 7.7 + s.seed) > 0.6) {
            g.fillStyle = `rgba(255,214,120,${0.85 * info.stars})`;
            g.fillRect(wx, wy, 4, 5);
          }
        }
      }
    }
  }
  s.tex.needsUpdate = true;
}

function textPlane(w, h, pxW, pxH, draw, parent) {
  const tex = canvasTex(pxW, pxH, draw);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }));
  m.receiveShadow = true;
  (parent || scene).add(m);
  return m;
}

function buildDoor() {
  const g = new THREE.Group();
  const z0 = 9.9, w = 1.4, h = 2.3;
  box(-0.05, 0, 0, w + 0.16, h + 0.08, 0.08, '#8a6a4a', g);
  box(0.06, 0, 0.02, w - 0.06, h - 0.04, 0.09, '#6e4c36', g);
  box(0.2, 1.25, 0.1, w - 0.34, 0.75, 0.02, '#5d3f2d', g);
  box(0.2, 0.2, 0.1, w - 0.34, 0.9, 0.02, '#5d3f2d', g);
  box(0.3, 1.45, 0.115, w - 0.54, 0.4, 0.01, mat('#a0d2ff', { emissive: '#3a5a7a', emissiveIntensity: 0.4 }), g);
  mesh(new THREE.SphereGeometry(0.06, 16, 12), mat('#f2c14e', { metalness: 0.7, roughness: 0.3 }), w - 0.2, 1.1, 0.16, g);
  const sign = textPlane(0.9, 0.22, 256, 64, (c, W, H) => {
    c.fillStyle = '#1f6f4a'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#d9ffe0'; c.font = 'bold 36px Consolas, monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('ENTRADA', W / 2, H / 2 + 2);
  }, g);
  sign.material.emissive = new THREE.Color('#1f6f4a');
  sign.material.emissiveIntensity = 0.6;
  sign.position.set(w / 2, h + 0.25, 0.05);
  g.rotation.y = Math.PI / 2;
  g.position.set(0.02, 0, z0 + w);
  scene.add(g);
  // felpudo
  box(0.1, 0, DOOR.z - 0.7, 0.9, 0.02, 1.4, '#8a4d4d').castShadow = false;
}

function buildWhiteboard() {
  const p = textPlane(3.4, 1.25, 680, 250, (g, W, H) => {
    g.fillStyle = '#c9ccd3'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#eef0f3'; g.fillRect(8, 8, W - 16, H - 16);
    g.lineWidth = 5;
    g.strokeStyle = '#4ea8de';
    g.strokeRect(50, 40, 130, 60); g.strokeRect(270, 40, 130, 60);
    g.strokeStyle = '#e85d75';
    g.strokeRect(160, 150, 130, 55);
    g.beginPath(); g.moveTo(180, 70); g.lineTo(270, 70); g.moveTo(115, 100); g.lineTo(190, 150); g.moveTo(335, 100); g.lineTo(260, 150); g.stroke();
    g.strokeStyle = '#3a3f4a'; g.lineWidth = 3;
    for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(450, 50 + i * 30); for (let k = 0; k < 8; k++) g.lineTo(450 + k * 22, 50 + i * 30 + (k % 2 ? -6 : 6)); g.stroke(); }
    g.fillStyle = '#f2c14e'; g.fillRect(580, 160, 60, 60);
    g.fillStyle = '#f58fb0'; g.fillRect(500, 175, 50, 50);
    g.fillStyle = '#1a1424'; g.font = 'bold 22px Consolas, monospace'; g.fillText('TODO', 588, 195);
  });
  p.position.set(2.5, 2.0, 0.03);
  box(0.9, 1.3, 0.02, 3.2, 0.05, 0.12, '#8e93a0');
}

function buildPoster() {
  const p = textPlane(1.1, 1.4, 220, 280, (g, W, H) => {
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, '#1f6f8b'); gr.addColorStop(1, '#16324f');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.fillStyle = '#fff';
    for (let i = 0; i < 20; i++) g.fillRect(rnd(i) * W, rnd(i + 9) * H * 0.7, 3, 3);
    const cx = W / 2;
    g.fillStyle = '#eef0f3'; g.fillRect(cx - 18, 60, 36, 90); g.beginPath(); g.moveTo(cx - 18, 60); g.lineTo(cx, 25); g.lineTo(cx + 18, 60); g.fill();
    g.fillStyle = '#4ea8de'; g.beginPath(); g.arc(cx, 90, 10, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#e85d75'; g.fillRect(cx - 36, 120, 18, 36); g.fillRect(cx + 18, 120, 18, 36);
    g.fillStyle = '#f2c14e'; g.fillRect(cx - 12, 150, 24, 16);
    g.fillStyle = '#ef8354'; g.fillRect(cx - 8, 166, 16, 14);
    g.fillStyle = '#f2c14e'; g.font = 'bold 34px Consolas, monospace'; g.textAlign = 'center';
    g.fillText('SHIP IT', cx, 240);
  });
  p.position.set(10.8, 2.2, 0.03);
}

let clockHands = null;
function buildClock() {
  const g = new THREE.Group();
  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.05, 40), [
    mat('#c9a227', { metalness: 0.6, roughness: 0.35 }),
    textPlaneMat(),
    mat('#c9a227'),
  ]);
  face.rotation.x = Math.PI / 2;
  g.add(face);
  const hand = (len, w, color) => {
    const pivot = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, len, 0.01), mat(color));
    m.position.y = len / 2;
    pivot.add(m);
    pivot.position.z = 0.035;
    g.add(pivot);
    return pivot;
  };
  clockHands = { h: hand(0.17, 0.035, '#2a2433'), m: hand(0.26, 0.025, '#2a2433'), s: hand(0.28, 0.01, '#e85d75') };
  g.position.set(9.3, 2.3, 0.06);
  scene.add(g);
}
function textPlaneMat() {
  const tex = canvasTex(256, 256, (g, W) => {
    g.fillStyle = '#fbf7ef'; g.beginPath(); g.arc(W / 2, W / 2, W / 2, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#3a2f2f';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.lineWidth = i % 3 === 0 ? 8 : 4;
      const r1 = W / 2 - (i % 3 === 0 ? 34 : 24);
      g.beginPath();
      g.moveTo(W / 2 + Math.sin(a) * r1, W / 2 - Math.cos(a) * r1);
      g.lineTo(W / 2 + Math.sin(a) * (W / 2 - 10), W / 2 - Math.cos(a) * (W / 2 - 10));
      g.stroke();
    }
  });
  // la tapa superior del cilindro, girado, mira a +z: rotamos la textura
  tex.center.set(0.5, 0.5);
  tex.rotation = Math.PI;
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
}
function updateClock(now) {
  if (!clockHands) return;
  const m = now.getMinutes() + now.getSeconds() / 60;
  const h = (now.getHours() % 12) + m / 60;
  clockHands.h.rotation.z = -(h / 12) * Math.PI * 2;
  clockHands.m.rotation.z = -(m / 60) * Math.PI * 2;
  clockHands.s.rotation.z = -(now.getSeconds() / 60) * Math.PI * 2;
}

function buildBookshelf() {
  const g = new THREE.Group();
  const w = 1.9, h = 2.2, d = 0.4;
  box(0, 0, 0, w, h, d, '#5a3d2b', g);
  box(0.05, 0.05, 0.05, w - 0.1, h - 0.1, d, '#3d2a1e', g);
  const colors = ['#e85d75', '#4ea8de', '#f2c14e', '#6bbf59', '#b56bd6', '#ef8354', '#3fc1c9', '#d9d2e6'];
  for (let s = 0; s < 4; s++) {
    const y = 0.1 + s * 0.52;
    box(0.05, y - 0.04, 0.05, w - 0.1, 0.04, d - 0.02, '#6e4c36', g);
    let x = 0.1, i = 0;
    while (x < w - 0.2) {
      const bw = 0.07 + (Math.abs(hash(s * 50 + i)) % 5) * 0.015;
      const bh = 0.28 + (Math.abs(hash(s * 70 + i)) % 7) * 0.025;
      if (Math.abs(hash(s + i * 13)) % 7 !== 0) {
        box(x, y, 0.1, bw, bh, 0.26, colors[Math.abs(hash(s * 90 + i * 7)) % colors.length], g);
      }
      x += bw + 0.012;
      i++;
    }
  }
  g.rotation.y = Math.PI / 2;
  g.position.set(0.02, 0, 3.8);
  scene.add(g);
}

let coffeeSteamAt = { x: 9.25, y: 1.5, z: 0.35 };
function buildCounter() {
  box(8.7, 0, 0.06, 3.0, 0.9, 0.62, '#6e4c36');
  box(8.66, 0.9, 0.04, 3.08, 0.05, 0.68, '#d9d2e6');
  box(9.0, 0.95, 0.14, 0.45, 0.55, 0.38, '#2a2d38');
  box(9.1, 1.28, 0.53, 0.25, 0.1, 0.01, mat('#15131c'));
  mesh(new THREE.SphereGeometry(0.025, 8, 8), mat('#e85d75', { emissive: '#e85d75', emissiveIntensity: 2 }), 9.37, 1.4, 0.53);
  box(10.5, 0.95, 0.12, 0.62, 0.36, 0.44, '#d7dade');
  box(10.56, 1.0, 0.565, 0.4, 0.26, 0.01, '#3a3f4a');
  const cups = ['#e85d75', '#4ea8de', '#f2c14e'];
  cups.forEach((c, i) => mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.12, 16), mat(c), 9.7 + i * 0.2, 1.01, 0.42));
  const bowl = mesh(new THREE.SphereGeometry(0.2, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), mat('#eef0f3'), 11.4, 1.15, 0.38);
  bowl.rotation.x = Math.PI;
  [['#e85d75', -0.06], ['#f2c14e', 0.05], ['#6bbf59', 0]].forEach(([c, dx], i) =>
    mesh(new THREE.SphereGeometry(0.07, 14, 10), mat(c), 11.4 + dx, 1.02 + (i === 2 ? 0.08 : 0), 0.38 + (i === 2 ? 0.03 : 0)));
}

function buildCooler() {
  box(1.5, 0, 0.22, 0.42, 0.95, 0.42, '#d7dade');
  box(1.58, 0.62, 0.64, 0.26, 0.14, 0.01, '#3a3f4a');
  const bottle = mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.55, 24),
    new THREE.MeshStandardMaterial({ color: '#8cc8ff', transparent: true, opacity: 0.6, roughness: 0.1 }), 1.71, 1.24, 0.43);
  bottle.castShadow = false;
}

function buildSofa() {
  const x = 0.14, z = 3.6, len = 1.8;
  box(x, 0, z, 0.8, 0.38, len, '#4a6aa0');
  box(x, 0.38, z + 0.14, 0.72, 0.14, len - 0.28, '#6b8fcf');
  box(x, 0.38, z, 0.26, 0.62, len, '#5c80bc');
  box(x, 0.38, z, 0.8, 0.28, 0.14, '#4a6aa0');
  box(x, 0.38, z + len - 0.14, 0.8, 0.28, 0.14, '#4a6aa0');
  const pillow = box(x + 0.28, 0.5, z + 0.3, 0.14, 0.34, 0.4, '#f2c14e');
  pillow.rotation.z = -0.25;
  // mesita
  mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 28), mat('#7a5436'), 1.35, 0.42, 4.5);
  mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.4, 12), mat('#4a3122'), 1.35, 0.2, 4.5);
}

function buildPlant(x, z, s) {
  mesh(new THREE.CylinderGeometry(0.2 * s, 0.15 * s, 0.4 * s, 18), mat('#b06a3a'), x, 0.2 * s, z);
  mesh(new THREE.CylinderGeometry(0.18 * s, 0.18 * s, 0.03, 18), mat('#3b2418'), x, 0.39 * s, z);
  const leaf = [mat('#4e8d4a'), mat('#5fa85a'), mat('#447a40')];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + rnd(i + x) * 0.5;
    const r = (i === 6 ? 0 : 0.14) * s;
    const m = mesh(new THREE.SphereGeometry(0.16 * s, 12, 10), leaf[i % 3], x + Math.cos(a) * r, (0.62 + (i === 6 ? 0.2 : rnd(i) * 0.12)) * s, z + Math.sin(a) * r);
    m.scale.set(0.8, 1.35, 0.8);
    m.rotation.z = Math.cos(a) * 0.4;
    m.rotation.x = Math.sin(a) * 0.4;
  }
}

// Mesa holográfica: un punto por miembro que brilla cuando trabaja.
const holo = { dots: [], beam: null, ring: null };
function buildHolo() {
  mesh(new THREE.CylinderGeometry(0.5, 0.58, 0.45, 32), mat('#2a2d38', { metalness: 0.5, roughness: 0.4 }), HOLO.x, 0.225, HOLO.z);
  holo.ring = mesh(new THREE.TorusGeometry(0.42, 0.025, 8, 48), mat('#5ac8ff', { emissive: '#5ac8ff', emissiveIntensity: 2.5 }), HOLO.x, 0.46, HOLO.z);
  holo.ring.rotation.x = Math.PI / 2;
  holo.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.42, 1.1, 32, 1, true),
    new THREE.MeshBasicMaterial({ color: '#5ac8ff', transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  holo.beam.position.set(HOLO.x, 1.02, HOLO.z);
  scene.add(holo.beam);
  const light = new THREE.PointLight('#5ac8ff', 1.2, 3.5, 2);
  light.position.set(HOLO.x, 1.2, HOLO.z);
  scene.add(light);
}

// ---- Puestos de trabajo ---------------------------------------------------------

function roundedRug(color) {
  return canvasTex(256, 256, (g, W, H) => {
    const rr = (x, y, w, h, r, c) => { g.fillStyle = c; g.beginPath(); g.roundRect(x, y, w, h, r); g.fill(); };
    rr(0, 0, W, H, 30, color);
    rr(14, 14, W - 28, H - 28, 22, shadeHex(color, 1.3));
    rr(28, 28, W - 56, H - 56, 16, color);
  });
}

function buildStation(d) {
  const { cx, cz } = d.slot;
  const g = new THREE.Group();
  g.userData.id = d.id;
  // alfombra
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.1), new THREE.MeshStandardMaterial({ map: roundedRug(d.rug), roughness: 1 }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(cx, 0.006, cz - 0.4);
  rug.receiveShadow = true;
  g.add(rug);
  d.rugMesh = rug;
  // anillo de destino / señalado (en el suelo, bajo la silla)
  d.ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.035, 8, 48),
    new THREE.MeshBasicMaterial({ color: TARGET_COLOR, transparent: true, opacity: 0.9 }));
  d.ring.rotation.x = -Math.PI / 2;
  d.ring.position.set(d.slot.seatX, 0.02, d.slot.seatZ);
  d.ring.visible = false;
  g.add(d.ring);

  // mesa
  const top = 0.75;
  box(cx - 0.8, top - 0.06, cz - 0.35, 1.6, 0.06, 0.7, '#9a6e49', g);
  box(cx - 0.76, 0, cz + 0.26, 1.52, top - 0.06, 0.05, '#5d3f2d', g);
  box(cx - 0.8, 0, cz - 0.33, 0.05, top - 0.06, 0.62, '#5d3f2d', g);
  box(cx + 0.75, 0, cz - 0.33, 0.05, top - 0.06, 0.62, '#5d3f2d', g);

  // portátil: la pantalla mira al agente; nosotros vemos el dorso con su logo
  const lx = cx - 0.05, lz = cz - 0.12;
  box(lx - 0.27, top, lz - 0.18, 0.54, 0.025, 0.36, '#c7ccd4', g);
  box(lx - 0.23, top + 0.026, lz - 0.14, 0.46, 0.004, 0.18, '#6b717c', g);
  const lid = new THREE.Group();
  lid.position.set(lx, top + 0.025, lz + 0.18);
  lid.rotation.x = -0.28;
  box(-0.27, 0, -0.02, 0.54, 0.34, 0.02, '#3a3f4a', lid);
  d.screen = box(-0.24, 0.03, -0.021, 0.48, 0.28, 0.002, mat('#11141b', { emissive: '#000000' }), lid);
  d.screen.material = new THREE.MeshStandardMaterial({ color: '#11141b', emissive: '#000000', roughness: 0.4 });
  d.logo = mesh(new THREE.CircleGeometry(0.035, 20), new THREE.MeshStandardMaterial({ color: '#5a606b', emissive: '#000000' }), 0, 0.17, 0.0015, lid);
  g.add(lid);
  d.glow = new THREE.PointLight('#7ee08a', 0, 2.2, 2);
  d.glow.position.set(lx, top + 0.35, lz - 0.2);
  g.add(d.glow);

  if (d.hasMug) {
    mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.12, 16), mat('#d65b5b'), cx - 0.6, top + 0.06, cz + 0.1, g);
    const h = mesh(new THREE.TorusGeometry(0.035, 0.012, 8, 16), mat('#d65b5b'), cx - 0.54, top + 0.07, cz + 0.1, g);
    h.rotation.y = Math.PI / 2;
    d.mugTop = new THREE.Vector3(cx - 0.6, top + 0.14, cz + 0.1);
  }
  if (d.hasLamp) {
    mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.03, 16), mat('#2a2d38'), cx + 0.55, top + 0.015, cz - 0.15, g);
    const arm = mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.45, 8), mat('#2a2d38'), cx + 0.55, top + 0.24, cz - 0.1, g);
    arm.rotation.x = 0.25;
    const head = mesh(new THREE.ConeGeometry(0.1, 0.14, 16, 1, true), mat('#f2c14e', { side: THREE.DoubleSide, emissive: '#f2c14e', emissiveIntensity: 0.3 }), cx + 0.55, top + 0.46, cz + 0.0, g);
    head.rotation.x = 0.6;
    d.lampHead = head;
    d.lampLight = new THREE.PointLight('#ffc878', 0, 3, 2);
    d.lampLight.position.set(cx + 0.55, top + 0.35, cz + 0.05);
    g.add(d.lampLight);
  } else {
    box(cx + 0.35, top, cz - 0.05, 0.3, 0.04, 0.22, '#fbf7ef', g);
  }
  if (d.hasPlant) {
    mesh(new THREE.CylinderGeometry(0.07, 0.055, 0.12, 12), mat('#b06a3a'), cx + 0.62, top + 0.06, cz + 0.18, g);
    const p = mesh(new THREE.SphereGeometry(0.1, 12, 10), mat('#5fa85a'), cx + 0.62, top + 0.2, cz + 0.18, g);
    p.scale.y = 1.3;
  }

  // silla
  const ch = new THREE.Group();
  ch.position.set(d.slot.seatX, 0, d.slot.seatZ);
  mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.04, 5), mat('#1c1f29'), 0, 0.05, 0, ch);
  mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.34, 8), mat('#262b38'), 0, 0.24, 0, ch);
  mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.44, 8), mat('#262b38'), 0, 0.28, 0, ch);
  box(-0.26, 0.48, -0.26, 0.52, 0.08, 0.52, '#3c435c', ch);
  box(-0.26, 0.54, -0.34, 0.52, 0.62, 0.08, '#2c3142', ch);
  g.add(ch);

  g.traverse((o) => { if (o.isMesh) o.userData.id = d.id; });
  scene.add(g);
  d.station = g;
}

// ---- Personajes chibi 3D --------------------------------------------------------

function makeCharacter(d) {
  const root = new THREE.Group();
  const body = new THREE.Group(); // lo que se mece al andar/respirar
  root.add(body);
  const skin = mat(d.style === 'robot' ? '#aab3bd' : d.skin, d.style === 'robot' ? { metalness: 0.55, roughness: 0.35 } : { roughness: 0.65 });
  const shirt = mat(d.shirt, { roughness: 0.75 });
  const pants = mat(d.pants);

  // piernas (pivotan en la cadera)
  const legGeo = new THREE.CapsuleGeometry(0.065, 0.14, 4, 10);
  const mkLeg = (x) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.26, 0);
    const leg = mesh(legGeo, pants, 0, -0.11, 0, pivot);
    const shoe = mesh(new THREE.BoxGeometry(0.11, 0.06, 0.16), mat(d.style === 'robot' ? '#3a3f4a' : '#1c1f2e'), 0, -0.22, 0.025, pivot);
    body.add(pivot);
    return { pivot, leg, shoe };
  };
  const legL = mkLeg(-0.08), legR = mkLeg(0.08);

  // torso
  let torso;
  if (d.style === 'robot') {
    torso = mesh(new THREE.BoxGeometry(0.34, 0.32, 0.24), mat('#7c8591', { metalness: 0.5, roughness: 0.4 }), 0, 0.42, 0, body);
    mesh(new THREE.BoxGeometry(0.16, 0.08, 0.01), mat('#2a2d38'), 0, 0.45, 0.125, body);
    d.chestLeds = [0, 1].map((i) => mesh(new THREE.BoxGeometry(0.035, 0.035, 0.012), new THREE.MeshStandardMaterial({ color: d.accent, emissive: d.accent, emissiveIntensity: 1.5 }), -0.035 + i * 0.07, 0.45, 0.128, body));
  } else {
    torso = mesh(new THREE.CapsuleGeometry(0.155, 0.12, 6, 14), shirt, 0, 0.43, 0, body);
    torso.scale.set(1.05, 1, 0.8);
    if (d.acc === 'earpiece') { // traje: camisa y corbata
      mesh(new THREE.BoxGeometry(0.09, 0.14, 0.01), mat('#eef0f3'), 0, 0.5, 0.125, body);
      mesh(new THREE.BoxGeometry(0.035, 0.15, 0.012), mat(d.accent), 0, 0.47, 0.132, body);
    } else if (d.acc === 'glasses') {
      mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.01, 6), mat(d.accent, { emissive: d.accent, emissiveIntensity: 0.4 }), 0.06, 0.47, 0.128, body).rotation.x = Math.PI / 2;
    } else if (d.acc === 'visor') {
      mesh(new THREE.BoxGeometry(0.3, 0.02, 0.01), mat(d.accent, { emissive: d.accent, emissiveIntensity: 1.2 }), 0, 0.4, 0.127, body);
    }
  }

  // brazos (pivotan en el hombro)
  const armGeo = new THREE.CapsuleGeometry(0.05, 0.15, 4, 10);
  const mkArm = (x) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.53, 0);
    mesh(armGeo, d.style === 'robot' ? mat('#7c8591', { metalness: 0.5, roughness: 0.4 }) : shirt, 0, -0.1, 0, pivot);
    mesh(new THREE.SphereGeometry(0.05, 12, 10), skin, 0, -0.2, 0, pivot);
    body.add(pivot);
    return pivot;
  };
  const armL = mkArm(-0.21), armR = mkArm(0.21);

  // cabeza grande
  const head = new THREE.Group();
  head.position.set(0, 0.82, 0);
  body.add(head);
  const parts = { root, body, head, legL, legR, armL, armR };
  if (d.style === 'robot') buildRobotHead(d, head, parts);
  else buildHumanHead(d, head, skin, parts);

  // chibis algo más grandes que los muebles, para que se les vea bien la cara
  root.scale.setScalar(CHAR_SCALE);
  root.traverse((o) => { if (o.isMesh) { o.userData.id = d.id; o.castShadow = true; } });
  scene.add(root);
  return parts;
}

function buildHumanHead(d, head, skin, parts) {
  const skull = mesh(new THREE.SphereGeometry(0.27, 28, 22), skin, 0, 0, 0, head);
  skull.scale.set(1.06, 0.96, 1);
  // orejas
  for (const s of [-1, 1]) mesh(new THREE.SphereGeometry(0.055, 12, 10), skin, s * 0.28, -0.02, 0, head);
  // ojos grandes con brillo
  const eyeMat = mat('#16131c', { roughness: 0.3 });
  const white = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  parts.eyes = [];
  if (d.style !== 'visor') {
    for (const s of [-1, 1]) {
      const eye = new THREE.Group();
      eye.position.set(s * 0.095, -0.01, 0.235);
      const e = mesh(new THREE.SphereGeometry(0.052, 16, 12), eyeMat, 0, 0, 0, eye);
      e.scale.set(0.85, 1.1, 0.5);
      mesh(new THREE.SphereGeometry(0.017, 8, 8), white, -0.012, 0.022, 0.024, eye);
      head.add(eye);
      parts.eyes.push(eye);
    }
  }
  // mofletes
  for (const s of [-1, 1]) {
    const c = mesh(new THREE.CircleGeometry(0.035, 16), new THREE.MeshBasicMaterial({ color: '#e87878', transparent: true, opacity: 0.45 }), s * 0.16, -0.08, 0.228, head);
    c.rotation.y = s * 0.55;
    c.castShadow = false;
  }
  // boca
  parts.mouth = mesh(new THREE.BoxGeometry(0.06, 0.018, 0.02), mat('#7a2e2e'), 0, -0.11, 0.245, head);

  // pelo
  const hair = mat(d.hair, { roughness: 0.6 });
  const cap = mesh(new THREE.SphereGeometry(0.285, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.5), hair, 0, 0.02, -0.01, head);
  cap.scale.set(1.08, 1.02, 1.06);
  const back = mesh(new THREE.SphereGeometry(0.285, 24, 14, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.28), hair, 0, 0.02, -0.03, head);
  back.scale.set(1.06, 1, 1.02);
  back.rotation.x = -0.35;
  const fringe = mesh(new THREE.BoxGeometry(0.4, 0.07, 0.08), hair, 0, 0.15, 0.2, head);
  fringe.rotation.x = 0.35;
  if (d.hairStyle === 1) { // de punta (KITT)
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const sp = mesh(new THREE.ConeGeometry(0.07, 0.2, 8), hair, Math.cos(a) * 0.14, 0.27, Math.sin(a) * 0.12 - 0.02, head);
      sp.rotation.z = -Math.cos(a) * 0.5;
      sp.rotation.x = Math.sin(a) * 0.5;
    }
  } else if (d.hairStyle === 2) { // melena (FRIDAY)
    const mane = mesh(new THREE.CapsuleGeometry(0.22, 0.3, 6, 14), hair, 0, -0.2, -0.12, head);
    mane.scale.set(1.25, 1, 0.7);
    for (const s of [-1, 1]) mesh(new THREE.CapsuleGeometry(0.06, 0.28, 4, 10), hair, s * 0.25, -0.15, 0.05, head);
  } else if (d.hairStyle === 3) { // moño (EDITH)
    mesh(new THREE.SphereGeometry(0.11, 16, 12), hair, 0, 0.3, -0.12, head);
  } else { // peinado hacia atrás (JARVIS)
    const tuft = mesh(new THREE.SphereGeometry(0.12, 14, 10), hair, 0.06, 0.24, 0.08, head);
    tuft.scale.set(1.6, 0.5, 1);
  }

  if (d.acc === 'headband') {
    const band = mesh(new THREE.TorusGeometry(0.29, 0.025, 8, 36), mat(d.accent), 0, 0.12, 0, head);
    band.rotation.x = Math.PI / 2 - 0.35;
  } else if (d.acc === 'glasses') {
    const frame = mat('#1a1a1a', { roughness: 0.3 });
    for (const s of [-1, 1]) mesh(new THREE.TorusGeometry(0.066, 0.011, 8, 24), frame, s * 0.095, -0.01, 0.262, head);
    mesh(new THREE.BoxGeometry(0.06, 0.012, 0.012), frame, 0, 0.0, 0.265, head);
  } else if (d.acc === 'earpiece') {
    mesh(new THREE.BoxGeometry(0.04, 0.08, 0.05), mat('#2a2d38'), 0.3, -0.02, 0.03, head);
    parts.earLed = mesh(new THREE.SphereGeometry(0.014, 8, 8), new THREE.MeshStandardMaterial({ color: d.accent, emissive: d.accent, emissiveIntensity: 2 }), 0.325, 0.01, 0.05, head);
  } else if (d.acc === 'visor') {
    // visor negro con el escáner rojo que barre de lado a lado
    const visor = mesh(new THREE.SphereGeometry(0.278, 28, 8, -Math.PI * 0.38, Math.PI * 0.76, Math.PI * 0.44, Math.PI * 0.14), mat('#111016', { roughness: 0.2, metalness: 0.4 }), 0, 0, 0, head);
    visor.rotation.y = 0;
    parts.scanner = mesh(new THREE.BoxGeometry(0.07, 0.035, 0.02), new THREE.MeshBasicMaterial({ color: d.accent }), 0, -0.005, 0.27, head);
    parts.scannerGlow = new THREE.PointLight(d.accent, 0.4, 0.8, 2);
    parts.scannerGlow.position.set(0, 0, 0.35);
    head.add(parts.scannerGlow);
  }
}

function buildRobotHead(d, head, parts) {
  const metal = mat('#aab3bd', { metalness: 0.6, roughness: 0.3 });
  const skull = mesh(new THREE.BoxGeometry(0.5, 0.44, 0.44), metal, 0, 0, 0, head);
  skull.scale.set(1, 1, 1);
  for (const s of [-1, 1]) {
    const bolt = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 12), mat('#5c6570', { metalness: 0.6 }), s * 0.27, 0, 0, head);
    bolt.rotation.z = Math.PI / 2;
  }
  mesh(new THREE.BoxGeometry(0.4, 0.28, 0.01), mat('#15131c', { roughness: 0.2 }), 0, -0.01, 0.222, head);
  const led = new THREE.MeshBasicMaterial({ color: d.accent });
  parts.eyes = [-1, 1].map((s) => {
    const e = new THREE.Group();
    e.position.set(s * 0.09, 0.03, 0.228);
    mesh(new THREE.BoxGeometry(0.07, 0.07, 0.005), led, 0, 0, 0, e);
    head.add(e);
    return e;
  });
  parts.mouthLeds = [0, 1, 2, 3, 4].map((i) => mesh(new THREE.BoxGeometry(0.03, 0.02, 0.005), led, -0.08 + i * 0.04, -0.08, 0.228, head));
  mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 8), mat('#5c6570'), 0, 0.3, 0, head);
  parts.antenna = mesh(new THREE.SphereGeometry(0.035, 12, 10), new THREE.MeshStandardMaterial({ color: '#e85d75', emissive: '#e85d75', emissiveIntensity: 2 }), 0, 0.39, 0, head);
}

// ---- Estado del equipo (desde main.js) --------------------------------------------

const display = new Map();
let agentCount = 0;
let serverNow = Date.now();
let clientStamp = performance.now();

function lookFor(id) {
  const P = (arr, k) => arr[Math.abs(hash(id + k)) % arr.length];
  return {
    shirt: P(['#e85d75', '#4ea8de', '#f4a259', '#6bbf59', '#b56bd6', '#3fc1c9'], ''),
    hair: P(['#2b2b2b', '#5a3825', '#8a5a2b', '#c9a227'], 'h'),
    skin: P(['#f1c9a5', '#e0ac86', '#c68642', '#8d5524'], 's'),
    pants: P(['#2c3350', '#3a3a44', '#2f4a5c'], 'p'),
    accent: '#7ee08a', hairStyle: Math.abs(hash(id + 'hs')) % 4, style: 'human',
  };
}

function pathTo(slot) {
  const ax = Math.min(slot.cx + 1.35, GW - 0.3);
  return [
    { x: 0.9, z: DOOR.z }, { x: 0.9, z: FRONT_Z }, { x: ax, z: FRONT_Z },
    { x: ax, z: slot.seatZ }, { x: slot.seatX, z: slot.seatZ },
  ];
}

function syncAgents(payload) {
  serverNow = payload.now;
  clientStamp = performance.now();
  const incoming = payload.agents.slice(0, SLOTS.length);
  agentCount = payload.agents.length;
  incoming.forEach((a, i) => {
    let d = display.get(a.id);
    if (!d) {
      const slot = SLOTS[i];
      d = Object.assign({
        id: a.id, slot, x: DOOR.x, z: DOOR.z, path: pathTo(slot), arrived: false,
        startAt: performance.now() + 500 + i * 1100, heading: Math.PI / 2,
        phase: Math.abs(hash(a.id)) % 1000,
        rug: ['#2f4a4a', '#43394f', '#3a4a2f', '#4a3a2f', '#2f3a4a'][i % 5],
        hasMug: Math.abs(hash(a.id + 'm')) % 2 === 0,
        hasLamp: Math.abs(hash(a.id + 'l')) % 2 === 0,
        hasPlant: Math.abs(hash(a.id + 'p')) % 3 === 0,
        emitAt: 0,
      }, a.look || lookFor(a.id));
      display.set(a.id, d);
      buildStation(d);
      d.parts = makeCharacter(d);
      d.parts.root.visible = false;
      d.el = makeBubble(d);
    }
    Object.assign(d, { name: a.name || a.project, role: a.role || '', state: a.state, emoji: a.emoji, label: a.label, busy: !!a.busy, lastTime: a.lastTime });
  });
}
if (window.office) window.office.onAgents(syncAgents);

function now() { return serverNow + (performance.now() - clientStamp); }
function isTarget(d) { const s = window.PIXEL_TARGET_SESSIONS; return !!(s instanceof Set && s.has(d.id)); }
function isSpeaking(d) { return window.PIXEL_SPEAKING_SESSION === d.id; }

// ---- Capa HTML: cabecera, bocadillos y partículas ------------------------------

const header = document.createElement('div');
header.className = 'o3-header';
header.innerHTML = '<span class="o3-logo">🏢</span><b>Pixel Office</b><span class="o3-pill" id="o3team"></span>' +
  '<span class="o3-pill" id="o3busy"></span><span class="o3-pill o3-speak" id="o3speak" hidden></span>' +
  '<span class="o3-grow"></span><span class="o3-tip">arrastra para girar · rueda para acercar · clic en un personaje para hablarle</span>' +
  '<span class="o3-clock" id="o3clock"></span>';
overlay.appendChild(header);

function makeBubble(d) {
  const el = document.createElement('div');
  el.className = 'o3-bubble';
  el.innerHTML = '<div class="o3-name"><i></i><span></span></div><div class="o3-label"><em></em><span></span></div>';
  el.addEventListener('click', (e) => pick(d.id, e));
  overlay.appendChild(el);
  const arrow = document.createElement('div');
  arrow.className = 'o3-arrow';
  overlay.appendChild(arrow);
  d.arrowEl = arrow;
  return el;
}

const tmpV = new THREE.Vector3();
function toScreen(x, y, z) {
  tmpV.set(x, y, z).project(camera);
  return { x: (tmpV.x + 1) / 2 * wrap.clientWidth, y: (1 - tmpV.y) / 2 * wrap.clientHeight, behind: tmpV.z > 1 };
}

function headWorld(d) {
  const h = (d.arrived ? 1.4 : 1.12) * CHAR_SCALE;
  return new THREE.Vector3(d.x, h, d.z);
}

function updateOverlay() {
  const all = [...display.values()];
  const busy = all.filter((d) => d.busy).length;
  header.querySelector('#o3team').textContent = `equipo: ${agentCount} IAs`;
  const b = header.querySelector('#o3busy');
  b.textContent = busy ? `${busy} trabajando` : 'todos disponibles';
  b.classList.toggle('busy', busy > 0);
  const sp = all.find(isSpeaking);
  const spEl = header.querySelector('#o3speak');
  spEl.hidden = !sp;
  if (sp) spEl.textContent = `🔊 ${sp.name}`;
  const dt = new Date(now());
  header.querySelector('#o3clock').textContent = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;

  for (const d of all) {
    const visible = d.parts.root.visible && d.arrived;
    const el = d.el;
    el.style.display = visible ? '' : 'none';
    d.arrowEl.style.display = visible && isTarget(d) ? '' : 'none';
    if (!visible) continue;
    const p = toScreen(d.x, headWorld(d).y + 0.12, d.z);
    const speaking = isSpeaking(d);
    const tg = isTarget(d);
    el.classList.toggle('target', tg);
    el.classList.toggle('speaking', speaking);
    el.style.setProperty('--accent', speaking || tg ? TARGET_COLOR : (STATE_COLOR[d.state] || '#9aa0a6'));
    el.querySelector('.o3-name i').style.background = STATE_COLOR[d.state] || '#9aa0a6';
    el.querySelector('.o3-name span').textContent = d.name;
    el.querySelector('.o3-label em').textContent = speaking ? '🔊' : d.emoji || '';
    el.querySelector('.o3-label span').textContent = speaking ? 'hablando…' : d.label || '';
    el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -100%)`;
    el.style.zIndex = String(1000 + Math.round(p.y));
    if (tg) d.arrowEl.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y - el.offsetHeight - 16 + Math.sin(performance.now() / 200) * 3)}px) translate(-50%, 0)`;
  }
}

// Partículas: glifos flotantes en HTML (código, engranajes, ideas, zzz…).
const particles = [];
function emitAt(world, text, color, opts) {
  if (particles.length > 60) return;
  const el = document.createElement('span');
  el.className = 'o3-particle';
  el.textContent = text;
  if (color) el.style.color = color;
  overlay.appendChild(el);
  particles.push(Object.assign({ el, w: world.clone(), vy: 0.00035, vx: (Math.random() - 0.5) * 0.0002, life: 0, max: 1500 }, opts || {}));
}
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life += dt;
    if (p.life >= p.max) { p.el.remove(); particles.splice(i, 1); continue; }
    p.w.y += p.vy * dt;
    p.w.x += p.vx * dt;
    const s = toScreen(p.w.x, p.w.y, p.w.z);
    const k = p.life / p.max;
    p.el.style.opacity = String(k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85);
    p.el.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px) translate(-50%, -50%)`;
  }
}
function emitters(t) {
  for (const d of display.values()) {
    if (!d.arrived || t < d.emitAt) continue;
    const lap = new THREE.Vector3(d.slot.cx - 0.05, 1.25, d.slot.cz - 0.05);
    if (/^capacit/.test(d.label || '')) {
      emitAt(headWorld(d).add(new THREE.Vector3((Math.random() - 0.5) * 0.5, 0.3, 0)), ['📚', '🎓', '💡'][Math.floor(Math.random() * 3)], null, { max: 1800 });
      d.emitAt = t + 700 + Math.random() * 500;
    } else if (d.state === 'coding' || d.state === 'working') {
      emitAt(lap.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0, 0)), ['{ }', '</>', ';', '=>', '()', '01'][Math.floor(Math.random() * 6)], '#7ee08a');
      d.emitAt = t + 500 + Math.random() * 500;
    } else if (d.state === 'thinking') {
      emitAt(headWorld(d).add(new THREE.Vector3(0.25, 0.2, 0)), Math.random() < 0.5 ? '?' : '…', '#d9b8f0', { max: 1600 });
      d.emitAt = t + 900 + Math.random() * 500;
    } else if (d.state === 'running') {
      emitAt(lap.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0, 0)), '⚙', '#f2c14e');
      d.emitAt = t + 600 + Math.random() * 500;
    } else if (d.state === 'web') {
      emitAt(lap, '•', '#7aa2dd', { vx: (Math.random() - 0.5) * 0.0005 });
      d.emitAt = t + 350;
    } else if (d.state === 'waiting') {
      emitAt(headWorld(d).add(new THREE.Vector3(0, 0.3, 0)), '!', '#e85d75');
      d.emitAt = t + 1200;
    } else {
      d.emitAt = t + 800;
    }
    if (d.hasMug && Math.random() < 0.4) emitAt(d.mugTop, '•', 'rgba(233,228,240,0.6)', { vy: 0.00018, max: 1400, small: true });
  }
  if (Math.random() < 0.02) emitAt(new THREE.Vector3(coffeeSteamAt.x, coffeeSteamAt.y, coffeeSteamAt.z), '•', 'rgba(233,228,240,0.6)', { vy: 0.0002, max: 1600 });
}

// ---- Cielo y luz según la hora -------------------------------------------------

const SKY_KEYS = [
  { h: 0, top: '#070b1f', bot: '#1a2150', stars: 1 },
  { h: 5.5, top: '#070b1f', bot: '#1a2150', stars: 1 },
  { h: 7, top: '#f39c6b', bot: '#9ab4e0', stars: 0 },
  { h: 9, top: '#4b9be0', bot: '#bfe3ff', stars: 0 },
  { h: 17.5, top: '#4b9be0', bot: '#bfe3ff', stars: 0 },
  { h: 19.5, top: '#3a2a6b', bot: '#f08a5d', stars: 0.2 },
  { h: 21, top: '#070b1f', bot: '#1a2150', stars: 1 },
  { h: 24, top: '#070b1f', bot: '#1a2150', stars: 1 },
];
function skyInfo() {
  const dt = new Date(now());
  const h = typeof window.PIXEL_FORCE_HOUR === 'number' ? window.PIXEL_FORCE_HOUR : dt.getHours() + dt.getMinutes() / 60;
  let i = 0;
  while (i < SKY_KEYS.length - 2 && SKY_KEYS[i + 1].h <= h) i++;
  const a = SKY_KEYS[i], b = SKY_KEYS[i + 1];
  const f = b.h === a.h ? 0 : (h - a.h) / (b.h - a.h);
  return { top: mix(a.top, b.top, f), bot: mix(a.bot, b.bot, f), stars: a.stars + (b.stars - a.stars) * f };
}

function applyLighting(info) {
  const night = info.stars;
  const day = 1 - night;
  sun.intensity = 0.35 + 2.1 * day;
  sun.color.set(night > 0.5 ? '#9fb3ff' : mix('#fff1d6', '#ffb27a', Math.max(0, 1 - Math.abs(info.stars - 0.2) * 5) * 0.6));
  hemi.intensity = 0.55 + 0.4 * day;
  fill.intensity = 0.3 + 0.55 * day;
  hemi.color.set(mix('#dfe8ff', '#8f8ac0', night));
  for (const l of ceiling) l.intensity = 9 * night;
  scene.background.set(mix('#1a1426', '#0e0b18', night));
  renderer.toneMappingExposure = 1.05 - 0.05 * night;
  for (const d of display.values()) {
    if (d.lampLight) {
      d.lampLight.intensity = 1.6 * night;
      d.lampHead.material.emissiveIntensity = 0.3 + 1.6 * night;
    }
  }
}

// ---- Gato ------------------------------------------------------------------------

const CAT_XS = [1.05, 4.55, 8.1, 11.6];
const CAT_ZS = [1.35, 4.6, 7.7, FRONT_Z];
const cat = { x: 8.1, z: FRONT_Z, gx: 2, gz: 3, tx: 8.1, tz: FRONT_Z, mode: 'sit', until: 0, heading: 0 };
function buildCat() {
  const g = new THREE.Group();
  const fur = mat('#e0a458'), dark = mat('#b97a3a');
  const bodyM = mesh(new THREE.CapsuleGeometry(0.1, 0.22, 4, 10), fur, 0, 0.17, 0, g);
  bodyM.rotation.x = Math.PI / 2;
  const head = mesh(new THREE.SphereGeometry(0.1, 14, 12), fur, 0, 0.3, 0.2, g);
  for (const s of [-1, 1]) {
    const ear = mesh(new THREE.ConeGeometry(0.035, 0.07, 6), fur, s * 0.055, 0.4, 0.2, g);
    ear.rotation.z = -s * 0.2;
    mesh(new THREE.SphereGeometry(0.014, 8, 8), mat('#1a1a1a'), s * 0.04, 0.32, 0.29, g);
  }
  cat.legs = [[-0.06, 0.12], [0.06, 0.12], [-0.06, -0.12], [0.06, -0.12]].map(([x, z]) => mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.12, 8), dark, x, 0.06, z, g));
  cat.tail = new THREE.Group();
  cat.tail.position.set(0, 0.2, -0.2);
  const tail = mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.28, 8), fur, 0, 0.12, 0, cat.tail);
  tail.rotation.x = -0.4;
  g.add(cat.tail);
  cat.head = head;
  cat.group = g;
  g.traverse((o) => { if (o.isMesh) o.userData.cat = true; });
  scene.add(g);
}
function updateCat(t, dt) {
  if (cat.mode === 'walk') {
    const dx = cat.tx - cat.x, dz = cat.tz - cat.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.02) {
      cat.x = cat.tx; cat.z = cat.tz;
      const r = Math.random();
      cat.mode = r < 0.55 ? 'pause' : r < 0.85 ? 'sit' : 'sleep';
      cat.until = t + (cat.mode === 'sleep' ? 9000 + Math.random() * 9000 : cat.mode === 'sit' ? 1500 + Math.random() * 4000 : 0);
    } else {
      const sp = Math.min(0.0011 * dt, dist);
      cat.x += (dx / dist) * sp;
      cat.z += (dz / dist) * sp;
      cat.heading = Math.atan2(dx, dz);
    }
  }
  if (cat.mode !== 'walk' && t >= cat.until) {
    const moves = [];
    if (cat.gx > 0) moves.push([-1, 0]);
    if (cat.gx < CAT_XS.length - 1) moves.push([1, 0]);
    if (cat.gz > 0) moves.push([0, -1]);
    if (cat.gz < CAT_ZS.length - 1) moves.push([0, 1]);
    const [mx, mz] = moves[Math.floor(Math.random() * moves.length)];
    cat.gx += mx; cat.gz += mz;
    cat.tx = CAT_XS[cat.gx]; cat.tz = CAT_ZS[cat.gz];
    cat.mode = 'walk';
  }
  const g = cat.group;
  g.position.set(cat.x, 0, cat.z);
  g.rotation.y += (cat.heading - g.rotation.y) * 0.15;
  const walking = cat.mode === 'walk';
  cat.legs.forEach((l, i) => { l.rotation.x = walking ? Math.sin(t / 70 + i * Math.PI) * 0.5 : 0; });
  cat.tail.rotation.z = Math.sin(t / 300) * 0.5;
  const sleeping = cat.mode === 'sleep';
  g.scale.y = sleeping ? 0.6 : cat.mode === 'sit' ? 1.1 : 1;
  cat.head.position.y = sleeping ? 0.18 : 0.3;
}

// ---- Animación de los personajes --------------------------------------------------

function updateCharacter(d, t, dt) {
  const P = d.parts;
  if (!d.arrived) {
    if (t < d.startAt) { P.root.visible = false; return; }
    P.root.visible = true;
    let step = 0.0026 * dt;
    while (step > 0 && d.path.length) {
      const wp = d.path[0];
      const dx = wp.x - d.x, dz = wp.z - d.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.001) d.heading = Math.atan2(dx, dz);
      if (dist <= step) { d.x = wp.x; d.z = wp.z; step -= dist; d.path.shift(); }
      else { d.x += (dx / dist) * step; d.z += (dz / dist) * step; step = 0; }
    }
    if (!d.path.length) d.arrived = true;
  }
  const walking = !d.arrived;
  const working = d.arrived && AT_WORK.has(d.state);
  // al sentarse mira hacia la mesa (+z)
  const wantHeading = walking ? d.heading : 0;
  let diff = wantHeading - P.root.rotation.y;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  P.root.rotation.y += diff * Math.min(1, dt * 0.012);
  P.root.position.set(d.x, 0, d.z);

  const swing = walking ? Math.sin(t / 110 + d.phase) : 0;
  if (walking) {
    P.body.position.y = Math.abs(Math.sin(t / 110 + d.phase)) * 0.04;
    P.legL.pivot.rotation.x = swing * 0.6;
    P.legR.pivot.rotation.x = -swing * 0.6;
    P.armL.rotation.x = -swing * 0.6;
    P.armR.rotation.x = swing * 0.6;
  } else {
    // sentado: cadera a la altura del asiento y piernas hacia delante
    // cadera (0,26 del modelo, escalado) a la altura del asiento (0,56)
    P.body.position.y = 0.56 / CHAR_SCALE - 0.26 + Math.sin(t / 700 + d.phase) * 0.006;
    P.legL.pivot.rotation.x = -Math.PI / 2 + 0.1;
    P.legR.pivot.rotation.x = -Math.PI / 2 + 0.1;
    const typing = working && (d.state === 'coding' || d.state === 'running' || d.state === 'working');
    const tap = typing ? Math.sin(t / 70 + d.phase) * 0.12 : 0;
    P.armL.rotation.x = -1.05 + tap;
    P.armR.rotation.x = -1.05 - tap;
  }
  // cabeza: asiente al trabajar, mira un poco a la cámara si le hablas
  P.head.rotation.x = working ? Math.sin(t / 900 + d.phase) * 0.06 + 0.08 : 0;
  P.head.rotation.y = isTarget(d) && d.arrived ? Math.sin(t / 1600) * 0.15 + 0.25 : 0;

  // parpadeo
  const blink = ((t + d.phase * 37) % 4300) < 130;
  if (P.eyes) for (const e of P.eyes) e.scale.y = blink ? 0.12 : 1;
  // boca al hablar
  const speaking = isSpeaking(d);
  if (P.mouth) P.mouth.scale.y = speaking ? 1 + Math.abs(Math.sin(t / 75)) * 3 : d.state === 'talking' ? 1.8 : 1;
  if (P.mouthLeds) P.mouthLeds.forEach((m, i) => { m.scale.y = speaking ? 1 + Math.abs(Math.sin(t / 80 + i)) * 2.5 : 1; });
  if (P.scanner) {
    const k = Math.sin(t / 260);
    P.scanner.position.x = k * 0.17;
    P.scannerGlow.position.x = k * 0.17;
  }
  if (P.earLed) P.earLed.material.emissiveIntensity = Math.floor(t / 500) % 2 ? 2.5 : 0.2;
  if (P.antenna) P.antenna.material.emissiveIntensity = Math.floor(t / 600) % 2 ? 2.5 : 0.3;

  // pantalla, logo y luz del portátil según el estado
  const on = working;
  const col = SCREEN_COLOR[d.state] || '#7ee08a';
  d.logo.material.emissive.set(on ? col : '#000000');
  d.logo.material.emissiveIntensity = on ? 1.5 + Math.sin(t / 300 + d.phase) * 0.5 : 0;
  d.screen.material.emissive.set(on ? col : '#000000');
  d.screen.material.emissiveIntensity = on ? 0.6 : 0;
  d.glow.color.set(col);
  d.glow.intensity = on ? 0.9 + Math.sin(t / 250 + d.phase) * 0.15 : 0;

  // anillo de destino / señalado
  const tg = isTarget(d);
  d.ring.visible = d.arrived && (tg || hoverId === d.id);
  d.ring.material.color.set(tg ? TARGET_COLOR : '#ffffff');
  d.ring.material.opacity = tg ? 0.65 + Math.sin(t / 260) * 0.3 : 0.5;
  d.ring.scale.setScalar(1 + (tg ? Math.sin(t / 260) * 0.05 : 0));
}

function updateHolo(t) {
  const ds = [...display.values()];
  if (holo.dots.length !== ds.length) {
    for (const m of holo.dots) scene.remove(m);
    holo.dots = ds.map((d) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 12), new THREE.MeshBasicMaterial({ color: d.accent || TARGET_COLOR, transparent: true }));
      scene.add(m);
      return m;
    });
  }
  ds.forEach((d, i) => {
    const a = t / 1400 + (i / ds.length) * Math.PI * 2;
    const m = holo.dots[i];
    m.position.set(HOLO.x + Math.cos(a) * 0.28, 1.05 + Math.sin(t / 700 + i) * 0.06, HOLO.z + Math.sin(a) * 0.28);
    m.material.opacity = d.busy ? 1 : 0.35;
    m.scale.setScalar(d.busy ? 1.3 + Math.sin(t / 200 + i) * 0.2 : 1);
  });
  holo.beam.material.opacity = 0.1 + Math.sin(t / 900) * 0.03;
  holo.ring.rotation.z = t / 2000;
}

// ---- Ratón: girar, acercar, señalar y elegir ------------------------------------

const ray = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let hoverId = null;
let drag = null;

function hitAt(e) {
  const r = canvas.getBoundingClientRect();
  mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const hits = ray.intersectObjects(scene.children, true);
  for (const h of hits) {
    if (h.object.userData.cat) return { cat: true };
    if (h.object.userData.id && display.has(h.object.userData.id)) return { id: h.object.userData.id };
  }
  return null;
}

function pick(id, e) {
  window.dispatchEvent(new CustomEvent('pixel:pick', { detail: { sessionId: id, additive: !!(e && (e.ctrlKey || e.shiftKey || e.metaKey)) } }));
}

canvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY, az: orbit.az, pol: orbit.pol, moved: false };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (drag.moved) {
      // límites: las paredes del fondo siempre quedan detrás
      orbit.az = Math.max(0.12, Math.min(Math.PI / 2 - 0.12, drag.az - dx * 0.006));
      orbit.pol = Math.max(0.55, Math.min(1.25, drag.pol - dy * 0.004));
      placeCamera();
      canvas.style.cursor = 'grabbing';
      return;
    }
  }
  const h = hitAt(e);
  hoverId = h && h.id ? h.id : null;
  canvas.style.cursor = h ? 'pointer' : 'grab';
});
canvas.addEventListener('pointerup', (e) => {
  const d = drag;
  drag = null;
  canvas.style.cursor = 'grab';
  if (d && d.moved) return;
  const h = hitAt(e);
  if (!h) return;
  if (h.cat) {
    for (let i = 0; i < 3; i++) emitAt(new THREE.Vector3(cat.x + (Math.random() - 0.5) * 0.3, 0.55, cat.z), '❤️', null, { vy: 0.0005, max: 1300 });
    if (cat.mode === 'sleep') cat.until = 0;
    return;
  }
  pick(h.id, e);
});
canvas.addEventListener('pointerleave', () => { hoverId = null; });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  orbit.dist = Math.max(11, Math.min(34, orbit.dist * (1 + Math.sign(e.deltaY) * 0.08)));
  placeCamera();
}, { passive: false });
canvas.addEventListener('dblclick', () => { Object.assign(orbit, ORBIT_HOME); placeCamera(); });
canvas.style.cursor = 'grab';

// Para pruebas: posición en pantalla (px del cliente) de la cabeza de un miembro.
window.PixelOffice = Object.assign(window.PixelOffice || {}, {
  lookFor,
  screenPos(id) {
    const d = display.get(id);
    if (!d) return null;
    const r = canvas.getBoundingClientRect();
    const p = toScreen(d.x, (d.arrived ? 1.1 : 0.8) * CHAR_SCALE, d.z);
    return { x: r.left + p.x, y: r.top + p.y };
  },
  mode: '3d',
  // Sienta a todos en su sitio sin la animación de entrada.
  skipIntro() {
    for (const d of display.values()) {
      d.path = [];
      d.x = d.slot.seatX;
      d.z = d.slot.seatZ;
      d.arrived = true;
      d.parts.root.visible = true;
    }
  },
});

// ---- Bucle ---------------------------------------------------------------------------

buildRoom();
buildCat();
let lastT = 0;
let skyAt = 0;
function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min(50, lastT ? t - lastT : 16);
  lastT = t;
  const info = skyInfo();
  if (t - skyAt > 120) {
    skyAt = t;
    for (const s of skies) drawSky(s, t, info);
    applyLighting(info);
  }
  updateClock(new Date(now()));
  for (const d of display.values()) updateCharacter(d, t, dt);
  updateCat(t, dt);
  updateHolo(t);
  emitters(t);
  updateParticles(dt);
  renderer.render(scene, camera);
  updateOverlay();
}
requestAnimationFrame(frame);
console.log('OFFICE3D ok; three r' + THREE.REVISION);
