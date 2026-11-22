import { Vehicle, VehicleProps } from '../../../core/domain/entities/vehicle';
import { MonthlyQuota, MonthlyQuotaProps } from '../../../core/domain/entities/monthly-quota';
import { Refuel, RefuelProps } from '../../../core/domain/entities/refuel';
import { CoreDomainEvent } from '../../../core/domain/events/domain-events';
import { QuotaRepository, RefuelFilter, RefuelRepository, VehicleRepository } from '../../../core/use-cases/ports/repositories';
import { EventOutbox, TransactionScope, UnitOfWork } from '../../../core/use-cases/ports/unit-of-work';

/**
 * Banco em memória para TESTES dos casos de uso (e para rodar o serviço sem Postgres).
 * Guarda apenas "fotografias" (props) das entidades: cada leitura devolve uma
 * instância NOVA, então mutar uma entidade sem chamar save() não vaza estado.
 */
export class InMemoryDatabase {
  vehicles = new Map<string, VehicleProps>();
  quotas = new Map<string, MonthlyQuotaProps>(); // chave: vehicleId|month
  refuels = new Map<string, RefuelProps>();
  outbox: CoreDomainEvent[] = [];

  clone(): InMemoryDatabase {
    const copy = new InMemoryDatabase();
    copy.vehicles = new Map([...this.vehicles].map(([k, v]) => [k, { ...v }]));
    copy.quotas = new Map([...this.quotas].map(([k, v]) => [k, { ...v }]));
    copy.refuels = new Map([...this.refuels].map(([k, v]) => [k, { ...v }]));
    copy.outbox = [...this.outbox];
    return copy;
  }

  restoreFrom(other: InMemoryDatabase): void {
    this.vehicles = other.vehicles;
    this.quotas = other.quotas;
    this.refuels = other.refuels;
    this.outbox = other.outbox;
  }
}

const vehicleProps = (v: Vehicle): VehicleProps => ({
  id: v.id,
  plate: v.plate,
  model: v.model,
  department: v.department,
  fuelType: v.fuelType,
  expectedKmPerLiter: v.expectedKmPerLiter,
  lastOdometer: v.lastOdometer,
  active: v.active,
  createdAt: v.createdAt,
});

const quotaProps = (q: MonthlyQuota): MonthlyQuotaProps => ({
  id: q.id,
  vehicleId: q.vehicleId,
  month: q.month,
  limit: q.limit,
  used: q.used,
  version: q.version,
});

/** Cede o event loop para simular latência de I/O e provocar intercalação real entre requisições. */
const yieldIo = () => new Promise<void>((r) => setImmediate(r));

export class InMemoryVehicleRepository implements VehicleRepository {
  constructor(private readonly db: InMemoryDatabase) {}
  async findById(id: string) {
    await yieldIo();
    const p = this.db.vehicles.get(id);
    return p ? Vehicle.restore(p) : null;
  }
  async findByIdForUpdate(id: string) {
    return this.findById(id);
  }
  async findByPlate(plate: string) {
    const p = [...this.db.vehicles.values()].find((v) => v.plate.value === plate);
    return p ? Vehicle.restore(p) : null;
  }
  async list() {
    return [...this.db.vehicles.values()].map((p) => Vehicle.restore(p));
  }
  async save(vehicle: Vehicle) {
    await yieldIo();
    this.db.vehicles.set(vehicle.id, vehicleProps(vehicle));
  }
}

export class InMemoryQuotaRepository implements QuotaRepository {
  constructor(private readonly db: InMemoryDatabase) {}
  private key(vehicleId: string, month: string) {
    return `${vehicleId}|${month}`;
  }
  async find(vehicleId: string, month: string) {
    await yieldIo();
    const p = this.db.quotas.get(this.key(vehicleId, month));
    return p ? MonthlyQuota.restore(p) : null;
  }
  async findForUpdate(vehicleId: string, month: string) {
    return this.find(vehicleId, month);
  }
  async listByMonth(month: string) {
    return [...this.db.quotas.values()].filter((q) => q.month.value === month).map((p) => MonthlyQuota.restore(p));
  }
  async save(quota: MonthlyQuota) {
    await yieldIo();
    this.db.quotas.set(this.key(quota.vehicleId, quota.month.value), quotaProps(quota));
  }
}

export class InMemoryRefuelRepository implements RefuelRepository {
  constructor(private readonly db: InMemoryDatabase) {}
  async findById(id: string) {
    const p = this.db.refuels.get(id);
    return p ? Refuel.restore(p) : null;
  }
  async findByClientId(clientId: string) {
    await yieldIo();
    const p = [...this.db.refuels.values()].find((r) => r.clientId === clientId);
    return p ? Refuel.restore(p) : null;
  }
  async list(filter: RefuelFilter) {
    return [...this.db.refuels.values()]
      .filter((r) => !filter.vehicleId || r.vehicleId === filter.vehicleId)
      .filter((r) => !filter.status || r.status === filter.status)
      .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())
      .slice(0, filter.limit ?? 50)
      .map((p) => Refuel.restore(p));
  }
  async save(refuel: Refuel) {
    // Simula a constraint UNIQUE(client_id) do Postgres.
    const dup = [...this.db.refuels.values()].find((r) => r.clientId === refuel.clientId && r.id !== refuel.id);
    if (dup) throw new Error(`unique violation: client_id ${refuel.clientId}`);
    this.db.refuels.set(refuel.id, { ...refuel.snapshot() });
  }
}

export class InMemoryOutbox implements EventOutbox {
  constructor(private readonly db: InMemoryDatabase) {}
  async add(event: CoreDomainEvent) {
    this.db.outbox.push(event);
  }
}

/**
 * Unit of Work em memória.
 * - serialize: true  → equivale ao lock pessimista (uma transação por vez). Comportamento CORRETO.
 * - serialize: false → sem lock nenhum: usado nos testes para DEMONSTRAR a race condition
 *                      (lost update) que o FOR UPDATE evita no Postgres.
 */
export class InMemoryUnitOfWork implements UnitOfWork {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly db: InMemoryDatabase,
    private readonly options: { serialize: boolean } = { serialize: true },
  ) {}

  run<T>(work: (tx: TransactionScope) => Promise<T>): Promise<T> {
    const exec = async () => {
      const backup = this.db.clone();
      const scope: TransactionScope = {
        vehicles: new InMemoryVehicleRepository(this.db),
        quotas: new InMemoryQuotaRepository(this.db),
        refuels: new InMemoryRefuelRepository(this.db),
        outbox: new InMemoryOutbox(this.db),
      };
      try {
        return await work(scope);
      } catch (err) {
        if (this.options.serialize) this.db.restoreFrom(backup); // ROLLBACK
        throw err;
      }
    };
    if (!this.options.serialize) return exec();
    const next = this.queue.then(exec, exec);
    this.queue = next.catch(() => undefined);
    return next;
  }
}
