# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
npm start                        # capture + web server → http://localhost:8339
npm run start:mock               # force simulated traffic (no tshark needed)
PH_IFACE=en0,utun1500 npm start  # capture specific interfaces (comma-separated)
```

There is no build step, bundler, or test suite. CI runs syntax checks only —
reproduce locally with:

```sh
node --check server/server.js                                  # backend is CommonJS
for f in public/js/*.js; do node --input-type=module --check - < "$f"; done  # frontend is ESM
```

Deploy: push to `main` (GitHub Actions deploys `public/` to Cloudflare Pages →
https://highway.qooeo.com), or manually `npx wrangler pages deploy public
--project-name=packet-highway`.

## Architecture

Two halves connected by one WebSocket:

- **`server/server.js`** (Node, CommonJS, only dep is `ws`) — spawns
  `tshark -T ek -l` on the detected interfaces, parses the streaming JSON,
  classifies each packet (protocol / size / direction via local-IP set), queues
  and flushes batches to all WS clients every 70 ms (max 400/batch, overflow
  reported as `dropped`). Falls back to a mock generator if tshark is missing,
  unauthorized, or exits. Also serves `public/` statically. Messages:
  `{type:'status', mode:'live'|'mock', iface}` and
  `{type:'packets', packets:[{proto,len,dir,src,dst,sport,dport,ts}], dropped}`.

- **`public/`** (ES modules, no bundler — three.js r160 via CDN import map in
  `index.html`) — single-page Three.js scene:
  - `main.js` — wiring: renderer/bloom/controls, data feed → spawn queue
    (capped per frame), stats window, picking (hover tooltip + click card),
    lang/theme persistence in localStorage. WebGL failure degrades to
    stats-only UI.
  - `vehicles.js` — the core. Protocol→vehicle mapping (`TYPES`), low-poly
    geometry built from vertex-colored boxes, and `VehicleFleet`: two
    InstancedMeshes per protocol (Lambert body + HDR lights with
    `toneMapped:false` so bloom picks them up), 150-slot object pools, and the
    traffic sim (packet size → speed and length; car-following; automatic
    lane changes across 8 lanes per direction).
  - `scene.js` — static world (road, lane markings, procedural city with
    canvas-texture windows, lamps, stars). `buildWorld()` returns a handle
    whose `setTheme('dark'|'light')` swaps the whole palette in place
    (materials, fog, lights, day/night building textures).
  - `net.js` + `mock.js` — WS client with reconnect; after 2 failed attempts
    with no successful connection it starts an in-browser mock generator.
    This is what makes the static Cloudflare Pages deployment work as a demo.
  - `ui.js` — DOM panels, zh/en string table (`STRINGS`), clickable legend
    (protocol filter), collapsible panels, tooltip/detail card.

## Gotchas

- **InstancedMesh raycasting**: each fleet mesh gets an explicit
  `boundingSphere` covering the road corridor. Without it three.js caches a
  degenerate sphere computed before any car exists and hover/click picking
  misses forever. Don't remove it.
- **macOS capture**: `/dev/bpf*` is root-only; the Homebrew formula doesn't
  fix it (`sudo chmod o+rw /dev/bpf*` now, `wireshark-chmodbpf` cask
  permanently). The server auto-detects VPN/proxy tun interfaces (`utun*`
  with IPv4) because Clash/Surge-style proxies route most traffic through
  their tun — capturing only `en0` shows encrypted proxy packets instead of
  real protocols.
- **tshark ek field names** vary across versions; `pick()` in server.js tries
  multiple key candidates (`frame_len` vs `frame_frame_len`). Keep that
  tolerance when adding fields.
- **Classification order matters** in `classify()`: ARP → ICMP → DNS → QUIC →
  SSH → TLS/443 → HTTP → TCP → UDP (e.g. TLS must be checked before HTTP,
  QUIC before HTTPS).
- The frontend must work with no backend (Pages demo): anything new that
  talks to the server needs a graceful fallback path.
- UI text is never hardcoded in HTML beyond defaults — add strings to both
  `zh` and `en` tables in `ui.js` and set them in `setLang()`.
