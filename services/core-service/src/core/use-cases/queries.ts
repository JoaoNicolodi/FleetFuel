import { Result, ok, fail } from '../domain/shared/result';
import { NotFoundError, ValidationError } from '../domain/shared/errors';
import { CompetenceMonth } from '../domain/value-objects/competence-month';
import { RefuelStatus } from '../domain/entities/refuel';
import { QuotaRepository, RefuelRepository, VehicleRepository } from './ports/repositories';
import { Clock } from './ports/services';
import { RefuelOutput, VehicleBalanceOutput } from './dtos';
import { toQuotaOutput, toRefuelOutput, toVehicleOutput } from './mappers';

/** Consultas (lado de leitura): não precisam de transação nem de lock. */
export class GetVehicleBalanceUseCase {
  constructor(
    private readonly vehicles: VehicleRepository,
    private readonly quotas: QuotaRepository,
    private readonly clock: Clock,
  ) {}

  async execute(vehicleId: string, monthRaw?: string): Promise<Result<VehicleBalanceOutput, NotFoundError | ValidationError>> {
    const month = monthRaw ? CompetenceMonth.create(monthRaw) : ok(CompetenceMonth.fromDate(this.clock.now()));
    if (!month.ok) return month;
    const vehicle = await this.vehicles.findById(vehicleId);
    if (!vehicle) return fail(new NotFoundError('Veículo', vehicleId));
    const quota = await this.quotas.find(vehicleId, month.value.value);
    return ok({ ...toVehicleOutput(vehicle), quota: quota ? toQuotaOutput(quota) : null });
  }
}

export class ListVehiclesUseCase {
  constructor(
    private readonly vehicles: VehicleRepository,
    private readonly quotas: QuotaRepository,
    private readonly clock: Clock,
  ) {}

  async execute(monthRaw?: string): Promise<Result<VehicleBalanceOutput[], ValidationError>> {
    const month = monthRaw ? CompetenceMonth.create(monthRaw) : ok(CompetenceMonth.fromDate(this.clock.now()));
    if (!month.ok) return month;
    const [vehicles, quotas] = await Promise.all([this.vehicles.list(), this.quotas.listByMonth(month.value.value)]);
    const byVehicle = new Map(quotas.map((q) => [q.vehicleId, q]));
    return ok(
      vehicles.map((v) => {
        const q = byVehicle.get(v.id);
        return { ...toVehicleOutput(v), quota: q ? toQuotaOutput(q) : null };
      }),
    );
  }
}

export class ListRefuelsUseCase {
  constructor(private readonly refuels: RefuelRepository) {}

  async execute(filter: { vehicleId?: string; status?: string; limit?: number }): Promise<Result<RefuelOutput[], ValidationError>> {
    const statuses: RefuelStatus[] = ['ACCEPTED', 'FLAGGED', 'REJECTED'];
    if (filter.status && !statuses.includes(filter.status as RefuelStatus)) {
      return fail(new ValidationError('status', `Status deve ser um de: ${statuses.join(', ')}`));
    }
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    const list = await this.refuels.list({ vehicleId: filter.vehicleId, status: filter.status as RefuelStatus | undefined, limit });
    return ok(list.map(toRefuelOutput));
  }
}
