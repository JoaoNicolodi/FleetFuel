import { Result, ok, fail } from '../shared/result';
import { ValidationError } from '../shared/errors';

/** Leitura do hodômetro em km (inteiro, não negativo). */
export class Odometer {
  static readonly MAX_KM = 3_000_000;

  private constructor(readonly km: number) {}

  static create(km: number): Result<Odometer, ValidationError> {
    if (typeof km !== 'number' || !Number.isInteger(km)) {
      return fail(new ValidationError('odometerKm', 'Hodômetro deve ser um número inteiro de km'));
    }
    if (km < 0 || km > Odometer.MAX_KM) {
      return fail(new ValidationError('odometerKm', `Hodômetro fora do intervalo 0..${Odometer.MAX_KM}`));
    }
    return ok(new Odometer(km));
  }

  static restore(km: number): Odometer {
    return new Odometer(km);
  }

  isBefore(other: Odometer): boolean {
    return this.km < other.km;
  }

  distanceFrom(previous: Odometer): number {
    return this.km - previous.km;
  }
}
