import { LedgerEntry } from '../../domain/entities/ledger-entry';
import { RefuelFact } from '../../domain/services/monthly-report';

export interface LedgerFilter {
  aggregateId?: string;
  eventType?: string;
  limit?: number;
  beforeSequence?: number;
}

export interface LedgerReader {
  list(filter: LedgerFilter): Promise<LedgerEntry[]>;
  /** Lê em ordem crescente de sequência, em lotes (para a verificação da cadeia). */
  readFrom(sequence: number, batchSize: number): Promise<LedgerEntry[]>;
  count(): Promise<number>;
}

export interface FactsReader {
  listByMonth(month: string): Promise<RefuelFact[]>;
}

/** Operações de escrita, todas na mesma transação. */
export interface AuditTransaction {
  /** Último registro da cadeia, com LOCK exclusivo (só um append por vez). */
  lastEntryForUpdate(): Promise<LedgerEntry | null>;
  hasEvent(eventId: string): Promise<boolean>;
  append(entry: LedgerEntry): Promise<void>;
  upsertFact(fact: RefuelFact): Promise<void>;
}

export interface AuditUnitOfWork {
  run<T>(work: (tx: AuditTransaction) => Promise<T>): Promise<T>;
}

export interface Clock {
  now(): Date;
}
