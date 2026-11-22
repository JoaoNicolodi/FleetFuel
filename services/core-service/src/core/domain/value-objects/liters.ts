import { Result, ok, fail } from '../shared/result';
import { ValidationError } from '../shared/errors';

/**
 * Volume de combustível. Internamente guardado em MILILITROS (inteiro)
 * para evitar erros de ponto flutuante (0.1 + 0.2 !== 0.3) no saldo da cota.
 */
export class Liters {
  static readonly MAX_SINGLE_OPERATION_ML = 1_000_000; // 1000 L

  private constructor(readonly milliliters: number) {}

  static create(liters: number, field = 'liters'): Result<Liters, ValidationError> {
    if (typeof liters !== 'number' || !Number.isFinite(liters)) {
      return fail(new ValidationError(field, 'Volume deve ser numérico'));
    }
    const ml = Math.round(liters * 1000);
    if (ml <= 0) return fail(new ValidationError(field, 'Volume deve ser maior que zero'));
    return ok(new Liters(ml));
  }

  /** Volume de um único abastecimento: limitado a 1000 L (tanque de caminhão). */
  static forRefuel(liters: number): Result<Liters, ValidationError> {
    const r = Liters.create(liters);
    if (r.ok && r.value.milliliters > Liters.MAX_SINGLE_OPERATION_ML) {
      return fail(new ValidationError('liters', 'Volume acima do limite de 1000 L por abastecimento'));
    }
    return r;
  }

  static fromMilliliters(ml: number): Liters {
    return new Liters(ml);
  }

  static zero(): Liters {
    return new Liters(0);
  }

  get value(): number {
    return this.milliliters / 1000;
  }

  add(other: Liters): Liters {
    return new Liters(this.milliliters + other.milliliters);
  }

  subtract(other: Liters): Liters {
    return new Liters(this.milliliters - other.milliliters);
  }

  isGreaterThan(other: Liters): boolean {
    return this.milliliters > other.milliliters;
  }
}
