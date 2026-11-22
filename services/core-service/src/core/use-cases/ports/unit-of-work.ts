import { CoreDomainEvent } from '../../domain/events/domain-events';
import { QuotaRepository, RefuelRepository, VehicleRepository } from './repositories';

/**
 * Transactional Outbox: o evento é gravado NA MESMA transação que altera
 * a cota. Um processo separado (OutboxRelay) publica no RabbitMQ depois.
 * Assim nunca existe "cota debitada sem evento" nem "evento sem débito".
 */
export interface EventOutbox {
  add(event: CoreDomainEvent): Promise<void>;
}

/** Repositórios que compartilham a mesma transação. */
export interface TransactionScope {
  vehicles: VehicleRepository;
  quotas: QuotaRepository;
  refuels: RefuelRepository;
  outbox: EventOutbox;
}

/**
 * Unit of Work: executa `work` dentro de UMA transação.
 * - Se `work` resolver normalmente → COMMIT (inclusive quando retorna um Result de falha
 *   de negócio, pois abastecimentos rejeitados também precisam ficar registrados).
 * - Se `work` lançar exceção (falha de infraestrutura) → ROLLBACK.
 */
export interface UnitOfWork {
  run<T>(work: (tx: TransactionScope) => Promise<T>): Promise<T>;
}
