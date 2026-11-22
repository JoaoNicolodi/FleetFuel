import { Result, ok, fail } from '../shared/result';
import { OdometerRegressionError, ValidationError, InactiveVehicleError } from '../shared/errors';
import { Plate } from '../value-objects/plate';
import { Odometer } from '../value-objects/odometer';
import { Liters } from '../value-objects/liters';

export type FuelType = 'GASOLINA' | 'ETANOL' | 'DIESEL';
export const FUEL_TYPES: readonly FuelType[] = ['GASOLINA', 'ETANOL', 'DIESEL'];

export interface VehicleProps {
  id: string;
  plate: Plate;
  model: string;
  department: string; // secretaria/órgão dono do veículo
  fuelType: FuelType;
  expectedKmPerLiter: number;
  lastOdometer: Odometer | null;
  active: boolean;
  createdAt: Date;
}

export interface ConsumptionEvaluation {
  distanceKm: number | null;
  kmPerLiter: number | null;
  suspicious: boolean;
  reason: string | null;
}

/**
 * Entidade Veículo. Guarda a última leitura de hodômetro aceita e
 * protege a invariante: "o hodômetro nunca anda para trás".
 */
export class Vehicle {
  /** Tolerância de ±40% sobre o consumo esperado antes de sinalizar a foto para revisão. */
  static readonly CONSUMPTION_TOLERANCE = 0.4;

  private constructor(private props: VehicleProps) {}

  static create(input: {
    id: string;
    plate: Plate;
    model: string;
    department: string;
    fuelType: string;
    expectedKmPerLiter: number;
    initialOdometer?: Odometer | null;
    now: Date;
  }): Result<Vehicle, ValidationError> {
    if (!input.model?.trim()) return fail(new ValidationError('model', 'Modelo é obrigatório'));
    if (!input.department?.trim()) return fail(new ValidationError('department', 'Secretaria é obrigatória'));
    if (!FUEL_TYPES.includes(input.fuelType as FuelType)) {
      return fail(new ValidationError('fuelType', `Combustível deve ser um de: ${FUEL_TYPES.join(', ')}`));
    }
    if (!(input.expectedKmPerLiter > 0 && input.expectedKmPerLiter < 50)) {
      return fail(new ValidationError('expectedKmPerLiter', 'Consumo esperado deve estar entre 0 e 50 km/L'));
    }
    return ok(
      new Vehicle({
        id: input.id,
        plate: input.plate,
        model: input.model.trim(),
        department: input.department.trim(),
        fuelType: input.fuelType as FuelType,
        expectedKmPerLiter: input.expectedKmPerLiter,
        lastOdometer: input.initialOdometer ?? null,
        active: true,
        createdAt: input.now,
      }),
    );
  }

  static restore(props: VehicleProps): Vehicle {
    return new Vehicle({ ...props });
  }

  get id() { return this.props.id; }
  get plate() { return this.props.plate; }
  get model() { return this.props.model; }
  get department() { return this.props.department; }
  get fuelType() { return this.props.fuelType; }
  get expectedKmPerLiter() { return this.props.expectedKmPerLiter; }
  get lastOdometer() { return this.props.lastOdometer; }
  get active() { return this.props.active; }
  get createdAt() { return this.props.createdAt; }

  ensureActive(): Result<void, InactiveVehicleError> {
    return this.props.active ? ok(undefined) : fail(new InactiveVehicleError(this.props.id));
  }

  /**
   * Valida a nova leitura e calcula o consumo desde o último abastecimento.
   * NÃO altera o estado: quem confirma é `advanceOdometer`, depois que a
   * cota também foi aprovada (tudo-ou-nada).
   */
  evaluateRefuel(
    reading: Odometer,
    liters: Liters,
  ): Result<ConsumptionEvaluation, OdometerRegressionError> {
    const last = this.props.lastOdometer;
    if (last && reading.isBefore(last)) {
      return fail(new OdometerRegressionError(reading.km, last.km));
    }
    if (!last) {
      return ok({ distanceKm: null, kmPerLiter: null, suspicious: false, reason: null });
    }
    const distanceKm = reading.distanceFrom(last);
    const kmPerLiter = Math.round((distanceKm / liters.value) * 100) / 100;
    const min = this.props.expectedKmPerLiter * (1 - Vehicle.CONSUMPTION_TOLERANCE);
    const max = this.props.expectedKmPerLiter * (1 + Vehicle.CONSUMPTION_TOLERANCE);
    let reason: string | null = null;
    if (kmPerLiter < min) reason = `Consumo ${kmPerLiter} km/L abaixo do mínimo esperado (${min.toFixed(1)})`;
    else if (kmPerLiter > max) reason = `Consumo ${kmPerLiter} km/L acima do máximo esperado (${max.toFixed(1)})`;
    return ok({ distanceKm, kmPerLiter, suspicious: reason !== null, reason });
  }

  advanceOdometer(reading: Odometer): void {
    this.props.lastOdometer = reading;
  }

  deactivate(): void {
    this.props.active = false;
  }
}
