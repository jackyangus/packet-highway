// Vehicle fleet: low-poly vehicle geometry per protocol + InstancedMesh pools.
// Each type gets two InstancedMeshes sharing matrices: a lit body (Lambert,
// vertex colors) and an HDR lights mesh (Basic, toneMapped=false) so head/tail
// lights and beacons bleed through the bloom pass.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const TIRE = '#0c0e14';
const GLASS = '#0d1626';
const DRIVER = '#27314a';

// box with per-vertex color; color may be '#rrggbb' or [r,g,b] with HDR values
function cbox(w, h, d, x, y, z, color) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  const c = Array.isArray(color) ? color : (() => {
    const t = new THREE.Color(color);
    return [t.r, t.g, t.b];
  })();
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c[0];
    arr[i * 3 + 1] = c[1];
    arr[i * 3 + 2] = c[2];
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function wheels(xOff, y, zList, w = 0.3, r = 0.6) {
  return zList.flatMap((z) => [
    cbox(w, r, r * 1.15, -xOff, y, z, TIRE),
    cbox(w, r, r * 1.15, xOff, y, z, TIRE),
  ]);
}

// head/tail light pair; front faces +Z
const HEAD = [2.6, 2.5, 2.0];
const TAIL = [2.6, 0.35, 0.3];
function lampPair(xOff, y, frontZ, rearZ, s = 0.3) {
  return [
    cbox(s, s * 0.6, 0.08, -xOff, y, frontZ, HEAD),
    cbox(s, s * 0.6, 0.08, xOff, y, frontZ, HEAD),
    cbox(s, s * 0.6, 0.08, -xOff, y, rearZ, TAIL),
    cbox(s, s * 0.6, 0.08, xOff, y, rearZ, TAIL),
  ];
}

function sedanBody(color) {
  return [
    cbox(2.0, 0.6, 4.4, 0, 0.62, 0, color),
    cbox(1.7, 0.55, 2.2, 0, 1.18, -0.25, GLASS),
    cbox(1.74, 0.1, 2.0, 0, 1.48, -0.25, color),
    ...wheels(0.95, 0.32, [1.45, -1.45]),
  ];
}

const TYPES = {
  HTTPS: {
    vehicle: 'city bus',
    color: '#3b82f6',
    body: (c) => [
      cbox(2.4, 2.2, 9.6, 0, 1.5, 0, c),
      cbox(2.44, 0.65, 8.6, 0, 2.05, 0.2, GLASS),
      cbox(2.2, 0.5, 0.1, 0, 1.0, 4.81, GLASS),
      ...wheels(1.1, 0.38, [3.4, -1.2, -3.4], 0.35, 0.75),
    ],
    lights: () => lampPair(0.85, 0.85, 4.85, -4.85, 0.4),
  },
  QUIC: {
    vehicle: 'sports car',
    color: '#ef4444',
    body: (c) => [
      cbox(2.0, 0.5, 4.3, 0, 0.5, 0, c),
      cbox(1.9, 0.3, 1.2, 0, 0.68, 1.75, c),
      cbox(1.55, 0.45, 1.7, 0, 0.95, -0.45, GLASS),
      cbox(1.9, 0.12, 0.5, 0, 1.0, -2.0, c),
      ...wheels(0.98, 0.3, [1.45, -1.4], 0.34, 0.58),
    ],
    lights: () => lampPair(0.62, 0.58, 2.16, -2.16, 0.32),
  },
  HTTP: {
    vehicle: 'box truck',
    color: '#f97316',
    body: (c) => [
      cbox(2.1, 1.5, 1.7, 0, 1.07, 2.7, c),
      cbox(1.9, 0.55, 0.12, 0, 1.55, 3.56, GLASS),
      cbox(2.4, 2.3, 5.4, 0, 1.5, -0.9, c),
      ...wheels(1.05, 0.36, [2.7, -0.6, -2.6], 0.34, 0.72),
    ],
    lights: () => lampPair(0.75, 0.62, 3.56, -3.62, 0.34),
  },
  DNS: {
    vehicle: 'motorbike',
    color: '#facc15',
    body: (c) => [
      cbox(0.5, 0.45, 1.9, 0, 0.72, 0, c),
      cbox(0.18, 0.62, 0.62, 0, 0.34, 1.05, TIRE),
      cbox(0.18, 0.62, 0.62, 0, 0.34, -1.05, TIRE),
      cbox(0.46, 0.65, 0.5, 0, 1.25, -0.25, DRIVER),
      cbox(0.34, 0.3, 0.36, 0, 1.72, -0.25, c),
    ],
    lights: () => [
      cbox(0.2, 0.16, 0.07, 0, 0.78, 0.96, HEAD),
      cbox(0.2, 0.14, 0.07, 0, 0.78, -0.96, TAIL),
    ],
  },
  SSH: {
    vehicle: 'taxi',
    color: '#22c55e',
    body: (c) => sedanBody(c),
    lights: () => [
      ...lampPair(0.62, 0.66, 2.21, -2.21),
      cbox(0.75, 0.26, 0.5, 0, 1.66, -0.25, [1.6, 1.5, 0.5]), // roof sign
    ],
  },
  TCP: {
    vehicle: 'sedan',
    color: '#22d3ee',
    body: (c) => sedanBody(c),
    lights: () => lampPair(0.62, 0.66, 2.21, -2.21),
  },
  UDP: {
    vehicle: 'minivan',
    color: '#a855f7',
    body: (c) => [
      cbox(2.1, 1.55, 5.0, 0, 1.1, -0.15, c),
      cbox(1.95, 0.6, 0.12, 0, 1.45, 2.36, GLASS),
      cbox(2.14, 0.5, 3.2, 0, 1.45, -0.7, GLASS),
      cbox(2.0, 0.6, 0.8, 0, 0.62, 2.2, c),
      ...wheels(1.0, 0.34, [1.7, -1.7], 0.32, 0.66),
    ],
    lights: () => lampPair(0.7, 0.66, 2.61, -2.66, 0.34),
  },
  ICMP: {
    vehicle: 'police car',
    color: '#f8fafc',
    body: (c) => sedanBody(c),
    lights: () => [
      ...lampPair(0.62, 0.66, 2.21, -2.21),
      cbox(0.42, 0.2, 0.5, -0.42, 1.62, -0.25, [3.0, 0.25, 0.25]), // beacon red
      cbox(0.42, 0.2, 0.5, 0.42, 1.62, -0.25, [0.3, 0.5, 3.0]),    // beacon blue
    ],
  },
  ARP: {
    vehicle: 'bicycle',
    color: '#9ca3af',
    body: (c) => [
      cbox(0.12, 0.4, 1.6, 0, 0.7, 0, c),
      cbox(0.14, 0.6, 0.55, 0, 0.32, 0.8, TIRE),
      cbox(0.14, 0.6, 0.55, 0, 0.32, -0.8, TIRE),
      cbox(0.42, 0.12, 0.12, 0, 1.02, 0.7, c),
      cbox(0.4, 0.75, 0.4, 0, 1.32, -0.25, DRIVER),
    ],
    lights: () => [
      cbox(0.12, 0.1, 0.06, 0, 0.95, 0.85, [1.6, 1.6, 1.3]),
      cbox(0.12, 0.1, 0.06, 0, 0.95, -0.85, [1.6, 0.25, 0.2]),
    ],
  },
  OTHER: {
    vehicle: 'hatchback',
    color: '#4b5563',
    body: (c) => [
      cbox(1.9, 0.6, 3.6, 0, 0.6, 0, c),
      cbox(1.65, 0.55, 1.9, 0, 1.15, -0.55, GLASS),
      cbox(1.7, 0.1, 1.7, 0, 1.45, -0.55, c),
      ...wheels(0.9, 0.3, [1.15, -1.15], 0.3, 0.56),
    ],
    lights: () => lampPair(0.58, 0.64, 1.81, -1.81, 0.28),
  },
};

export const VEHICLE_INFO = Object.fromEntries(
  Object.entries(TYPES).map(([proto, t]) => [proto, { vehicle: t.vehicle, color: t.color }])
);

const CAPACITY = 150; // per type
// 8 lanes per direction, 3.4 units wide, median barrier at x=0
const LANES_PER_DIR = 8;
const INBOUND_LANES = Array.from({ length: LANES_PER_DIR }, (_, i) => -(2.4 + i * 3.4));
const OUTBOUND_LANES = Array.from({ length: LANES_PER_DIR }, (_, i) => 2.4 + i * 3.4);
const SPAWN_FAR = -285;
const SPAWN_NEAR = 52;

// approximate body length per type, used for following distance
const TYPE_LEN = {
  HTTPS: 9.7, QUIC: 4.4, HTTP: 7.4, DNS: 2.1, SSH: 4.5,
  TCP: 4.5, UDP: 5.2, ICMP: 4.5, ARP: 1.8, OTHER: 3.7,
};

const LANE_CHANGE_RATE = 6; // lateral units/s
const ACCEL = 26; // units/s^2 back toward desired speed

const _mat = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const NO_FLIP = new THREE.Quaternion();
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

export class VehicleFleet {
  constructor(scene) {
    this.types = {};
    this.bodyMeshes = [];
    this.activeCount = 0;

    const bodyMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const lightMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });

    for (const [proto, def] of Object.entries(TYPES)) {
      const bodyGeo = mergeGeometries(def.body(def.color));
      const lightGeo = mergeGeometries(def.lights());
      const body = new THREE.InstancedMesh(bodyGeo, bodyMat, CAPACITY);
      const lights = new THREE.InstancedMesh(lightGeo, lightMat, CAPACITY);
      for (const m of [body, lights]) {
        m.frustumCulled = false;
        for (let i = 0; i < CAPACITY; i++) m.setMatrixAt(i, HIDDEN);
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        // fixed sphere covering the whole road corridor: three.js would
        // otherwise cache a degenerate sphere computed before any car exists
        // and every raycast (hover/click picking) would miss forever
        m.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, -120), 220);
        scene.add(m);
      }
      body.userData.proto = proto;
      this.bodyMeshes.push(body);
      this.types[proto] = {
        body,
        lights,
        free: Array.from({ length: CAPACITY }, (_, i) => CAPACITY - 1 - i),
        slots: new Array(CAPACITY).fill(null),
      };
    }
  }

  // instantly clear all on-road vehicles of one protocol (legend filter)
  despawnAll(proto) {
    const t = this.types[proto];
    if (!t) return;
    for (let i = 0; i < t.slots.length; i++) {
      if (!t.slots[i]) continue;
      t.slots[i] = null;
      t.free.push(i);
      this.activeCount--;
      t.body.setMatrixAt(i, HIDDEN);
      t.lights.setMatrixAt(i, HIDDEN);
    }
    t.body.instanceMatrix.needsUpdate = true;
    t.lights.instanceMatrix.needsUpdate = true;
  }

  // size → speed & length: big packets are slower and longer
  spawn(packet) {
    const proto = this.types[packet.proto] ? packet.proto : 'OTHER';
    const t = this.types[proto];
    if (t.free.length === 0) return false;

    const sizeNorm = Math.min(1, Math.max(0, (Math.log2(Math.max(packet.len, 48)) - 5.6) / (10.7 - 5.6)));
    const inbound = packet.dir === 'in';
    const dirSign = inbound ? 1 : -1;
    const z = inbound ? SPAWN_FAR : SPAWN_NEAR;
    const spawnP = z * dirSign;
    const lenScale = 0.85 + 0.65 * sizeNorm;
    const halfLen = (TYPE_LEN[proto] * lenScale) / 2;

    // pick a lane with room at the spawn point so cars don't stack
    const laneList = this.laneVehicles(dirSign);
    let laneIdx = (Math.random() * LANES_PER_DIR) | 0;
    for (let tries = 0; tries < LANES_PER_DIR; tries++) {
      const cand = (laneIdx + tries) % LANES_PER_DIR;
      const blocked = laneList[cand].some((o) => Math.abs(o.z * o.dirSign - spawnP) < halfLen + o.halfLen + 9);
      if (!blocked) {
        laneIdx = cand;
        break;
      }
    }

    const idx = t.free.pop();
    const desired = 72 - 44 * sizeNorm + (Math.random() - 0.5) * 5;
    t.slots[idx] = {
      packet,
      laneIdx,
      x: (inbound ? INBOUND_LANES : OUTBOUND_LANES)[laneIdx],
      z,
      dirSign,
      desired,
      speed: desired,
      lenScale,
      halfLen,
      cooldown: 0,
    };
    this.activeCount++;
    return true;
  }

  // active vehicles grouped per lane for one direction
  laneVehicles(dirSign) {
    const lanes = Array.from({ length: LANES_PER_DIR }, () => []);
    for (const t of Object.values(this.types)) {
      for (const v of t.slots) {
        if (v && v.dirSign === dirSign) lanes[v.laneIdx].push(v);
      }
    }
    return lanes;
  }

  // nearest gaps ahead/behind of progress p in a lane
  static gapsAt(laneArr, p, halfLen, self) {
    let ahead = Infinity;
    let behind = Infinity;
    let leader = null;
    for (const o of laneArr) {
      if (o === self) continue;
      const d = o.z * o.dirSign - p;
      if (d >= 0) {
        const gap = d - o.halfLen - halfLen;
        if (gap < ahead) {
          ahead = gap;
          leader = o;
        }
      } else {
        const gap = -d - o.halfLen - halfLen;
        if (gap < behind) behind = gap;
      }
    }
    return { ahead, behind, leader };
  }

  update(dt) {
    // traffic logic: follow the car ahead, change lanes to overtake
    for (const dirSign of [1, -1]) {
      const lanes = this.laneVehicles(dirSign);
      for (let li = 0; li < LANES_PER_DIR; li++) {
        for (const v of lanes[li]) {
          if (v.cooldown > 0) v.cooldown -= dt;
          const p = v.z * v.dirSign;
          const { ahead, leader } = VehicleFleet.gapsAt(lanes[li], p, v.halfLen, v);
          const followGap = 4 + v.speed * 0.22;

          if (!leader || ahead > followGap) {
            // open road: ease back up to desired speed
            v.speed = Math.min(v.desired, v.speed + ACCEL * dt);
            continue;
          }

          // blocked behind a slower car: try an adjacent lane with room
          if (v.cooldown <= 0 && leader.speed < v.desired - 3) {
            let best = -1;
            let bestAhead = ahead;
            for (const nl of [li - 1, li + 1]) {
              if (nl < 0 || nl >= LANES_PER_DIR) continue;
              const g = VehicleFleet.gapsAt(lanes[nl], p, v.halfLen, v);
              if (g.ahead > followGap + 5 && g.behind > 7 && g.ahead > bestAhead) {
                best = nl;
                bestAhead = g.ahead;
              }
            }
            if (best >= 0) {
              v.laneIdx = best;
              v.cooldown = 2;
              continue; // keep speed through the lane change
            }
          }

          // can't change lanes: follow, brake harder when really close
          v.speed = Math.min(v.speed, ahead < 1.5 ? leader.speed * 0.8 : Math.max(leader.speed, 3));
        }
      }
    }

    // integrate motion and write instance matrices
    const laneX = { 1: INBOUND_LANES, '-1': OUTBOUND_LANES };
    for (const t of Object.values(this.types)) {
      let dirty = false;
      for (let i = 0; i < t.slots.length; i++) {
        const v = t.slots[i];
        if (!v) continue;
        v.z += v.dirSign * v.speed * dt;
        const dx = laneX[v.dirSign][v.laneIdx] - v.x;
        const step = LANE_CHANGE_RATE * dt;
        v.x += Math.abs(dx) <= step ? dx : Math.sign(dx) * step;
        if ((v.dirSign > 0 && v.z > SPAWN_NEAR + 12) || (v.dirSign < 0 && v.z < SPAWN_FAR - 12)) {
          t.slots[i] = null;
          t.free.push(i);
          this.activeCount--;
          t.body.setMatrixAt(i, HIDDEN);
          t.lights.setMatrixAt(i, HIDDEN);
          dirty = true;
          continue;
        }
        _pos.set(v.x, 0, v.z);
        _scale.set(1, 1, v.lenScale);
        _mat.compose(_pos, v.dirSign > 0 ? NO_FLIP : FLIP, _scale);
        t.body.setMatrixAt(i, _mat);
        t.lights.setMatrixAt(i, _mat);
        dirty = true;
      }
      if (dirty) {
        t.body.instanceMatrix.needsUpdate = true;
        t.lights.instanceMatrix.needsUpdate = true;
      }
    }
  }

  pick(raycaster) {
    const hits = raycaster.intersectObjects(this.bodyMeshes, false);
    for (const hit of hits) {
      if (hit.instanceId === undefined) continue;
      const v = this.types[hit.object.userData.proto].slots[hit.instanceId];
      if (v) return v.packet;
    }
    return null;
  }
}
