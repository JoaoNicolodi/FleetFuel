import { Result, ok, fail } from '../shared/result';
import { ValidationError } from '../shared/errors';

export interface DriverSessionProps {
  token: string;
  vehicleId: string;
  plate: string;
  driverName: string;
  startedAt: Date;
  expiresAt: Date;
  lastSeenAt: Date;
  lastTelemetryAt: Date | null;
}

/**
 * Sessão (turno) efêmera do motorista. O token tem vida curta (TTL) e é
 * guardado só no Redis: se expirar, simplesmente some — não precisa de limpeza.
 */
export class DriverSession {
  static readonly DEFAULT_TTL_MS = 12 * 60 * 60 * 1000; // um turno
  /** Ingestão rápida, mas com proteção: no máximo 1 ponto de telemetria a cada 2 s por sessão. */
  static readonly MIN_TELEMETRY_INTERVAL_MS = 2000;

  private constructor(private props: DriverSessionProps) {}

  static start(input: {
    token: string;
    vehicleId: string;
    plate: string;
    driverName: string;
    now: Date;
    ttlMs?: number;
  }): Result<DriverSession, ValidationError> {
    if (!/^[a-f0-9]{48}$/.test(input.token)) return fail(new ValidationError('token', 'Token mal formado'));
    if (!input.vehicleId) return fail(new ValidationError('vehicleId', 'Veículo é obrigatório'));
    if (!input.driverName?.trim()) return fail(new ValidationError('driverName', 'Motorista é obrigatório'));
    const ttl = input.ttlMs ?? DriverSession.DEFAULT_TTL_MS;
    return ok(
      new DriverSession({
        token: input.token,
        vehicleId: input.vehicleId,
        plate: input.plate.toUpperCase(),
        driverName: input.driverName.trim(),
        startedAt: input.now,
        expiresAt: new Date(input.now.getTime() + ttl),
        lastSeenAt: input.now,
        lastTelemetryAt: null,
      }),
    );
  }

  static restore(props: DriverSessionProps) {
    return new DriverSession({ ...props });
  }

  get token() { return this.props.token; }
  get vehicleId() { return this.props.vehicleId; }
  get plate() { return this.props.plate; }
  get driverName() { return this.props.driverName; }
  get expiresAt() { return this.props.expiresAt; }

  isExpired(now: Date): boolean {
    return now.getTime() >= this.props.expiresAt.getTime();
  }

  remainingTtlMs(now: Date): number {
    return Math.max(0, this.props.expiresAt.getTime() - now.getTime());
  }

  /** Retorna false se o ponto chegou cedo demais (throttle). */
  acceptTelemetry(now: Date): boolean {
    const last = this.props.lastTelemetryAt;
    if (last && now.getTime() - last.getTime() < DriverSession.MIN_TELEMETRY_INTERVAL_MS) return false;
    this.props.lastTelemetryAt = now;
    this.props.lastSeenAt = now;
    return true;
  }

  snapshot(): Readonly<DriverSessionProps> {
    return { ...this.props };
  }
}
