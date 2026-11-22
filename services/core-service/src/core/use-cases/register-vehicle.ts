import { Result, ok, fail } from '../domain/shared/result';
import { ConflictError, ValidationError } from '../domain/shared/errors';
import { Plate } from '../domain/value-objects/plate';
import { Odometer } from '../domain/value-objects/odometer';
import { Vehicle } from '../domain/entities/vehicle';
import { UnitOfWork } from './ports/unit-of-work';
import { Clock, IdGenerator } from './ports/services';
import { RegisterVehicleInput, VehicleOutput } from './dtos';
import { toVehicleOutput } from './mappers';

export type RegisterVehicleError = ValidationError | ConflictError;

export class RegisterVehicleUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: RegisterVehicleInput): Promise<Result<VehicleOutput, RegisterVehicleError>> {
    const plate = Plate.create(input.plate);
    if (!plate.ok) return plate;

    let initialOdometer: Odometer | null = null;
    if (input.initialOdometerKm !== undefined && input.initialOdometerKm !== null) {
      const odo = Odometer.create(input.initialOdometerKm);
      if (!odo.ok) return odo;
      initialOdometer = odo.value;
    }

    const now = this.clock.now();
    const vehicle = Vehicle.create({
      id: this.ids.next(),
      plate: plate.value,
      model: input.model,
      department: input.department,
      fuelType: input.fuelType,
      expectedKmPerLiter: input.expectedKmPerLiter,
      initialOdometer,
      now,
    });
    if (!vehicle.ok) return vehicle;

    return this.uow.run(async (tx) => {
      const existing = await tx.vehicles.findByPlate(plate.value.value);
      if (existing) return fail(new ConflictError(`Placa ${plate.value.value} já cadastrada`));

      await tx.vehicles.save(vehicle.value);
      await tx.outbox.add({
        eventId: this.ids.next(),
        type: 'vehicle.registered',
        source: 'core-service',
        occurredAt: now.toISOString(),
        payload: {
          vehicleId: vehicle.value.id,
          plate: vehicle.value.plate.value,
          model: vehicle.value.model,
          department: vehicle.value.department,
          fuelType: vehicle.value.fuelType,
        },
      });
      return ok(toVehicleOutput(vehicle.value));
    });
  }
}
