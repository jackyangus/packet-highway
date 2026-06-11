// WebSocket client with automatic reconnect (exponential backoff, capped).
// If the backend never answers (static demo hosting, e.g. Cloudflare Pages),
// falls back to the in-browser mock traffic generator.
import { startClientMock } from './mock.js';

const MAX_ATTEMPTS_BEFORE_MOCK = 2;

export function connect({ onPackets, onStatus, onDisconnect }) {
  let retryMs = 1000;
  let everConnected = false;
  let attempts = 0;

  function open() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let ws;
    try {
      ws = new WebSocket(`${proto}://${location.host}/ws`);
    } catch {
      return fallback();
    }

    ws.onopen = () => {
      everConnected = true;
      retryMs = 1000;
    };

    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === 'packets') onPackets(msg.packets, msg.dropped || 0);
      else if (msg.type === 'status') onStatus(msg);
    };

    ws.onclose = () => {
      attempts++;
      if (!everConnected && attempts >= MAX_ATTEMPTS_BEFORE_MOCK) return fallback();
      onDisconnect();
      setTimeout(open, retryMs);
      retryMs = Math.min(retryMs * 1.7, 10000);
    };

    ws.onerror = () => ws.close();
  }

  function fallback() {
    onStatus({ type: 'status', mode: 'mock', iface: 'browser demo' });
    startClientMock(onPackets);
  }

  open();
}
