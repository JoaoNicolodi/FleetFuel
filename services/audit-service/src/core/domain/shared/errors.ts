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

export class InvalidEventError implements DomainError {
  readonly code = 'INVALID_EVENT' as const;
  constructor(readonly message: string) {}
}

/** A cadeia de hashes foi quebrada: alguém alterou/apagou um registro direto no banco. */
export class ChainBrokenError implements DomainError {
  readonly code = 'CHAIN_BROKEN' as const;
  readonly message: string;
  constructor(
    readonly sequence: number,
    readonly reason: string,
  ) {
    this.message = `Ledger adulterado na sequência ${sequence}: ${reason}`;
  }
}
