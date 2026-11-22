import { Vehicle } from '../../domain/entities/vehicle';
import { MonthlyQuota } from '../../domain/entities/monthly-quota';
import { Refuel, RefuelStatus } from '../../domain/entities/refuel';

/**
 * PORTAS (interfaces) de persistência. O core só conhece estas abstrações;
 * as implementações concretas ficam em infra/database (Postgres e In-Memory).
 */
export interface VehicleRepository {
  findById(id: string): Promise<Vehicle | null>;
  /** Lê E BLOQUEIA a linha até o fim da transação (lock pessimista). */
  findByIdForUpdate(id: string): Promise<Vehicle | null>;
  findByPlate(plate: string): Promise<Vehicle | null>;
  list(): Promise<Vehicle[]>;
  save(vehicle: Vehicle): Promise<void>;
}

export interface QuotaRepository {
  find(vehicleId: string, month: string): Promise<MonthlyQuota | null>;
  /** Lê E BLOQUEIA a cota: requisições concorrentes do mesmo veículo/mês esperam na fila. */
  findForUpdate(vehicleId: string, month: string): Promise<MonthlyQuota | null>;
  listByMonth(month: string): Promise<MonthlyQuota[]>;
  save(quota: MonthlyQuota): Promise<void>;
}

export interface RefuelFilter {
  vehicleId?: string;
  status?: RefuelStatus;
  limit?: number;
}

export interface RefuelRepository {
  findById(id: string): Promise<Refuel | null>;
  findByClientId(clientId: string): Promise<Refuel | null>;
  list(filter: RefuelFilter): Promise<Refuel[]>;
  save(refuel: Refuel): Promise<void>;
}
