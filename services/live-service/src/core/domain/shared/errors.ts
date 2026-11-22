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

export class InvalidSessionError implements DomainError {
  readonly code = 'INVALID_SESSION' as const;
  readonly message = 'Sessão inexistente ou expirada';
}
