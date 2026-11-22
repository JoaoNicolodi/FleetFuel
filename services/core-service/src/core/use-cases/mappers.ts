import { Vehicle } from '../domain/entities/vehicle';
import { MonthlyQuota } from '../domain/entities/monthly-quota';
import { Refuel } from '../domain/entities/refuel';
import { QuotaOutput, RefuelOutput, VehicleOutput } from './dtos';
import { RefuelPayload } from '../domain/events/domain-events';

export const toVehicleOutput = (v: Vehicle): VehicleOutput => ({
  id: v.id,
  plate: v.plate.value,
  model: v.model,
  department: v.department,
  fuelType: v.fuelType,
  expectedKmPerLiter: v.expectedKmPerLiter,
  lastOdometerKm: v.lastOdometer?.km ?? null,
  active: v.active,
});

export const toQuotaOutput = (q: MonthlyQuota): QuotaOutput => ({
  vehicleId: q.vehicleId,
  month: q.month.value,
  limitLiters: q.limit.value,
  usedLiters: q.used.value,
  remainingLiters: q.remaining.value,
});

export const toRefuelOutput = (r: Refuel): RefuelOutput => {
  const s = r.snapshot();
  return {
    id: s.id,
    clientId: s.clientId,
    vehicleId: s.vehicleId,
    plate: s.plate,
    driverName: s.driverName,
    stationName: s.stationName,
    month: s.month.value,
    liters: s.liters.value,
    odometerKm: s.odometer.km,
    pricePerLiterCents: s.pricePerLiter.cents,
    totalCents: s.total.cents,
    status: s.status,
    distanceKm: s.distanceKm,
    kmPerLiter: s.kmPerLiter,
    reviewReason: s.reviewReason,
    rejectionCode: s.rejectionCode,
    quotaRemainingLiters: s.quotaRemainingLiters,
    occurredAt: s.occurredAt.toISOString(),
    receivedAt: s.receivedAt.toISOString(),
    offline: s.offline,
    location: s.location,
  };
};

export const toRefuelPayload = (r: Refuel, department: string): RefuelPayload => {
  const o = toRefuelOutput(r);
  return {
    refuelId: o.id,
    clientId: o.clientId,
    vehicleId: o.vehicleId,
    plate: o.plate,
    department,
    driverName: o.driverName,
    stationName: o.stationName,
    month: o.month,
    liters: o.liters,
    odometerKm: o.odometerKm,
    pricePerLiterCents: o.pricePerLiterCents,
    totalCents: o.totalCents,
    status: o.status,
    distanceKm: o.distanceKm,
    kmPerLiter: o.kmPerLiter,
    reviewReason: o.reviewReason,
    rejectionCode: o.rejectionCode,
    quotaRemainingLiters: o.quotaRemainingLiters,
    offline: o.offline,
    refuelOccurredAt: o.occurredAt,
    location: o.location,
  };
};
