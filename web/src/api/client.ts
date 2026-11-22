import type { LedgerEntry, MonthlyReport, Quota, Refuel, Vehicle } from './types';

/** Erro HTTP com o `code` de domínio devolvido pelo backend (ex.: QUOTA_BELOW_USAGE). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const BASE = import.meta.env.VITE_API_URL ?? '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Sem conexão com o servidor');
  }
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, body?.code ?? 'HTTP_ERROR', body?.message ?? `Erro ${res.status}`);
  }
  return body as T;
}

export const api = {
  listVehicles: (month?: string) => request<Vehicle[]>(`/core/vehicles${month ? `?month=${month}` : ''}`),
  createVehicle: (data: {
    plate: string;
    model: string;
    department: string;
    fuelType: string;
    expectedKmPerLiter: number;
    initialOdometerKm?: number;
  }) => request<Vehicle>('/core/vehicles', { method: 'POST', body: JSON.stringify(data) }),
  setQuota: (vehicleId: string, month: string, limitLiters: number) =>
    request<Quota>(`/core/vehicles/${vehicleId}/quotas/${month}`, { method: 'PUT', body: JSON.stringify({ limitLiters }) }),
  listRefuels: (params: { status?: string; vehicleId?: string } = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
    return request<Refuel[]>(`/core/refuels?limit=100&${q}`);
  },
  photoUrl: (refuelId: string) => `${BASE}/core/refuels/${refuelId}/photo`,
  ledger: (params: { vehicleId?: string; type?: string } = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
    return request<LedgerEntry[]>(`/audit/ledger?limit=100&${q}`);
  },
  verifyLedger: async (): Promise<{ valid: boolean; entriesVerified?: number; headHash?: string; message?: string; sequence?: number }> => {
    const res = await fetch(`${BASE}/audit/ledger/verify`);
    return res.json();
  },
  monthlyReport: (month: string) => request<MonthlyReport>(`/audit/reports/monthly?month=${month}`),
  monthlyReportCsvUrl: (month: string) => `${BASE}/audit/reports/monthly?month=${month}&format=csv`,
};

export const currentMonth = () => {
  const d = new Date(Date.now() - 3 * 3600_000); // fuso de Brasília
  return d.toISOString().slice(0, 7);
};

export const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const liters = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} L`;
export const dateTime = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
