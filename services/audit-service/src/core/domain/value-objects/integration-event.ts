import { Result, ok, fail } from '../shared/result';
import { InvalidEventError } from '../shared/errors';

/**
 * Evento recebido do broker (vindo do Serviço A ou B). É validado na entrada
 * porque o Serviço C não confia cegamente em mensagens externas.
 */
export class IntegrationEvent {
  private constructor(
    readonly eventId: string,
    readonly type: string,
    readonly source: string,
    readonly occurredAt: Date,
    readonly payload: Readonly<Record<string, unknown>>,
  ) {}

  static parse(raw: unknown): Result<IntegrationEvent, InvalidEventError> {
    if (!raw || typeof raw !== 'object') return fail(new InvalidEventError('Evento não é um objeto'));
    const e = raw as Record<string, unknown>;
    if (typeof e.eventId !== 'string' || e.eventId.length < 8) return fail(new InvalidEventError('eventId ausente'));
    if (typeof e.type !== 'string' || !/^[a-z]+\.[a-z_.]+$/.test(e.type)) return fail(new InvalidEventError(`type inválido: ${String(e.type)}`));
    if (typeof e.source !== 'string') return fail(new InvalidEventError('source ausente'));
    const occurredAt = new Date(String(e.occurredAt));
    if (Number.isNaN(occurredAt.getTime())) return fail(new InvalidEventError('occurredAt inválido'));
    if (!e.payload || typeof e.payload !== 'object') return fail(new InvalidEventError('payload ausente'));
    return ok(new IntegrationEvent(e.eventId, e.type, e.source, occurredAt, e.payload as Record<string, unknown>));
  }

  /** Agregado a que o evento se refere (o veículo), para filtrar o histórico. */
  get aggregateId(): string | null {
    const id = this.payload.vehicleId;
    return typeof id === 'string' ? id : null;
  }

  get isRefuel(): boolean {
    return this.type === 'refuel.registered' || this.type === 'refuel.rejected';
  }
}
