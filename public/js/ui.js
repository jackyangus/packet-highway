// DOM panels: dashboard stats, clickable legend (protocol filter),
// scrolling traffic log, detail card, zh/en strings.
import { VEHICLE_INFO } from './vehicles.js';

const $ = (id) => document.getElementById(id);

const STRINGS = {
  en: {
    legendTitle: "WHO'S DRIVING",
    legendHint: 'click to filter',
    logTitle: 'PASSING TRAFFIC',
    pps: 'packets/s',
    traffic: 'traffic/s',
    cars: 'on the road',
    hint: 'drag to orbit · scroll to zoom · click a vehicle for details',
    proto: 'protocol',
    dir: 'direction',
    len: 'size',
    src: 'source',
    dst: 'destination',
    packet: 'PACKET',
    dirIn: 'inbound →',
    dirOut: '← outbound',
    logIn: '→ in',
    logOut: '← out',
    bytes: (n) => `${n} bytes`,
    vehicles: {
      HTTPS: 'city bus', QUIC: 'sports car', HTTP: 'box truck', DNS: 'motorbike',
      SSH: 'taxi', TCP: 'sedan', UDP: 'minivan', ICMP: 'police car',
      ARP: 'bicycle', OTHER: 'hatchback',
    },
  },
  zh: {
    legendTitle: '谁在开车',
    legendHint: '点击筛选协议',
    logTitle: '过往车流',
    pps: '包/秒',
    traffic: '流量/秒',
    cars: '在路车辆',
    hint: '拖拽旋转 · 滚轮缩放 · 点击车辆查看数据包详情',
    proto: '协议',
    dir: '方向',
    len: '大小',
    src: '源地址',
    dst: '目的地址',
    packet: '数据包',
    dirIn: '入站 →',
    dirOut: '← 出站',
    logIn: '→ 入',
    logOut: '← 出',
    bytes: (n) => `${n} 字节`,
    vehicles: {
      HTTPS: '城市巴士', QUIC: '跑车', HTTP: '箱式货车', DNS: '摩托车',
      SSH: '出租车', TCP: '轿车', UDP: '面包车', ICMP: '警车',
      ARP: '自行车', OTHER: '两厢车',
    },
  },
};

let lang = 'en';
let legendToggle = null; // (proto, enabled) => void
const disabled = new Set();

const MAX_LOG_ROWS = 22;
const LOG_MIN_INTERVAL = 120; // ms between log rows so the panel stays readable
let lastLogAt = 0;

export function isProtoEnabled(proto) {
  return !disabled.has(VEHICLE_INFO[proto] ? proto : 'OTHER');
}

export function setLang(next) {
  lang = next;
  const t = STRINGS[lang];
  $('legend-title').textContent = t.legendTitle;
  $('legend-hint').textContent = t.legendHint;
  $('log-title').textContent = t.logTitle;
  $('l-pps').textContent = t.pps;
  $('l-traffic').textContent = t.traffic;
  $('l-cars').textContent = t.cars;
  $('hint').textContent = t.hint;
  $('l-proto').textContent = t.proto;
  $('l-dir').textContent = t.dir;
  $('l-len').textContent = t.len;
  $('l-src').textContent = t.src;
  $('l-dst').textContent = t.dst;
  $('btn-lang').textContent = lang === 'zh' ? 'EN' : '中';
  renderLegend();
}

export function initLegend(onToggle) {
  legendToggle = onToggle;
  renderLegend();
}

function renderLegend() {
  const t = STRINGS[lang];
  const rows = $('legend-rows');
  rows.innerHTML = '';
  for (const [proto, info] of Object.entries(VEHICLE_INFO)) {
    const row = document.createElement('div');
    row.className = 'legend-row' + (disabled.has(proto) ? ' off' : '');
    row.innerHTML =
      `<span class="legend-chip" style="background:${info.color};color:${info.color}"></span>` +
      `<span class="legend-vehicle">${t.vehicles[proto]}</span>` +
      `<span class="legend-proto">${proto}</span>`;
    row.addEventListener('click', () => {
      const nowEnabled = disabled.has(proto);
      if (nowEnabled) disabled.delete(proto);
      else disabled.add(proto);
      row.classList.toggle('off', !nowEnabled);
      if (legendToggle) legendToggle(proto, nowEnabled);
    });
    rows.appendChild(row);
  }
}

export function setBadge(state) {
  const badge = $('badge');
  const text = $('badge-text');
  badge.className = 'badge ' + (state === 'live' ? 'live' : state === 'mock' ? 'mock' : 'off');
  text.textContent = state === 'live' ? 'LIVE' : state === 'mock' ? 'MOCK' : 'OFFLINE';
}

export function updateStats({ pps, bytesPerSec, cars }) {
  $('stat-pps').textContent = String(pps);
  $('stat-kbps').textContent = `${(bytesPerSec / 1024).toFixed(1)} KB`;
  $('stat-cars').textContent = String(cars);
}

export function logPacket(p) {
  const now = performance.now();
  if (now - lastLogAt < LOG_MIN_INTERVAL) return;
  lastLogAt = now;

  const t = STRINGS[lang];
  const rows = $('log-rows');
  const row = document.createElement('div');
  row.className = 'log-row';
  const color = (VEHICLE_INFO[p.proto] || VEHICLE_INFO.OTHER).color;
  row.innerHTML =
    `<span class="log-proto" style="color:${color}">${p.proto}</span>` +
    `<span class="log-bytes">${p.len} B</span>` +
    `<span class="log-dir">${p.dir === 'in' ? t.logIn : t.logOut}</span>`;
  rows.prepend(row);
  while (rows.children.length > MAX_LOG_ROWS) rows.lastChild.remove();
}

export function showTooltip(p, x, y) {
  const t = STRINGS[lang];
  const key = VEHICLE_INFO[p.proto] ? p.proto : 'OTHER';
  const tip = $('tooltip');
  $('tt-title').textContent = `${p.proto} · ${t.vehicles[key]}`;
  $('tt-title').style.color = VEHICLE_INFO[key].color;
  $('tt-route').textContent =
    `${p.src || '?'}${p.sport ? ':' + p.sport : ''} → ${p.dst || '?'}${p.dport ? ':' + p.dport : ''}`;
  $('tt-meta').textContent = `${t.bytes(p.len)} · ${p.dir === 'in' ? t.dirIn : t.dirOut}`;
  tip.classList.remove('hidden');
  // keep the tip on screen: flip to the left/top of the cursor near the edges
  const pad = 14;
  const r = tip.getBoundingClientRect();
  let left = x + pad;
  let top = y + pad;
  if (left + r.width > window.innerWidth - 8) left = x - r.width - pad;
  if (top + r.height > window.innerHeight - 8) top = y - r.height - pad;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

export function hideTooltip() {
  $('tooltip').classList.add('hidden');
}

export function showDetail(p) {
  const t = STRINGS[lang];
  const key = VEHICLE_INFO[p.proto] ? p.proto : 'OTHER';
  $('detail-title').textContent = `${t.packet} · ${t.vehicles[key]}`;
  $('d-proto').textContent = p.proto;
  $('d-proto').style.color = VEHICLE_INFO[key].color;
  $('d-dir').textContent = p.dir === 'in' ? t.dirIn : t.dirOut;
  $('d-len').textContent = t.bytes(p.len);
  $('d-src').textContent = p.src ? `${p.src}${p.sport ? ':' + p.sport : ''}` : '—';
  $('d-dst').textContent = p.dst ? `${p.dst}${p.dport ? ':' + p.dport : ''}` : '—';
  $('detail').classList.remove('hidden');
}

export function hideDetail() {
  $('detail').classList.add('hidden');
}

export function initDetailClose() {
  $('detail-close').addEventListener('click', hideDetail);
}
