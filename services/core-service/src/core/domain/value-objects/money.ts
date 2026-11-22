import { Result, ok, fail } from '../shared/result';
import { ValidationError } from '../shared/errors';

/** Valor monetário em centavos (inteiro) para não perder precisão. */
export class Money {
  private constructor(readonly cents: number) {}

  static fromCents(cents: number, field = 'amount'): Result<Money, ValidationError> {
    if (!Number.isInteger(cents) || cents < 0) {
      return fail(new ValidationError(field, 'Valor deve ser um inteiro de centavos >= 0'));
    }
    return ok(new Money(cents));
  }

  static restore(cents: number): Money {
    return new Money(cents);
  }

  /** preço/litro (centavos) × volume (mL) → total arredondado em centavos. */
  static total(pricePerLiter: Money, milliliters: number): Money {
    return new Money(Math.round((pricePerLiter.cents * milliliters) / 1000));
  }
}
