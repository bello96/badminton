import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, ServerMessage } from "../types/protocol";

type Listener = (msg: ServerMessage) => void;

const HEARTBEAT_INTERVAL = 25_000;
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 15000];

export function useWebSocket(url: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef<Set<Listener>>(new Set());
  const [connected, setConnected] = useState(false);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryRef = useRef(0);
  const closedIntentionallyRef = useRef(false);
  const urlRef = useRef(url);
  urlRef.current = url;

  const connect = useCallback(() => {
    const wsUrl = urlRef.current;
    if (!wsUrl) {
      return;
    }

    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        /* */
      }
    }
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      retryRef.current = 0;
      heartbeatRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, HEARTBEAT_INTERVAL);
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string) as ServerMessage;
        listenersRef.current.forEach((fn) => fn(msg));
      } catch {
        /* ignore */
      }
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      if (!closedIntentionallyRef.current) {
        const delay =
          RECONNECT_DELAYS[
            Math.min(retryRef.current, RECONNECT_DELAYS.length - 1)
          ]!;
        retryRef.current++;
        setTimeout(() => {
          if (!closedIntentionallyRef.current) {
            connect();
          }
        }, delay);
      }
    };

    ws.onerror = () => {
      // onclose 会紧随触发
    };
  }, []);

  useEffect(() => {
    closedIntentionallyRef.current = false;
    retryRef.current = 0;
    connect();

    return () => {
      closedIntentionallyRef.current = true;
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setConnected(false);
    };
  }, [url, connect]);

  const send = useCallback((msg: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const addListener = useCallback((fn: Listener) => {
    listenersRef.current.add(fn);
    return () => {
      listenersRef.current.delete(fn);
    };
  }, []);

  const leave = useCallback(() => {
    closedIntentionallyRef.current = true;
    send({ type: "leave" });
    wsRef.current?.close();
  }, [send]);

  return { connected, send, addListener, leave };
}
