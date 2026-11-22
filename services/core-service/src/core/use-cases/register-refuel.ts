import { Result, ok, fail } from '../domain/shared/result';
import {
  DomainError,
  InactiveVehicleError,
  NotFoundError,
  OdometerRegressionError,
  QuotaExceededError,
  QuotaNotDefinedError,
  ValidationError,
} from '../domain/shared/errors';
import { Liters } from '../domain/value-objects/liters';
import { Odometer } from '../domain/value-objects/odometer';
import { Money } from '../domain/value-objects/money';
import { CompetenceMonth } from '../domain/value-objects/competence-month';
import { Refuel, GeoPoint } from '../domain/entities/refuel';
import { Vehicle } from '../domain/entities/vehicle';
import { TransactionScope, UnitOfWork } from './ports/unit-of-work';
import { Clock, IdGenerator, PhotoStorage } from './ports/services';
import { RegisterRefuelInput, RegisterRefuelOutput } from './dtos';
import { toRefuelOutput, toRefuelPayload } from './mappers';
import { RefuelOutput } from './dtos';

/** Motivos de negócio que fazem um abastecimento ser REJEITADO (mas registrado). */
export type BusinessRejection =
  | QuotaExceededError
  | QuotaNotDefinedError
  | OdometerRegressionError
  | InactiveVehicleError;

/** Erro devolvido quando o abastecimento foi registrado com status REJECTED. */
export class RefuelRejectedError implements DomainError {
  readonly code = 'REFUEL_REJECTED' as const;
  readonly message: string;
  constructor(
    readonly reasonCode: string,
    readonly reason: string,
    readonly refuel: RefuelOutput,
    readonly replayed: boolean,
  ) {
    this.message = reason;
  }
}

export type RegisterRefuelError = ValidationError | NotFoundError | RefuelRejectedError;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PHOTO_BASE64_CHARS = 7_000_000; // ~5 MB
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const MAX_OFFLINE_AGE_MS = 35 * 24 * 60 * 60 * 1000;

/**
 * Caso de uso central do FleetFuel: registrar um abastecimento.
 *
 * Fluxo (tudo dentro de UMA transação):
 *  1. Valida a entrada (Value Objects) — erros aqui NÃO são persistidos.
 *  2. Bloqueia o veículo (FOR UPDATE) → serializa abastecimentos do mesmo veículo.
 *  3. Checa idempotência pelo clientId (depois do lock, para não haver corrida entre reenvios).
 *  4. Bloqueia a cota do mês (FOR UPDATE) e valida hodômetro + saldo.
 *  5. Persiste o abastecimento (ACCEPTED/FLAGGED/REJECTED) + evento no outbox.
 */
export class RegisterRefuelUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly photos: PhotoStorage,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: RegisterRefuelInput): Promise<Result<RegisterRefuelOutput, RegisterRefuelError>> {
    const now = this.clock.now();
    const validated = this.validate(input, now);
    if (!validated.ok) return validated;
    const v = validated.value;

    // Foto salva fora da transação: a chave é o clientId, então reenvio só sobrescreve.
    const photoKey = await this.photos.save(`refuels/${input.clientId}`, input.photoBase64, v.mimeType);

    return this.uow.run(async (tx) => {
      const vehicle = await tx.vehicles.findByIdForUpdate(input.vehicleId);
      if (!vehicle) return fail(new NotFoundError('Veículo', input.vehicleId));

      const existing = await tx.refuels.findByClientId(input.clientId);
      if (existing) return this.replay(existing);

      const base = {
        id: this.ids.next(),
        clientId: input.clientId,
        vehicleId: vehicle.id,
        plate: vehicle.plate.value,
        driverName: input.driverName.trim(),
        stationName: input.stationName.trim(),
        month: v.month,
        liters: v.liters,
        odometer: v.odometer,
        pricePerLiter: v.price,
        occurredAt: v.occurredAt,
        receivedAt: now,
        offline: Boolean(input.offline),
        photoKey,
        location: v.location,
      };

      const decision = await this.decide(tx, vehicle, v.month, v.odometer, v.liters);
      if (!decision.ok) {
        const rejected = Refuel.reject({ ...base, rejectionCode: decision.error.code, reviewReason: decision.error.message });
        await this.persist(tx, rejected, vehicle, 'refuel.rejected');
        return fail(new RefuelRejectedError(decision.error.code, decision.error.message, toRefuelOutput(rejected), false));
      }

      const accepted = Refuel.accept({ ...base, ...decision.value });
      await tx.vehicles.save(vehicle);
      await this.persist(tx, accepted, vehicle, 'refuel.registered');
      return ok({ refuel: toRefuelOutput(accepted), replayed: false });
    });
  }

  /** Regras de negócio: só altera o estado (hodômetro e saldo) se TUDO passar. */
  private async decide(
    tx: TransactionScope,
    vehicle: Vehicle,
    month: CompetenceMonth,
    odometer: Odometer,
    liters: Liters,
  ): Promise<
    Result<
      { distanceKm: number | null; kmPerLiter: number | null; reviewReason: string | null; quotaRemainingLiters: number },
      BusinessRejection
    >
  > {
    const active = vehicle.ensureActive();
    if (!active.ok) return active;

    const consumption = vehicle.evaluateRefuel(odometer, liters);
    if (!consumption.ok) return consumption;

    const quota = await tx.quotas.findForUpdate(vehicle.id, month.value);
    if (!quota) return fail(new QuotaNotDefinedError(vehicle.id, month.value));

    const debited = quota.debit(liters);
    if (!debited.ok) return debited;

    vehicle.advanceOdometer(odometer);
    await tx.quotas.save(quota);

    return ok({
      distanceKm: consumption.value.distanceKm,
      kmPerLiter: consumption.value.kmPerLiter,
      reviewReason: consumption.value.reason,
      quotaRemainingLiters: debited.value.value,
    });
  }

  private async persist(
    tx: TransactionScope,
    refuel: Refuel,
    vehicle: Vehicle,
    type: 'refuel.registered' | 'refuel.rejected',
  ): Promise<void> {
    await tx.refuels.save(refuel);
    await tx.outbox.add({
      eventId: this.ids.next(),
      type,
      source: 'core-service',
      occurredAt: this.clock.now().toISOString(),
      payload: toRefuelPayload(refuel, vehicle.department),
    });
  }

  private replay(existing: Refuel): Result<RegisterRefuelOutput, RefuelRejectedError> {
    const out = toRefuelOutput(existing);
    if (existing.isRejected) {
      return fail(new RefuelRejectedError(existing.rejectionCode ?? 'REJECTED', out.reviewReason ?? '', out, true));
    }
    return ok({ refuel: out, replayed: true });
  }

  private validate(input: RegisterRefuelInput, now: Date) {
    if (!UUID.test(String(input.clientId))) {
      return fail(new ValidationError('clientId', 'clientId deve ser um UUID gerado pelo app'));
    }
    if (!input.driverName?.trim()) return fail(new ValidationError('driverName', 'Motorista é obrigatório'));
    if (!input.stationName?.trim()) return fail(new ValidationError('stationName', 'Posto é obrigatório'));

    const liters = Liters.forRefuel(input.liters);
    if (!liters.ok) return liters;
    const odometer = Odometer.create(input.odometerKm);
    if (!odometer.ok) return odometer;
    const price = Money.fromCents(input.pricePerLiterCents, 'pricePerLiterCents');
    if (!price.ok) return price;

    const occurredAt = new Date(input.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) {
      return fail(new ValidationError('occurredAt', 'Data do abastecimento inválida'));
    }
    if (occurredAt.getTime() - now.getTime() > MAX_FUTURE_SKEW_MS) {
      return fail(new ValidationError('occurredAt', 'Data do abastecimento está no futuro'));
    }
    if (now.getTime() - occurredAt.getTime() > MAX_OFFLINE_AGE_MS) {
      return fail(new ValidationError('occurredAt', 'Abastecimento com mais de 35 dias não pode ser lançado'));
    }

    // Validação de hodômetro por foto: a foto é OBRIGATÓRIA e fica vinculada ao registro.
    if (!input.photoBase64 || input.photoBase64.length < 100) {
      return fail(new ValidationError('photoBase64', 'Foto do hodômetro é obrigatória'));
    }
    if (input.photoBase64.length > MAX_PHOTO_BASE64_CHARS) {
      return fail(new ValidationError('photoBase64', 'Foto muito grande (máx. 5 MB)'));
    }
    const mimeType = input.photoMimeType ?? 'image/jpeg';
    if (!['image/jpeg', 'image/png'].includes(mimeType)) {
      return fail(new ValidationError('photoMimeType', 'Foto deve ser JPEG ou PNG'));
    }

    let location: GeoPoint | null = null;
    if (input.location) {
      const { lat, lng } = input.location;
      if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) {
        return fail(new ValidationError('location', 'Coordenadas inválidas'));
      }
      location = { lat, lng };
    }

    return ok({
      liters: liters.value,
      odometer: odometer.value,
      price: price.value,
      occurredAt,
      month: CompetenceMonth.fromDate(occurredAt),
      mimeType,
      location,
    });
  }
}
