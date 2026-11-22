import type { Pool, PoolClient } from 'pg';
import { Vehicle, FuelType } from '../../../core/domain/entities/vehicle';
import { MonthlyQuota } from '../../../core/domain/entities/monthly-quota';
import { Refuel, RefuelStatus } from '../../../core/domain/entities/refuel';
import { Plate } from '../../../core/domain/value-objects/plate';
import { Odometer } from '../../../core/domain/value-objects/odometer';
import { Liters } from '../../../core/domain/value-objects/liters';
import { Money } from '../../../core/domain/value-objects/money';
import { CompetenceMonth } from '../../../core/domain/value-objects/competence-month';
import { CoreDomainEvent } from '../../../core/domain/events/domain-events';
import { QuotaRepository, RefuelFilter, RefuelRepository, VehicleRepository } from '../../../core/use-cases/ports/repositories';
import { EventOutbox } from '../../../core/use-cases/ports/unit-of-work';

/** Pool (fora de transação) ou PoolClient (dentro de transação). */
export type Queryable = Pool | PoolClient;

/* eslint-disable @typescript-eslint/no-explicit-any */
const toVehicle = (r: any): Vehicle =>
  Vehicle.restore({
    id: r.id,
    plate: Plate.restore(r.plate),
    model: r.model,
    department: r.department,
    fuelType: r.fuel_type as FuelType,
    expectedKmPerLiter: Number(r.expected_km_per_liter),
    lastOdometer: r.last_odometer_km === null ? null : Odometer.restore(r.last_odometer_km),
    active: r.active,
    createdAt: new Date(r.created_at),
  });

const toQuota = (r: any): MonthlyQuota =>
  MonthlyQuota.restore({
    id: r.id,
    vehicleId: r.vehicle_id,
    month: CompetenceMonth.restore(r.month),
    limit: Liters.fromMilliliters(Number(r.limit_ml)),
    used: Liters.fromMilliliters(Number(r.used_ml)),
    version: r.version,
  });

const toRefuel = (r: any): Refuel =>
  Refuel.restore({
    id: r.id,
    clientId: r.client_id,
    vehicleId: r.vehicle_id,
    plate: r.plate,
    driverName: r.driver_name,
    stationName: r.station_name,
    month: CompetenceMonth.restore(r.month),
    liters: Liters.fromMilliliters(Number(r.liters_ml)),
    odometer: Odometer.restore(r.odometer_km),
    pricePerLiter: Money.restore(r.price_per_liter_cents),
    total: Money.restore(Number(r.total_cents)),
    occurredAt: new Date(r.occurred_at),
    receivedAt: new Date(r.received_at),
    offline: r.offline,
    photoKey: r.photo_key,
    location: r.lat === null ? null : { lat: r.lat, lng: r.lng },
    status: r.status as RefuelStatus,
    distanceKm: r.distance_km,
    kmPerLiter: r.km_per_liter === null ? null : Number(r.km_per_liter),
    reviewReason: r.review_reason,
    rejectionCode: r.rejection_code,
    quotaRemainingLiters: r.quota_remaining_ml === null ? null : Number(r.quota_remaining_ml) / 1000,
  });

export class PgVehicleRepository implements VehicleRepository {
  constructor(private readonly db: Queryable) {}

  async findById(id: string) {
    const { rows } = await this.db.query('SELECT * FROM vehicles WHERE id = $1', [id]);
    return rows[0] ? toVehicle(rows[0]) : null;
  }

  /** Lock pessimista na linha do veículo: outra transação que pedir o mesmo lock ESPERA. */
  async findByIdForUpdate(id: string) {
    const { rows } = await this.db.query('SELECT * FROM vehicles WHERE id = $1 FOR UPDATE', [id]);
    return rows[0] ? toVehicle(rows[0]) : null;
  }

  async findByPlate(plate: string) {
    const { rows } = await this.db.query('SELECT * FROM vehicles WHERE plate = $1', [plate]);
    return rows[0] ? toVehicle(rows[0]) : null;
  }

  async list() {
    const { rows } = await this.db.query('SELECT * FROM vehicles ORDER BY plate');
    return rows.map(toVehicle);
  }

  async save(v: Vehicle) {
    await this.db.query(
      `INSERT INTO vehicles (id, plate, model, department, fuel_type, expected_km_per_liter, last_odometer_km, active, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET
         model = EXCLUDED.model, department = EXCLUDED.department,
         expected_km_per_liter = EXCLUDED.expected_km_per_liter,
         last_odometer_km = EXCLUDED.last_odometer_km, active = EXCLUDED.active`,
      [v.id, v.plate.value, v.model, v.department, v.fuelType, v.expectedKmPerLiter, v.lastOdometer?.km ?? null, v.active, v.createdAt],
    );
  }
}

export class PgQuotaRepository implements QuotaRepository {
  constructor(private readonly db: Queryable) {}

  async find(vehicleId: string, month: string) {
    const { rows } = await this.db.query('SELECT * FROM monthly_quotas WHERE vehicle_id = $1 AND month = $2', [vehicleId, month]);
    return rows[0] ? toQuota(rows[0]) : null;
  }

  /**
   * SELECT ... FOR UPDATE: o coração do controle de concorrência.
   * Se 50 abastecimentos do mesmo veículo chegarem juntos, o Postgres
   * enfileira as transações nesta linha; cada uma lê o saldo JÁ atualizado pela anterior.
   */
  async findForUpdate(vehicleId: string, month: string) {
    const { rows } = await this.db.query(
      'SELECT * FROM monthly_quotas WHERE vehicle_id = $1 AND month = $2 FOR UPDATE',
      [vehicleId, month],
    );
    return rows[0] ? toQuota(rows[0]) : null;
  }

  async listByMonth(month: string) {
    const { rows } = await this.db.query('SELECT * FROM monthly_quotas WHERE month = $1', [month]);
    return rows.map(toQuota);
  }

  async save(q: MonthlyQuota) {
    await this.db.query(
      `INSERT INTO monthly_quotas (id, vehicle_id, month, limit_ml, used_ml, version)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (vehicle_id, month) DO UPDATE SET
         limit_ml = EXCLUDED.limit_ml, used_ml = EXCLUDED.used_ml, version = EXCLUDED.version`,
      [q.id, q.vehicleId, q.month.value, q.limit.milliliters, q.used.milliliters, q.version],
    );
  }
}

export class PgRefuelRepository implements RefuelRepository {
  constructor(private readonly db: Queryable) {}

  async findById(id: string) {
    const { rows } = await this.db.query('SELECT * FROM refuels WHERE id = $1', [id]);
    return rows[0] ? toRefuel(rows[0]) : null;
  }

  async findByClientId(clientId: string) {
    const { rows } = await this.db.query('SELECT * FROM refuels WHERE client_id = $1', [clientId]);
    return rows[0] ? toRefuel(rows[0]) : null;
  }

  async list(filter: RefuelFilter) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.vehicleId) {
      params.push(filter.vehicleId);
      where.push(`vehicle_id = $${params.length}`);
    }
    if (filter.status) {
      params.push(filter.status);
      where.push(`status = $${params.length}`);
    }
    params.push(filter.limit ?? 50);
    const sql = `SELECT * FROM refuels ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY received_at DESC LIMIT $${params.length}`;
    const { rows } = await this.db.query(sql, params);
    return rows.map(toRefuel);
  }

  async save(refuel: Refuel) {
    const s = refuel.snapshot();
    await this.db.query(
      `INSERT INTO refuels (id, client_id, vehicle_id, plate, driver_name, station_name, month, liters_ml, odometer_km,
         price_per_liter_cents, total_cents, occurred_at, received_at, offline, photo_key, lat, lng, status,
         distance_km, km_per_liter, review_reason, rejection_code, quota_remaining_ml)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
      [
        s.id, s.clientId, s.vehicleId, s.plate, s.driverName, s.stationName, s.month.value, s.liters.milliliters,
        s.odometer.km, s.pricePerLiter.cents, s.total.cents, s.occurredAt, s.receivedAt, s.offline, s.photoKey,
        s.location?.lat ?? null, s.location?.lng ?? null, s.status, s.distanceKm, s.kmPerLiter, s.reviewReason,
        s.rejectionCode, s.quotaRemainingLiters === null ? null : Math.round(s.quotaRemainingLiters * 1000),
      ],
    );
  }
}

export class PgOutbox implements EventOutbox {
  constructor(private readonly db: Queryable) {}
  async add(event: CoreDomainEvent) {
    await this.db.query('INSERT INTO outbox (id, type, payload) VALUES ($1, $2, $3)', [event.eventId, event.type, JSON.stringify(event)]);
  }
}
