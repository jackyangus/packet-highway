// Static world: highway surface, lane markings, median barrier, low-poly city
// blocks, street lamps, stars. buildWorld() returns a handle whose setTheme()
// swaps between night (dark) and day (light) palettes in place.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const ROAD_LEN = 380;
const ROAD_Z = -120; // road spans z in [-310, 70]

const PALETTES = {
  dark: {
    bg: 0x070d1f,
    fogNear: 100, fogFar: 340,
    hemiSky: 0x46568c, hemiGround: 0x0b101d, hemiIntensity: 1.0,
    sun: 0x8fa3ff, sunIntensity: 0.7,
    road: 0x161c2e, ground: 0x070c19, barrier: 0x2a3148, pole: 0x39415c,
    lampHead: [2.2, 1.9, 1.3],
    stars: true,
  },
  light: {
    bg: 0xaac6e4,
    fogNear: 130, fogFar: 430,
    hemiSky: 0xd6e7ff, hemiGround: 0x8a917e, hemiIntensity: 1.3,
    sun: 0xfff1d6, sunIntensity: 1.7,
    road: 0x4d5468, ground: 0x7e8a78, barrier: 0x9aa0b4, pole: 0x6a7388,
    lampHead: [0.45, 0.44, 0.4],
    stars: false,
  },
};

function buildingTexture(mode) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = mode === 'dark' ? '#0a1124' : '#9aa7bd';
  ctx.fillRect(0, 0, 64, 128);
  const lit = ['#ffd789', '#ffe9b8', '#bcd2ff', '#9fefff'];
  for (let y = 4; y < 124; y += 9) {
    for (let x = 4; x < 60; x += 8) {
      if (mode === 'dark' && Math.random() < 0.24) {
        ctx.fillStyle = lit[(Math.random() * lit.length) | 0];
        ctx.globalAlpha = 0.55 + Math.random() * 0.45;
      } else {
        ctx.fillStyle = mode === 'dark' ? '#101a33' : '#5d7a99';
        ctx.globalAlpha = 1;
      }
      ctx.fillRect(x, y, 4.5, 5);
    }
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildWorld(scene) {
  const refs = { buildings: [], lambert: {}, fog: null, hemi: null, sun: null, lampHeadMat: null, stars: null };

  scene.background = new THREE.Color();
  refs.fog = new THREE.Fog(0x000000, 100, 340);
  scene.fog = refs.fog;

  refs.hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 1.0);
  scene.add(refs.hemi);
  refs.sun = new THREE.DirectionalLight(0xffffff, 0.7);
  refs.sun.position.set(50, 90, 30);
  scene.add(refs.sun);

  // ---- road & ground
  const lambert = (key) => (refs.lambert[key] = new THREE.MeshLambertMaterial());

  const road = new THREE.Mesh(new THREE.PlaneGeometry(58, ROAD_LEN), lambert('road'));
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0, ROAD_Z);
  scene.add(road);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), lambert('ground'));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.05, ROAD_Z);
  scene.add(ground);

  // lane markings: dashed white between lanes, solid yellow-ish at the median,
  // solid white at the outer edges
  // 8 lanes per direction (3.4 wide, centers ±2.4 + i*3.4): dashed boundaries
  // between lanes, solid lines beside the median, solid edge lines
  const dashes = [];
  for (let b = 0; b < 7; b++) {
    for (const x of [-(4.1 + b * 3.4), 4.1 + b * 3.4]) {
      for (let z = -310; z < 70; z += 6.5) {
        dashes.push(new THREE.BoxGeometry(0.18, 0.02, 2.4).translate(x, 0.02, z + 1.2));
      }
    }
  }
  for (const x of [-0.7, 0.7]) {
    dashes.push(new THREE.BoxGeometry(0.16, 0.02, ROAD_LEN).translate(x, 0.02, ROAD_Z));
  }
  scene.add(new THREE.Mesh(mergeGeometries(dashes), new THREE.MeshBasicMaterial({ color: 0xbac4dd })));

  const edges = [];
  for (const x of [-28.0, 28.0]) {
    edges.push(new THREE.BoxGeometry(0.2, 0.02, ROAD_LEN).translate(x, 0.02, ROAD_Z));
  }
  scene.add(new THREE.Mesh(mergeGeometries(edges), new THREE.MeshBasicMaterial({ color: 0x6f7a99 })));

  const barrier = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.55, ROAD_LEN), lambert('barrier'));
  barrier.position.set(0, 0.27, ROAD_Z);
  scene.add(barrier);

  // ---- city blocks (4 texture variants, day+night maps each)
  const unit = new THREE.BoxGeometry(1, 1, 1);
  unit.translate(0, 0.5, 0); // base sits on the ground
  const mat4 = new THREE.Matrix4();
  for (let v = 0; v < 4; v++) {
    const entry = {
      night: buildingTexture('dark'),
      day: buildingTexture('light'),
      mesh: new THREE.InstancedMesh(unit, new THREE.MeshBasicMaterial(), 36),
    };
    for (let i = 0; i < 36; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const x = side * (44 + Math.random() * 95);
      const z = -310 + Math.random() * 375;
      mat4.makeScale(8 + Math.random() * 14, 14 + Math.random() * 55, 8 + Math.random() * 14);
      mat4.setPosition(x, 0, z);
      entry.mesh.setMatrixAt(i, mat4);
    }
    entry.mesh.instanceMatrix.needsUpdate = true;
    scene.add(entry.mesh);
    refs.buildings.push(entry);
  }

  // ---- street lamps
  const poles = [];
  const heads = [];
  for (let z = -300; z <= 60; z += 36) {
    for (const side of [-1, 1]) {
      const x = side * 29.6;
      poles.push(new THREE.BoxGeometry(0.22, 7.5, 0.22).translate(x, 3.75, z));
      poles.push(new THREE.BoxGeometry(2.4, 0.16, 0.16).translate(x - side * 1.2, 7.4, z));
      heads.push(new THREE.BoxGeometry(0.7, 0.18, 0.4).translate(x - side * 2.2, 7.3, z));
    }
  }
  scene.add(new THREE.Mesh(mergeGeometries(poles), lambert('pole')));
  refs.lampHeadMat = new THREE.MeshBasicMaterial({ toneMapped: false });
  scene.add(new THREE.Mesh(mergeGeometries(heads), refs.lampHeadMat));

  // ---- stars (night only)
  const n = 700;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI * 0.42; // upper dome only
    pos[i * 3] = 600 * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = 600 * Math.cos(phi);
    pos[i * 3 + 2] = 600 * Math.sin(phi) * Math.sin(theta);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  refs.stars = new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({ color: 0xb9ccf2, size: 1.4, sizeAttenuation: false })
  );
  scene.add(refs.stars);

  return {
    setTheme(mode) {
      const p = PALETTES[mode] || PALETTES.dark;
      scene.background.set(p.bg);
      refs.fog.color.set(p.bg);
      refs.fog.near = p.fogNear;
      refs.fog.far = p.fogFar;
      refs.hemi.color.set(p.hemiSky);
      refs.hemi.groundColor.set(p.hemiGround);
      refs.hemi.intensity = p.hemiIntensity;
      refs.sun.color.set(p.sun);
      refs.sun.intensity = p.sunIntensity;
      refs.lambert.road.color.set(p.road);
      refs.lambert.ground.color.set(p.ground);
      refs.lambert.barrier.color.set(p.barrier);
      refs.lambert.pole.color.set(p.pole);
      refs.lampHeadMat.color.setRGB(...p.lampHead);
      refs.stars.visible = p.stars;
      for (const b of refs.buildings) {
        b.mesh.material.map = mode === 'light' ? b.day : b.night;
        b.mesh.material.needsUpdate = true;
      }
    },
  };
}
