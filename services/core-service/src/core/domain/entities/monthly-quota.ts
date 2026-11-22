import { Result, ok, fail } from '../shared/result';
import { QuotaExceededError, QuotaBelowUsageError } from '../shared/errors';
import { Liters } from '../value-objects/liters';
import { CompetenceMonth } from '../value-objects/competence-month';

export interface MonthlyQuotaProps {
  id: string;
  vehicleId: string;
  month: CompetenceMonth;
  limit: Liters;
  used: Liters;
  version: number;
}

/**
 * Cota mensal de combustível de um veículo — o recurso disputado sob
 * alta concorrência. Invariante central: used <= limit, SEMPRE.
 *
 * A entidade garante a regra; quem garante que duas requisições
 * simultâneas não leiam o mesmo saldo é o lock pessimista do repositório
 * (SELECT ... FOR UPDATE), acionado pelo caso de uso dentro da Unit of Work.
 */
export class MonthlyQuota {
  private constructor(private props: MonthlyQuotaProps) {}

  static create(input: { id: string; vehicleId: string; month: CompetenceMonth; limit: Liters }): MonthlyQuota {
    return new MonthlyQuota({ ...input, used: Liters.zero(), version: 0 });
  }

  static restore(props: MonthlyQuotaProps): MonthlyQuota {
    return new MonthlyQuota({ ...props });
  }

  get id() { return this.props.id; }
  get vehicleId() { return this.props.vehicleId; }
  get month() { return this.props.month; }
  get limit() { return this.props.limit; }
  get used() { return this.props.used; }
  get version() { return this.props.version; }
  get remaining(): Liters { return this.props.limit.subtract(this.props.used); }

  canDebit(amount: Liters): Result<void, QuotaExceededError> {
    if (amount.isGreaterThan(this.remaining)) {
      return fail(new QuotaExceededError(amount.value, this.remaining.value));
    }
    return ok(undefined);
  }

  debit(amount: Liters): Result<Liters, QuotaExceededError> {
    const check = this.canDebit(amount);
    if (!check.ok) return check;
    this.props.used = this.props.used.add(amount);
    this.props.version += 1;
    return ok(this.remaining);
  }

  changeLimit(newLimit: Liters): Result<void, QuotaBelowUsageError> {
    if (this.props.used.isGreaterThan(newLimit)) {
      return fail(new QuotaBelowUsageError(newLimit.value, this.props.used.value));
    }
    this.props.limit = newLimit;
    this.props.version += 1;
    return ok(undefined);
  }
}
