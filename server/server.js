/*
 * Packet Highway — backend
 * Captures live packets with tshark (-T ek streaming JSON), classifies them,
 * and pushes them to the browser over WebSocket. Falls back to a mock traffic
 * generator when tshark is unavailable or lacks capture permission.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const PORT = process.env.PORT ? Number(process.env.PORT) : 8339;
const FORCE_MOCK = process.env.MOCK === '1' || process.argv.includes('--mock');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// Interfaces to capture. PH_IFACE accepts a comma-separated list. On macOS
// there is no 'any' pseudo-device, so default to the primary interface plus
// any active VPN/proxy tunnel (utun* with an IPv4 address) — proxies like
// Clash/Surge route most traffic through their tun, and capturing only en0
// would show encrypted proxy packets instead of the real protocols.
function detectIfaces() {
  if (process.env.PH_IFACE) return process.env.PH_IFACE.split(',').map((s) => s.trim());
  if (process.platform !== 'darwin') return ['any'];
  const ifaces = [];
  try {
    const route = require('child_process').execSync('route -n get default 2>/dev/null', { encoding: 'utf8' });
    const m = route.match(/interface:\s*(\S+)/);
    if (m) ifaces.push(m[1]);
  } catch { /* fall through */ }
  if (ifaces.length === 0) ifaces.push('en0');
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (name.startsWith('utun') && (addrs || []).some((a) => a.family === 'IPv4')) {
      ifaces.push(name);
    }
  }
  return ifaces;
}
const IFACES = detectIfaces();
const IFACE = IFACES.join(',');

// ---------------------------------------------------------------- local IPs
const LOCAL_IPS = new Set(['127.0.0.1', '::1']);
for (const ifaces of Object.values(os.networkInterfaces())) {
  for (const i of ifaces || []) LOCAL_IPS.add(i.address);
}

// ------------------------------------------------------------ static server
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  let filePath = path.normalize(path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

// -------------------------------------------------------------- WebSocket
const wss = new WebSocket.Server({ server, path: '/ws' });
let mode = 'starting'; // 'live' | 'mock'

function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  }
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'status', mode, iface: IFACE }));
});

function setMode(m, reason) {
  if (mode === m) return;
  mode = m;
  if (reason) console.log(`[packet-highway] mode -> ${m}: ${reason}`);
  broadcast({ type: 'status', mode, iface: IFACE });
}

// ------------------------------------------------------- packet batching
// Packets are queued and flushed every ~70 ms so high traffic doesn't turn
// into thousands of tiny WebSocket frames.
const MAX_BATCH = 400;
let queue = [];
let droppedInBatch = 0;

function pushPacket(p) {
  if (queue.length < MAX_BATCH) queue.push(p);
  else droppedInBatch++;
}

setInterval(() => {
  if (queue.length === 0 && droppedInBatch === 0) return;
  broadcast({ type: 'packets', packets: queue, dropped: droppedInBatch });
  queue = [];
  droppedInBatch = 0;
}, 70);

// ------------------------------------------------------- classification
function classify(protocols, sport, dport) {
  const p = (protocols || '').toLowerCase();
  const port = (a, b) => sport === a || dport === a || (b !== undefined && (sport === b || dport === b));
  if (p.includes('arp')) return 'ARP';
  if (p.includes('icmp')) return 'ICMP';
  if (p.includes('dns') || port(53, 5353)) return 'DNS';
  if (p.includes('quic')) return 'QUIC';
  if (p.includes('ssh') || (p.includes('tcp') && port(22))) return 'SSH';
  if (p.includes('tls') || (p.includes('tcp') && port(443))) return 'HTTPS';
  if (p.includes('http')) return 'HTTP';
  if (p.includes('tcp')) return 'TCP';
  if (p.includes('udp')) return 'UDP';
  return 'OTHER';
}

// --------------------------------------------------------- live capture
// tshark -T ek emits one JSON object per line; with -e the interesting fields
// land in `layers` keyed by the field name with dots replaced by underscores.
// Key naming has varied across tshark versions, so look up several candidates.
function pick(layers, candidates) {
  for (const k of candidates) {
    const v = layers[k];
    if (v === undefined) continue;
    return Array.isArray(v) ? v[0] : v;
  }
  return undefined;
}

let tsharkProc = null;
let shuttingDown = false;

function startLiveCapture() {
  const fields = [
    'frame.len', 'frame.protocols',
    'ip.src', 'ip.dst', 'ipv6.src', 'ipv6.dst',
    'tcp.srcport', 'tcp.dstport', 'udp.srcport', 'udp.dstport',
  ];
  const args = ['-T', 'ek', '-l', '-n'];
  for (const i of IFACES) args.push('-i', i);
  for (const f of fields) args.push('-e', f);

  console.log(`[packet-highway] starting capture: tshark ${args.join(' ')}`);
  let gotPacket = false;
  let stderrTail = '';

  try {
    tsharkProc = spawn('tshark', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    return startMock(`failed to spawn tshark (${e.message})`);
  }

  tsharkProc.on('error', (e) => startMock(`tshark unavailable (${e.message})`));

  tsharkProc.stderr.on('data', (d) => {
    stderrTail = (stderrTail + d.toString()).slice(-2000);
  });

  tsharkProc.on('exit', (code) => {
    tsharkProc = null;
    if (shuttingDown) return;
    if (!gotPacket) {
      const hint = stderrTail.trim().split('\n').pop() || `exit code ${code}`;
      startMock(`tshark exited before capturing anything: ${hint}`);
    } else {
      console.error('[packet-highway] tshark exited unexpectedly, switching to mock traffic');
      startMock('tshark stream ended');
    }
  });

  const rl = readline.createInterface({ input: tsharkProc.stdout });
  rl.on('line', (line) => {
    if (!line || line[0] !== '{') return;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      return;
    }
    const layers = obj.layers;
    if (!layers) return; // ek index header lines

    const len = parseInt(pick(layers, ['frame_len', 'frame_frame_len']), 10) || 0;
    const protocols = pick(layers, ['frame_protocols', 'frame_frame_protocols']) || '';
    const src = pick(layers, ['ip_src', 'ip_ip_src', 'ipv6_src', 'ipv6_ipv6_src']) || '';
    const dst = pick(layers, ['ip_dst', 'ip_ip_dst', 'ipv6_dst', 'ipv6_ipv6_dst']) || '';
    const sport = parseInt(pick(layers, ['tcp_srcport', 'tcp_tcp_srcport', 'udp_srcport', 'udp_udp_srcport']), 10) || undefined;
    const dport = parseInt(pick(layers, ['tcp_dstport', 'tcp_tcp_dstport', 'udp_dstport', 'udp_udp_dstport']), 10) || undefined;

    if (!gotPacket) {
      gotPacket = true;
      setMode('live', `capturing on ${IFACE}`);
    }
    pushPacket({
      proto: classify(protocols, sport, dport),
      len,
      dir: LOCAL_IPS.has(src) ? 'out' : 'in',
      src,
      dst,
      sport,
      dport,
      ts: Date.now(),
    });
  });
}

// --------------------------------------------------------- mock traffic
const MOCK_PROTOS = [
  ['HTTPS', 30], ['QUIC', 12], ['TCP', 14], ['UDP', 12], ['DNS', 10],
  ['HTTP', 6], ['OTHER', 6], ['SSH', 4], ['ICMP', 3], ['ARP', 3],
];
const MOCK_TOTAL_WEIGHT = MOCK_PROTOS.reduce((s, [, w]) => s + w, 0);
const MOCK_SIZES = {
  HTTPS: [80, 1500], QUIC: [60, 1350], HTTP: [200, 1500], DNS: [60, 320],
  SSH: [60, 600], TCP: [54, 1500], UDP: [60, 1200], ICMP: [64, 128],
  ARP: [42, 60], OTHER: [60, 800],
};
const MOCK_PORTS = { HTTPS: 443, QUIC: 443, HTTP: 80, DNS: 53, SSH: 22 };

function randInt(a, b) {
  return a + Math.floor(Math.random() * (b - a + 1));
}

function randomRemoteIp() {
  return `${randInt(11, 220)}.${randInt(0, 255)}.${randInt(0, 255)}.${randInt(1, 254)}`;
}

function pickMockProto() {
  let r = Math.random() * MOCK_TOTAL_WEIGHT;
  for (const [proto, w] of MOCK_PROTOS) {
    if ((r -= w) < 0) return proto;
  }
  return 'TCP';
}

function makeMockPacket(proto, flow) {
  const [lo, hi] = MOCK_SIZES[proto];
  const inbound = flow ? flow.inbound : Math.random() < 0.6;
  const remote = flow ? flow.remote : randomRemoteIp();
  const local = '192.168.1.42';
  const wellKnown = MOCK_PORTS[proto];
  const ephemeral = flow ? flow.port : randInt(49152, 65535);
  return {
    proto,
    len: randInt(lo, hi),
    dir: inbound ? 'in' : 'out',
    src: inbound ? remote : local,
    dst: inbound ? local : remote,
    sport: inbound ? wellKnown : ephemeral,
    dport: inbound ? ephemeral : wellKnown,
    ts: Date.now(),
  };
}

let mockTimer = null;

function startMock(reason) {
  if (mode === 'mock') return;
  setMode('mock', reason);
  const tick = () => {
    // Occasionally simulate a download burst: a run of packets on one flow.
    if (Math.random() < 0.12) {
      const proto = Math.random() < 0.6 ? 'HTTPS' : 'QUIC';
      const flow = { inbound: true, remote: randomRemoteIp(), port: randInt(49152, 65535) };
      const n = randInt(5, 25);
      for (let i = 0; i < n; i++) {
        setTimeout(() => pushPacket(makeMockPacket(proto, flow)), i * randInt(8, 30));
      }
    } else {
      pushPacket(makeMockPacket(pickMockProto()));
    }
    mockTimer = setTimeout(tick, randInt(15, 260));
  };
  tick();
}

// ----------------------------------------------------------------- boot
server.listen(PORT, () => {
  console.log(`[packet-highway] http://localhost:${PORT}`);
  if (FORCE_MOCK) startMock('MOCK=1 requested');
  else startLiveCapture();
});

process.on('SIGINT', () => {
  shuttingDown = true;
  if (tsharkProc) tsharkProc.kill();
  if (mockTimer) clearTimeout(mockTimer);
  process.exit(0);
});
