import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, PoolClient } from 'pg';
import { LedgerEntry } from '../../../core/domain/entities/ledger-entry';
import { RefuelFact } from '../../../core/domain/services/monthly-report';
import { AuditTransaction, AuditUnitOfWork, FactsReader, LedgerFilter, LedgerReader } from '../../../core/use-cases/ports';

/* eslint-disable @typescript-eslint/no-explicit-any */
const toEntry = (r: any) =>
  LedgerEntry.restore({
    sequence: Number(r.sequence),
    eventId: r.event_id,
    eventType: r.event_type,
    source: r.source,
    aggregateId: r.aggregate_id,
    occurredAt: new Date(r.occurred_at),
    recordedAt: new Date(r.recorded_at),
    payload: r.payload,
    previousHash: r.previous_hash,
    hash: r.hash,
  });

export async function migrate(pool: Pool) {
  await pool.query(readFileSync(join(__dirname, 'schema.sql'), 'utf8'));
}

/** Chave do advisory lock que serializa os appends na cadeia. */
const LEDGER_LOCK_KEY = 7_420_001;

class PgAuditTransaction implements AuditTransaction {
  constructor(private readonly c: PoolClient) {}

  async lastEntryForUpdate() {
    // Advisory lock de transação: liberado automaticamente no COMMIT/ROLLBACK.
    await this.c.query('SELECT pg_advisory_xact_lock($1)', [LEDGER_LOCK_KEY]);
    const { rows } = await this.c.query('SELECT * FROM ledger_entries ORDER BY sequence DESC LIMIT 1');
    return rows[0] ? toEntry(rows[0]) : null;
  }

  async hasEvent(eventId: string) {
    const { rowCount } = await this.c.query('SELECT 1 FROM ledger_entries WHERE event_id = $1', [eventId]);
    return (rowCount ?? 0) > 0;
  }

  async append(entry: LedgerEntry) {
    const s = entry.snapshot();
    await this.c.query(
      `INSERT INTO ledger_entries (sequence, event_id, event_type, source, aggregate_id, occurred_at, recorded_at, payload, previous_hash, hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [s.sequence, s.eventId, s.eventType, s.source, s.aggregateId, s.occurredAt, s.recordedAt, JSON.stringify(s.payload), s.previousHash, s.hash],
    );
  }

  async upsertFact(f: RefuelFact) {
    await this.c.query(
      `INSERT INTO refuel_facts (refuel_id, vehicle_id, plate, department, month, status, liters, total_cents, distance_km, offline, rejection_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (refuel_id) DO NOTHING`,
      [f.refuelId, f.vehicleId, f.plate, f.department, f.month, f.status, f.liters, f.totalCents, f.distanceKm, f.offline, f.rejectionCode],
    );
  }
}

export class PgAuditUnitOfWork implements AuditUnitOfWork {
  constructor(private readonly pool: Pool) {}
  async run<T>(work: (tx: AuditTransaction) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const r = await work(new PgAuditTransaction(c));
      await c.query('COMMIT');
      return r;
    } catch (err) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }
  }
}

export class PgLedgerReader implements LedgerReader, FactsReader {
  constructor(private readonly pool: Pool) {}

  async list(f: LedgerFilter) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (f.aggregateId) { params.push(f.aggregateId); where.push(`aggregate_id = $${params.length}`); }
    if (f.eventType) { params.push(f.eventType); where.push(`event_type = $${params.length}`); }
    if (f.beforeSequence) { params.push(f.beforeSequence); where.push(`sequence < $${params.length}`); }
    params.push(f.limit ?? 50);
    const { rows } = await this.pool.query(
      `SELECT * FROM ledger_entries ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY sequence DESC LIMIT $${params.length}`,
      params,
    );
    return rows.map(toEntry);
  }

  async readFrom(sequence: number, batchSize: number) {
    const { rows } = await this.pool.query('SELECT * FROM ledger_entries WHERE sequence >= $1 ORDER BY sequence LIMIT $2', [sequence, batchSize]);
    return rows.map(toEntry);
  }

  async count() {
    const { rows } = await this.pool.query('SELECT count(*)::int AS n FROM ledger_entries');
    return rows[0].n as number;
  }

  async listByMonth(month: string): Promise<RefuelFact[]> {
    const { rows } = await this.pool.query('SELECT * FROM refuel_facts WHERE month = $1', [month]);
    return rows.map((r: any) => ({
      refuelId: r.refuel_id,
      vehicleId: r.vehicle_id,
      plate: r.plate,
      department: r.department,
      month: r.month,
      status: r.status,
      liters: Number(r.liters),
      totalCents: Number(r.total_cents),
      distanceKm: r.distance_km,
      offline: r.offline,
      rejectionCode: r.rejection_code,
    }));
  }
}
