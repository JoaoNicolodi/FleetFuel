import { Result, ok, fail } from '../shared/result';
import { ValidationError } from '../shared/errors';

/**
 * Placa de veículo brasileira. Aceita o padrão antigo (ABC1234)
 * e o padrão Mercosul (ABC1D23). Normaliza para maiúsculas sem hífen.
 */
export class Plate {
  private static readonly PATTERN = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/;

  private constructor(readonly value: string) {}

  static create(raw: string): Result<Plate, ValidationError> {
    const normalized = String(raw ?? '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    if (!Plate.PATTERN.test(normalized)) {
      return fail(new ValidationError('plate', `Placa inválida: "${raw}"`));
    }
    return ok(new Plate(normalized));
  }

  /** Reidratação a partir do banco (dado já validado). */
  static restore(value: string): Plate {
    return new Plate(value);
  }

  get isMercosul(): boolean {
    return /[A-Z]/.test(this.value[4]!);
  }

  equals(other: Plate): boolean {
    return this.value === other.value;
  }
}
