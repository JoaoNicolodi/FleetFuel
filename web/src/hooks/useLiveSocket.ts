import { useEffect, useReducer, useRef } from 'react';
import type { ActiveSession, DailyStats, LiveEvent, LiveQuota, LiveSnapshot, VehiclePosition } from '../api/types';

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting';

export interface LiveState {
  status: ConnectionStatus;
  stats: DailyStats | null;
  sessions: ActiveSession[];
  positions: Record<string, VehiclePosition>;
  quotas: Record<string, LiveQuota>;
  feed: LiveEvent[];
  lastMessageAt: string | null;
  /** Incrementa a cada evento de domínio: telas podem usar para recarregar dados. */
  revision: number;
}

type Msg = { type: string; data: unknown; at?: string };
type Action = { kind: 'status'; status: ConnectionStatus } | { kind: 'message'; msg: Msg };

const initial: LiveState = {
  status: 'connecting',
  stats: null,
  sessions: [],
  positions: {},
  quotas: {},
  feed: [],
  lastMessageAt: null,
  revision: 0,
};

const asFeed = (msg: Msg): LiveEvent => ({
  eventId: `${msg.type}-${msg.at ?? Date.now()}-${Math.random()}`,
  type: msg.type,
  occurredAt: msg.at ?? new Date().toISOString(),
  payload: (msg.data ?? {}) as Record<string, unknown>,
});

/** Reducer puro: cada mensagem do WebSocket vira uma transição de estado. */
function reducer(state: LiveState, action: Action): LiveState {
  if (action.kind === 'status') return { ...state, status: action.status };
  const { msg } = action;
  const at = msg.at ?? new Date().toISOString();
  switch (msg.type) {
    case 'snapshot': {
      const s = msg.data as LiveSnapshot;
      return {
        ...state,
        stats: s.stats,
        sessions: s.activeSessions,
        positions: Object.fromEntries(s.positions.map((p) => [p.vehicleId, p])),
        quotas: Object.fromEntries(s.quotas.map((q) => [q.vehicleId, q])),
        feed: s.feed,
        lastMessageAt: at,
      };
    }
    case 'stats.updated':
      return { ...state, stats: msg.data as DailyStats, lastMessageAt: at };
    case 'vehicle.position': {
      const p = msg.data as VehiclePosition;
      return { ...state, positions: { ...state.positions, [p.vehicleId]: p }, lastMessageAt: at };
    }
    case 'session.started': {
      const s = msg.data as ActiveSession;
      return {
        ...state,
        sessions: [...state.sessions.filter((x) => x.vehicleId !== s.vehicleId), s],
        feed: [asFeed(msg), ...state.feed].slice(0, 50),
        lastMessageAt: at,
      };
    }
    case 'session.ended': {
      const s = msg.data as { vehicleId: string };
      const { [s.vehicleId]: _removed, ...positions } = state.positions;
      return {
        ...state,
        sessions: state.sessions.filter((x) => x.vehicleId !== s.vehicleId),
        positions,
        feed: [asFeed(msg), ...state.feed].slice(0, 50),
        lastMessageAt: at,
      };
    }
    case 'refuel.registered':
    case 'refuel.rejected':
    case 'quota.defined': {
      const p = msg.data as Record<string, unknown>;
      const quotas = { ...state.quotas };
      if (typeof p.vehicleId === 'string') {
        if (msg.type === 'quota.defined') {
          quotas[p.vehicleId] = {
            vehicleId: p.vehicleId,
            plate: String(p.plate),
            month: String(p.month),
            limitLiters: Number(p.limitLiters),
            remainingLiters: Number(p.limitLiters) - Number(p.usedLiters),
            updatedAt: at,
          };
        } else if (msg.type === 'refuel.registered' && p.quotaRemainingLiters !== null) {
          const prev = quotas[p.vehicleId];
          quotas[p.vehicleId] = {
            vehicleId: p.vehicleId,
            plate: String(p.plate),
            month: String(p.month),
            limitLiters: prev?.limitLiters,
            remainingLiters: Number(p.quotaRemainingLiters),
            updatedAt: at,
          };
        }
      }
      return { ...state, quotas, feed: [asFeed(msg), ...state.feed].slice(0, 50), lastMessageAt: at, revision: state.revision + 1 };
    }
    default:
      return { ...state, feed: [asFeed(msg), ...state.feed].slice(0, 50), lastMessageAt: at };
  }
}

/**
 * Conexão WebSocket com o Serviço B (via gateway). Reconecta com backoff
 * exponencial (1s, 2s, 4s... até 15s) e, ao reconectar, recebe um novo
 * snapshot — então nenhum evento perdido durante a queda fica faltando na tela.
 * Não há polling HTTP: toda atualização chega empurrada pelo servidor.
 */
export function useLiveSocket(): LiveState {
  const [state, dispatch] = useReducer(reducer, initial);
  const retry = useRef(0);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const url = import.meta.env.VITE_WS_URL ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

    const connect = () => {
      dispatch({ kind: 'status', status: retry.current === 0 ? 'connecting' : 'reconnecting' });
      ws = new WebSocket(url);
      ws.onopen = () => {
        retry.current = 0;
        dispatch({ kind: 'status', status: 'open' });
      };
      ws.onmessage = (ev) => {
        try {
          dispatch({ kind: 'message', msg: JSON.parse(ev.data as string) as Msg });
        } catch {
          /* mensagem malformada: ignora */
        }
      };
      ws.onclose = () => {
        if (disposed) return;
        const delay = Math.min(15_000, 1000 * 2 ** retry.current);
        retry.current += 1;
        dispatch({ kind: 'status', status: 'reconnecting' });
        timer = setTimeout(connect, delay);
      };
      ws.onerror = () => ws?.close();
    };

    connect();
    return () => {
      disposed = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, []);

  return state;
}
