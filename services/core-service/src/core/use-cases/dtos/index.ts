export interface RegisterVehicleInput {
  plate: string;
  model: string;
  department: string;
  fuelType: string;
  expectedKmPerLiter: number;
  initialOdometerKm?: number;
}

export interface VehicleOutput {
  id: string;
  plate: string;
  model: string;
  department: string;
  fuelType: string;
  expectedKmPerLiter: number;
  lastOdometerKm: number | null;
  active: boolean;
}

export interface SetMonthlyQuotaInput {
  vehicleId: string;
  month: string; // YYYY-MM
  limitLiters: number;
}

export interface QuotaOutput {
  vehicleId: string;
  month: string;
  limitLiters: number;
  usedLiters: number;
  remainingLiters: number;
}

export interface VehicleBalanceOutput extends VehicleOutput {
  quota: QuotaOutput | null;
}

export interface RegisterRefuelInput {
  clientId: string;
  vehicleId: string;
  driverName: string;
  stationName: string;
  liters: number;
  odometerKm: number;
  pricePerLiterCents: number;
  occurredAt: string; // ISO
  offline: boolean;
  photoBase64: string;
  photoMimeType?: string;
  location?: { lat: number; lng: number } | null;
}

export interface RefuelOutput {
  id: string;
  clientId: string;
  vehicleId: string;
  plate: string;
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
  occurredAt: string;
  receivedAt: string;
  offline: boolean;
  location: { lat: number; lng: number } | null;
}

export interface RegisterRefuelOutput {
  refuel: RefuelOutput;
  /** true quando a mesma clientId já tinha sido processada (reenvio do sync). */
  replayed: boolean;
}
