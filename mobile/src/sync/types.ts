/** Estado de um abastecimento na fila local (SQLite). */
export type QueueStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'REJECTED' | 'ERROR';

export interface PendingRefuel {
  clientId: string; // UUID gerado no celular = chave de idempotência no servidor
  vehicleId: string;
  plate: string;
  driverName: string;
  stationName: string;
  liters: number;
  odometerKm: number;
  pricePerLiterCents: number;
  occurredAt: string;
  photoUri: string;
  lat: number | null;
  lng: number | null;
  status: QueueStatus;
  attempts: number;
  lastError: string | null;
  serverStatus: 'ACCEPTED' | 'FLAGGED' | 'REJECTED' | null;
  serverRefuelId: string | null;
  serverMessage: string | null;
  nextAttemptAt: number; // epoch ms
  createdAt: string;
  syncedAt: string | null;
}

export interface RefuelRequestBody {
  clientId: string;
  vehicleId: string;
  driverName: string;
  stationName: string;
  liters: number;
  odometerKm: number;
  pricePerLiterCents: number;
  occurredAt: string;
  offline: boolean;
  photoBase64: string;
  photoMimeType: 'image/jpeg';
  location: { lat: number; lng: number } | null;
}

export type PostOutcome =
  | { kind: 'created' | 'replayed'; refuelId: string; status: 'ACCEPTED' | 'FLAGGED'; message: string | null; quotaRemainingLiters: number | null }
  | { kind: 'rejected'; refuelId: string | null; code: string; message: string }
  | { kind: 'invalid'; message: string } // 400/404: nunca vai passar, não adianta reenviar
  | { kind: 'transient'; message: string }; // sem rede, timeout, 5xx, 429: tentar depois

export interface QueueStore {
  /** Pendentes cujo nextAttemptAt já passou, em ordem cronológica do abastecimento. */
  listReadyToSync(nowMs: number): Promise<PendingRefuel[]>;
  /** Itens que ficaram em SYNCING porque o app foi fechado no meio do envio. */
  resetStuckSyncing(): Promise<void>;
  markSyncing(clientId: string): Promise<void>;
  markSynced(clientId: string, data: { serverRefuelId: string; serverStatus: 'ACCEPTED' | 'FLAGGED'; message: string | null }): Promise<void>;
  markRejected(clientId: string, data: { serverRefuelId: string | null; message: string }): Promise<void>;
  markRetry(clientId: string, data: { error: string; nextAttemptAt: number }): Promise<void>;
}

export interface PhotoReader {
  readBase64(uri: string): Promise<string | null>;
}

export interface RefuelApi {
  postRefuel(body: RefuelRequestBody): Promise<PostOutcome>;
}

export interface SyncSummary {
  synced: number;
  rejected: number;
  retrying: number;
  skipped: boolean;
}
