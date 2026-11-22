import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SyncEngine } from '../src/sync/sync-engine';
import type { PendingRefuel, PostOutcome, QueueStore, RefuelApi, RefuelRequestBody } from '../src/sync/types';

/** Fila em memória que imita o SQLite do app. */
class MemoryQueue implements QueueStore {
  items = new Map<string, PendingRefuel>();
  add(p: Partial<PendingRefuel> & { clientId: string }) {
    this.items.set(p.clientId, {
      vehicleId: 'v1', plate: 'IXA1B23', driverName: 'Carlos', stationName: 'Posto', liters: 10, odometerKm: 1000,
      pricePerLiterCents: 600, occurredAt: '2026-11-20T10:00:00Z', photoUri: 'file://a.jpg', lat: null, lng: null,
      status: 'PENDING', attempts: 0, lastError: null, serverStatus: null, serverRefuelId: null, serverMessage: null,
      nextAttemptAt: 0, createdAt: '2026-11-20T10:00:00Z', syncedAt: null, ...p,
    });
  }
  async listReadyToSync(now: number) {
    return [...this.items.values()]
      .filter((i) => (i.status === 'PENDING' || i.status === 'ERROR') && i.nextAttemptAt <= now)
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  }
  async resetStuckSyncing() {
    for (const i of this.items.values()) if (i.status === 'SYNCING') i.status = 'PENDING';
  }
  async markSyncing(id: string) { this.items.get(id)!.status = 'SYNCING'; }
  async markSynced(id: string, d: { serverRefuelId: string; serverStatus: 'ACCEPTED' | 'FLAGGED' }) {
    Object.assign(this.items.get(id)!, { status: 'SYNCED', serverRefuelId: d.serverRefuelId, serverStatus: d.serverStatus });
  }
  async markRejected(id: string, d: { message: string }) {
    Object.assign(this.items.get(id)!, { status: 'REJECTED', serverStatus: 'REJECTED', serverMessage: d.message });
  }
  async markRetry(id: string, d: { error: string; nextAttemptAt: number }) {
    const i = this.items.get(id)!;
    Object.assign(i, { status: 'ERROR', lastError: d.error, nextAttemptAt: d.nextAttemptAt, attempts: i.attempts + 1 });
  }
}

/** Servidor fake com idempotência por clientId (como o Serviço A). */
class FakeServer implements RefuelApi {
  online = true;
  loseResponses = false; // processa, mas a resposta "se perde" no caminho
  processed = new Map<string, string>();
  calls: RefuelRequestBody[] = [];
  rejectIds = new Set<string>();

  async postRefuel(body: RefuelRequestBody): Promise<PostOutcome> {
    this.calls.push(body);
    if (!this.online) return { kind: 'transient', message: 'Network request failed' };
    if (this.rejectIds.has(body.clientId)) return { kind: 'rejected', refuelId: 'r-x', code: 'QUOTA_EXCEEDED', message: 'Cota insuficiente' };
    const existed = this.processed.has(body.clientId);
    if (!existed) this.processed.set(body.clientId, `srv-${this.processed.size + 1}`);
    if (this.loseResponses) return { kind: 'transient', message: 'timeout' };
    return { kind: existed ? 'replayed' : 'created', refuelId: this.processed.get(body.clientId)!, status: 'ACCEPTED', message: null, quotaRemainingLiters: 50 };
  }
}

const photos = { readBase64: async (uri: string) => (uri.includes('missing') ? null : 'BASE64') };

describe('SyncEngine (offline-first)', () => {
  test('sem rede: nada se perde, item fica em ERROR com backoff', async () => {
    const q = new MemoryQueue();
    q.add({ clientId: 'a' });
    const srv = new FakeServer();
    srv.online = false;
    const engine = new SyncEngine(q, srv, photos, () => 1000, () => 0);
    const r = await engine.run();
    assert.equal(r.retrying, 1);
    assert.equal(q.items.get('a')!.status, 'ERROR');
    assert.equal(q.items.get('a')!.nextAttemptAt, 1000 + 5000);
  });

  test('rede volta: sincroniza em ordem cronológica', async () => {
    const q = new MemoryQueue();
    q.add({ clientId: 'b', occurredAt: '2026-11-20T12:00:00Z', odometerKm: 1200 });
    q.add({ clientId: 'a', occurredAt: '2026-11-20T09:00:00Z', odometerKm: 1100 });
    const srv = new FakeServer();
    await new SyncEngine(q, srv, photos).run();
    assert.deepEqual(srv.calls.map((c) => c.clientId), ['a', 'b']);
    assert.equal(q.items.get('a')!.status, 'SYNCED');
    assert.equal(q.items.get('b')!.status, 'SYNCED');
  });

  test('IDEMPOTÊNCIA: resposta perdida → reenvio usa o mesmo clientId e o servidor não duplica', async () => {
    const q = new MemoryQueue();
    q.add({ clientId: 'a' });
    const srv = new FakeServer();
    let now = 0;
    const engine = new SyncEngine(q, srv, photos, () => now, () => 0);

    srv.loseResponses = true;
    await engine.run(); // servidor gravou, mas o app não soube
    assert.equal(q.items.get('a')!.status, 'ERROR');

    srv.loseResponses = false;
    now = 60_000;
    await engine.run(); // reenvio
    assert.equal(q.items.get('a')!.status, 'SYNCED');
    assert.equal(srv.processed.size, 1, 'servidor registrou UMA vez só');
    assert.equal(srv.calls.length, 2);
    assert.equal(srv.calls[0]!.clientId, srv.calls[1]!.clientId);
  });

  test('para no primeiro erro transitório para preservar a ordem do hodômetro', async () => {
    const q = new MemoryQueue();
    q.add({ clientId: 'a', occurredAt: '2026-11-20T09:00:00Z' });
    q.add({ clientId: 'b', occurredAt: '2026-11-20T10:00:00Z' });
    const srv = new FakeServer();
    srv.online = false;
    await new SyncEngine(q, srv, photos).run();
    assert.equal(srv.calls.length, 1);
    assert.equal(q.items.get('b')!.status, 'PENDING');
  });

  test('rejeição de negócio não trava a fila: marca REJECTED e segue para o próximo', async () => {
    const q = new MemoryQueue();
    q.add({ clientId: 'a', occurredAt: '2026-11-20T09:00:00Z' });
    q.add({ clientId: 'b', occurredAt: '2026-11-20T10:00:00Z' });
    const srv = new FakeServer();
    srv.rejectIds.add('a');
    const r = await new SyncEngine(q, srv, photos).run();
    assert.equal(r.rejected, 1);
    assert.equal(r.synced, 1);
    assert.equal(q.items.get('a')!.serverMessage, 'Cota insuficiente');
  });

  test('execuções concorrentes (NetInfo + botão) não enviam o mesmo item duas vezes', async () => {
    const q = new MemoryQueue();
    q.add({ clientId: 'a' });
    const srv = new FakeServer();
    const engine = new SyncEngine(q, srv, photos);
    const [r1, r2] = await Promise.all([engine.run(), engine.run()]);
    assert.equal(srv.calls.length, 1);
    assert.ok(r2.skipped || r1.skipped);
  });

  test('app fechado no meio do envio: item SYNCING volta para a fila', async () => {
    const q = new MemoryQueue();
    q.add({ clientId: 'a', status: 'SYNCING' });
    await new SyncEngine(q, new FakeServer(), photos).run();
    assert.equal(q.items.get('a')!.status, 'SYNCED');
  });

  test('foto apagada do aparelho → REJECTED com mensagem clara', async () => {
    const q = new MemoryQueue();
    q.add({ clientId: 'a', photoUri: 'file://missing.jpg' });
    await new SyncEngine(q, new FakeServer(), photos).run();
    assert.equal(q.items.get('a')!.status, 'REJECTED');
  });
});
