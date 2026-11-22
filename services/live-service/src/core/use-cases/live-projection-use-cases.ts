import { Result, ok } from '../domain/shared/result';
import { Clock, DailyStats, LiveEvent, LiveStore, RealtimeBroadcaster, SessionStore, VehiclePosition } from './ports';

const BRASILIA_OFFSET_MS = -3 * 60 * 60 * 1000;
export const localDate = (d: Date) => new Date(d.getTime() + BRASILIA_OFFSET_MS).toISOString().slice(0, 10);

/**
 * Consome eventos do Serviço A (via RabbitMQ) e mantém uma projeção
 * "quente" no Redis para o painel: feed, contadores do dia e saldos de cota.
 * Idempotente: o mesmo eventId entregue duas vezes é ignorado.
 */
export class ProjectCoreEventUseCase {
  constructor(
    private readonly live: LiveStore,
    private readonly broadcaster: RealtimeBroadcaster,
    private readonly clock: Clock,
  ) {}

  async execute(event: LiveEvent): Promise<Result<{ processed: boolean }, never>> {
    const first = await this.live.markProcessed(event.eventId);
    if (!first) return ok({ processed: false });

    const p = event.payload as Record<string, unknown>;
    const today = localDate(this.clock.now());

    if (event.type === 'refuel.registered' || event.type === 'refuel.rejected') {
      const rejected = event.type === 'refuel.rejected';
      const stats = await this.live.incrementStats(today, {
        refuels: rejected ? 0 : 1,
        rejected: rejected ? 1 : 0,
        flagged: p.status === 'FLAGGED' ? 1 : 0,
        liters: rejected ? 0 : Number(p.liters ?? 0),
        totalCents: rejected ? 0 : Number(p.totalCents ?? 0),
        offlineSynced: p.offline ? 1 : 0,
      });
      if (!rejected && p.quotaRemainingLiters !== null && p.quotaRemainingLiters !== undefined) {
        await this.live.saveQuota(String(p.vehicleId), {
          vehicleId: p.vehicleId,
          plate: p.plate,
          month: p.month,
          remainingLiters: p.quotaRemainingLiters,
          updatedAt: event.occurredAt,
        });
      }
      await this.live.pushFeed(event);
      await this.broadcaster.broadcast(event.type, p);
      await this.broadcaster.broadcast('stats.updated', stats);
    } else if (event.type === 'quota.defined') {
      await this.live.saveQuota(String(p.vehicleId), {
        vehicleId: p.vehicleId,
        plate: p.plate,
        month: p.month,
        limitLiters: p.limitLiters,
        remainingLiters: Number(p.limitLiters) - Number(p.usedLiters),
        updatedAt: event.occurredAt,
      });
      await this.live.pushFeed(event);
      await this.broadcaster.broadcast('quota.defined', p);
    } else {
      await this.live.pushFeed(event);
      await this.broadcaster.broadcast(event.type, p);
    }
    return ok({ processed: true });
  }
}

export interface LiveSnapshot {
  stats: DailyStats;
  activeSessions: { vehicleId: string; plate: string; driverName: string; expiresAt: string }[];
  positions: VehiclePosition[];
  quotas: Record<string, unknown>[];
  feed: LiveEvent[];
}

/** Estado inicial enviado ao painel assim que o WebSocket conecta. */
export class GetLiveSnapshotUseCase {
  constructor(
    private readonly sessions: SessionStore,
    private readonly live: LiveStore,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<LiveSnapshot> {
    const now = this.clock.now();
    const [sessions, positions, quotas, feed, stats] = await Promise.all([
      this.sessions.listActive(now),
      this.live.listPositions(),
      this.live.listQuotas(),
      this.live.recentFeed(30),
      this.live.getStats(localDate(now)),
    ]);
    const activeVehicles = new Set(sessions.map((s) => s.vehicleId));
    return {
      stats,
      activeSessions: sessions.map((s) => ({ vehicleId: s.vehicleId, plate: s.plate, driverName: s.driverName, expiresAt: s.expiresAt.toISOString() })),
      positions: positions.filter((p) => activeVehicles.has(p.vehicleId)),
      quotas,
      feed,
    };
  }
}
