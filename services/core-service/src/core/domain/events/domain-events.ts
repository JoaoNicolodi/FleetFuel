/**
 * Eventos de domínio publicados pelo Serviço A. São contratos públicos:
 * o Serviço B (tempo real) e o Serviço C (ledger) dependem deste formato.
 * Mudanças devem ser retrocompatíveis (apenas adicionar campos).
 */
export interface EventEnvelope<TType extends string, TPayload> {
  eventId: string;
  type: TType;
  source: 'core-service';
  occurredAt: string; // ISO 8601
  payload: TPayload;
}

export interface RefuelPayload {
  refuelId: string;
  clientId: string;
  vehicleId: string;
  plate: string;
  department: string;
  driverName: string;
  stationName: string;
  month: string;
  liters: number;
  odometerKm: number;
  pricePerLiterCents: number;
  totalCents: number;
  status: 'ACCEPTED' | 'FLAGGED' | 'REJECTED';
  distanceKm: number | null;
  kmPerLiter: number | null;
  reviewReason: string | null;
  rejectionCode: string | null;
  quotaRemainingLiters: number | null;
  offline: boolean;
  refuelOccurredAt: string;
  location: { lat: number; lng: number } | null;
}

export type RefuelRegistered = EventEnvelope<'refuel.registered', RefuelPayload>;
export type RefuelRejected = EventEnvelope<'refuel.rejected', RefuelPayload>;

export type VehicleRegistered = EventEnvelope<
  'vehicle.registered',
  { vehicleId: string; plate: string; model: string; department: string; fuelType: string }
>;

export type QuotaDefined = EventEnvelope<
  'quota.defined',
  { vehicleId: string; plate: string; month: string; limitLiters: number; usedLiters: number; previousLimitLiters: number | null }
>;

export type CoreDomainEvent = RefuelRegistered | RefuelRejected | VehicleRegistered | QuotaDefined;
