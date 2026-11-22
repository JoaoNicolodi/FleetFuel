import { IntegrationEvent } from '../value-objects/integration-event';

/** Porta de hash (implementada com SHA-256 na infra) — o domínio não importa `crypto`. */
export interface Hasher {
  sha256(data: string): string;
}

export interface LedgerEntryProps {
  sequence: number;
  eventId: string;
  eventType: string;
  source: string;
  aggregateId: string | null;
  occurredAt: Date;
  recordedAt: Date;
  payload: Record<string, unknown>;
  previousHash: string;
  hash: string;
}

export const GENESIS_HASH = '0'.repeat(64);

/** JSON canônico (chaves ordenadas) para o hash não depender da ordem dos campos. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .filter((k) => obj[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(',')}}`;
}

/**
 * Registro do Ledger: append-only e encadeado por hash (como um blockchain simplificado).
 * hash(n) = SHA-256( hash(n-1) | n | eventId | type | occurredAt | payload )
 * Se alguém alterar qualquer linha antiga direto no banco, todos os hashes
 * seguintes deixam de bater e a verificação aponta exatamente onde.
 */
export class LedgerEntry {
  private constructor(private readonly props: LedgerEntryProps) {}

  static append(previous: LedgerEntry | null, event: IntegrationEvent, hasher: Hasher, now: Date): LedgerEntry {
    const sequence = previous ? previous.sequence + 1 : 1;
    const previousHash = previous ? previous.hash : GENESIS_HASH;
    const base = {
      sequence,
      eventId: event.eventId,
      eventType: event.type,
      source: event.source,
      aggregateId: event.aggregateId,
      occurredAt: event.occurredAt,
      recordedAt: now,
      payload: { ...event.payload },
      previousHash,
    };
    return new LedgerEntry({ ...base, hash: LedgerEntry.computeHash(base, hasher) });
  }

  static restore(props: LedgerEntryProps): LedgerEntry {
    return new LedgerEntry({ ...props });
  }

  static computeHash(
    p: Pick<LedgerEntryProps, 'previousHash' | 'sequence' | 'eventId' | 'eventType' | 'occurredAt' | 'payload'>,
    hasher: Hasher,
  ): string {
    return hasher.sha256([p.previousHash, p.sequence, p.eventId, p.eventType, p.occurredAt.toISOString(), canonicalJson(p.payload)].join('|'));
  }

  get sequence() { return this.props.sequence; }
  get hash() { return this.props.hash; }
  get previousHash() { return this.props.previousHash; }
  get eventId() { return this.props.eventId; }

  /** Recalcula o próprio hash e compara com o armazenado. */
  isIntact(hasher: Hasher): boolean {
    return LedgerEntry.computeHash(this.props, hasher) === this.props.hash;
  }

  snapshot(): Readonly<LedgerEntryProps> {
    return { ...this.props };
  }
}
