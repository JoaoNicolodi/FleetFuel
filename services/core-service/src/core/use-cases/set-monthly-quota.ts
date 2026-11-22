import { Result, ok, fail } from '../domain/shared/result';
import { NotFoundError, QuotaBelowUsageError, ValidationError } from '../domain/shared/errors';
import { CompetenceMonth } from '../domain/value-objects/competence-month';
import { Liters } from '../domain/value-objects/liters';
import { MonthlyQuota } from '../domain/entities/monthly-quota';
import { UnitOfWork } from './ports/unit-of-work';
import { Clock, IdGenerator } from './ports/services';
import { QuotaOutput, SetMonthlyQuotaInput } from './dtos';
import { toQuotaOutput } from './mappers';

export type SetMonthlyQuotaError = ValidationError | NotFoundError | QuotaBelowUsageError;

/**
 * Define (ou altera) a cota de um veículo num mês. Também usa o lock da cota,
 * pois o gestor pode reduzir a cota enquanto um abastecimento está debitando.
 */
export class SetMonthlyQuotaUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: SetMonthlyQuotaInput): Promise<Result<QuotaOutput, SetMonthlyQuotaError>> {
    const month = CompetenceMonth.create(input.month);
    if (!month.ok) return month;
    const limit = Liters.create(input.limitLiters, 'limitLiters');
    if (!limit.ok) return limit;

    return this.uow.run(async (tx) => {
      // Mesma ordem de lock do RegisterRefuel (veículo → cota) para evitar deadlock.
      const vehicle = await tx.vehicles.findByIdForUpdate(input.vehicleId);
      if (!vehicle) return fail(new NotFoundError('Veículo', input.vehicleId));

      let quota = await tx.quotas.findForUpdate(vehicle.id, month.value.value);
      const previousLimit = quota ? quota.limit.value : null;

      if (!quota) {
        quota = MonthlyQuota.create({ id: this.ids.next(), vehicleId: vehicle.id, month: month.value, limit: limit.value });
      } else {
        const changed = quota.changeLimit(limit.value);
        if (!changed.ok) return changed;
      }

      await tx.quotas.save(quota);
      await tx.outbox.add({
        eventId: this.ids.next(),
        type: 'quota.defined',
        source: 'core-service',
        occurredAt: this.clock.now().toISOString(),
        payload: {
          vehicleId: vehicle.id,
          plate: vehicle.plate.value,
          month: quota.month.value,
          limitLiters: quota.limit.value,
          usedLiters: quota.used.value,
          previousLimitLiters: previousLimit,
        },
      });
      return ok(toQuotaOutput(quota));
    });
  }
}
