import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { InMemoryLiveStore, InMemorySessionStore, RecordingBroadcaster, RecordingPublisher } from '../src/infra/database/in-memory/in-memory-stores';
import { EndSessionUseCase, IngestTelemetryUseCase, StartSessionUseCase, ValidateSessionUseCase } from '../src/core/use-cases/session-use-cases';
import { GetLiveSnapshotUseCase, ProjectCoreEventUseCase } from '../src/core/use-cases/live-projection-use-cases';

function sut() {
  const clock = { current: new Date('2026-11-20T15:00:00Z'), now() { return new Date(this.current); } };
  const sessions = new InMemorySessionStore(() => clock.now());
  const live = new InMemoryLiveStore();
  const broadcaster = new RecordingBroadcaster();
  const publisher = new RecordingPublisher();
  const tokens = { next: () => randomBytes(24).toString('hex') };
  return {
    clock, sessions, live, broadcaster, publisher,
    start: new StartSessionUseCase(sessions, live, tokens, broadcaster, publisher, clock),
    end: new EndSessionUseCase(sessions, live, broadcaster, publisher, clock),
    telemetry: new IngestTelemetryUseCase(sessions, live, broadcaster, clock),
    validate: new ValidateSessionUseCase(sessions, clock),
    project: new ProjectCoreEventUseCase(live, broadcaster, clock),
    snapshot: new GetLiveSnapshotUseCase(sessions, live, clock),
  };
}

const startInput = { vehicleId: 'v1', plate: 'ixa1b23', driverName: 'Carlos' };

describe('Sessões efêmeras', () => {
  test('inicia turno, gera token de 48 hex e publica session.started', async () => {
    const s = sut();
    const r = await s.start.execute(startInput);
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.match(r.value.token, /^[a-f0-9]{48}$/);
    assert.equal(r.value.plate, 'IXA1B23');
    assert.ok(s.publisher.published.some((p) => p.type === 'session.started'));
    assert.ok(s.broadcaster.sent.some((p) => p.type === 'session.started'));
  });

  test('token expira após 12 h (TTL)', async () => {
    const s = sut();
    const r = await s.start.execute(startInput);
    assert.ok(r.ok);
    if (!r.ok) return;
    s.clock.current = new Date(s.clock.current.getTime() + 12 * 3600_000 + 1);
    const v = await s.validate.execute(r.value.token);
    assert.ok(!v.ok && v.error.code === 'INVALID_SESSION');
  });

  test('novo turno no mesmo veículo encerra o anterior', async () => {
    const s = sut();
    const a = await s.start.execute(startInput);
    const b = await s.start.execute({ ...startInput, driverName: 'Ana' });
    assert.ok(a.ok && b.ok);
    if (!a.ok) return;
    assert.equal((await s.validate.execute(a.value.token)).ok, false);
    assert.ok(s.publisher.published.some((p) => p.type === 'session.ended' && p.payload.reason === 'REPLACED'));
  });

  test('encerrar turno remove a posição do mapa', async () => {
    const s = sut();
    const r = await s.start.execute(startInput);
    if (!r.ok) throw new Error();
    await s.telemetry.execute({ token: r.value.token, lat: -28.6, lng: -53.6, recordedAt: s.clock.now().toISOString() });
    assert.equal(s.live.positions.size, 1);
    await s.end.execute(r.value.token);
    assert.equal(s.live.positions.size, 0);
  });
});

describe('Telemetria', () => {
  test('rejeita token inválido', async () => {
    const s = sut();
    const r = await s.telemetry.execute({ token: 'x'.repeat(48), lat: 0, lng: 0, recordedAt: new Date().toISOString() });
    assert.ok(!r.ok && r.error.code === 'INVALID_SESSION');
  });

  test('aceita ponto, faz broadcast e aplica throttle de 2 s', async () => {
    const s = sut();
    const r = await s.start.execute(startInput);
    if (!r.ok) throw new Error();
    const point = { token: r.value.token, lat: -28.63, lng: -53.6, speedKmh: 40, recordedAt: s.clock.now().toISOString() };

    const first = await s.telemetry.execute(point);
    const tooSoon = await s.telemetry.execute(point);
    s.clock.current = new Date(s.clock.current.getTime() + 2500);
    const later = await s.telemetry.execute(point);

    assert.ok(first.ok && first.value.accepted);
    assert.ok(tooSoon.ok && !tooSoon.value.accepted);
    assert.ok(later.ok && later.value.accepted);
    assert.equal(s.broadcaster.sent.filter((m) => m.type === 'vehicle.position').length, 2);
  });

  test('rejeita coordenada inválida', async () => {
    const s = sut();
    const r = await s.start.execute(startInput);
    if (!r.ok) throw new Error();
    const t = await s.telemetry.execute({ token: r.value.token, lat: 200, lng: 0, recordedAt: new Date().toISOString() });
    assert.ok(!t.ok && t.error.code === 'VALIDATION_ERROR');
  });
});

describe('Projeção de eventos do Serviço A', () => {
  const event = (id: string, type = 'refuel.registered', extra: Record<string, unknown> = {}) => ({
    eventId: id,
    type,
    occurredAt: '2026-11-20T15:00:00Z',
    payload: { vehicleId: 'v1', plate: 'IXA1B23', liters: 40, totalCents: 25160, status: 'ACCEPTED', offline: true, quotaRemainingLiters: 60, month: '2026-11', ...extra },
  });

  test('atualiza contadores do dia e saldo, e faz broadcast', async () => {
    const s = sut();
    await s.project.execute(event('e1'));
    await s.project.execute(event('e2', 'refuel.rejected'));
    const snap = await s.snapshot.execute();
    assert.equal(snap.stats.refuels, 1);
    assert.equal(snap.stats.rejected, 1);
    assert.equal(snap.stats.liters, 40);
    assert.equal(snap.stats.offlineSynced, 2);
    assert.equal(snap.quotas[0]?.remainingLiters, 60);
    assert.ok(s.broadcaster.sent.some((m) => m.type === 'stats.updated'));
  });

  test('é idempotente: o mesmo eventId entregue 2x conta uma vez (at-least-once do broker)', async () => {
    const s = sut();
    const a = await s.project.execute(event('dup'));
    const b = await s.project.execute(event('dup'));
    assert.ok(a.ok && a.value.processed);
    assert.ok(b.ok && !b.value.processed);
    assert.equal((await s.snapshot.execute()).stats.refuels, 1);
  });
});
