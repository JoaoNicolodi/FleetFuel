import amqp, { ConfirmChannel, ConsumeMessage } from 'amqplib';
import { randomUUID } from 'node:crypto';
import { EventPublisher, LiveEvent } from '../../core/use-cases/ports';

export const EVENTS_EXCHANGE = 'fleetfuel.events';
export const DLX = 'fleetfuel.dlx';
export type AmqpConnection = Awaited<ReturnType<typeof amqp.connect>>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function connectRabbit(url: string, log: (m: string) => void): Promise<AmqpConnection> {
  for (let attempt = 1; ; attempt++) {
    try {
      const conn = await amqp.connect(url);
      log(`RabbitMQ conectado (tentativa ${attempt})`);
      return conn;
    } catch (err) {
      log(`RabbitMQ indisponível (tentativa ${attempt}): ${(err as Error).message}`);
      await sleep(Math.min(1000 * attempt, 10_000));
    }
  }
}

export class RabbitEventPublisher implements EventPublisher {
  constructor(
    private readonly channel: ConfirmChannel,
    private readonly log: (m: string) => void,
  ) {}

  static async create(conn: AmqpConnection, log: (m: string) => void) {
    const ch = await conn.createConfirmChannel();
    await ch.assertExchange(EVENTS_EXCHANGE, 'topic', { durable: true });
    return new RabbitEventPublisher(ch, log);
  }

  async publish(type: string, payload: Record<string, unknown>) {
    const eventId = randomUUID();
    const envelope = { eventId, type, source: 'live-service', occurredAt: new Date().toISOString(), payload };
    try {
      this.channel.publish(EVENTS_EXCHANGE, type, Buffer.from(JSON.stringify(envelope)), {
        persistent: true,
        contentType: 'application/json',
        messageId: eventId,
        type,
      });
      await this.channel.waitForConfirms();
    } catch (err) {
      // Eventos de sessão são informativos: não derrubam a requisição do motorista.
      this.log(`falha ao publicar ${type}: ${(err as Error).message}`);
    }
  }
}

/**
 * Consumidor com Dead Letter Queue: se o handler falhar 3 vezes, a mensagem
 * vai para `live-service.dlq` em vez de travar a fila (poison message).
 */
export async function startConsumer(
  conn: AmqpConnection,
  queue: string,
  bindings: string[],
  handler: (event: LiveEvent) => Promise<void>,
  log: (m: string) => void,
) {
  const ch = await conn.createChannel();
  await ch.assertExchange(EVENTS_EXCHANGE, 'topic', { durable: true });
  await ch.assertExchange(DLX, 'topic', { durable: true });
  await ch.assertQueue(`${queue}.dlq`, { durable: true });
  await ch.bindQueue(`${queue}.dlq`, DLX, `${queue}.#`);
  await ch.assertQueue(queue, {
    durable: true,
    arguments: { 'x-dead-letter-exchange': DLX, 'x-dead-letter-routing-key': `${queue}.dead` },
  });
  for (const key of bindings) await ch.bindQueue(queue, EVENTS_EXCHANGE, key);
  await ch.prefetch(20);

  await ch.consume(queue, async (msg: ConsumeMessage | null) => {
    if (!msg) return;
    const attempts = Number(msg.properties.headers?.['x-attempts'] ?? 0);
    try {
      const event = JSON.parse(msg.content.toString()) as LiveEvent;
      await handler(event);
      ch.ack(msg);
    } catch (err) {
      log(`erro ao processar ${msg.fields.routingKey} (tentativa ${attempts + 1}): ${(err as Error).message}`);
      if (attempts + 1 >= 3) {
        ch.nack(msg, false, false); // → DLQ
      } else {
        // Republica com contador de tentativas (requeue simples geraria loop infinito).
        ch.sendToQueue(queue, msg.content, { ...msg.properties, headers: { ...msg.properties.headers, 'x-attempts': attempts + 1 } });
        ch.ack(msg);
      }
    }
  });
  log(`consumindo ${queue} ← [${bindings.join(', ')}]`);
}
