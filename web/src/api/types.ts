export type RefuelStatus = 'ACCEPTED' | 'FLAGGED' | 'REJECTED';

export interface Quota {
  vehicleId: string;
  month: string;
  limitLiters: number;
  usedLiters: number;
  remainingLiters: number;
}

export interface Vehicle {
  id: string;
  plate: string;
  model: string;
  department: string;
  fuelType: string;
  expectedKmPerLiter: number;
  lastOdometerKm: number | null;
  active: boolean;
  quota: Quota | null;
}

export interface Refuel {
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
  status: RefuelStatus;
  distanceKm: number | null;
  kmPerLiter: number | null;
  reviewReason: string | null;
  rejectionCode: string | null;
  quotaRemainingLiters: number | null;
  occurredAt: string;
  receivedAt: string;
  offline: boolean;
}

export interface DailyStats {
  date: string;
  refuels: number;
  rejected: number;
  flagged: number;
  liters: number;
  totalCents: number;
  offlineSynced: number;
}

export interface VehiclePosition {
  vehicleId: string;
  plate: string;
  driverName: string;
  lat: number;
  lng: number;
  speedKmh: number | null;
  recordedAt: string;
}

export interface LiveEvent {
  eventId: string;
  type: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

export interface ActiveSession {
  vehicleId: string;
  plate: string;
  driverName: string;
  expiresAt: string;
}

export interface LiveQuota {
  vehicleId: string;
  plate: string;
  month: string;
  limitLiters?: number;
  remainingLiters: number;
  updatedAt: string;
}

export interface LiveSnapshot {
  stats: DailyStats;
  activeSessions: ActiveSession[];
  positions: VehiclePosition[];
  quotas: LiveQuota[];
  feed: LiveEvent[];
}

export interface LedgerEntry {
  sequence: number;
  eventId: string;
  eventType: string;
  source: string;
  aggregateId: string | null;
  occurredAt: string;
  recordedAt: string;
  payload: Record<string, unknown>;
  previousHash: string;
  hash: string;
}

export interface MonthlyReport {
  month: string;
  totals: { refuels: number; rejected: number; flagged: number; offline: number; liters: number; totalCents: number };
  byVehicle: {
    vehicleId: string;
    plate: string;
    department: string;
    refuels: number;
    rejected: number;
    flagged: number;
    liters: number;
    totalCents: number;
    distanceKm: number;
    avgKmPerLiter: number | null;
    avgPricePerLiterCents: number | null;
  }[];
  byDepartment: { department: string; vehicles: number; liters: number; totalCents: number }[];
  rejectionReasons: Record<string, number>;
}
