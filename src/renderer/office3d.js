// ---------------------------------------------------------------------------
// Pixel Office 3D - la oficina ciberpunk en 3D real con Three.js (WebGL).
// El equipo de 5 IAs son chibis 3D: trabajan en su mesa y, cuando no tienen
// nada que hacer, pasean por la oficina (café, agua, sofá, ventanas, el
// holograma o a curiosear lo que hace un compañero). Si les llega trabajo,
// vuelven corriendo a su sitio.
// - Mundo en metros ≈ baldosas: x hacia la derecha-abajo, z hacia la
//   izquierda-abajo, y hacia arriba. Paredes en x = 0 y z = 0.
// - Se mueven por una red de pasillos (NX × NZ) para no atravesar muebles.
// - Neones con resplandor (UnrealBloomPass) y luz según la hora real.
// - Arrastra para girar la cámara, rueda para acercar, doble clic para volver.
// - Clic en un personaje o en su mesa: evento 'pixel:pick' (Ctrl = marcar).
// - Lee de chat.js: PIXEL_TARGET_SESSIONS (destino) y PIXEL_SPEAKING_SESSION.
// - Nombres, bocadillos y partículas son HTML encima del canvas (#overlay).
// Si no hay WebGL, carga la versión 2.5D (renderer.js).
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const GW = 12;
const GH = 12;
const WALL_H = 3.2;
const DOOR = { x: 0.15, z: 10.6 };
const HOLO = { x: 6.6, z: 7.6 };

const NEON = { cyan: '#29f0ff', magenta: '#ff2bd6', purple: '#9b5cff', yellow: '#ffe14d', orange: '#ff8a3d', green: '#39ff9e' };
const STATE_COLOR = {
  idle: '#6b7280', prompt: '#f4a259', thinking: '#b56bd6', talking: '#4ea8de',
  reading: '#3fc1c9', coding: '#6bbf59', running: '#f2c14e', web: '#5c80bc',
  delegating: '#d65db1', working: '#9aa0a6', waiting: '#e85d75',
};
const SCREEN_COLOR = {
  running: '#ffe14d', web: '#7aa2ff', reading: '#29f0ff', thinking: '#c89bff', delegating: '#ff6bd6',
};
const AT_WORK = new Set(['reading', 'coding', 'running', 'web', 'working', 'thinking', 'delegating']);
const TARGET_COLOR = NEON.cyan;
const CHAR_SCALE = 1.3;

// ---- Red de pasillos ---------------------------------------------------------
// Nodos en los cruces de NX × NZ. Los personajes van de nodo en nodo; entre
// el nodo y su destino (silla, sofá, máquina…) hay un último tramo directo.
const NX = [1.3, 4.8, 8.4, 11.2];
const NZ = [1.3, 4.3, 7.4, 10.95];
const BLOCKED = new Set(['1,2|2,2']); // la mesa holográfica corta ese tramo

const SLOTS = [[6.6, 3.0], [3.2, 6.1], [10.0, 6.1], [3.2, 9.3], [10.0, 9.3]].map(([cx, cz]) => {
  const seatZ = cz - 0.78;
  // columna de pasillo más cercana que no pase por la mesa (empate: hacia el centro)
  let ei = 0;
  let best = Infinity;
  NX.forEach((x, i) => {
    const dist = Math.abs(x - cx);
    if (dist > 0.9 && (dist < best - 1e-6 || (Math.abs(dist - best) < 1e-6 && Math.abs(x - 6) < Math.abs(NX[ei] - 6)))) { best = dist; ei = i; }
  });
  let ej = 0;
  NZ.forEach((z, j) => { if (Math.abs(z - seatZ) < Math.abs(NZ[ej] - seatZ)) ej = j; });
  return { cx, cz, seatX: cx, seatZ, ei, ej };
});

// Sitios a los que van a pasear: nodo de acceso (i, j), posición, hacia dónde miran.
const SPOTS = [
  { id: 'cafe1', i: 2, j: 0, x: 9.25, z: 1.08, face: Math.PI, label: '☕ tomando café', anim: 'sip' },
  { id: 'cafe2', i: 2, j: 0, x: 9.9, z: 1.08, face: Math.PI, label: '☕ tomando café', anim: 'sip' },
  { id: 'agua', i: 0, j: 0, x: 1.72, z: 1.02, face: Math.PI, label: '💧 bebiendo agua', anim: 'sip' },
  { id: 'rack', i: 0, j: 0, x: 0.85, z: 2.85, face: -Math.PI / 2, label: '🖥️ revisando el servidor', anim: 'look' },
  { id: 'sofa', i: 0, j: 1, x: 0.64, z: 4.5, face: Math.PI / 2, label: '🛋️ descansando', anim: 'sit' },
  { id: 'ventanaL', i: 0, j: 2, x: 0.8, z: 6.95, face: -Math.PI / 2, label: '🌆 mirando la ciudad', anim: 'look' },
  { id: 'ventanaF', i: 1, j: 0, x: 5.5, z: 0.95, face: Math.PI, label: '🌆 mirando la ciudad', anim: 'look' },
  { id: 'holoA', i: 1, j: 2, x: 5.75, z: 7.6, face: Math.PI / 2, label: '🔮 consultando el holograma', anim: 'look' },
  { id: 'holoB', i: 2, j: 2, x: 7.45, z: 7.6, face: -Math.PI / 2, label: '🔮 consultando el holograma', anim: 'look' },
  { id: 'maquina', i: 3, j: 0, x: 11.3, z: 1.35, face: Math.PI, label: '🥤 en la máquina', anim: 'look' },
];

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
    mats.set(key, new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.7, metalness: 0.1 }, opts || {})));
  }
  return mats.get(key);
}
// Material de neón: color por encima de 1 para que el resplandor lo recoja.
// Todos "respiran" (pulso suave) y de vez en cuando alguno parpadea.
const NEON_GAIN = 0.75; // brillo general de los neones
const neonCache = new Map();
const neonAnims = [];
function neon(color, strength) {
  const key = color + '|' + (strength || 3);
  if (!neonCache.has(key)) {
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar((strength || 3) * NEON_GAIN), toneMapped: false });
    neonCache.set(key, m);
    neonAnims.push({ m, base: new THREE.Color(color), strength: (strength || 3) * NEON_GAIN, phase: Math.abs(hash(key)) % 628 / 100, flickUntil: 0 });
  }
  return neonCache.get(key);
}
function animateNeon(t) {
  for (const a of neonAnims) {
    if (!a.flickUntil && Math.random() < 0.0015) a.flickUntil = t + 60 + Math.random() * 180;
    let k = 0.8 + 0.2 * Math.sin(t / 1400 + a.phase);
    if (a.flickUntil) {
      if (t > a.flickUntil) a.flickUntil = 0;
      else k *= Math.floor(t / 45) % 2 ? 0.25 : 0.9; // parpadeo tipo tubo viejo
    }
    a.m.color.copy(a.base).multiplyScalar(a.strength * k);
  }
}

// Destellos que recorren las tiras de neón (de un extremo al otro, en bucle).
const chasers = [];
function chaser(axis, fixed, y, from, to, color, speed, offset) {
  const len = 0.6;
  const geo = axis === 'x' ? new THREE.BoxGeometry(len, 0.035, 0.035) : new THREE.BoxGeometry(0.035, 0.035, len);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(4 * NEON_GAIN), toneMapped: false, transparent: true }));
  scene.add(m);
  chasers.push({ m, axis, fixed, y, from, to, speed, offset });
}
function animateChasers(t) {
  for (const c of chasers) {
    const span = Math.abs(c.to - c.from);
    const k = ((t * c.speed + c.offset) % (span + 2)) - 1; // pasa fuera unos instantes
    const pos = c.from + Math.sign(c.to - c.from) * k;
    const visible = k >= 0 && k <= span;
    c.m.visible = visible;
    if (!visible) continue;
    if (c.axis === 'x') c.m.position.set(pos, c.y, c.fixed); else c.m.position.set(c.fixed, c.y, pos);
    c.m.material.opacity = Math.min(1, Math.min(k, span - k) * 2 + 0.2);
  }
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
// Tira de neón (sin sombra)
function strip(x0, y0, z0, w, h, d, color, strength, parent) {
  const m = box(x0, y0, z0, w, h, d, neon(color, strength), parent);
  m.castShadow = false;
  m.receiveShadow = false;
  return m;
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
// Panel luminoso con textura de lienzo (pantallas, carteles): brilla con el bloom.
function glowPanel(w, h, tex, strength, parent, opts) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial(Object.assign({
    map: tex, toneMapped: false, color: new THREE.Color(1, 1, 1).multiplyScalar(strength || 1.4),
  }, opts || {})));
  (parent || scene).add(m);
  return m;
}

// ---- Escena, cámara, renderer y resplandor ---------------------------------------

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
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
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#07060d');
scene.fog = new THREE.FogExp2('#0b0818', 0.008);

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

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.6, 0.5, 0.92);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function resize() {
  const w = wrap.clientWidth || 800;
  const h = wrap.clientHeight || 600;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  camera.aspect = w / h;
  // en ventanas estrechas nos alejamos un poco para que quepa la sala
  camera.fov = w / h < 1.1 ? 36 : 30;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(wrap);
resize();
placeCamera();

// Luces: ambiente frío, sol/luna con sombras, relleno y focos de neón de color.
const hemi = new THREE.HemisphereLight('#8fa0ff', '#2a1838', 0.7);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#ffd2b0', 1.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 50 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
sun.position.set(-4, 14, -2);
sun.target.position.set(6, 0, 6);
scene.add(sun, sun.target);
const fill = new THREE.DirectionalLight('#b9a7ff', 0.4);
fill.position.set(16, 8, 18);
scene.add(fill);
const neonLights = [
  [1.0, 2.6, 1.0, NEON.magenta, 6],
  [11.0, 2.6, 1.0, NEON.cyan, 6],
  [1.0, 2.2, 11.0, NEON.purple, 4],
  [6.0, 2.8, 5.5, NEON.cyan, 3],
].map(([x, y, z, c, i]) => {
  const l = new THREE.PointLight(c, i, 10, 1.6);
  l.position.set(x, y, z);
  scene.add(l);
  return l;
});
// Plafones (invisibles): de noche la oficina tiene la luz encendida.
const ceiling = [[3.5, 3.5], [8.5, 3.5], [3.5, 8.5], [8.5, 8.5]].map(([x, z]) => {
  const l = new THREE.PointLight('#c9b8ff', 0, 9, 1.4);
  l.position.set(x, 3.1, z);
  scene.add(l);
  return l;
});

// ---- Sala ciberpunk ----------------------------------------------------------------

const WALL = '#1b1d2e';
let floorGlow = null; // material del suelo (su rejilla late)

function buildRoom() {
  // suelo: placas metálicas oscuras con rejilla de neón
  const tile = (glow) => canvasTex(256, 256, (g, W, H) => {
    if (glow) {
      g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
      g.strokeStyle = '#ffffff'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, W - 3, H - 3);
      g.fillStyle = '#ffffff';
      for (const [x, y] of [[0, 0], [W, 0], [0, H], [W, H]]) { g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill(); }
      return;
    }
    g.fillStyle = '#15161f'; g.fillRect(0, 0, W, H);
    const gr = g.createLinearGradient(0, 0, W, H);
    gr.addColorStop(0, 'rgba(255,255,255,0.04)'); gr.addColorStop(1, 'rgba(0,0,0,0.12)');
    g.fillStyle = gr; g.fillRect(6, 6, W - 12, H - 12);
    g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 6; g.strokeRect(3, 3, W - 6, H - 6);
    g.fillStyle = 'rgba(255,255,255,0.05)';
    for (let i = 0; i < 6; i++) g.fillRect(40 + i * 30, 120, 16, 4); // rejilla de ventilación
  });
  const map = tile(false), em = tile(true);
  for (const t of [map, em]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(GW, GH); }
  em.colorSpace = THREE.NoColorSpace;
  const floorTop = new THREE.MeshStandardMaterial({ map, emissiveMap: em, emissive: NEON.cyan, emissiveIntensity: 0.18, roughness: 0.32, metalness: 0.55 });
  floorGlow = floorTop;
  const floorSide = mat('#0d0e16', { metalness: 0.4 });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(GW, 0.25, GH), [floorSide, floorSide, floorTop, floorSide, floorSide, floorSide]);
  floor.position.set(GW / 2, -0.125, GH / 2);
  floor.receiveShadow = true;
  scene.add(floor);
  // canto del suelo con neón
  strip(0, -0.05, GH, GW, 0.04, 0.04, NEON.cyan, 3);
  strip(GW, -0.05, 0, 0.04, 0.04, GH, NEON.magenta, 3);

  // paredes de hormigón oscuro con paneles
  const wallTex = canvasTex(512, 256, (g, W, H) => {
    g.fillStyle = WALL; g.fillRect(0, 0, W, H);
    for (let x = 0; x < W; x += 128) {
      g.fillStyle = 'rgba(255,255,255,0.03)'; g.fillRect(x + 4, 8, 120, H - 16);
      g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(x, 0, 3, H);
    }
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(255,255,255,${rnd(i) * 0.03})`; g.fillRect(rnd(i + 3) * W, rnd(i + 7) * H, 3, 3); }
  });
  wallTex.wrapS = THREE.RepeatWrapping;
  wallTex.repeat.set(GW / 3, 1);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.85, metalness: 0.15 });
  box(-0.2, 0, -0.2, 0.2, WALL_H, GH + 0.2, wallMat).castShadow = false;
  box(0, 0, -0.2, GW, WALL_H, 0.2, wallMat).castShadow = false;
  // zócalo metálico y tiras de neón (abajo cian, arriba magenta, esquina morada)
  box(0, 0, 0, 0.06, 0.18, GH, '#2a2d40', null, { metalness: 0.6, roughness: 0.4 }).castShadow = false;
  box(0, 0, 0, GW, 0.18, 0.06, '#2a2d40', null, { metalness: 0.6, roughness: 0.4 }).castShadow = false;
  strip(0.06, 0.16, 0, 0.02, 0.025, GH, NEON.cyan, 3.5);
  strip(0, 0.16, 0.06, GW, 0.025, 0.02, NEON.cyan, 3.5);
  strip(0.02, WALL_H - 0.14, 0, 0.03, 0.03, GH, NEON.magenta, 3.5);
  strip(0, WALL_H - 0.14, 0.02, GW, 0.03, 0.03, NEON.magenta, 3.5);
  strip(0.02, 0, 0.02, 0.04, WALL_H, 0.04, NEON.purple, 4);
  box(-0.2, WALL_H, -0.2, 0.2, 0.04, GH + 0.2, '#0e0f18').castShadow = false;
  box(-0.2, WALL_H, -0.2, GW + 0.2, 0.04, 0.2, '#0e0f18').castShadow = false;

  chaser('x', 0.07, 0.175, 0, GW, '#c8fdff', 0.0022, 0);
  chaser('x', 0.07, 0.175, 0, GW, '#c8fdff', 0.0022, 7);
  chaser('z', 0.07, 0.175, GH, 0, '#c8fdff', 0.0022, 3);
  chaser('x', 0.035, WALL_H - 0.125, GW, 0, '#ffc8f4', 0.0016, 2);
  chaser('z', 0.035, WALL_H - 0.125, 0, GH, '#ffc8f4', 0.0016, 9);
  chaser('x', GH + 0.02, -0.03, 0, GW, '#c8fdff', 0.0028, 5);
  buildWindow('back', 5.0, 8.5);
  buildWindow('left', 4.75, 8.25);
  buildDoor();
  buildHoloBoard();
  buildNeonSign();
  buildLedClock();
  buildServerRack();
  buildCounter();
  buildVending();
  buildCoolant();
  buildSofa();
  buildPlant(0.55, 0.55, 1.2);
  buildPlant(0.5, 9.1, 0.9);
  buildPlant(11.45, 11.4, 1.3);
  buildPlant(11.75, 3.3, 0.85);
  buildHolo();
}

// Ventana a la ciudad: cielo en un lienzo que se actualiza (neones, coches voladores).
const skies = [];
function buildWindow(side, a, b) {
  const y0 = 1.2, y1 = 2.7;
  const w = b - a, h = y1 - y0;
  const tex = canvasTex(640, 256, () => {});
  const g = new THREE.Group();
  const sky = glowPanel(w, h, tex, 0.95, g);
  sky.position.set(w / 2, y0 + h / 2, 0.012);
  const frame = mat('#2a2d40', { metalness: 0.7, roughness: 0.35 });
  box(-0.08, y0 - 0.08, 0, w + 0.16, 0.08, 0.06, frame, g);
  box(-0.08, y1, 0, w + 0.16, 0.08, 0.06, frame, g);
  box(-0.08, y0, 0, 0.08, h, 0.06, frame, g);
  box(w, y0, 0, 0.08, h, 0.06, frame, g);
  box(w / 2 - 0.03, y0, 0, 0.06, h, 0.05, frame, g);
  strip(-0.1, y0 - 0.12, 0.04, w + 0.2, 0.025, 0.025, NEON.magenta, 3, g); // neón bajo la ventana
  strip(-0.1, y1 + 0.1, 0.04, w + 0.2, 0.025, 0.025, NEON.cyan, 3, g);
  if (side === 'back') g.position.set(a, 0, 0);
  else { g.rotation.y = Math.PI / 2; g.position.set(0, 0, b); }
  g.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  scene.add(g);
  skies.push({ tex, seed: side === 'back' ? 1 : 40, moon: side === 'back' });
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
    for (let i = 0; i < 40; i++) {
      const tw = (Math.sin(t / 500 + i * 1.7 + s.seed) + 1) / 2;
      g.fillStyle = `rgba(255,230,255,${(0.25 + tw * 0.5) * info.stars})`;
      g.fillRect(rnd(s.seed + i) * W, rnd(s.seed + i + 50) * H * 0.35, 2, 2);
    }
    if (s.moon) {
      g.fillStyle = `rgba(255,190,240,${0.9 * info.stars})`;
      g.beginPath(); g.arc(W * 0.8, 36, 18, 0, Math.PI * 2); g.fill();
    }
  }
  // rascacielos lejanos y cercanos con ventanas y carteles de neón
  const neonCols = [NEON.magenta, NEON.cyan, NEON.purple, NEON.yellow, NEON.green];
  for (let layer = 0; layer < 2; layer++) {
    const n = layer ? 12 : 18;
    for (let i = 0; i < n; i++) {
      const seed = s.seed + i * 13 + layer * 101;
      const bw = (layer ? 44 : 26) + rnd(seed) * 30;
      const bx = (i / n) * W - 10 + rnd(seed + 1) * 20;
      const bh = (layer ? 90 : 120) + rnd(seed + 2) * (layer ? 110 : 90);
      g.fillStyle = layer ? mix('#1a1030', '#0b0716', info.stars) : mix('#2a1c48', '#140c28', info.stars);
      g.fillRect(bx, H - bh, bw, bh);
      const lit = 0.55 + 0.3 * info.stars;
      for (let wy = H - bh + 8; wy < H - 6; wy += 10) {
        for (let wx = bx + 4; wx < bx + bw - 4; wx += 7) {
          if (rnd(wx * 3.1 + wy * 7.7 + seed) > lit) {
            g.fillStyle = rnd(wx + wy) > 0.8 ? 'rgba(41,240,255,0.8)' : 'rgba(255,200,120,0.75)';
            g.fillRect(wx, wy, 3, 4);
          }
        }
      }
      if (layer && rnd(seed + 5) > 0.45) { // cartel de neón en la fachada
        const col = neonCols[Math.floor(rnd(seed + 6) * neonCols.length)];
        const on = Math.sin(t / 400 + seed) > -0.85; // parpadeo ocasional
        g.save();
        g.shadowColor = col; g.shadowBlur = on ? 14 : 0;
        g.fillStyle = on ? col : shadeHex(col, 0.4);
        const sw = bw * 0.6, sh = 10 + rnd(seed + 7) * 26;
        g.fillRect(bx + (bw - sw) / 2, H - bh + 16, sw, sh);
        g.restore();
      }
    }
  }
  // coches voladores
  for (let i = 0; i < 7; i++) {
    const seed = s.seed + i * 7;
    const y = 30 + rnd(seed) * (H * 0.5);
    const speed = 0.04 + rnd(seed + 1) * 0.08;
    const dir = rnd(seed + 2) > 0.5 ? 1 : -1;
    const span = W + 80;
    let x = ((t * speed + rnd(seed + 3) * span) % span) - 40;
    if (dir < 0) x = W - x;
    const col = rnd(seed + 4) > 0.5 ? '#ff5f6d' : '#ffffff';
    const tr = g.createLinearGradient(x, 0, x - dir * 40, 0);
    tr.addColorStop(0, col); tr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = tr;
    g.fillRect(Math.min(x, x - dir * 40), y, 40, 2);
    g.fillStyle = col;
    g.fillRect(x - 2, y - 1, 4, 4);
  }
  s.tex.needsUpdate = true;
}

function buildDoor() {
  const g = new THREE.Group();
  const w = 1.4, h = 2.4;
  box(-0.06, 0, 0, w + 0.12, h + 0.08, 0.08, '#2a2d40', g, { metalness: 0.7, roughness: 0.3 });
  box(0.04, 0, 0.02, w / 2 - 0.05, h - 0.04, 0.08, '#3a3f58', g, { metalness: 0.8, roughness: 0.3 });
  box(w / 2 + 0.01, 0, 0.02, w / 2 - 0.05, h - 0.04, 0.08, '#3a3f58', g, { metalness: 0.8, roughness: 0.3 });
  strip(w / 2 - 0.012, 0.1, 0.105, 0.024, h - 0.24, 0.01, NEON.cyan, 3, g);
  strip(-0.08, h + 0.08, 0.06, w + 0.16, 0.03, 0.03, NEON.cyan, 4, g);
  strip(-0.08, 0, 0.06, 0.03, h + 0.1, 0.03, NEON.cyan, 4, g);
  strip(w + 0.05, 0, 0.06, 0.03, h + 0.1, 0.03, NEON.cyan, 4, g);
  const sign = glowPanel(0.95, 0.24, canvasTex(256, 64, (c, W, H) => {
    c.fillStyle = '#04181c'; c.fillRect(0, 0, W, H);
    c.shadowColor = NEON.green; c.shadowBlur = 12;
    c.fillStyle = NEON.green; c.font = 'bold 34px Consolas, monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('ENTRADA', W / 2, H / 2 + 2);
  }), 1.6, g);
  sign.position.set(w / 2, h + 0.3, 0.06);
  g.rotation.y = Math.PI / 2;
  g.position.set(0.02, 0, 9.9 + w);
  g.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  scene.add(g);
  // alfombrilla con neón
  box(0.1, 0, DOOR.z - 0.7, 0.9, 0.015, 1.4, '#1a1b28').castShadow = false;
  strip(0.1, 0.016, DOOR.z - 0.7, 0.9, 0.006, 0.02, NEON.cyan, 2);
  strip(0.1, 0.016, DOOR.z + 0.68, 0.9, 0.006, 0.02, NEON.cyan, 2);
}

// Tablero holográfico de la pared: las tareas reales del equipo (lo que llega
// de screen.js en window.PIXEL_BOARD). Una fila por miembro con lo que hace,
// lo que tiene en cola, lo que ha terminado y lo que lleva gastado.
// Clic en el tablero: vista del equipo; clic en una fila: pantalla de ese miembro.
let holoBoard = null;
let holoBoardMesh = null;
const BOARD_W = 1024, BOARD_H = 392, BOARD_TOP = 76, BOARD_ROW = 61;
function boardData() {
  const b = window.PIXEL_BOARD;
  return b && Array.isArray(b.tasks) ? b : { tasks: [], spent: {} };
}
// Texto corto de un paso (para el tablero y las pantallas de las mesas).
function shortStep(s) {
  if (!s) return '';
  const base = (p) => String(p || '').split(/[\\/]/).pop();
  switch (s.kind) {
    case 'edit': return 'editando ' + base(s.file);
    case 'write': return 'creando ' + base(s.file);
    case 'read': return 'leyendo ' + base(s.file);
    case 'validate': return 'validando: ' + String(s.command || '').split('\n')[0];
    case 'run': return '$ ' + String(s.command || '').split('\n')[0];
    case 'search': return 'buscando "' + (s.pattern || '') + '"';
    case 'web': return 'web: ' + (s.query || '');
    case 'plan': return 'planificando (' + (s.todos || []).length + ' pasos)';
    case 'delegate': return 'delegando: ' + (s.note || '');
    case 'say': return String(s.text || '').replace(/\s+/g, ' ');
    default: return s.tool || '';
  }
}
function fitText(g, text, maxW) {
  let t = String(text || '');
  if (g.measureText(t).width <= maxW) return t;
  while (t.length > 1 && g.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}
function drawHoloBoard(t) {
  const c = holoBoard.userData.canvas;
  const g = c.getContext('2d');
  const W = c.width, H = c.height;
  const data = boardData();
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(4,20,32,0.86)'; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(41,240,255,0.12)'; g.lineWidth = 1;
  for (let x = 0; x < W; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  for (let y = 0; y < H; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  g.shadowColor = NEON.cyan; g.shadowBlur = 8;
  g.strokeStyle = NEON.cyan; g.lineWidth = 3;
  g.strokeRect(4, 4, W - 8, H - 8);
  g.shadowBlur = 0;

  // cabecera: totales
  const pend = data.tasks.filter((x) => x.status === 'pendiente').length;
  const run = data.tasks.filter((x) => x.status === 'en curso').length;
  const done = data.tasks.filter((x) => x.status === 'hecho').length;
  const total = Object.values(data.spent || {}).reduce((a, b) => a + (Number(b) || 0), 0);
  g.textBaseline = 'middle';
  g.font = 'bold 28px Consolas, monospace';
  g.fillStyle = NEON.cyan;
  g.fillText('TABLERO // EQUIPO', 26, 40);
  g.textAlign = 'right';
  g.font = 'bold 22px Consolas, monospace';
  g.fillStyle = NEON.yellow; g.fillText(`EN COLA ${pend}`, 640, 40);
  g.fillStyle = NEON.cyan; g.fillText(`EN CURSO ${run}`, 790, 40);
  g.fillStyle = NEON.green; g.fillText(`HECHAS ${done}`, 920, 40);
  g.fillStyle = NEON.magenta; g.fillText('$' + total.toFixed(2), W - 22, 40);
  g.textAlign = 'left';
  g.strokeStyle = 'rgba(41,240,255,0.5)'; g.beginPath(); g.moveTo(20, 66); g.lineTo(W - 20, 66); g.stroke();

  // una fila por miembro
  [...display.values()].slice(0, 5).forEach((d, i) => {
    const y = BOARD_TOP + i * BOARD_ROW + BOARD_ROW / 2;
    const mine = data.tasks.filter((x) => x.member === d.id);
    const cur = mine.find((x) => x.status === 'en curso');
    const queued = mine.filter((x) => x.status === 'pendiente').length;
    const fin = mine.filter((x) => x.status === 'hecho').length;
    const acc = d.accent || NEON.cyan;
    if (boardHover === i) { g.fillStyle = 'rgba(41,240,255,0.10)'; g.fillRect(12, y - BOARD_ROW / 2 + 3, W - 24, BOARD_ROW - 6); }
    // luz de estado
    g.fillStyle = cur ? (Math.floor(t / 400) % 2 ? NEON.yellow : '#b89a1c') : NEON.green;
    g.beginPath(); g.arc(34, y, 7, 0, Math.PI * 2); g.fill();
    g.font = 'bold 24px Consolas, monospace';
    g.fillStyle = acc; g.shadowColor = acc; g.shadowBlur = 6;
    g.fillText(fitText(g, d.name || '', 150), 52, y);
    g.shadowBlur = 0;
    // qué hace
    g.font = '19px Consolas, monospace';
    let what = 'libre';
    let col = 'rgba(200,220,235,0.55)';
    if (cur) {
      const last = cur.steps && cur.steps[cur.steps.length - 1];
      what = last ? shortStep(last) : 'pensando: ' + String(cur.text || '').split('\n')[0];
      col = last && last.kind === 'validate' ? NEON.magenta : '#dff9ff';
    }
    g.fillStyle = col;
    g.fillText(fitText(g, what, 440), 214, y);
    // cola, hechas y gastado
    g.textAlign = 'right';
    g.font = 'bold 20px Consolas, monospace';
    g.fillStyle = queued ? NEON.yellow : 'rgba(255,225,77,0.3)'; g.fillText(String(queued), 700, y);
    g.fillStyle = fin ? NEON.green : 'rgba(57,255,158,0.3)'; g.fillText(String(fin), 845, y);
    g.fillStyle = NEON.magenta; g.fillText('$' + (Number((data.spent || {})[d.id]) || 0).toFixed(2), W - 22, y);
    g.textAlign = 'left';
    g.strokeStyle = 'rgba(41,240,255,0.12)';
    g.beginPath(); g.moveTo(20, y + BOARD_ROW / 2); g.lineTo(W - 20, y + BOARD_ROW / 2); g.stroke();
  });
  // barrido de escaneo
  const sy = (t / 12) % H;
  g.fillStyle = 'rgba(41,240,255,0.06)'; g.fillRect(6, sy, W - 12, 10);
  holoBoard.needsUpdate = true;
}
let boardHover = -1;
function buildHoloBoard() {
  holoBoard = canvasTex(BOARD_W, BOARD_H, () => {});
  const p = glowPanel(3.4, 1.3, holoBoard, 1.2, null, { transparent: true, opacity: 0.94, side: THREE.DoubleSide });
  p.position.set(2.55, 1.95, 0.05);
  p.userData.board = true;
  holoBoardMesh = p;
  drawHoloBoard(0);
  // proyector en el suelo del tablero
  box(1.0, 1.2, 0.02, 3.1, 0.04, 0.12, '#2a2d40', null, { metalness: 0.6 }).castShadow = false;
  strip(1.0, 1.24, 0.1, 3.1, 0.015, 0.02, NEON.cyan, 4);
}
// Fila del tablero bajo el ratón (uv del impacto) → índice de miembro, o -1.
function boardRowAt(uv) {
  if (!uv) return -1;
  const y = (1 - uv.y) * BOARD_H;
  const i = Math.floor((y - BOARD_TOP) / BOARD_ROW);
  return i >= 0 && i < Math.min(5, display.size) ? i : -1;
}

// Letrero de neón en la pared del fondo.
let neonSign = null;
function buildNeonSign() {
  const tex = canvasTex(1024, 200, (g, W, H) => {
    g.clearRect(0, 0, W, H);
    g.font = 'bold 120px "Segoe UI", Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.shadowColor = NEON.magenta; g.shadowBlur = 30;
    g.strokeStyle = NEON.magenta; g.lineWidth = 10;
    g.strokeText('PIXEL OFFICE', W / 2, H / 2 + 4);
    g.shadowBlur = 0; g.strokeStyle = '#ffd6f6'; g.lineWidth = 3;
    g.strokeText('PIXEL OFFICE', W / 2, H / 2 + 4);
  });
  neonSign = glowPanel(3.4, 0.66, tex, 1.7, null, { transparent: true, depthWrite: false });
  neonSign.position.set(6.75, 2.95, 0.04);
  // pequeño rótulo "IA ✦ 24/7" al lado
  const t2 = canvasTex(256, 256, (g, W, H) => {
    g.clearRect(0, 0, W, H);
    g.shadowColor = NEON.cyan; g.shadowBlur = 20; g.strokeStyle = NEON.cyan; g.lineWidth = 8;
    g.beginPath(); g.roundRect(40, 30, 176, 140, 30); g.stroke();
    g.beginPath(); g.arc(95, 95, 16, 0, Math.PI * 2); g.arc(161, 95, 16, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(96, 135); g.lineTo(160, 135); g.stroke();
    g.fillStyle = NEON.yellow; g.shadowColor = NEON.yellow; g.font = 'bold 44px Consolas, monospace'; g.textAlign = 'center';
    g.fillText('24/7', 128, 225);
  });
  const p = glowPanel(1.0, 1.0, t2, 1.6, null, { transparent: true, depthWrite: false });
  p.position.set(10.8, 2.2, 0.04);
}

// Reloj digital LED.
let ledClock = null;
let ledMinute = -1;
function buildLedClock() {
  ledClock = canvasTex(256, 96, () => {});
  box(8.95, 2.28, 0.0, 0.9, 0.36, 0.06, '#0e0f18').castShadow = false;
  const p = glowPanel(0.82, 0.3, ledClock, 1.8);
  p.position.set(9.4, 2.46, 0.065);
}
function updateLedClock(d) {
  const m = d.getHours() * 60 + d.getMinutes();
  if (m === ledMinute) return;
  ledMinute = m;
  const c = ledClock.userData.canvas;
  const g = c.getContext('2d');
  g.fillStyle = '#05030a'; g.fillRect(0, 0, c.width, c.height);
  g.font = 'bold 64px Consolas, "Courier New", monospace';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = NEON.magenta; g.shadowBlur = 16; g.fillStyle = NEON.magenta;
  g.fillText(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, c.width / 2, c.height / 2 + 4);
  ledClock.needsUpdate = true;
}

// Rack de servidores con luces que parpadean (en lugar de la estantería).
let rackTex = null;
function buildServerRack() {
  const g = new THREE.Group();
  const w = 1.9, h = 2.3, d = 0.6;
  box(0, 0, 0, w, h, d, '#14151f', g, { metalness: 0.6, roughness: 0.35 });
  rackTex = canvasTex(256, 320, () => {});
  const front = glowPanel(w - 0.12, h - 0.14, rackTex, 1.5, g);
  front.position.set(w / 2, h / 2, d + 0.005);
  strip(0, h, d - 0.02, w, 0.02, 0.02, NEON.purple, 4, g);
  g.rotation.y = Math.PI / 2;
  g.position.set(0.02, 0, 3.8);
  g.traverse((o) => { if (o.isMesh && o !== front) o.castShadow = true; });
  scene.add(g);
}
function drawRack(t) {
  const c = rackTex.userData.canvas;
  const g = c.getContext('2d');
  g.fillStyle = '#07080e'; g.fillRect(0, 0, c.width, c.height);
  for (let r = 0; r < 10; r++) {
    const y = 8 + r * 31;
    g.fillStyle = '#161826'; g.fillRect(8, y, c.width - 16, 26);
    g.fillStyle = '#0b0c14';
    for (let k = 0; k < 10; k++) g.fillRect(16 + k * 14, y + 8, 10, 10);
    for (let k = 0; k < 6; k++) {
      const on = rnd(r * 17 + k + Math.floor(t / (180 + k * 40))) > 0.45;
      g.fillStyle = on ? [NEON.green, NEON.cyan, NEON.yellow, NEON.magenta][(r + k) % 4] : '#1c1f2c';
      g.fillRect(170 + k * 12, y + 10, 6, 6);
    }
  }
  rackTex.needsUpdate = true;
}

const coffeeSteamAt = { x: 9.25, y: 1.55, z: 0.35 };
function buildCounter() {
  box(8.7, 0, 0.06, 2.2, 0.9, 0.62, '#1a1b28', null, { metalness: 0.5, roughness: 0.4 });
  box(8.66, 0.9, 0.04, 2.28, 0.05, 0.68, '#2e3248', null, { metalness: 0.7, roughness: 0.25 });
  strip(8.7, 0.86, 0.68, 2.2, 0.02, 0.02, NEON.magenta, 3.5); // neón bajo la encimera
  box(9.0, 0.95, 0.14, 0.45, 0.6, 0.38, '#0f1018', null, { metalness: 0.7, roughness: 0.3 });
  const cup = glowPanel(0.2, 0.12, canvasTex(64, 40, (g, W, H) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    g.fillStyle = NEON.orange; g.font = 'bold 26px sans-serif'; g.textAlign = 'center'; g.fillText('☕', W / 2, 30);
  }), 1.8);
  cup.position.set(9.225, 1.38, 0.525);
  const cups = [NEON.magenta, NEON.cyan, NEON.yellow];
  cups.forEach((c, i) => mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.12, 16), mat('#1f2130'), 9.7 + i * 0.22, 1.01, 0.42));
  cups.forEach((c, i) => { const r = mesh(new THREE.TorusGeometry(0.05, 0.006, 6, 20), neon(c, 3), 9.7 + i * 0.22, 1.07, 0.42); r.rotation.x = Math.PI / 2; r.castShadow = false; });
}

// Máquina expendedora con frontal luminoso.
function buildVending() {
  box(10.95, 0, 0.05, 0.85, 2.0, 0.7, '#161826', null, { metalness: 0.6, roughness: 0.35 });
  const tex = canvasTex(160, 256, (g, W, H) => {
    g.fillStyle = '#0a0b12'; g.fillRect(0, 0, W, H);
    const cols = [NEON.magenta, NEON.cyan, NEON.yellow, NEON.green, NEON.orange, NEON.purple];
    for (let r = 0; r < 5; r++) for (let k = 0; k < 4; k++) {
      g.fillStyle = cols[(r * 4 + k) % cols.length];
      g.fillRect(14 + k * 34, 16 + r * 36, 22, 28);
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(16 + k * 34, 18 + r * 36, 5, 22);
    }
    g.fillStyle = NEON.cyan; g.font = 'bold 22px Consolas, monospace'; g.textAlign = 'center';
    g.fillText('NEO-COLA', W / 2, 225);
  });
  const p = glowPanel(0.62, 1.2, tex, 1.3);
  p.position.set(11.33, 1.2, 0.755);
  strip(10.95, 2.0, 0.73, 0.85, 0.025, 0.025, NEON.cyan, 4);
}

// Depósito de refrigerante (en lugar del dispensador de agua).
function buildCoolant() {
  box(1.5, 0, 0.22, 0.42, 0.7, 0.42, '#1f2130', null, { metalness: 0.6 });
  const tank = mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.7, 24),
    new THREE.MeshStandardMaterial({ color: '#29f0ff', emissive: '#18a8c0', emissiveIntensity: 1.2, transparent: true, opacity: 0.75, roughness: 0.1 }), 1.71, 1.05, 0.43);
  tank.castShadow = false;
  strip(1.52, 0.7, 0.62, 0.38, 0.02, 0.02, NEON.cyan, 4);
}

function buildSofa() {
  const x = 0.14, z = 3.6, len = 1.8;
  const leather = { roughness: 0.45, metalness: 0.1 };
  box(x, 0.06, z, 0.8, 0.32, len, '#3a1f5c', null, leather);
  box(x, 0.38, z + 0.14, 0.72, 0.14, len - 0.28, '#4b2a78', null, leather);
  box(x, 0.38, z, 0.26, 0.62, len, '#3a1f5c', null, leather);
  box(x, 0.38, z, 0.8, 0.28, 0.14, '#321a50', null, leather);
  box(x, 0.38, z + len - 0.14, 0.8, 0.28, 0.14, '#321a50', null, leather);
  strip(x + 0.78, 0.04, z, 0.02, 0.02, len, NEON.magenta, 4); // luz de suelo bajo el sofá
  const pillow = box(x + 0.28, 0.5, z + 0.3, 0.14, 0.34, 0.4, '#1ec8d8');
  pillow.rotation.z = -0.25;
  // mesita
  mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.04, 28), mat('#2e3248', { metalness: 0.7, roughness: 0.25 }), 0.62, 0.42, 6.0);
  mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.4, 12), mat('#14151f'), 0.62, 0.2, 6.0);
  const ring = mesh(new THREE.TorusGeometry(0.28, 0.008, 6, 36), neon(NEON.cyan, 3), 0.62, 0.44, 6.0);
  ring.rotation.x = Math.PI / 2;
  ring.castShadow = false;
}

function buildPlant(x, z, s) {
  mesh(new THREE.CylinderGeometry(0.2 * s, 0.15 * s, 0.4 * s, 18), mat('#1f2130', { metalness: 0.6, roughness: 0.3 }), x, 0.2 * s, z);
  const r = mesh(new THREE.TorusGeometry(0.2 * s, 0.008, 6, 30), neon(NEON.purple, 3), x, 0.4 * s, z);
  r.rotation.x = Math.PI / 2;
  r.castShadow = false;
  const leaf = [mat('#2f9e6a'), mat('#3fbf7f'), mat('#237a52')];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + rnd(i + x) * 0.5;
    const rr = (i === 6 ? 0 : 0.14) * s;
    const m = mesh(new THREE.SphereGeometry(0.16 * s, 12, 10), leaf[i % 3], x + Math.cos(a) * rr, (0.62 + (i === 6 ? 0.2 : rnd(i) * 0.12)) * s, z + Math.sin(a) * rr);
    m.scale.set(0.8, 1.35, 0.8);
    m.rotation.z = Math.cos(a) * 0.4;
    m.rotation.x = Math.sin(a) * 0.4;
  }
}

// Mesa holográfica: un punto por miembro que brilla cuando trabaja.
const holo = { dots: [], beam: null, ring: null };
function buildHolo() {
  mesh(new THREE.CylinderGeometry(0.5, 0.58, 0.45, 32), mat('#1a1b28', { metalness: 0.7, roughness: 0.3 }), HOLO.x, 0.225, HOLO.z);
  holo.ring = mesh(new THREE.TorusGeometry(0.42, 0.022, 8, 48), neon(NEON.cyan, 4), HOLO.x, 0.46, HOLO.z);
  holo.ring.rotation.x = Math.PI / 2;
  holo.ring.castShadow = false;
  holo.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.42, 1.2, 32, 1, true),
    new THREE.MeshBasicMaterial({ color: NEON.cyan, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  holo.beam.position.set(HOLO.x, 1.06, HOLO.z);
  scene.add(holo.beam);
  const light = new THREE.PointLight(NEON.cyan, 2.5, 4, 2);
  light.position.set(HOLO.x, 1.2, HOLO.z);
  scene.add(light);
}

// ---- Puestos de trabajo ---------------------------------------------------------

function neonOutline(color) {
  const t = canvasTex(256, 256, (g, W, H) => {
    g.clearRect(0, 0, W, H);
    g.shadowColor = color; g.shadowBlur = 16;
    g.strokeStyle = color; g.lineWidth = 6;
    g.beginPath(); g.roundRect(14, 14, W - 28, H - 28, 34); g.stroke();
  });
  return t;
}

function buildStation(d) {
  const { cx, cz } = d.slot;
  const g = new THREE.Group();
  g.userData.id = d.id;
  const accent = d.accent || NEON.cyan;
  // contorno de neón en el suelo (en lugar de alfombra)
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.1), new THREE.MeshBasicMaterial({
    map: neonOutline(accent), transparent: true, depthWrite: false, toneMapped: false,
    color: new THREE.Color(1.6, 1.6, 1.6), blending: THREE.AdditiveBlending,
  }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(cx, 0.008, cz - 0.4);
  g.add(rug);
  // anillo de destino / señalado (sigue al personaje)
  d.ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.03, 8, 48),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(TARGET_COLOR).multiplyScalar(2), transparent: true, opacity: 0.9, toneMapped: false }));
  d.ring.rotation.x = -Math.PI / 2;
  d.ring.visible = false;
  scene.add(d.ring);

  // mesa de metal oscuro con canto de neón del color del miembro
  const top = 0.75;
  const metal = { metalness: 0.65, roughness: 0.3 };
  box(cx - 0.8, top - 0.06, cz - 0.35, 1.6, 0.06, 0.7, '#23263a', g, metal);
  strip(cx - 0.8, top - 0.05, cz + 0.35, 1.6, 0.02, 0.012, accent, 3.5, g);
  box(cx - 0.76, 0, cz + 0.26, 1.52, top - 0.06, 0.05, '#171925', g, metal);
  box(cx - 0.8, 0, cz - 0.33, 0.05, top - 0.06, 0.62, '#171925', g, metal);
  box(cx + 0.75, 0, cz - 0.33, 0.05, top - 0.06, 0.62, '#171925', g, metal);

  // portátil: la pantalla mira al agente; nosotros vemos el dorso con su logo
  const lx = cx - 0.05, lz = cz - 0.12;
  box(lx - 0.27, top, lz - 0.18, 0.54, 0.025, 0.36, '#2e3248', g, metal);
  d.keys = box(lx - 0.23, top + 0.026, lz - 0.14, 0.46, 0.004, 0.18, new THREE.MeshBasicMaterial({ color: '#1a1c28' }), g);
  const lid = new THREE.Group();
  lid.position.set(lx, top + 0.025, lz + 0.18);
  lid.rotation.x = -0.28;
  box(-0.27, 0, -0.02, 0.54, 0.34, 0.02, '#1f2233', lid, metal);
  d.logo = mesh(new THREE.CircleGeometry(0.035, 20), new THREE.MeshBasicMaterial({ color: '#2a2d40', toneMapped: false }), 0, 0.17, 0.0015, lid);
  g.add(lid);
  d.glow = new THREE.PointLight(accent, 0, 2.4, 2);
  d.glow.position.set(lx, top + 0.4, lz - 0.25);
  g.add(d.glow);

  // pantalla holográfica flotante (código cuando trabaja)
  d.holoTex = canvasTex(320, 200, () => {});
  d.holoPanel = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.41), new THREE.MeshBasicMaterial({
    map: d.holoTex, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false, color: new THREE.Color(1.4, 1.4, 1.4),
  }));
  d.holoPanel.position.set(cx + 0.55, 1.15, cz - 0.05);
  d.holoPanel.rotation.y = Math.PI / 4;
  g.add(d.holoPanel);
  // un poco más grande que la pantalla para que sea fácil pulsarla
  d.screenHit = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.55), new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
  d.screenHit.position.copy(d.holoPanel.position);
  d.screenHit.rotation.copy(d.holoPanel.rotation);
  g.add(d.screenHit);
  const emitter = mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.03, 16), mat('#2e3248', metal), cx + 0.55, top + 0.015, cz - 0.05, g);
  emitter.castShadow = false;
  d.holoLine = strip(cx + 0.545, top + 0.03, cz - 0.055, 0.01, 0.2, 0.01, accent, 3, g);

  if (d.hasMug) {
    mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.12, 16), mat('#2e3248'), cx - 0.6, top + 0.06, cz + 0.1, g);
    const r = mesh(new THREE.TorusGeometry(0.055, 0.006, 6, 20), neon(accent, 3), cx - 0.6, top + 0.12, cz + 0.1, g);
    r.rotation.x = Math.PI / 2;
    d.mugTop = new THREE.Vector3(cx - 0.6, top + 0.14, cz + 0.1);
  }
  if (d.hasPlant) {
    mesh(new THREE.CylinderGeometry(0.07, 0.055, 0.12, 12), mat('#1f2130'), cx - 0.62, top + 0.06, cz - 0.2, g);
    const p = mesh(new THREE.SphereGeometry(0.1, 12, 10), mat('#3fbf7f'), cx - 0.62, top + 0.2, cz - 0.2, g);
    p.scale.y = 1.3;
  }

  // silla gamer
  const ch = new THREE.Group();
  ch.position.set(d.slot.seatX, 0, d.slot.seatZ);
  mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.04, 5), mat('#14151f', metal), 0, 0.05, 0, ch);
  mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.44, 8), mat('#2a2d40', metal), 0, 0.28, 0, ch);
  box(-0.26, 0.48, -0.26, 0.52, 0.08, 0.52, '#1f2233', ch);
  box(-0.26, 0.54, -0.34, 0.52, 0.66, 0.08, '#1f2233', ch);
  strip(-0.2, 0.58, -0.255, 0.012, 0.56, 0.01, accent, 3, ch);
  strip(0.19, 0.58, -0.255, 0.012, 0.56, 0.01, accent, 3, ch);
  g.add(ch);

  g.traverse((o) => { if (o.isMesh) o.userData.id = d.id; });
  d.holoPanel.userData.screen = true;
  d.screenHit.userData.screen = true;
  scene.add(g);
  d.station = g;
}

// Líneas que se ven en la pantalla de la mesa: lo que el agente está haciendo
// de verdad (el código que escribe, el comando y su salida…).
function screenLines(step) {
  if (!step) return null;
  const L = (text, color) => String(text || '').split('\n').map((x) => ({ text: x, color }));
  const tail = (arr, n) => arr.slice(-n);
  switch (step.kind) {
    case 'edit': return L(step.after, '#7dffb0').map((l) => ({ text: '+ ' + l.text, color: l.color }));
    case 'write': return L(step.code, '#7dffb0');
    case 'run':
    case 'validate': {
      const out = step.output ? tail(L(step.output, step.ok === false ? '#ff7a8c' : '#cfe8ff'), 8) : [{ text: '▌', color: '#ffffff' }];
      return L('$ ' + String(step.command || '').split('\n')[0], NEON.yellow).concat(out);
    }
    case 'plan': return (step.todos || []).map((x) => ({ text: (x.status === 'completed' ? '[x] ' : x.status === 'in_progress' ? '[>] ' : '[ ] ') + x.text, color: x.status === 'completed' ? '#7dffb0' : '#dff9ff' }));
    case 'say': return L(step.text, '#dff9ff');
    default: return step.output ? L(step.output, '#cfe8ff') : L(shortStep(step), '#dff9ff');
  }
}
function currentStepOf(id) {
  const cur = boardData().tasks.find((x) => x.member === id && x.status === 'en curso');
  return cur && cur.steps && cur.steps.length ? cur.steps[cur.steps.length - 1] : null;
}

// Pantalla holográfica de cada mesa: lo que hace si trabaja; en reposo, su emblema.
function drawHoloScreen(d, t) {
  const c = d.holoTex.userData.canvas;
  const g = c.getContext('2d');
  const W = c.width, H = c.height;
  const col = d.working ? (SCREEN_COLOR[d.state] || d.accent || NEON.cyan) : (d.accent || NEON.cyan);
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(10,20,40,0.6)';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = col; g.lineWidth = 3; g.strokeRect(2, 2, W - 4, H - 4);
  const step = d.busy ? currentStepOf(d.id) : null;
  const lines = screenLines(step);
  if (d.busy && lines && lines.length) {
    // barra de título con lo que hace
    g.fillStyle = col; g.fillRect(2, 2, W - 4, 22);
    g.fillStyle = '#05070d'; g.font = 'bold 13px Consolas, monospace'; g.textBaseline = 'middle';
    g.fillText(fitText(g, shortStep(step).toUpperCase(), W - 16), 8, 13);
    g.font = '12px Consolas, monospace';
    const max = 11;
    const shown = lines.slice(0, max);
    shown.forEach((l, i) => {
      g.fillStyle = l.color;
      g.fillText(fitText(g, l.text.replace(/\t/g, '  '), W - 18), 9, 36 + i * 14.5);
    });
    if (Math.floor(t / 500) % 2) { g.fillStyle = '#ffffff'; g.fillRect(9, Math.min(H - 12, 36 + shown.length * 14.5 - 6), 7, 11); }
  } else if (d.working || d.busy) {
    const scroll = Math.floor(t / 180);
    for (let i = 0; i < 10; i++) {
      const seed = hash(d.id) + scroll + i;
      const indent = (Math.abs(seed) % 3) * 16;
      const len = 50 + (Math.abs(seed * 7) % 180);
      g.fillStyle = i === 9 ? '#ffffff' : col;
      g.globalAlpha = 0.5 + (i / 10) * 0.5;
      g.fillRect(16 + indent, 14 + i * 16, Math.min(len, W - 34 - indent), 8);
    }
    g.globalAlpha = 1;
    g.fillStyle = col; g.font = 'bold 15px Consolas, monospace'; g.textBaseline = 'alphabetic';
    g.fillText(fitText(g, d.label || '', W - 24), 12, H - 10);
  } else {
    g.fillStyle = col; g.font = 'bold 42px Consolas, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.globalAlpha = 0.6 + Math.sin(t / 600) * 0.2;
    g.fillText(d.name || '', W / 2, H / 2 - 16);
    g.font = '15px Consolas, monospace';
    g.fillText('— STANDBY —', W / 2, H / 2 + 22);
    g.globalAlpha = 0.45;
    g.font = '12px Consolas, monospace';
    g.fillText('clic: ver su pantalla', W / 2, H - 18);
    g.globalAlpha = 1;
    g.textAlign = 'left';
  }
  g.textBaseline = 'alphabetic';
  d.holoTex.needsUpdate = true;
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


// ---- Navegación por los pasillos -------------------------------------------------

function nodePt(i, j) { return { x: NX[i], z: NZ[j], node: { i, j } }; }
function edgeKey(a, b) {
  const k1 = a.i + ',' + a.j, k2 = b.i + ',' + b.j;
  return k1 < k2 ? k1 + '|' + k2 : k2 + '|' + k1;
}
// Camino más corto (en saltos) entre dos nodos de la rejilla.
function bfs(a, b) {
  const key = (n) => n.i + ',' + n.j;
  const prev = new Map([[key(a), null]]);
  const queue = [a];
  while (queue.length) {
    const n = queue.shift();
    if (n.i === b.i && n.j === b.j) break;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const m = { i: n.i + di, j: n.j + dj };
      if (m.i < 0 || m.j < 0 || m.i >= NX.length || m.j >= NZ.length) continue;
      if (prev.has(key(m)) || BLOCKED.has(edgeKey(n, m))) continue;
      prev.set(key(m), n);
      queue.push(m);
    }
  }
  const out = [];
  for (let n = b; n; n = prev.get(key(n))) out.unshift(n);
  return out;
}

// Por dónde se sale (o se llega) a la silla de un puesto.
function seatExit(slot) { return [{ x: NX[slot.ei], z: slot.seatZ }, nodePt(slot.ei, slot.ej)]; }

// Punto de partida para replanificar: el nodo más próximo en el camino actual.
function planStart(d) {
  if (d.mode === 'seated') return { prefix: seatExit(d.slot), node: { i: d.slot.ei, j: d.slot.ej } };
  if ((d.mode === 'hang' || d.mode === 'sofa') && d.spot) return { prefix: [nodePt(d.spot.i, d.spot.j)], node: { i: d.spot.i, j: d.spot.j } };
  const k = d.path.findIndex((p) => p.node);
  if (k >= 0) return { prefix: d.path.slice(0, k + 1), node: d.path[k].node };
  // último tramo hacia un sitio o la silla: lo terminamos y salimos desde ahí
  const last = d.path.slice();
  if (d.goal === 'seat') return { prefix: last.concat(seatExit(d.slot)), node: { i: d.slot.ei, j: d.slot.ej } };
  if (d.goal && d.goal.i != null) return { prefix: last.concat([nodePt(d.goal.i, d.goal.j)]), node: { i: d.goal.i, j: d.goal.j } };
  return { prefix: [nodePt(0, 3)], node: { i: 0, j: 3 } };
}

function goTo(d, target, hurry) {
  const { prefix, node } = planStart(d);
  const tNode = target === 'seat' ? { i: d.slot.ei, j: d.slot.ej } : { i: target.i, j: target.j };
  const mid = bfs(node, tNode).slice(1).map((n) => nodePt(n.i, n.j));
  const tail = target === 'seat'
    ? [{ x: NX[d.slot.ei], z: d.slot.seatZ }, { x: d.slot.seatX, z: d.slot.seatZ }]
    : [{ x: target.x, z: target.z }];
  if (d.spot) { d.spot.takenBy = null; d.spot = null; }
  if (target !== 'seat') target.takenBy = d.id;
  d.path = prefix.concat(mid, tail);
  d.goal = target;
  d.mode = 'walk';
  d.hurry = !!hurry;
}

// Sitios de "visita": ponerse al lado de un compañero que está trabajando.
function visitSpotFor(other) {
  const s = other.slot;
  const sgn = Math.sign(NX[s.ei] - s.cx);
  return {
    id: 'visita:' + other.id, i: s.ei, j: s.ej, x: NX[s.ei] - sgn * 0.45, z: s.seatZ + 0.1,
    face: sgn > 0 ? -Math.PI / 2 : Math.PI / 2, label: `👀 viendo lo que hace ${other.name}`, anim: 'look', visitOf: other.id,
  };
}

function wander(d) {
  const free = SPOTS.filter((s) => !s.takenBy && s !== d.lastSpot);
  const busy = [...display.values()].filter((o) => o !== d && o.busy && o.mode === 'seated' && !o.visitedBy);
  let target;
  if (busy.length && Math.random() < 0.3) {
    const o = busy[Math.floor(Math.random() * busy.length)];
    target = visitSpotFor(o);
    o.visitedBy = d.id;
  } else if (free.length) {
    target = free[Math.floor(Math.random() * free.length)];
  } else {
    return goTo(d, 'seat');
  }
  d.lastSpot = target;
  goTo(d, target);
}

// Qué hace cada uno cuando no le llega trabajo.
// Recados: cuando JARVIS reparte un plan, va a la mesa de cada compañero a
// darle su tarea (aunque esté ocupado) y luego vuelve a la suya.
function errand(d, t) {
  if (d.mode === 'walk-intro') return;
  // ya va a entregar una tarea (o vuelve del último recado): que siga
  if (d.mode === 'walk' && d.goal && (d.goal.errand || (d.goal === 'seat' && !d.errands.length))) return;
  if (d.mode === 'hang' && d.spot && d.spot.errand && t < d.until) return;
  if (d.spot && d.spot.errand) { d.spot.takenBy = null; d.spot = null; }
  const o = display.get(d.errands.shift());
  if (o && o !== d) {
    const s = visitSpotFor(o);
    s.errand = true;
    s.label = `📋 dándole su tarea a ${o.name}`;
    goTo(d, s, true);
    return;
  }
  d.errands = [];
  if (d.mode === 'walk' && d.goal === 'seat') return;
  if (d.mode === 'seated') { d.onErrand = false; return; }
  goTo(d, 'seat', true);
}
window.addEventListener('pixel:delegate', (e) => {
  const { from, to } = e.detail || {};
  const d = display.get(from);
  if (!d || !Array.isArray(to) || !to.length) return;
  d.errands = to.filter((id) => id !== from && display.has(id));
  d.onErrand = d.errands.length > 0;
});

function think(d, t) {
  const idle = !d.busy && (d.state === 'idle' || !d.state);
  if (d.mode === 'intro') return;
  if (d.onErrand) { errand(d, t); return; }
  if (!idle) {
    // le ha llegado trabajo: a su mesa (corriendo). Si ya está sentado, se queda
    // quieto trabajando; si ya va hacia su silla, que siga.
    if (d.mode === 'seated') { d.idleSince = 0; return; }
    if (d.mode === 'hang' || d.mode === 'sofa' || d.goal !== 'seat') goTo(d, 'seat', true);
    d.idleSince = 0;
    return;
  }
  if (d.mode === 'seated') {
    if (!d.idleSince) { d.idleSince = t; d.restless = 9000 + Math.random() * 22000; }
    if (t - d.idleSince > d.restless) wander(d);
  } else if ((d.mode === 'hang' || d.mode === 'sofa') && t > d.until) {
    if (d.spot && d.spot.visitOf) { const o = display.get(d.spot.visitOf); if (o) o.visitedBy = null; }
    if (Math.random() < 0.45) wander(d); else goTo(d, 'seat');
  } else if ((d.mode === 'hang') && d.spot && d.spot.visitOf) {
    // el compañero ya no trabaja: deja de mirar
    const o = display.get(d.spot.visitOf);
    if (!o || !o.busy) d.until = Math.min(d.until, t + 1500);
  }
}

function arrive(d, t) {
  if (d.goal === 'seat') {
    if (d.onErrand && !d.errands.length) d.onErrand = false;
    d.mode = 'seated';
    d.idleSince = 0;
    if (d.spot) { d.spot.takenBy = null; d.spot = null; }
  } else {
    d.spot = d.goal;
    d.mode = d.goal.anim === 'sit' ? 'sofa' : 'hang';
    d.until = t + 8000 + Math.random() * 12000;
    if (d.goal.errand) {
      // entrega la tarea: una hoja que vuela hacia el compañero
      d.until = t + 2400;
      const o = display.get(d.goal.visitOf);
      if (o) for (let k = 0; k < 2; k++) emitAt(headWorld(o), '📋', null, { vy: 0.0006, max: 1600 });
    }
  }
  d.goal = null;
  d.hurry = false;
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
    accent: NEON.cyan, hairStyle: Math.abs(hash(id + 'hs')) % 4, style: 'human',
  };
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
        id: a.id, slot, x: DOOR.x, z: DOOR.z, heading: Math.PI / 2, mode: 'intro',
        startAt: performance.now() + 500 + i * 1100,
        phase: Math.abs(hash(a.id)) % 1000,
        hasMug: Math.abs(hash(a.id + 'm')) % 2 === 0,
        hasPlant: Math.abs(hash(a.id + 'p')) % 3 === 0,
        emitAt: 0, holoAt: 0,
      }, a.look || lookFor(a.id));
      // entrada: de la puerta al pasillo delantero y de ahí a su silla
      d.path = [{ x: 1.3, z: DOOR.z }, nodePt(0, 3)]
        .concat(bfs({ i: 0, j: 3 }, { i: slot.ei, j: slot.ej }).slice(1).map((n) => nodePt(n.i, n.j)))
        .concat([{ x: NX[slot.ei], z: slot.seatZ }, { x: slot.seatX, z: slot.seatZ }]);
      d.goal = 'seat';
      d.lookSig = JSON.stringify(a.look || null);
      display.set(a.id, d);
      buildStation(d);
      d.parts = makeCharacter(d);
      d.parts.root.visible = false;
      d.el = makeBubble(d);
    }
    if (a.look && JSON.stringify(a.look) !== d.lookSig) restyle(d, a.look);
    Object.assign(d, { name: a.name || a.project, role: a.role || '', state: a.state, emoji: a.emoji, label: a.label, busy: !!a.busy, lastTime: a.lastTime });
  });
}

// Colores nuevos (Personalizar equipo): se rehacen su mesa y su personaje.
function restyle(d, look) {
  d.lookSig = JSON.stringify(look);
  Object.assign(d, look);
  const old = d.parts;
  for (const o of [d.station, d.ring, old.root]) {
    scene.remove(o);
    o.traverse((x) => { if (x.geometry) x.geometry.dispose(); });
  }
  buildStation(d);
  d.parts = makeCharacter(d);
  d.parts.root.visible = old.root.visible;
  d.parts.root.position.copy(old.root.position);
  d.parts.root.rotation.copy(old.root.rotation);
  d.holoAt = 0;
  for (const m of holo.dots) scene.remove(m);
  holo.dots = [];
}
if (window.office) window.office.onAgents(syncAgents);

function now() { return serverNow + (performance.now() - clientStamp); }
function isTarget(d) { const s = window.PIXEL_TARGET_SESSIONS; return !!(s instanceof Set && s.has(d.id)); }
function isSpeaking(d) { return window.PIXEL_SPEAKING_SESSION === d.id; }
function isSeated(d) { return d.mode === 'seated' || d.mode === 'sofa'; }

// ---- Capa HTML: cabecera, bocadillos y partículas ------------------------------

const header = document.createElement('div');
header.className = 'o3-header';
header.innerHTML = '<span class="o3-logo">🌆</span><b>Pixel Office</b><span class="o3-pill" id="o3team"></span>' +
  '<span class="o3-pill" id="o3busy"></span><span class="o3-pill o3-speak" id="o3speak" hidden></span>' +
  '<span class="o3-grow"></span><span class="o3-tip">arrastra para girar · rueda para acercar · clic en un personaje para hablarle · en su pantalla para ver qué hace</span>' +
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
  return { x: (tmpV.x + 1) / 2 * wrap.clientWidth, y: (1 - tmpV.y) / 2 * wrap.clientHeight };
}

function headWorld(d) {
  return new THREE.Vector3(d.x, (isSeated(d) ? 1.4 : 1.12) * CHAR_SCALE, d.z);
}

// Qué pone el bocadillo: lo que dice main.js, o su actividad si está paseando.
function activityLabel(d) {
  if (d.onErrand) {
    if (d.mode === 'walk') return ['🧭', d.goal === 'seat' ? 'vuelvo a mi mesa' : 'repartiendo tareas'];
    if (d.spot && d.spot.errand) { const [em, ...rest] = d.spot.label.split(' '); return [em, rest.join(' ')]; }
  }
  if (d.busy || d.state !== 'idle') {
    if (d.mode === 'walk' && d.goal === 'seat' && d.hurry) return ['🏃', 'vuelvo a mi mesa'];
    return [d.emoji || '', d.label || ''];
  }
  if (d.mode === 'walk') return ['🚶', d.goal === 'seat' ? 'volviendo a su mesa' : 'dando un paseo'];
  if ((d.mode === 'hang' || d.mode === 'sofa') && d.spot) {
    const [em, ...rest] = d.spot.label.split(' ');
    return [em, rest.join(' ')];
  }
  return [d.emoji || '', d.label || ''];
}

function updateOverlay() {
  const all = [...display.values()];
  const busy = all.filter((d) => d.busy).length;
  header.querySelector('#o3team').textContent = `equipo: ${agentCount} IAs`;
  const b = header.querySelector('#o3busy');
  b.textContent = busy ? `${busy} trabajando` : 'todos libres';
  b.classList.toggle('busy', busy > 0);
  const sp = all.find(isSpeaking);
  const spEl = header.querySelector('#o3speak');
  spEl.hidden = !sp;
  if (sp) spEl.textContent = `🔊 ${sp.name}`;
  const dt = new Date(now());
  header.querySelector('#o3clock').textContent = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;

  for (const d of all) {
    const visible = d.parts.root.visible && d.mode !== 'intro';
    const el = d.el;
    el.style.display = visible ? '' : 'none';
    d.arrowEl.style.display = visible && isTarget(d) ? '' : 'none';
    if (!visible) continue;
    const hw = headWorld(d);
    const p = toScreen(hw.x, hw.y + 0.12, hw.z);
    const speaking = isSpeaking(d);
    const tg = isTarget(d);
    el.classList.toggle('target', tg);
    el.classList.toggle('speaking', speaking);
    el.classList.toggle('away', !d.busy && d.mode !== 'seated');
    el.style.setProperty('--accent', speaking || tg ? TARGET_COLOR : (d.busy ? (STATE_COLOR[d.state] || d.accent) : d.accent || '#9aa0a6'));
    el.querySelector('.o3-name i').style.background = d.busy ? (STATE_COLOR[d.state] || '#9aa0a6') : NEON.green;
    el.querySelector('.o3-name span').textContent = d.name;
    const [em, txt] = speaking ? ['🔊', 'hablando…'] : activityLabel(d);
    el.querySelector('.o3-label em').textContent = em;
    el.querySelector('.o3-label span').textContent = txt;
    el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -100%)`;
    el.style.zIndex = String(1000 + Math.round(p.y));
    if (tg) d.arrowEl.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y - el.offsetHeight - 16 + Math.sin(performance.now() / 200) * 3)}px) translate(-50%, 0)`;
  }
}

// Partículas: glifos flotantes en HTML (código, engranajes, ideas, vapor…).
const particles = [];
function emitAt(world, text, color, opts) {
  if (particles.length > 60) return;
  const el = document.createElement('span');
  el.className = 'o3-particle';
  el.textContent = text;
  if (color) { el.style.color = color; el.style.textShadow = `0 0 6px ${color}`; }
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
    if (d.mode === 'intro' || t < d.emitAt) continue;
    const scr = new THREE.Vector3(d.slot.cx + 0.55, 1.4, d.slot.cz - 0.05);
    if (/^capacit/.test(d.label || '')) {
      emitAt(headWorld(d).add(new THREE.Vector3((Math.random() - 0.5) * 0.5, 0.3, 0)), ['📚', '🎓', '💡'][Math.floor(Math.random() * 3)], null, { max: 1800 });
      d.emitAt = t + 700 + Math.random() * 500;
    } else if (d.working && (d.state === 'coding' || d.state === 'working')) {
      emitAt(scr.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0, 0)), ['{ }', '</>', ';', '=>', '()', '01'][Math.floor(Math.random() * 6)], NEON.green);
      d.emitAt = t + 500 + Math.random() * 500;
    } else if (d.working && d.state === 'thinking') {
      emitAt(headWorld(d).add(new THREE.Vector3(0.25, 0.2, 0)), Math.random() < 0.5 ? '?' : '…', '#d9b8ff', { max: 1600 });
      d.emitAt = t + 900 + Math.random() * 500;
    } else if (d.working && d.state === 'running') {
      emitAt(scr.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0, 0)), '⚙', NEON.yellow);
      d.emitAt = t + 600 + Math.random() * 500;
    } else if (d.working && d.state === 'web') {
      emitAt(scr, '•', '#7aa2ff', { vx: (Math.random() - 0.5) * 0.0005 });
      d.emitAt = t + 350;
    } else if (d.state === 'waiting') {
      emitAt(headWorld(d).add(new THREE.Vector3(0, 0.3, 0)), '!', '#ff5f6d');
      d.emitAt = t + 1200;
    } else if (d.mode === 'hang' && d.spot && d.spot.anim === 'sip') {
      emitAt(new THREE.Vector3(d.x + 0.15, 1.35 * CHAR_SCALE, d.z), '•', 'rgba(233,228,240,0.7)', { vy: 0.00018, max: 1400 });
      d.emitAt = t + 700;
    } else if (d.mode === 'sofa' && Math.random() < 0.3) {
      emitAt(headWorld(d).add(new THREE.Vector3(0.2, 0.2, 0)), '♪', NEON.magenta, { max: 1800 });
      d.emitAt = t + 1500;
    } else {
      d.emitAt = t + 800;
    }
    if (d.hasMug && d.mode === 'seated' && Math.random() < 0.3) emitAt(d.mugTop, '•', 'rgba(233,228,240,0.6)', { vy: 0.00018, max: 1400 });
  }
  if (Math.random() < 0.02) emitAt(new THREE.Vector3(coffeeSteamAt.x, coffeeSteamAt.y, coffeeSteamAt.z), '•', 'rgba(233,228,240,0.6)', { vy: 0.0002, max: 1600 });
}

// ---- Cielo y luz según la hora (ciudad ciberpunk) -------------------------------

const SKY_KEYS = [
  { h: 0, top: '#07041a', bot: '#2b0b3f', stars: 1 },
  { h: 5.5, top: '#07041a', bot: '#2b0b3f', stars: 1 },
  { h: 7, top: '#40205a', bot: '#ff7e67', stars: 0.1 },
  { h: 9, top: '#4a3f86', bot: '#f2a37f', stars: 0 },
  { h: 17.5, top: '#4a3f86', bot: '#f2a37f', stars: 0 },
  { h: 19.5, top: '#2a1050', bot: '#ff4f8b', stars: 0.4 },
  { h: 21, top: '#07041a', bot: '#2b0b3f', stars: 1 },
  { h: 24, top: '#07041a', bot: '#2b0b3f', stars: 1 },
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
  // de día entra un sol anaranjado de "smog"; de noche mandan los neones
  sun.intensity = 0.25 + 1.5 * day;
  sun.color.set(night > 0.5 ? '#8f7bff' : '#ffc7a0');
  hemi.intensity = 0.45 + 0.35 * day;
  fill.intensity = 0.25 + 0.4 * day;
  for (const l of ceiling) l.intensity = 4 * night;
  for (const l of neonLights) l.intensity = l.userData.base * (0.8 + 0.1 * night);
  scene.background.set(mix('#140f24', '#07060d', night));
  scene.fog.color.set(mix('#1c1430', '#0b0818', night));
  bloom.strength = 0.5 + 0.12 * night;
}
neonLights.forEach((l) => { l.userData.base = l.intensity; });

// ---- Gato (con collar de neón) ------------------------------------------------------

const cat = { x: NX[2], z: NZ[3], gx: 2, gz: 3, tx: NX[2], tz: NZ[3], mode: 'sit', until: 0, heading: 0 };
function buildCat() {
  const g = new THREE.Group();
  const fur = mat('#e0a458'), dark = mat('#b97a3a');
  const bodyM = mesh(new THREE.CapsuleGeometry(0.1, 0.22, 4, 10), fur, 0, 0.17, 0, g);
  bodyM.rotation.x = Math.PI / 2;
  const head = mesh(new THREE.SphereGeometry(0.1, 14, 12), fur, 0, 0.3, 0.2, g);
  for (const s of [-1, 1]) {
    const ear = mesh(new THREE.ConeGeometry(0.035, 0.07, 6), fur, s * 0.055, 0.4, 0.2, g);
    ear.rotation.z = -s * 0.2;
    mesh(new THREE.SphereGeometry(0.014, 8, 8), neon(NEON.green, 2), s * 0.04, 0.32, 0.29, g);
  }
  const collar = mesh(new THREE.TorusGeometry(0.075, 0.012, 6, 20), neon(NEON.magenta, 3), 0, 0.24, 0.17, g);
  collar.rotation.x = Math.PI / 2 - 0.4;
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
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = { i: cat.gx + di, j: cat.gz + dj };
      if (n.i < 0 || n.j < 0 || n.i >= NX.length || n.j >= NZ.length) continue;
      if (BLOCKED.has(edgeKey({ i: cat.gx, j: cat.gz }, n))) continue;
      moves.push(n);
    }
    const n = moves[Math.floor(Math.random() * moves.length)];
    cat.gx = n.i; cat.gz = n.j;
    cat.tx = NX[cat.gx]; cat.tz = NZ[cat.gz];
    cat.mode = 'walk';
  }
  const g = cat.group;
  g.position.set(cat.x, 0, cat.z);
  let diff = cat.heading - g.rotation.y;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  g.rotation.y += diff * 0.15;
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
  if (d.mode === 'intro' && t < d.startAt) { P.root.visible = false; return; }
  P.root.visible = true;
  if (d.mode === 'intro' && d.path.length && Math.hypot(d.x - DOOR.x, d.z - DOOR.z) < 0.01) d.mode = 'walk-intro';

  // avanzar por el camino
  const walking = d.mode === 'walk' || d.mode === 'walk-intro' || d.mode === 'intro';
  if (walking) {
    let step = (d.hurry ? 0.003 : d.mode === 'walk' ? 0.0017 : 0.0026) * dt;
    while (step > 0 && d.path.length) {
      const wp = d.path[0];
      const dx = wp.x - d.x, dz = wp.z - d.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.001) d.heading = Math.atan2(dx, dz);
      if (dist <= step) { d.x = wp.x; d.z = wp.z; step -= dist; d.path.shift(); }
      else { d.x += (dx / dist) * step; d.z += (dz / dist) * step; step = 0; }
    }
    if (!d.path.length) {
      if (d.mode !== 'walk') { d.mode = 'seated'; d.goal = null; d.idleSince = 0; } else arrive(d, t);
    }
  }
  const moving = d.mode === 'walk' || d.mode === 'walk-intro';
  const seated = isSeated(d);
  d.working = d.mode === 'seated' && AT_WORK.has(d.state);

  // orientación: al andar, hacia donde va; sentado, hacia la mesa; en un sitio, hacia lo que mira
  const want = moving ? d.heading : d.mode === 'seated' ? 0 : d.spot ? d.spot.face : d.heading;
  let diff = want - P.root.rotation.y;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  P.root.rotation.y += diff * Math.min(1, dt * 0.012);
  P.root.position.set(d.x, 0, d.z);

  if (moving) {
    const sw = Math.sin(t / (d.hurry ? 80 : 120) + d.phase);
    P.body.position.y = Math.abs(sw) * 0.04;
    P.legL.pivot.rotation.x = sw * 0.6;
    P.legR.pivot.rotation.x = -sw * 0.6;
    P.armL.rotation.x = -sw * 0.6;
    P.armR.rotation.x = sw * 0.6;
  } else if (seated) {
    // cadera (0,26 del modelo, escalado) a la altura del asiento (0,56)
    P.body.position.y = 0.56 / CHAR_SCALE - 0.26 + Math.sin(t / 700 + d.phase) * 0.006;
    P.legL.pivot.rotation.x = -Math.PI / 2 + 0.1;
    P.legR.pivot.rotation.x = -Math.PI / 2 + 0.1;
    if (d.mode === 'sofa') {
      P.armL.rotation.x = -0.3;
      P.armR.rotation.x = -0.3;
    } else {
      const typing = d.working && (d.state === 'coding' || d.state === 'running' || d.state === 'working');
      const tap = typing ? Math.sin(t / 70 + d.phase) * 0.12 : 0;
      P.armL.rotation.x = -1.05 + tap;
      P.armR.rotation.x = -1.05 - tap;
    }
  } else {
    // de pie en un sitio: respira; con taza, bebe de vez en cuando
    P.body.position.y = Math.sin(t / 900 + d.phase) * 0.01;
    P.legL.pivot.rotation.x = 0;
    P.legR.pivot.rotation.x = 0;
    const sip = d.spot && d.spot.anim === 'sip' && ((t + d.phase * 13) % 5000) < 1600;
    P.armR.rotation.x = sip ? -2.3 : -0.15;
    P.armL.rotation.x = d.spot && d.spot.visitOf ? -0.6 : -0.1;
  }
  // cabeza: asiente al trabajar, mira a los lados en un sitio, a la cámara si le hablas
  P.head.rotation.x = d.working ? Math.sin(t / 900 + d.phase) * 0.06 + 0.08 : 0;
  P.head.rotation.y = isTarget(d) && d.mode === 'seated' ? Math.sin(t / 1600) * 0.15 + 0.25
    : d.mode === 'hang' ? Math.sin(t / 2200 + d.phase) * 0.4 : 0;

  const blink = ((t + d.phase * 37) % 4300) < 130;
  if (P.eyes) for (const e of P.eyes) e.scale.y = blink ? 0.12 : 1;
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

  // portátil, pantalla holográfica y luz según esté trabajando en su mesa
  const col = new THREE.Color(SCREEN_COLOR[d.state] || d.accent || NEON.cyan);
  d.logo.material.color.copy(d.working ? col.clone().multiplyScalar(2.5) : new THREE.Color('#2a2d40'));
  d.keys.material.color.set(d.working ? '#2a4a55' : '#1a1c28');
  d.glow.color.copy(col);
  d.glow.intensity = d.working ? 1.2 + Math.sin(t / 250 + d.phase) * 0.2 : 0;
  d.holoPanel.material.opacity = d.working ? 0.95 : 0.45;
  d.holoPanel.position.y = 1.15 + Math.sin(t / 900 + d.phase) * 0.015;
  if (t > d.holoAt) { drawHoloScreen(d, t); d.holoAt = t + (d.working ? 150 : 600); }

  // anillo de destino / señalado bajo el personaje
  const tg = isTarget(d);
  d.ring.visible = d.mode !== 'intro' && (tg || hoverId === d.id);
  d.ring.position.set(d.x, 0.02, d.z);
  d.ring.material.color.set(tg ? TARGET_COLOR : '#ffffff').multiplyScalar(tg ? 2 : 1.2);
  d.ring.material.opacity = tg ? 0.65 + Math.sin(t / 260) * 0.3 : 0.5;
  d.ring.scale.setScalar(1 + (tg ? Math.sin(t / 260) * 0.05 : 0));
}

function updateHolo(t) {
  const ds = [...display.values()];
  if (holo.dots.length !== ds.length) {
    for (const m of holo.dots) scene.remove(m);
    holo.dots = ds.map((d) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(d.accent || NEON.cyan).multiplyScalar(2.5), transparent: true, toneMapped: false }));
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
    if (h.object.userData.board) return { board: true, row: boardRowAt(h.uv) };
    if (h.object.userData.id && display.has(h.object.userData.id)) return { id: h.object.userData.id, screen: !!h.object.userData.screen };
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
  boardHover = h && h.board ? h.row : -1;
  canvas.style.cursor = h ? 'pointer' : 'grab';
  const who = h && h.id ? display.get(h.id) : h && h.board && h.row >= 0 ? [...display.values()][h.row] : null;
  canvas.title = h && h.screen && who ? `Ver la pantalla de ${who.name}`
    : h && h.board ? (who ? `Ver la pantalla de ${who.name}` : 'Ver el tablero del equipo') : '';
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
  if (h.board) {
    const d2 = h.row >= 0 ? [...display.values()][h.row] : null;
    window.dispatchEvent(new CustomEvent('pixel:board-open', { detail: { id: d2 ? d2.id : null } }));
    return;
  }
  if (h.screen) {
    window.dispatchEvent(new CustomEvent('pixel:screen', { detail: { id: h.id } }));
    return;
  }
  pick(h.id, e);
});
canvas.addEventListener('pointerleave', () => { hoverId = null; boardHover = -1; });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  orbit.dist = Math.max(11, Math.min(34, orbit.dist * (1 + Math.sign(e.deltaY) * 0.08)));
  placeCamera();
}, { passive: false });
canvas.addEventListener('dblclick', () => { Object.assign(orbit, ORBIT_HOME); placeCamera(); });
canvas.style.cursor = 'grab';

// Para pruebas: posición en pantalla, saltar la entrada y forzar un paseo.
window.PixelOffice = Object.assign(window.PixelOffice || {}, {
  lookFor,
  mode: '3d',
  screenPos(id) {
    const d = display.get(id);
    if (!d) return null;
    const r = canvas.getBoundingClientRect();
    const p = toScreen(d.x, (isSeated(d) ? 1.1 : 0.8) * CHAR_SCALE, d.z);
    return { x: r.left + p.x, y: r.top + p.y };
  },
  skipIntro() {
    for (const d of display.values()) {
      d.path = [];
      d.x = d.slot.seatX;
      d.z = d.slot.seatZ;
      d.mode = 'seated';
      d.goal = null;
      d.parts.root.visible = true;
    }
  },
  // Coloca a un miembro directamente en un sitio (id de SPOTS) o lo manda a pasear.
  debugSpot(id, spotId, teleport) {
    const d = display.get(id);
    const s = SPOTS.find((x) => x.id === spotId);
    if (!d || !s) return false;
    if (teleport) {
      if (d.spot) d.spot.takenBy = null;
      d.path = []; d.x = s.x; d.z = s.z; d.spot = s; s.takenBy = d.id;
      d.mode = s.anim === 'sit' ? 'sofa' : 'hang'; d.until = performance.now() + 60000; d.goal = null;
    } else goTo(d, s);
    return true;
  },
  // posición en pantalla de la pantalla holográfica de su mesa / del tablero
  screenAt(id) {
    const d = display.get(id);
    if (!d) return null;
    const v = new THREE.Vector3();
    d.holoPanel.getWorldPosition(v);
    const r = canvas.getBoundingClientRect();
    const p = toScreen(v.x, v.y, v.z);
    return { x: r.left + p.x, y: r.top + p.y };
  },
  boardAt(row) {
    const r = canvas.getBoundingClientRect();
    const y = row == null ? 1.95 : 1.95 + 0.65 - ((BOARD_TOP + row * BOARD_ROW + BOARD_ROW / 2) / BOARD_H) * 1.3;
    const p = toScreen(2.55, y, 0.06);
    return { x: r.left + p.x, y: r.top + p.y };
  },
  state(id) { const d = display.get(id); return d ? { mode: d.mode, x: +d.x.toFixed(2), z: +d.z.toFixed(2), spot: d.spot && d.spot.id, goal: d.goal && (d.goal.id || d.goal), errands: d.onErrand ? d.errands.slice() : null } : null; },
});

// ---- Bucle ---------------------------------------------------------------------------

buildRoom();
buildCat();
let lastT = 0;
let skyAt = 0;
let slowAt = 0;
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
  if (t - slowAt > 220) {
    slowAt = t;
    drawRack(t);
    drawHoloBoard(t);
    // parpadeo ocasional del letrero de neón
    neonSign.material.color.setScalar(Math.random() < 0.04 ? 0.5 : 1.55 + Math.sin(t / 900) * 0.15);
  }
  updateLedClock(new Date(now()));
  animateNeon(t);
  animateChasers(t);
  if (floorGlow) floorGlow.emissiveIntensity = 0.14 + 0.06 * (0.5 + 0.5 * Math.sin(t / 1800));
  for (const d of display.values()) {
    think(d, t);
    updateCharacter(d, t, dt);
  }
  updateCat(t, dt);
  updateHolo(t);
  emitters(t);
  updateParticles(dt);
  composer.render();
  updateOverlay();
}
requestAnimationFrame(frame);
console.log('OFFICE3D ok; three r' + THREE.REVISION);
