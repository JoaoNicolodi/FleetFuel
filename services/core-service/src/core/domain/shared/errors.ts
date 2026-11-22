/**
 * Erros de domínio são VALORES (não exceções). Cada um tem um `code`
 * literal, o que permite ao TypeScript fazer narrowing exaustivo.
 */
export interface DomainError {
  readonly code: string;
  readonly message: string;
}

export class ValidationError implements DomainError {
  readonly code = 'VALIDATION_ERROR' as const;
  constructor(
    readonly field: string,
    readonly message: string,
  ) {}
}

export class NotFoundError implements DomainError {
  readonly code = 'NOT_FOUND' as const;
  readonly message: string;
  constructor(
    readonly entity: string,
    readonly id: string,
  ) {
    this.message = `${entity} ${id} não encontrado`;
  }
}

export class ConflictError implements DomainError {
  readonly code = 'CONFLICT' as const;
  constructor(readonly message: string) {}
}

export class QuotaExceededError implements DomainError {
  readonly code = 'QUOTA_EXCEEDED' as const;
  readonly message: string;
  constructor(
    readonly requestedLiters: number,
    readonly remainingLiters: number,
  ) {
    this.message = `Cota insuficiente: solicitado ${requestedLiters} L, saldo ${remainingLiters} L`;
  }
}

export class QuotaNotDefinedError implements DomainError {
  readonly code = 'QUOTA_NOT_DEFINED' as const;
  readonly message: string;
  constructor(
    readonly vehicleId: string,
    readonly month: string,
  ) {
    this.message = `Veículo ${vehicleId} não possui cota definida para ${month}`;
  }
}

export class QuotaBelowUsageError implements DomainError {
  readonly code = 'QUOTA_BELOW_USAGE' as const;
  readonly message: string;
  constructor(
    readonly newLimitLiters: number,
    readonly usedLiters: number,
  ) {
    this.message = `Nova cota (${newLimitLiters} L) é menor que o já consumido (${usedLiters} L)`;
  }
}

export class OdometerRegressionError implements DomainError {
  readonly code = 'ODOMETER_REGRESSION' as const;
  readonly message: string;
  constructor(
    readonly informedKm: number,
    readonly lastKm: number,
  ) {
    this.message = `Hodômetro informado (${informedKm} km) é menor que o último registrado (${lastKm} km)`;
  }
}

export class InactiveVehicleError implements DomainError {
  readonly code = 'INACTIVE_VEHICLE' as const;
  readonly message: string;
  constructor(readonly vehicleId: string) {
    this.message = `Veículo ${vehicleId} está inativo`;
  }
}
