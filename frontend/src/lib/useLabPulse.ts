import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { emptyState, mergeEvents, type LabEvent, type StoreState } from './store';

export type ConnState = 'connecting' | 'catching_up' | 'live' | 'reconnecting' | 'unauthorized';

type Action = { type: 'events'; events: LabEvent[] };
const reducer = (s: StoreState, a: Action): StoreState => mergeEvents(s, a.events);

export function useLabPulse(token: string) {
  const [state, dispatch] = useReducer(reducer, undefined, emptyState);
  const [conn, setConn] = useState<ConnState>('connecting');
  const [instance, setInstance] = useState<string>('');
  const [reconnects, setReconnects] = useState(0);
  const cursor = useRef(0);
  const socketRef = useRef<Socket | null>(null);
  const buffer = useRef<LabEvent[]>([]);
  const raf = useRef(0);

  useEffect(() => { cursor.current = state.maxSeq; }, [state.maxSeq]);

  useEffect(() => {
    // State starts fresh because <Dashboard key={token}> remounts for every session.
    const socket = io({
      transports: ['websocket'],
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      // evaluated on every (re)connect: always resumes from the newest seq we have rendered
      auth: (cb) => cb({ token, ...(cursor.current > 0 && { cursor: cursor.current }) }),
    });
    socketRef.current = socket;

    const flush = () => {
      raf.current = 0;
      const events = buffer.current;
      buffer.current = [];
      if (events.length) dispatch({ type: 'events', events });
    };
    socket.on('events', (batch: LabEvent[]) => {
      buffer.current.push(...batch);
      if (!raf.current) raf.current = requestAnimationFrame(flush); // coalesce bursts into one render
    });
    socket.on('hello', (h: { instance: string }) => setInstance(h.instance));
    socket.on('connect', () => setConn('catching_up'));
    socket.on('caught_up', () => { flush(); setConn('live'); });
    socket.on('disconnect', () => setConn('reconnecting'));
    socket.io.on('reconnect_attempt', () => setConn('reconnecting'));
    socket.io.on('reconnect', () => setReconnects((n) => n + 1));
    socket.on('connect_error', (err) => {
      if (err.message === 'unauthorized') { setConn('unauthorized'); socket.close(); } else setConn('reconnecting');
    });

    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      socket.removeAllListeners();
      socket.close();
    };
  }, [token]);

  // a tiny hook for demos/tests: drop the transport without telling the server
  const simulateDrop = useCallback(() => socketRef.current?.io.engine?.close(), []);

  return { state, conn, instance, reconnects, simulateDrop };
}
