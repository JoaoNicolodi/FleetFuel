import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { InMemoryAuditDb, InMemoryAuditUnitOfWork, InMemoryLedgerReader } from '../src/infra/database/in-memory/in-memory-audit';
import { ListLedgerUseCase, MonthlyReportUseCase, RecordEventUseCase, VerifyChainUseCase } from '../src/core/use-cases/audit-use-cases';
import { GENESIS_HASH } from '../src/core/domain/entities/ledger-entry';

const hasher = { sha256: (s: string) => createHash('sha256').update(s).digest('hex') };

function sut() {
  const db = new InMemoryAuditDb();
  const reader = new InMemoryLedgerReader(db);
  const clock = { now: () => new Date('2026-11-20T15:00:00Z') };
  return {
    db,
    record: new RecordEventUseCase(new InMemoryAuditUnitOfWork(db), hasher, clock),
    verify: new VerifyChainUseCase(reader, hasher),
    list: new ListLedgerUseCase(reader),
    report: new MonthlyReportUseCase(reader),
  };
}

const refuelEvent = (overrides: Record<string, unknown> = {}, type = 'refuel.registered') => ({
  eventId: randomUUID(),
  type,
  source: 'core-service',
  occurredAt: '2026-11-20T14:00:00Z',
  payload: {
    refuelId: randomUUID(),
    vehicleId: 'v1',
    plate: 'IXA1B23',
    department: 'Saúde',
    month: '2026-11',
    status: 'ACCEPTED',
    liters: 40,
    totalCents: 25160,
    distanceKm: 400,
    offline: false,
    rejectionCode: null,
    ...overrides,
  },
});

describe('Ledger imutável com hash encadeado', () => {
  test('primeiro registro aponta para o hash gênese e os seguintes encadeiam', async () => {
    const s = sut();
    await s.record.execute(refuelEvent());
    await s.record.execute(refuelEvent());
    assert.equal(s.db.entries[0]!.previousHash, GENESIS_HASH);
    assert.equal(s.db.entries[1]!.previousHash, s.db.entries[0]!.hash);
    assert.equal(s.db.entries[1]!.sequence, 2);
  });

  test('evento duplicado (at-least-once) não gera novo registro', async () => {
    const s = sut();
    const e = refuelEvent();
    const a = await s.record.execute(e);
    const b = await s.record.execute(e);
    assert.ok(a.ok && !a.value.duplicated);
    assert.ok(b.ok && b.value.duplicated);
    assert.equal(s.db.entries.length, 1);
  });

  test('100 eventos concorrentes geram sequência contínua 1..100 sem bifurcar', async () => {
    const s = sut();
    await Promise.all(Array.from({ length: 100 }, () => s.record.execute(refuelEvent())));
    assert.deepEqual(s.db.entries.map((e) => e.sequence), Array.from({ length: 100 }, (_, i) => i + 1));
    const v = await s.verify.execute(7); // lotes pequenos para exercitar a paginação
    assert.ok(v.ok && v.value.entriesVerified === 100);
  });

  test('detecta adulteração: alterar litros direto no "banco" quebra a cadeia', async () => {
    const s = sut();
    for (let i = 0; i < 5; i++) await s.record.execute(refuelEvent());
    s.db.entries[2]!.payload = { ...s.db.entries[2]!.payload, liters: 1 }; // fraude!
    const v = await s.verify.execute();
    assert.ok(!v.ok);
    if (!v.ok) {
      assert.equal(v.error.code, 'CHAIN_BROKEN');
      assert.equal(v.error.sequence, 3);
    }
  });

  test('detecta remoção de um registro no meio', async () => {
    const s = sut();
    for (let i = 0; i < 4; i++) await s.record.execute(refuelEvent());
    s.db.entries.splice(1, 1);
    const v = await s.verify.execute();
    assert.ok(!v.ok && v.error.code === 'CHAIN_BROKEN');
  });

  test('rejeita mensagem malformada vinda do broker', async () => {
    const s = sut();
    const r = await s.record.execute({ type: 'x', payload: {} });
    assert.ok(!r.ok && r.error.code === 'INVALID_EVENT');
  });

  test('aceita eventos do Serviço B (sessões) no histórico', async () => {
    const s = sut();
    await s.record.execute({ eventId: randomUUID(), type: 'session.started', source: 'live-service', occurredAt: new Date().toISOString(), payload: { vehicleId: 'v1', driverName: 'Ana' } });
    const list = await s.list.execute({ aggregateId: 'v1' });
    assert.ok(list.ok && list.value[0]?.eventType === 'session.started');
  });
});

describe('Relatório mensal consolidado', () => {
  test('soma aceitos, conta rejeitados sem somar litros e calcula km/L médio', async () => {
    const s = sut();
    await s.record.execute(refuelEvent({ liters: 40, totalCents: 25000, distanceKm: 400 }));
    await s.record.execute(refuelEvent({ liters: 50, totalCents: 30000, distanceKm: 350, status: 'FLAGGED', offline: true }));
    await s.record.execute(refuelEvent({ liters: 60, totalCents: 36000, status: 'REJECTED', rejectionCode: 'QUOTA_EXCEEDED', distanceKm: null }, 'refuel.rejected'));
    await s.record.execute(refuelEvent({ vehicleId: 'v2', plate: 'ABC1234', department: 'Obras', liters: 10, totalCents: 6000, distanceKm: 90 }));
    await s.record.execute(refuelEvent({ month: '2026-10' })); // outro mês: fora

    const r = await s.report.execute('2026-11');
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.value.totals.refuels, 3);
    assert.equal(r.value.totals.rejected, 1);
    assert.equal(r.value.totals.flagged, 1);
    assert.equal(r.value.totals.liters, 100);
    assert.equal(r.value.totals.totalCents, 61000);
    assert.deepEqual(r.value.rejectionReasons, { QUOTA_EXCEEDED: 1 });
    const v1 = r.value.byVehicle.find((l) => l.vehicleId === 'v1')!;
    assert.equal(v1.avgKmPerLiter, 8.33); // 750 km / 90 L
    assert.equal(r.value.byDepartment[0]!.department, 'Saúde');
  });

  test('mês inválido retorna erro de validação', async () => {
    const r = await sut().report.execute('nov/2026');
    assert.ok(!r.ok && r.error.code === 'VALIDATION_ERROR');
  });
});
