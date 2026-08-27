import { WS_URL, getStoredToken } from '../config';

type Handler = (event: string, data: unknown) => void;

export function connectAgentSocket(onMessage: Handler, onStatus: (connected: boolean) => void) {
  let ws: WebSocket | null = null;
  let closed = false;
  let timer: number | null = null;

  const connect = () => {
    if (closed) return;
    const token = encodeURIComponent(getStoredToken());
    ws = new WebSocket(`${WS_URL}?token=${token}`);

    ws.onopen = () => onStatus(true);
    ws.onclose = () => {
      onStatus(false);
      if (!closed) timer = window.setTimeout(connect, 3000);
    };
    ws.onerror = () => {
      try {
        ws?.close();
      } catch {
        // ignore
      }
    };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as { event: string; data: unknown };
        onMessage(msg.event, msg.data);
      } catch {
        // ignore
      }
    };
  };

  connect();

  return () => {
    closed = true;
    if (timer) window.clearTimeout(timer);
    ws?.close();
  };
}
