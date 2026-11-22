import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { TransactionScope, UnitOfWork } from '../../../core/use-cases/ports/unit-of-work';
import { PgOutbox, PgQuotaRepository, PgRefuelRepository, PgVehicleRepository } from './pg-repositories';

export function createPool(connectionString: string): Pool {
  return new Pool({ connectionString, max: 20 });
}

export async function migrate(pool: Pool): Promise<void> {
  const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
}

/**
 * Unit of Work sobre Postgres. Isolamento READ COMMITTED (padrão) +
 * locks pessimistas explícitos (FOR UPDATE) nas linhas disputadas.
 *
 * Por que não SERIALIZABLE? Funcionaria, mas sob alta concorrência geraria
 * muitos erros 40001 (serialization_failure) que exigem retry. O FOR UPDATE
 * faz as transações ESPERAREM em fila na linha da cota, sem abortar.
 */
export class PgUnitOfWork implements UnitOfWork {
  constructor(private readonly pool: Pool) {}

  async run<T>(work: (tx: TransactionScope) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Não deixa uma requisição esperar o lock para sempre.
      await client.query("SET LOCAL lock_timeout = '5s'");
      const result = await work({
        vehicles: new PgVehicleRepository(client),
        quotas: new PgQuotaRepository(client),
        refuels: new PgRefuelRepository(client),
        outbox: new PgOutbox(client),
      });
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
}
