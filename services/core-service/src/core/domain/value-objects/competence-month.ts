import { Result, ok, fail } from '../shared/result';
import { ValidationError } from '../shared/errors';

/**
 * Mês de competência da cota (formato YYYY-MM).
 * O mês é calculado no fuso de Brasília (UTC-3), pois um abastecimento às
 * 22h do dia 31 (horário local) pertence ao mês corrente, não ao seguinte.
 */
export class CompetenceMonth {
  private static readonly PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
  private static readonly BRASILIA_OFFSET_MS = -3 * 60 * 60 * 1000;

  private constructor(readonly value: string) {}

  static create(raw: string): Result<CompetenceMonth, ValidationError> {
    if (!CompetenceMonth.PATTERN.test(String(raw))) {
      return fail(new ValidationError('month', `Mês inválido "${raw}" (use YYYY-MM)`));
    }
    return ok(new CompetenceMonth(raw));
  }

  static fromDate(date: Date): CompetenceMonth {
    const local = new Date(date.getTime() + CompetenceMonth.BRASILIA_OFFSET_MS);
    const y = local.getUTCFullYear();
    const m = String(local.getUTCMonth() + 1).padStart(2, '0');
    return new CompetenceMonth(`${y}-${m}`);
  }

  static restore(value: string): CompetenceMonth {
    return new CompetenceMonth(value);
  }

  equals(other: CompetenceMonth): boolean {
    return this.value === other.value;
  }
}
