import type { Pool } from 'pg';
import type { ConfirmChannel } from 'amqplib';
import { EVENTS_EXCHANGE } from './rabbitmq';

/**
 * Outbox Relay: lê eventos pendentes da tabela `outbox` e publica no RabbitMQ.
 *
 * - FOR UPDATE SKIP LOCKED: permite rodar várias réplicas do serviço sem publicar o mesmo lote duas vezes.
 * - Garantia "at-least-once": se o processo cair entre o publish e o UPDATE, o evento é reenviado.
 *   Por isso os consumidores (B e C) deduplicam pelo `eventId`.
 */
export class OutboxRelay {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly pool: Pool,
    private readonly channel: ConfirmChannel,
    private readonly log: (msg: string) => void,
    private readonly intervalMs = 300,
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT id, type, payload FROM outbox
          WHERE published_at IS NULL
          ORDER BY created_at
          LIMIT 100
          FOR UPDATE SKIP LOCKED`,
      );
      if (rows.length === 0) {
        await client.query('COMMIT');
        return 0;
      }
      for (const row of rows) {
        this.channel.publish(EVENTS_EXCHANGE, row.type, Buffer.from(JSON.stringify(row.payload)), {
          persistent: true,
          contentType: 'application/json',
          messageId: row.id,
          type: row.type,
        });
      }
      await this.channel.waitForConfirms();
      await client.query('UPDATE outbox SET published_at = now(), attempts = attempts + 1 WHERE id = ANY($1::uuid[])', [
        rows.map((r) => r.id),
      ]);
      await client.query('COMMIT');
      return rows.length;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      this.log(`Outbox relay falhou, tentará novamente: ${(err as Error).message}`);
      return 0;
    } finally {
      client.release();
      this.running = false;
    }
  }
}
