import { randomUUID } from 'node:crypto';
import { InMemoryDatabase, InMemoryQuotaRepository, InMemoryRefuelRepository, InMemoryUnitOfWork, InMemoryVehicleRepository } from '../../src/infra/database/in-memory/in-memory-database';
import { InMemoryPhotoStorage } from '../../src/infra/storage/photo-storage';
import { RegisterVehicleUseCase } from '../../src/core/use-cases/register-vehicle';
import { SetMonthlyQuotaUseCase } from '../../src/core/use-cases/set-monthly-quota';
import { RegisterRefuelUseCase } from '../../src/core/use-cases/register-refuel';
import { GetVehicleBalanceUseCase } from '../../src/core/use-cases/queries';
import { RegisterRefuelInput } from '../../src/core/use-cases/dtos';
import { Clock, IdGenerator } from '../../src/core/use-cases/ports/services';

export class FixedClock implements Clock {
  constructor(public current = new Date('2026-11-20T15:00:00Z')) {}
  now() {
    return new Date(this.current);
  }
}

export class SeqIds implements IdGenerator {
  next() {
    return randomUUID();
  }
}

// Foto fake (qualquer base64 com mais de 100 caracteres serve no teste).
export const FAKE_PHOTO = Buffer.alloc(200, 7).toString('base64');

export function buildSut(options: { serialize: boolean } = { serialize: true }) {
  const db = new InMemoryDatabase();
  const uow = new InMemoryUnitOfWork(db, options);
  const clock = new FixedClock();
  const ids = new SeqIds();
  const photos = new InMemoryPhotoStorage();
  return {
    db,
    clock,
    photos,
    registerVehicle: new RegisterVehicleUseCase(uow, ids, clock),
    setQuota: new SetMonthlyQuotaUseCase(uow, ids, clock),
    registerRefuel: new RegisterRefuelUseCase(uow, photos, ids, clock),
    balance: new GetVehicleBalanceUseCase(new InMemoryVehicleRepository(db), new InMemoryQuotaRepository(db), clock),
    refuelsRepo: new InMemoryRefuelRepository(db),
  };
}

export async function seedVehicleWithQuota(sut: ReturnType<typeof buildSut>, limitLiters = 100) {
  const v = await sut.registerVehicle.execute({
    plate: 'IXA1B23',
    model: 'Fiat Strada',
    department: 'Secretaria de Saúde',
    fuelType: 'GASOLINA',
    expectedKmPerLiter: 10,
    initialOdometerKm: 10_000,
  });
  if (!v.ok) throw new Error('seed falhou: ' + v.error.message);
  const q = await sut.setQuota.execute({ vehicleId: v.value.id, month: '2026-11', limitLiters });
  if (!q.ok) throw new Error('seed falhou: ' + q.error.message);
  return v.value;
}

export function refuelInput(vehicleId: string, overrides: Partial<RegisterRefuelInput> = {}): RegisterRefuelInput {
  return {
    clientId: randomUUID(),
    vehicleId,
    driverName: 'Carlos Motorista',
    stationName: 'Posto Central',
    liters: 40,
    odometerKm: 10_400, // 400 km / 40 L = 10 km/L (dentro do esperado)
    pricePerLiterCents: 629,
    occurredAt: '2026-11-20T14:30:00Z',
    offline: false,
    photoBase64: FAKE_PHOTO,
    photoMimeType: 'image/jpeg',
    location: { lat: -28.6389, lng: -53.6064 },
    ...overrides,
  };
}
