import { Result, ok, fail } from '../shared/result';
import { ChainBrokenError } from '../shared/errors';
import { GENESIS_HASH, Hasher, LedgerEntry } from '../entities/ledger-entry';

/**
 * Serviço de domínio que verifica a integridade do ledger de forma incremental
 * (recebe lotes em ordem de sequência, para não carregar milhões de linhas na memória).
 */
export class ChainVerifier {
  private expectedSequence = 1;
  private lastHash = GENESIS_HASH;
  private checked = 0;

  constructor(private readonly hasher: Hasher) {}

  feed(batch: LedgerEntry[]): Result<void, ChainBrokenError> {
    for (const entry of batch) {
      if (entry.sequence !== this.expectedSequence) {
        return fail(new ChainBrokenError(this.expectedSequence, `sequência ${this.expectedSequence} ausente (encontrada ${entry.sequence})`));
      }
      if (entry.previousHash !== this.lastHash) {
        return fail(new ChainBrokenError(entry.sequence, 'previousHash não corresponde ao registro anterior'));
      }
      if (!entry.isIntact(this.hasher)) {
        return fail(new ChainBrokenError(entry.sequence, 'conteúdo alterado (hash não confere)'));
      }
      this.lastHash = entry.hash;
      this.expectedSequence += 1;
      this.checked += 1;
    }
    return ok(undefined);
  }

  get result() {
    return { entriesVerified: this.checked, headHash: this.lastHash };
  }
}
