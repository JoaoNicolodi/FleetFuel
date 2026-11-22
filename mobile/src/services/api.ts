import type { PostOutcome, RefuelApi, RefuelRequestBody } from '../sync/types';
import { getSetting } from '../db/database';

export const DEFAULT_SERVER = 'http://192.168.0.10:8080';

export async function serverUrl(): Promise<string> {
  return ((await getSetting('serverUrl')) ?? DEFAULT_SERVER).replace(/\/+$/, '');
}

/** fetch com timeout: em posto com sinal fraco, a requisição pode ficar pendurada para sempre. */
async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export interface RemoteVehicle {
  id: string;
  plate: string;
  model: string;
  department: string;
  lastOdometerKm: number | null;
  quota: { limitLiters: number; remainingLiters: number } | null;
}

export async function fetchVehicles(): Promise<RemoteVehicle[]> {
  const res = await fetchWithTimeout(`${await serverUrl()}/api/core/vehicles`, {}, 8000);
  if (!res.ok) throw new Error(`Erro ${res.status}`);
  return res.json();
}

export async function startSession(input: { vehicleId: string; plate: string; driverName: string }): Promise<{ token: string; expiresAt: string }> {
  const res = await fetchWithTimeout(`${await serverUrl()}/api/live/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message ?? `Erro ${res.status}`);
  return body;
}

export async function endSession(token: string): Promise<void> {
  await fetchWithTimeout(`${await serverUrl()}/api/live/sessions/${token}`, { method: 'DELETE' }, 5000).catch(() => undefined);
}

/** Retorna false se o token expirou (401) — o app então pede novo turno. */
export async function sendTelemetry(token: string, p: { lat: number; lng: number; speedKmh: number | null; recordedAt: string }): Promise<boolean> {
  const res = await fetchWithTimeout(
    `${await serverUrl()}/api/live/telemetry`,
    { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(p) },
    5000,
  );
  return res.status !== 401;
}

/** Implementação HTTP da porta usada pelo SyncEngine. Traduz status HTTP em "o que fazer com o item". */
export class HttpRefuelApi implements RefuelApi {
  async postRefuel(body: RefuelRequestBody): Promise<PostOutcome> {
    let res: Response;
    try {
      res = await fetchWithTimeout(`${await serverUrl()}/api/core/refuels`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': body.clientId },
        body: JSON.stringify(body),
      }, 30_000);
    } catch (err) {
      return { kind: 'transient', message: (err as Error).name === 'AbortError' ? 'Tempo esgotado' : 'Sem conexão' };
    }
    const json = await res.json().catch(() => ({}));
    if (res.status === 201 || res.status === 200) {
      const r = json.refuel;
      return { kind: res.status === 201 ? 'created' : 'replayed', refuelId: r.id, status: r.status, message: r.reviewReason, quotaRemainingLiters: r.quotaRemainingLiters };
    }
    if (res.status === 422 && json.code === 'REFUEL_REJECTED') {
      return { kind: 'rejected', refuelId: json.refuel?.id ?? null, code: json.reasonCode, message: json.message };
    }
    if (res.status === 400 || res.status === 404 || res.status === 409) {
      return { kind: 'invalid', message: json.message ?? `Erro ${res.status}` };
    }
    // 429 (rate limit), 5xx, 503 (lock timeout): tenta de novo mais tarde
    return { kind: 'transient', message: json.message ?? `Servidor respondeu ${res.status}` };
  }
}
