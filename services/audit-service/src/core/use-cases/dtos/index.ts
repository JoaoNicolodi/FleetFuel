export interface RecordEventOutput {
  duplicated: boolean;
  sequence: number | null;
}

export interface LedgerEntryOutput {
  sequence: number;
  eventId: string;
  eventType: string;
  source: string;
  aggregateId: string | null;
  occurredAt: string;
  recordedAt: string;
  payload: Record<string, unknown>;
  previousHash: string;
  hash: string;
}

export interface VerifyChainOutput {
  valid: true;
  entriesVerified: number;
  headHash: string;
}

export type { MonthlyReport } from '../../domain/services/monthly-report';
