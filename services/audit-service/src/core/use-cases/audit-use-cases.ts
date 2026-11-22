import { Result, ok, fail } from '../domain/shared/result';
import { ChainBrokenError, InvalidEventError, ValidationError } from '../domain/shared/errors';
import { IntegrationEvent } from '../domain/value-objects/integration-event';
import { Hasher, LedgerEntry } from '../domain/entities/ledger-entry';
import { ChainVerifier } from '../domain/services/chain-verifier';
import { buildMonthlyReport, MonthlyReport, RefuelFact } from '../domain/services/monthly-report';
import { AuditUnitOfWork, Clock, FactsReader, LedgerFilter, LedgerReader } from './ports';
import { LedgerEntryOutput, RecordEventOutput, VerifyChainOutput } from './dtos';

export const toEntryOutput = (e: LedgerEntry): LedgerEntryOutput => {
  const s = e.snapshot();
  return {
    sequence: s.sequence,
    eventId: s.eventId,
    eventType: s.eventType,
    source: s.source,
    aggregateId: s.aggregateId,
    occurredAt: s.occurredAt.toISOString(),
    recordedAt: s.recordedAt.toISOString(),
    payload: s.payload,
    previousHash: s.previousHash,
    hash: s.hash,
  };
};

const toFact = (event: IntegrationEvent): RefuelFact | null => {
  if (!event.isRefuel) return null;
  const p = event.payload;
  return {
    refuelId: String(p.refuelId),
    vehicleId: String(p.vehicleId),
    plate: String(p.plate),
    department: String(p.department ?? 'N/D'),
    month: String(p.month),
    status: p.status as RefuelFact['status'],
    liters: Number(p.liters ?? 0),
    totalCents: Number(p.totalCents ?? 0),
    distanceKm: p.distanceKm === null || p.distanceKm === undefined ? null : Number(p.distanceKm),
    offline: Boolean(p.offline),
    rejectionCode: (p.rejectionCode as string | null) ?? null,
  };
};

/**
 * Único caso de uso de ESCRITA do Serviço C, acionado só pelo consumidor do broker
 * (o serviço não expõe nenhum POST: comunicação 100% orientada a eventos).
 */
export class RecordEventUseCase {
  constructor(
    private readonly uow: AuditUnitOfWork,
    private readonly hasher: Hasher,
    private readonly clock: Clock,
  ) {}

  async execute(raw: unknown): Promise<Result<RecordEventOutput, InvalidEventError>> {
    const parsed = IntegrationEvent.parse(raw);
    if (!parsed.ok) return parsed;
    const event = parsed.value;

    return this.uow.run(async (tx) => {
      // O lock do último registro serializa os appends: dois consumidores nunca
      // geram a mesma sequência nem "bifurcam" a cadeia.
      const last = await tx.lastEntryForUpdate();
      if (await tx.hasEvent(event.eventId)) return ok({ duplicated: true, sequence: null });

      const entry = LedgerEntry.append(last, event, this.hasher, this.clock.now());
      await tx.append(entry);
      const fact = toFact(event);
      if (fact) await tx.upsertFact(fact);
      return ok({ duplicated: false, sequence: entry.sequence });
    });
  }
}

export class VerifyChainUseCase {
  constructor(
    private readonly reader: LedgerReader,
    private readonly hasher: Hasher,
  ) {}

  async execute(batchSize = 500): Promise<Result<VerifyChainOutput, ChainBrokenError>> {
    const verifier = new ChainVerifier(this.hasher);
    let from = 1;
    for (;;) {
      const batch = await this.reader.readFrom(from, batchSize);
      if (batch.length === 0) break;
      const r = verifier.feed(batch);
      if (!r.ok) return fail(r.error);
      from = batch[batch.length - 1]!.sequence + 1;
    }
    return ok({ valid: true, ...verifier.result });
  }
}

export class ListLedgerUseCase {
  constructor(private readonly reader: LedgerReader) {}
  async execute(filter: LedgerFilter): Promise<Result<LedgerEntryOutput[], never>> {
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 500);
    const items = await this.reader.list({ ...filter, limit });
    return ok(items.map(toEntryOutput));
  }
}

export class MonthlyReportUseCase {
  constructor(private readonly facts: FactsReader) {}
  async execute(month: string): Promise<Result<MonthlyReport, ValidationError>> {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return fail(new ValidationError('month', 'Use o formato YYYY-MM'));
    const facts = await this.facts.listByMonth(month);
    return ok(buildMonthlyReport(month, facts));
  }
}
