import { DomainError } from '../../core/domain/shared/errors';

/** Traduz erros de domínio (valores) em respostas HTTP. Única camada que conhece status codes. */
export function toHttpError(error: DomainError): { status: number; body: Record<string, unknown> } {
  const base = { code: error.code, message: error.message };
  switch (error.code) {
    case 'VALIDATION_ERROR':
      return { status: 400, body: { ...base, field: (error as { field?: string }).field } };
    case 'NOT_FOUND':
      return { status: 404, body: base };
    case 'CONFLICT':
      return { status: 409, body: base };
    case 'QUOTA_BELOW_USAGE':
      return { status: 422, body: base };
    case 'REFUEL_REJECTED': {
      const e = error as unknown as { reasonCode: string; refuel: unknown; replayed: boolean };
      return { status: 422, body: { ...base, reasonCode: e.reasonCode, refuel: e.refuel, replayed: e.replayed } };
    }
    default:
      return { status: 400, body: base };
  }
}
