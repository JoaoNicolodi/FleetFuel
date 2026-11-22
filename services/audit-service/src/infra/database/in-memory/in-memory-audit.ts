import { LedgerEntry, LedgerEntryProps } from '../../../core/domain/entities/ledger-entry';
import { RefuelFact } from '../../../core/domain/services/monthly-report';
import { AuditTransaction, AuditUnitOfWork, FactsReader, LedgerFilter, LedgerReader } from '../../../core/use-cases/ports';

export class InMemoryAuditDb {
  entries: LedgerEntryProps[] = [];
  facts = new Map<string, RefuelFact>();
}

/** Serializa as transações (equivalente ao lock da cadeia no Postgres). */
export class InMemoryAuditUnitOfWork implements AuditUnitOfWork {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly db: InMemoryAuditDb) {}

  run<T>(work: (tx: AuditTransaction) => Promise<T>): Promise<T> {
    const db = this.db;
    const tx: AuditTransaction = {
      async lastEntryForUpdate() {
        await new Promise((r) => setImmediate(r));
        const last = db.entries[db.entries.length - 1];
        return last ? LedgerEntry.restore(last) : null;
      },
      async hasEvent(eventId) {
        return db.entries.some((e) => e.eventId === eventId);
      },
      async append(entry) {
        db.entries.push({ ...entry.snapshot() });
      },
      async upsertFact(fact) {
        db.facts.set(fact.refuelId, fact);
      },
    };
    const next = this.queue.then(() => work(tx));
    this.queue = next.catch(() => undefined);
    return next;
  }
}

export class InMemoryLedgerReader implements LedgerReader, FactsReader {
  constructor(private readonly db: InMemoryAuditDb) {}
  async list(f: LedgerFilter) {
    return this.db.entries
      .filter((e) => !f.aggregateId || e.aggregateId === f.aggregateId)
      .filter((e) => !f.eventType || e.eventType === f.eventType)
      .filter((e) => !f.beforeSequence || e.sequence < f.beforeSequence)
      .slice()
      .reverse()
      .slice(0, f.limit ?? 50)
      .map((p) => LedgerEntry.restore(p));
  }
  async readFrom(sequence: number, batchSize: number) {
    return this.db.entries.filter((e) => e.sequence >= sequence).slice(0, batchSize).map((p) => LedgerEntry.restore(p));
  }
  async count() {
    return this.db.entries.length;
  }
  async listByMonth(month: string) {
    return [...this.db.facts.values()].filter((f) => f.month === month);
  }
}
