import type { Redis } from 'ioredis';
import { DriverSession, DriverSessionProps } from '../../../core/domain/entities/driver-session';
import { DailyStats, LiveEvent, LiveStore, SessionStore, VehiclePosition } from '../../../core/use-cases/ports';

type StoredSession = Omit<DriverSessionProps, 'startedAt' | 'expiresAt' | 'lastSeenAt' | 'lastTelemetryAt'> & {
  startedAt: string;
  expiresAt: string;
  lastSeenAt: string;
  lastTelemetryAt: string | null;
};

const serialize = (s: DriverSession): string => {
  const p = s.snapshot();
  return JSON.stringify({
    ...p,
    startedAt: p.startedAt.toISOString(),
    expiresAt: p.expiresAt.toISOString(),
    lastSeenAt: p.lastSeenAt.toISOString(),
    lastTelemetryAt: p.lastTelemetryAt?.toISOString() ?? null,
  });
};

const deserialize = (raw: string): DriverSession => {
  const p = JSON.parse(raw) as StoredSession;
  return DriverSession.restore({
    ...p,
    startedAt: new Date(p.startedAt),
    expiresAt: new Date(p.expiresAt),
    lastSeenAt: new Date(p.lastSeenAt),
    lastTelemetryAt: p.lastTelemetryAt ? new Date(p.lastTelemetryAt) : null,
  });
};

/**
 * Sessões no Redis com TTL nativo (PX). Quando o turno expira, a chave
 * some sozinha — não há job de limpeza nem tabela de sessões crescendo.
 */
export class RedisSessionStore implements SessionStore {
  constructor(private readonly redis: Redis) {}

  async save(session: DriverSession, ttlMs: number) {
    const ttl = Math.max(1, Math.floor(ttlMs));
    await this.redis
      .multi()
      .set(`session:${session.token}`, serialize(session), 'PX', ttl)
      .set(`vehicle-session:${session.vehicleId}`, session.token, 'PX', ttl)
      .zadd('sessions:active', session.expiresAt.getTime(), session.token)
      .exec();
  }

  async find(token: string) {
    if (!/^[a-f0-9]{48}$/.test(token)) return null;
    const raw = await this.redis.get(`session:${token}`);
    return raw ? deserialize(raw) : null;
  }

  async findActiveByVehicle(vehicleId: string) {
    const token = await this.redis.get(`vehicle-session:${vehicleId}`);
    return token ? this.find(token) : null;
  }

  async delete(token: string) {
    const s = await this.find(token);
    const tx = this.redis.multi().del(`session:${token}`).zrem('sessions:active', token);
    if (s) {
      const current = await this.redis.get(`vehicle-session:${s.vehicleId}`);
      if (current === token) tx.del(`vehicle-session:${s.vehicleId}`);
    }
    await tx.exec();
  }

  async listActive(now: Date) {
    await this.redis.zremrangebyscore('sessions:active', '-inf', now.getTime());
    const tokens = await this.redis.zrange('sessions:active', 0, -1);
    if (tokens.length === 0) return [];
    const raws = await this.redis.mget(tokens.map((t) => `session:${t}`));
    return raws.filter((r): r is string => r !== null).map(deserialize);
  }
}

const STATS_FIELDS = ['refuels', 'rejected', 'flagged', 'litersMl', 'totalCents', 'offlineSynced'] as const;

export class RedisLiveStore implements LiveStore {
  constructor(private readonly redis: Redis) {}

  async savePosition(pos: VehiclePosition) {
    await this.redis
      .multi()
      .hset('live:positions', pos.vehicleId, JSON.stringify(pos))
      .geoadd('live:geo', pos.lng, pos.lat, pos.vehicleId) // permite GEOSEARCH "veículos num raio de X km"
      .exec();
  }

  async removePosition(vehicleId: string) {
    await this.redis.multi().hdel('live:positions', vehicleId).zrem('live:geo', vehicleId).exec();
  }

  async listPositions() {
    const all = await this.redis.hvals('live:positions');
    return all.map((v) => JSON.parse(v) as VehiclePosition);
  }

  /** SET NX: operação atômica de "primeira vez que vejo este eventId?". */
  async markProcessed(eventId: string) {
    const r = await this.redis.set(`processed:${eventId}`, '1', 'EX', 172_800, 'NX');
    return r === 'OK';
  }

  async pushFeed(event: LiveEvent) {
    await this.redis.multi().lpush('live:feed', JSON.stringify(event)).ltrim('live:feed', 0, 49).exec();
  }

  async recentFeed(limit: number) {
    const items = await this.redis.lrange('live:feed', 0, limit - 1);
    return items.map((i) => JSON.parse(i) as LiveEvent);
  }

  async incrementStats(date: string, delta: Partial<Omit<DailyStats, 'date'>>) {
    const key = `live:stats:${date}`;
    const tx = this.redis.multi();
    const asInt: Record<string, number> = {
      refuels: delta.refuels ?? 0,
      rejected: delta.rejected ?? 0,
      flagged: delta.flagged ?? 0,
      litersMl: Math.round((delta.liters ?? 0) * 1000),
      totalCents: delta.totalCents ?? 0,
      offlineSynced: delta.offlineSynced ?? 0,
    };
    for (const [field, inc] of Object.entries(asInt)) if (inc) tx.hincrby(key, field, inc); // HINCRBY é atômico
    tx.expire(key, 3 * 86400);
    await tx.exec();
    return this.getStats(date);
  }

  async getStats(date: string): Promise<DailyStats> {
    const h = await this.redis.hgetall(`live:stats:${date}`);
    const n = (f: (typeof STATS_FIELDS)[number]) => Number(h[f] ?? 0);
    return {
      date,
      refuels: n('refuels'),
      rejected: n('rejected'),
      flagged: n('flagged'),
      liters: n('litersMl') / 1000,
      totalCents: n('totalCents'),
      offlineSynced: n('offlineSynced'),
    };
  }

  async saveQuota(vehicleId: string, data: Record<string, unknown>) {
    const current = await this.redis.hget('live:quotas', vehicleId);
    const merged = { ...(current ? JSON.parse(current) : {}), ...data };
    await this.redis.hset('live:quotas', vehicleId, JSON.stringify(merged));
  }

  async listQuotas() {
    const all = await this.redis.hvals('live:quotas');
    return all.map((v) => JSON.parse(v) as Record<string, unknown>);
  }
}
