import type { PhotoReader, QueueStore, RefuelApi, SyncSummary } from './types';

/**
 * Motor de sincronização Offline-First.
 *
 * Por que é IDEMPOTENTE?
 *  - O clientId (UUID) é gerado e gravado no SQLite ANTES de qualquer envio.
 *  - Todo reenvio usa o mesmo clientId como Idempotency-Key.
 *  - O servidor trava o veículo, procura o clientId e, se já existir, devolve o
 *    mesmo resultado sem debitar a cota de novo.
 *  Logo: se a resposta se perder (sinal caiu no meio), reenviar é seguro.
 *
 * Ordem: envia em ordem cronológica e PARA no primeiro erro transitório, para que
 * o hodômetro chegue ao servidor sempre crescente.
 */
export class SyncEngine {
  private running: Promise<SyncSummary> | null = null;

  constructor(
    private readonly queue: QueueStore,
    private readonly api: RefuelApi,
    private readonly photos: PhotoReader,
    private readonly now: () => number = () => Date.now(),
    private readonly random: () => number = Math.random,
  ) {}

  /** Chamadas concorrentes (NetInfo + AppState + botão) reaproveitam a mesma execução. */
  run(): Promise<SyncSummary> {
    if (this.running) return this.running.then((s) => ({ ...s, skipped: true }));
    this.running = this.doRun().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** Backoff exponencial com jitter: 5s, 10s, 20s ... até 5 min. */
  backoffMs(attempts: number): number {
    const base = Math.min(5 * 60_000, 5_000 * 2 ** attempts);
    return base + Math.floor(this.random() * 1000);
  }

  private async doRun(): Promise<SyncSummary> {
    const summary: SyncSummary = { synced: 0, rejected: 0, retrying: 0, skipped: false };
    await this.queue.resetStuckSyncing();
    const items = await this.queue.listReadyToSync(this.now());

    for (const item of items) {
      await this.queue.markSyncing(item.clientId);

      const photoBase64 = await this.photos.readBase64(item.photoUri);
      if (!photoBase64) {
        await this.queue.markRejected(item.clientId, { serverRefuelId: null, message: 'Foto do hodômetro não encontrada no aparelho' });
        summary.rejected += 1;
        continue;
      }

      const outcome = await this.api.postRefuel({
        clientId: item.clientId,
        vehicleId: item.vehicleId,
        driverName: item.driverName,
        stationName: item.stationName,
        liters: item.liters,
        odometerKm: item.odometerKm,
        pricePerLiterCents: item.pricePerLiterCents,
        occurredAt: item.occurredAt,
        offline: item.attempts > 0 || new Date(item.createdAt).getTime() < this.now() - 60_000,
        photoBase64,
        photoMimeType: 'image/jpeg',
        location: item.lat !== null && item.lng !== null ? { lat: item.lat, lng: item.lng } : null,
      });

      switch (outcome.kind) {
        case 'created':
        case 'replayed':
          await this.queue.markSynced(item.clientId, { serverRefuelId: outcome.refuelId, serverStatus: outcome.status, message: outcome.message });
          summary.synced += 1;
          break;
        case 'rejected':
          await this.queue.markRejected(item.clientId, { serverRefuelId: outcome.refuelId, message: outcome.message });
          summary.rejected += 1;
          break;
        case 'invalid':
          await this.queue.markRejected(item.clientId, { serverRefuelId: null, message: outcome.message });
          summary.rejected += 1;
          break;
        case 'transient':
          await this.queue.markRetry(item.clientId, { error: outcome.message, nextAttemptAt: this.now() + this.backoffMs(item.attempts) });
          summary.retrying += 1;
          return summary; // para aqui: preserva a ordem e não martela uma rede ruim
      }
    }
    return summary;
  }
}
