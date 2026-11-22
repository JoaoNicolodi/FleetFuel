import { Result, ok, fail } from '../domain/shared/result';
import { InvalidSessionError, ValidationError } from '../domain/shared/errors';
import { DriverSession } from '../domain/entities/driver-session';
import { GeoPosition } from '../domain/value-objects/geo-position';
import { Clock, EventPublisher, LiveStore, RealtimeBroadcaster, SessionStore, TokenGenerator } from './ports';

export interface StartSessionInput {
  vehicleId: string;
  plate: string;
  driverName: string;
}

export interface SessionOutput {
  token: string;
  vehicleId: string;
  plate: string;
  driverName: string;
  expiresAt: string;
}

const toOutput = (s: DriverSession): SessionOutput => ({
  token: s.token,
  vehicleId: s.vehicleId,
  plate: s.plate,
  driverName: s.driverName,
  expiresAt: s.expiresAt.toISOString(),
});

/** Motorista inicia o turno no app → recebe um token efêmero (TTL de 12 h). */
export class StartSessionUseCase {
  constructor(
    private readonly sessions: SessionStore,
    private readonly live: LiveStore,
    private readonly tokens: TokenGenerator,
    private readonly broadcaster: RealtimeBroadcaster,
    private readonly publisher: EventPublisher,
    private readonly clock: Clock,
  ) {}

  async execute(input: StartSessionInput): Promise<Result<SessionOutput, ValidationError>> {
    const now = this.clock.now();
    const session = DriverSession.start({ ...input, token: this.tokens.next(), now });
    if (!session.ok) return session;

    // Um veículo só tem um turno ativo: o anterior é encerrado (ex.: motorista reinstalou o app).
    const previous = await this.sessions.findActiveByVehicle(input.vehicleId);
    if (previous) {
      await this.sessions.delete(previous.token);
      await this.publisher.publish('session.ended', { vehicleId: previous.vehicleId, plate: previous.plate, driverName: previous.driverName, reason: 'REPLACED' });
    }

    await this.sessions.save(session.value, session.value.remainingTtlMs(now));
    const out = toOutput(session.value);
    const publicData = { vehicleId: out.vehicleId, plate: out.plate, driverName: out.driverName, expiresAt: out.expiresAt };
    await this.publisher.publish('session.started', publicData);
    await this.broadcaster.broadcast('session.started', publicData);
    return ok(out);
  }
}

export class EndSessionUseCase {
  constructor(
    private readonly sessions: SessionStore,
    private readonly live: LiveStore,
    private readonly broadcaster: RealtimeBroadcaster,
    private readonly publisher: EventPublisher,
    private readonly clock: Clock,
  ) {}

  async execute(token: string): Promise<Result<void, InvalidSessionError>> {
    const session = await this.sessions.find(token);
    if (!session || session.isExpired(this.clock.now())) return fail(new InvalidSessionError());
    await this.sessions.delete(token);
    await this.live.removePosition(session.vehicleId);
    const data = { vehicleId: session.vehicleId, plate: session.plate, driverName: session.driverName, reason: 'ENDED_BY_DRIVER' };
    await this.publisher.publish('session.ended', data);
    await this.broadcaster.broadcast('session.ended', data);
    return ok(undefined);
  }
}

export interface TelemetryInput {
  token: string;
  lat: number;
  lng: number;
  speedKmh?: number | null;
  recordedAt: string;
}

/**
 * Ingestão rápida de telemetria: valida o token efêmero, aplica throttle,
 * guarda a última posição no Redis e empurra para o painel via WebSocket.
 * Não grava histórico ponto a ponto (isso seria papel de um TSDB).
 */
export class IngestTelemetryUseCase {
  constructor(
    private readonly sessions: SessionStore,
    private readonly live: LiveStore,
    private readonly broadcaster: RealtimeBroadcaster,
    private readonly clock: Clock,
  ) {}

  async execute(input: TelemetryInput): Promise<Result<{ accepted: boolean }, InvalidSessionError | ValidationError>> {
    const now = this.clock.now();
    const session = await this.sessions.find(input.token);
    if (!session || session.isExpired(now)) return fail(new InvalidSessionError());

    const pos = GeoPosition.create(input);
    if (!pos.ok) return pos;

    if (!session.acceptTelemetry(now)) return ok({ accepted: false });
    await this.sessions.save(session, session.remainingTtlMs(now));

    const position = {
      vehicleId: session.vehicleId,
      plate: session.plate,
      driverName: session.driverName,
      ...pos.value.toJSON(),
    };
    await this.live.savePosition(position);
    await this.broadcaster.broadcast('vehicle.position', position);
    return ok({ accepted: true });
  }
}

/** Valida um token (usado pelo app para saber se o turno ainda vale). */
export class ValidateSessionUseCase {
  constructor(
    private readonly sessions: SessionStore,
    private readonly clock: Clock,
  ) {}

  async execute(token: string): Promise<Result<SessionOutput, InvalidSessionError>> {
    const session = await this.sessions.find(token);
    if (!session || session.isExpired(this.clock.now())) return fail(new InvalidSessionError());
    return ok(toOutput(session));
  }
}
