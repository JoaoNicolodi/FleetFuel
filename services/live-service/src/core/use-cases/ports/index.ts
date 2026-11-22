import { DriverSession } from '../../domain/entities/driver-session';

export interface SessionStore {
  /** Salva com expiração automática (TTL). */
  save(session: DriverSession, ttlMs: number): Promise<void>;
  find(token: string): Promise<DriverSession | null>;
  findActiveByVehicle(vehicleId: string): Promise<DriverSession | null>;
  delete(token: string): Promise<void>;
  listActive(now: Date): Promise<DriverSession[]>;
}

export interface VehiclePosition {
  vehicleId: string;
  plate: string;
  driverName: string;
  lat: number;
  lng: number;
  speedKmh: number | null;
  recordedAt: string;
}

export interface LiveEvent {
  eventId: string;
  type: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

export interface DailyStats {
  date: string;
  refuels: number;
  rejected: number;
  flagged: number;
  liters: number;
  totalCents: number;
  offlineSynced: number;
}

export interface LiveStore {
  savePosition(pos: VehiclePosition): Promise<void>;
  removePosition(vehicleId: string): Promise<void>;
  listPositions(): Promise<VehiclePosition[]>;
  /** Deduplicação: retorna true só na PRIMEIRA vez que vê o eventId. */
  markProcessed(eventId: string): Promise<boolean>;
  pushFeed(event: LiveEvent): Promise<void>;
  recentFeed(limit: number): Promise<LiveEvent[]>;
  incrementStats(date: string, delta: Partial<Omit<DailyStats, 'date'>>): Promise<DailyStats>;
  getStats(date: string): Promise<DailyStats>;
  saveQuota(vehicleId: string, data: Record<string, unknown>): Promise<void>;
  listQuotas(): Promise<Record<string, unknown>[]>;
}

/** Empurra mensagens para os painéis conectados via WebSocket. */
export interface RealtimeBroadcaster {
  broadcast(type: string, data: unknown): Promise<void>;
}

/** Publica eventos do Serviço B no broker (para o Serviço C auditar). */
export interface EventPublisher {
  publish(type: string, payload: Record<string, unknown>): Promise<void>;
}

export interface Clock {
  now(): Date;
}

export interface TokenGenerator {
  /** 24 bytes aleatórios em hex (48 chars). */
  next(): string;
}
