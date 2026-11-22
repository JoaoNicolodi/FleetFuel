import { DriverSession, DriverSessionProps } from '../../../core/domain/entities/driver-session';
import {
  DailyStats,
  EventPublisher,
  LiveEvent,
  LiveStore,
  RealtimeBroadcaster,
  SessionStore,
  VehiclePosition,
} from '../../../core/use-cases/ports';

/** Implementações em memória para testes dos casos de uso do Serviço B. */
export class InMemorySessionStore implements SessionStore {
  readonly items = new Map<string, { props: DriverSessionProps; expiresAtMs: number }>();
  constructor(private readonly nowFn: () => Date) {}

  async save(session: DriverSession, ttlMs: number) {
    this.items.set(session.token, { props: session.snapshot(), expiresAtMs: this.nowFn().getTime() + ttlMs });
  }
  async find(token: string) {
    const it = this.items.get(token);
    if (!it || it.expiresAtMs <= this.nowFn().getTime()) return null; // simula o TTL do Redis
    return DriverSession.restore(it.props);
  }
  async findActiveByVehicle(vehicleId: string) {
    for (const [token, it] of this.items) if (it.props.vehicleId === vehicleId) return this.find(token);
    return null;
  }
  async delete(token: string) {
    this.items.delete(token);
  }
  async listActive(now: Date) {
    return [...this.items.values()].filter((i) => i.expiresAtMs > now.getTime()).map((i) => DriverSession.restore(i.props));
  }
}

const emptyStats = (date: string): DailyStats => ({ date, refuels: 0, rejected: 0, flagged: 0, liters: 0, totalCents: 0, offlineSynced: 0 });

export class InMemoryLiveStore implements LiveStore {
  positions = new Map<string, VehiclePosition>();
  processed = new Set<string>();
  feed: LiveEvent[] = [];
  stats = new Map<string, DailyStats>();
  quotas = new Map<string, Record<string, unknown>>();

  async savePosition(pos: VehiclePosition) { this.positions.set(pos.vehicleId, pos); }
  async removePosition(vehicleId: string) { this.positions.delete(vehicleId); }
  async listPositions() { return [...this.positions.values()]; }
  async markProcessed(eventId: string) {
    if (this.processed.has(eventId)) return false;
    this.processed.add(eventId);
    return true;
  }
  async pushFeed(e: LiveEvent) { this.feed.unshift(e); this.feed = this.feed.slice(0, 50); }
  async recentFeed(limit: number) { return this.feed.slice(0, limit); }
  async incrementStats(date: string, delta: Partial<Omit<DailyStats, 'date'>>) {
    const s = this.stats.get(date) ?? emptyStats(date);
    const bag = s as unknown as Record<string, number>;
    for (const [k, v] of Object.entries(delta)) bag[k] = (bag[k] ?? 0) + (v ?? 0);
    s.liters = Math.round(s.liters * 1000) / 1000;
    this.stats.set(date, s);
    return { ...s };
  }
  async getStats(date: string) { return { ...(this.stats.get(date) ?? emptyStats(date)) }; }
  async saveQuota(vehicleId: string, data: Record<string, unknown>) {
    this.quotas.set(vehicleId, { ...(this.quotas.get(vehicleId) ?? {}), ...data });
  }
  async listQuotas() { return [...this.quotas.values()]; }
}

export class RecordingBroadcaster implements RealtimeBroadcaster {
  readonly sent: { type: string; data: unknown }[] = [];
  async broadcast(type: string, data: unknown) { this.sent.push({ type, data }); }
}

export class RecordingPublisher implements EventPublisher {
  readonly published: { type: string; payload: Record<string, unknown> }[] = [];
  async publish(type: string, payload: Record<string, unknown>) { this.published.push({ type, payload }); }
}
