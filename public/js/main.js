import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { buildWorld } from './scene.js';
import { VehicleFleet } from './vehicles.js';
import { connect } from './net.js';
import * as ui from './ui.js';

// legend click toggles a protocol: stop spawning it and clear it off the road
ui.initLegend((proto, enabled) => {
  if (!enabled && fleet) fleet.despawnAll(proto);
});
ui.initDetailClose();

// ------------------------------------------------------- lang & theme
let theme = localStorage.getItem('ph-theme') || 'dark';
let lang = localStorage.getItem('ph-lang') || (navigator.language.startsWith('zh') ? 'zh' : 'en');

function applyLang() {
  ui.setLang(lang);
  localStorage.setItem('ph-lang', lang);
}

function applyTheme() {
  document.documentElement.dataset.theme = theme;
  document.getElementById('btn-theme').textContent = theme === 'dark' ? '☀' : '☾';
  if (world) world.setTheme(theme);
  if (bloom) bloom.strength = theme === 'dark' ? 0.85 : 0.25;
  localStorage.setItem('ph-theme', theme);
}

document.getElementById('btn-lang').addEventListener('click', () => {
  lang = lang === 'zh' ? 'en' : 'zh';
  applyLang();
});
document.getElementById('btn-theme').addEventListener('click', () => {
  theme = theme === 'dark' ? 'light' : 'dark';
  applyTheme();
});

// ------------------------------------------------------------- renderer
// If WebGL is unavailable the dashboard/log still work — only the 3D dies.
const canvas = document.getElementById('scene');
let renderer = null;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
} catch (e) {
  console.error('WebGL unavailable:', e);
  const note = document.createElement('div');
  note.className = 'panel';
  note.style.cssText = 'top:50%;left:50%;transform:translate(-50%,-50%)';
  note.textContent = 'WebGL is not available in this browser — stats only.';
  document.body.appendChild(note);
}

let fleet = null;
let composer = null;
let controls = null;
let camera = null;
let world = null;
let bloom = null;

if (renderer) {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1200);
  camera.position.set(26, 40, 72);

  controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 2, -45);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 12;
  controls.maxDistance = 220;
  controls.maxPolarAngle = Math.PI * 0.49;

  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight), 0.85, 0.45, 0.78
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  world = buildWorld(scene);
  fleet = new VehicleFleet(scene);

  // --------------------------------------------------------- picking
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let downX = 0;
  let downY = 0;

  canvas.addEventListener('pointerdown', (e) => {
    downX = e.clientX;
    downY = e.clientY;
  });

  // hover: raycast at most every 50 ms, skipped while orbiting
  let lastHoverAt = 0;
  canvas.addEventListener('pointermove', (e) => {
    if (e.buttons !== 0) {
      ui.hideTooltip();
      return;
    }
    const now = performance.now();
    if (now - lastHoverAt < 50) return;
    lastHoverAt = now;
    pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const packet = fleet.pick(raycaster);
    if (packet) {
      ui.showTooltip(packet, e.clientX, e.clientY);
      canvas.style.cursor = 'pointer';
    } else {
      ui.hideTooltip();
      canvas.style.cursor = '';
    }
  });

  canvas.addEventListener('pointerleave', () => {
    ui.hideTooltip();
    canvas.style.cursor = '';
  });

  canvas.addEventListener('pointerup', (e) => {
    // a click, not the end of an orbit drag
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return;
    pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const packet = fleet.pick(raycaster);
    if (packet) ui.showDetail(packet);
    else ui.hideDetail();
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
  });
}

applyLang();
applyTheme();

// ------------------------------------------------------------ data feed
// rolling 1-second window for packets/s and bytes/s (stats count everything;
// the legend filter only hides vehicles and log rows)
const window1s = [];
let pendingSpawn = [];

connect({
  onPackets: (packets, dropped) => {
    const now = performance.now();
    let bytes = 0;
    for (const p of packets) bytes += p.len;
    window1s.push({ t: now, count: packets.length + dropped, bytes });
    const visible = packets.filter((p) => ui.isProtoEnabled(p.proto));
    if (fleet) pendingSpawn.push(...visible);
    for (const p of visible) ui.logPacket(p);
  },
  onStatus: (s) => ui.setBadge(s.mode === 'starting' ? 'off' : s.mode),
  onDisconnect: () => ui.setBadge('off'),
});

// ----------------------------------------------------------- main loop
const clock = new THREE.Clock();
let lastStatsAt = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);

  if (fleet) {
    // spawn queued packets gradually (cap per frame to avoid hitches on bursts)
    let budget = 24;
    while (pendingSpawn.length && budget-- > 0) {
      fleet.spawn(pendingSpawn.shift());
    }
    if (pendingSpawn.length > 600) pendingSpawn = pendingSpawn.slice(-300);

    fleet.update(dt);
    controls.update();
    composer.render();
  }

  const now = performance.now();
  if (now - lastStatsAt > 250) {
    lastStatsAt = now;
    while (window1s.length && now - window1s[0].t > 1000) window1s.shift();
    let pps = 0;
    let bps = 0;
    for (const w of window1s) {
      pps += w.count;
      bps += w.bytes;
    }
    ui.updateStats({ pps, bytesPerSec: bps, cars: fleet ? fleet.activeCount : 0 });
  }
}

animate();
