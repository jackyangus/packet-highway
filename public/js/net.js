// WebSocket client with automatic reconnect (exponential backoff, capped).
export function connect({ onPackets, onStatus, onDisconnect }) {
  let retryMs = 1000;

  function open() {
    const ws = new WebSocket(`ws://${location.host}/ws`);

    ws.onopen = () => {
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
      onDisconnect();
      setTimeout(open, retryMs);
      retryMs = Math.min(retryMs * 1.7, 10000);
    };

    ws.onerror = () => ws.close();
  }

  open();
}
