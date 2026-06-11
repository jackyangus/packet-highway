// Client-side mock traffic generator: mirrors the server's mock mode so the
// frontend works as a static demo (e.g. Cloudflare Pages) with no backend.
const PROTOS = [
  ['HTTPS', 30], ['QUIC', 12], ['TCP', 14], ['UDP', 12], ['DNS', 10],
  ['HTTP', 6], ['OTHER', 6], ['SSH', 4], ['ICMP', 3], ['ARP', 3],
];
const TOTAL_WEIGHT = PROTOS.reduce((s, [, w]) => s + w, 0);
const SIZES = {
  HTTPS: [80, 1500], QUIC: [60, 1350], HTTP: [200, 1500], DNS: [60, 320],
  SSH: [60, 600], TCP: [54, 1500], UDP: [60, 1200], ICMP: [64, 128],
  ARP: [42, 60], OTHER: [60, 800],
};
const PORTS = { HTTPS: 443, QUIC: 443, HTTP: 80, DNS: 53, SSH: 22 };

const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const remoteIp = () => `${randInt(11, 220)}.${randInt(0, 255)}.${randInt(0, 255)}.${randInt(1, 254)}`;

function pickProto() {
  let r = Math.random() * TOTAL_WEIGHT;
  for (const [proto, w] of PROTOS) {
    if ((r -= w) < 0) return proto;
  }
  return 'TCP';
}

function makePacket(proto, flow) {
  const [lo, hi] = SIZES[proto];
  const inbound = flow ? flow.inbound : Math.random() < 0.6;
  const remote = flow ? flow.remote : remoteIp();
  const local = '192.168.1.42';
  const wellKnown = PORTS[proto];
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

export function startClientMock(onPackets) {
  let queue = [];

  const tick = () => {
    // occasional download burst: a run of packets on one flow
    if (Math.random() < 0.12) {
      const proto = Math.random() < 0.6 ? 'HTTPS' : 'QUIC';
      const flow = { inbound: true, remote: remoteIp(), port: randInt(49152, 65535) };
      const n = randInt(5, 25);
      for (let i = 0; i < n; i++) {
        setTimeout(() => queue.push(makePacket(proto, flow)), i * randInt(8, 30));
      }
    } else {
      queue.push(makePacket(pickProto()));
    }
    setTimeout(tick, randInt(15, 260));
  };
  tick();

  setInterval(() => {
    if (queue.length === 0) return;
    onPackets(queue, 0);
    queue = [];
  }, 70);
}
