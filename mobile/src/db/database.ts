import * as SQLite from 'expo-sqlite';
import type { PendingRefuel, QueueStore } from '../sync/types';

/**
 * Banco LOCAL do aparelho (SQLite). É a fonte da verdade do app:
 * tudo é gravado aqui primeiro; o servidor é atualizado depois, pela sincronização.
 */
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('fleetfuel.db');
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS vehicles_cache (
          id TEXT PRIMARY KEY NOT NULL,
          plate TEXT NOT NULL,
          model TEXT NOT NULL,
          department TEXT NOT NULL,
          last_odometer_km INTEGER,
          limit_liters REAL,
          remaining_liters REAL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS refuel_queue (
          client_id TEXT PRIMARY KEY NOT NULL,
          vehicle_id TEXT NOT NULL,
          plate TEXT NOT NULL,
          driver_name TEXT NOT NULL,
          station_name TEXT NOT NULL,
          liters REAL NOT NULL,
          odometer_km INTEGER NOT NULL,
          price_per_liter_cents INTEGER NOT NULL,
          occurred_at TEXT NOT NULL,
          photo_uri TEXT NOT NULL,
          lat REAL,
          lng REAL,
          status TEXT NOT NULL DEFAULT 'PENDING',
          attempts INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          server_status TEXT,
          server_refuel_id TEXT,
          server_message TEXT,
          next_attempt_at INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          synced_at TEXT
        );
        CREATE INDEX IF NOT EXISTS refuel_queue_status_idx ON refuel_queue (status, occurred_at);
      `);
      return db;
    })();
  }
  return dbPromise;
}

/* ---------------- Configurações ---------------- */
export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string | null): Promise<void> {
  const db = await getDb();
  if (value === null) await db.runAsync('DELETE FROM settings WHERE key = ?', [key]);
  else await db.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);
}

/* ---------------- Cache de veículos (para funcionar sem sinal) ---------------- */
export interface CachedVehicle {
  id: string;
  plate: string;
  model: string;
  department: string;
  lastOdometerKm: number | null;
  limitLiters: number | null;
  remainingLiters: number | null;
  updatedAt: string;
}

export async function saveVehiclesCache(list: Omit<CachedVehicle, 'updatedAt'>[]): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM vehicles_cache');
    for (const v of list) {
      await db.runAsync(
        'INSERT INTO vehicles_cache (id, plate, model, department, last_odometer_km, limit_liters, remaining_liters, updated_at) VALUES (?,?,?,?,?,?,?,?)',
        [v.id, v.plate, v.model, v.department, v.lastOdometerKm, v.limitLiters, v.remainingLiters, now],
      );
    }
  });
}

export async function listCachedVehicles(): Promise<CachedVehicle[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Record<string, unknown>>('SELECT * FROM vehicles_cache ORDER BY plate');
  return rows.map((r) => ({
    id: String(r.id),
    plate: String(r.plate),
    model: String(r.model),
    department: String(r.department),
    lastOdometerKm: (r.last_odometer_km as number | null) ?? null,
    limitLiters: (r.limit_liters as number | null) ?? null,
    remainingLiters: (r.remaining_liters as number | null) ?? null,
    updatedAt: String(r.updated_at),
  }));
}

/* ---------------- Fila de abastecimentos ---------------- */
const toPending = (r: Record<string, unknown>): PendingRefuel => ({
  clientId: String(r.client_id),
  vehicleId: String(r.vehicle_id),
  plate: String(r.plate),
  driverName: String(r.driver_name),
  stationName: String(r.station_name),
  liters: Number(r.liters),
  odometerKm: Number(r.odometer_km),
  pricePerLiterCents: Number(r.price_per_liter_cents),
  occurredAt: String(r.occurred_at),
  photoUri: String(r.photo_uri),
  lat: (r.lat as number | null) ?? null,
  lng: (r.lng as number | null) ?? null,
  status: r.status as PendingRefuel['status'],
  attempts: Number(r.attempts),
  lastError: (r.last_error as string | null) ?? null,
  serverStatus: (r.server_status as PendingRefuel['serverStatus']) ?? null,
  serverRefuelId: (r.server_refuel_id as string | null) ?? null,
  serverMessage: (r.server_message as string | null) ?? null,
  nextAttemptAt: Number(r.next_attempt_at),
  createdAt: String(r.created_at),
  syncedAt: (r.synced_at as string | null) ?? null,
});

export async function enqueueRefuel(
  p: Omit<PendingRefuel, 'status' | 'attempts' | 'lastError' | 'serverStatus' | 'serverRefuelId' | 'serverMessage' | 'nextAttemptAt' | 'createdAt' | 'syncedAt'>,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO refuel_queue (client_id, vehicle_id, plate, driver_name, station_name, liters, odometer_km, price_per_liter_cents,
       occurred_at, photo_uri, lat, lng, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [p.clientId, p.vehicleId, p.plate, p.driverName, p.stationName, p.liters, p.odometerKm, p.pricePerLiterCents, p.occurredAt, p.photoUri, p.lat, p.lng, new Date().toISOString()],
  );
}

export async function listQueue(limit = 100): Promise<PendingRefuel[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Record<string, unknown>>('SELECT * FROM refuel_queue ORDER BY occurred_at DESC LIMIT ?', [limit]);
  return rows.map(toPending);
}

/** Litros ainda não confirmados pelo servidor (para estimar o saldo offline). */
export async function pendingLitersFor(vehicleId: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ total: number | null }>(
    "SELECT SUM(liters) AS total FROM refuel_queue WHERE vehicle_id = ? AND status IN ('PENDING','SYNCING','ERROR')",
    [vehicleId],
  );
  return row?.total ?? 0;
}

export class SqliteQueueStore implements QueueStore {
  async listReadyToSync(nowMs: number) {
    const db = await getDb();
    const rows = await db.getAllAsync<Record<string, unknown>>(
      "SELECT * FROM refuel_queue WHERE status IN ('PENDING','ERROR') AND next_attempt_at <= ? ORDER BY occurred_at ASC",
      [nowMs],
    );
    return rows.map(toPending);
  }
  async resetStuckSyncing() {
    const db = await getDb();
    await db.runAsync("UPDATE refuel_queue SET status = 'PENDING' WHERE status = 'SYNCING'");
  }
  async markSyncing(id: string) {
    const db = await getDb();
    await db.runAsync("UPDATE refuel_queue SET status = 'SYNCING' WHERE client_id = ?", [id]);
  }
  async markSynced(id: string, d: { serverRefuelId: string; serverStatus: 'ACCEPTED' | 'FLAGGED'; message: string | null }) {
    const db = await getDb();
    await db.runAsync(
      "UPDATE refuel_queue SET status = 'SYNCED', server_status = ?, server_refuel_id = ?, server_message = ?, last_error = NULL, synced_at = ? WHERE client_id = ?",
      [d.serverStatus, d.serverRefuelId, d.message, new Date().toISOString(), id],
    );
  }
  async markRejected(id: string, d: { serverRefuelId: string | null; message: string }) {
    const db = await getDb();
    await db.runAsync(
      "UPDATE refuel_queue SET status = 'REJECTED', server_status = 'REJECTED', server_refuel_id = ?, server_message = ?, synced_at = ? WHERE client_id = ?",
      [d.serverRefuelId, d.message, new Date().toISOString(), id],
    );
  }
  async markRetry(id: string, d: { error: string; nextAttemptAt: number }) {
    const db = await getDb();
    await db.runAsync(
      "UPDATE refuel_queue SET status = 'ERROR', attempts = attempts + 1, last_error = ?, next_attempt_at = ? WHERE client_id = ?",
      [d.error, d.nextAttemptAt, id],
    );
  }
}
