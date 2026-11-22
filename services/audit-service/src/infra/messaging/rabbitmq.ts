import amqp, { ConsumeMessage } from 'amqplib';

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

/**
 * Consumidor do ledger. prefetch(1) + ack manual: processa um evento por vez,
 * e só confirma ao broker DEPOIS do COMMIT no Postgres. Se o serviço cair no
 * meio, o RabbitMQ reentrega e a deduplicação por eventId evita registro duplo.
 */
export async function startConsumer(
  conn: AmqpConnection,
  queue: string,
  bindings: string[],
  handler: (raw: unknown) => Promise<'ok' | 'invalid'>,
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
  await ch.prefetch(1);

  await ch.consume(queue, async (msg: ConsumeMessage | null) => {
    if (!msg) return;
    const attempts = Number(msg.properties.headers?.['x-attempts'] ?? 0);
    try {
      const outcome = await handler(JSON.parse(msg.content.toString()));
      if (outcome === 'invalid') {
        log(`evento inválido → DLQ (${msg.fields.routingKey})`);
        ch.nack(msg, false, false);
      } else {
        ch.ack(msg);
      }
    } catch (err) {
      log(`erro ao gravar ${msg.fields.routingKey} (tentativa ${attempts + 1}): ${(err as Error).message}`);
      if (attempts + 1 >= 5) {
        ch.nack(msg, false, false);
      } else {
        await sleep(200 * 2 ** attempts); // backoff exponencial
        ch.sendToQueue(queue, msg.content, { ...msg.properties, headers: { ...msg.properties.headers, 'x-attempts': attempts + 1 } });
        ch.ack(msg);
      }
    }
  });
  log(`consumindo ${queue} ← [${bindings.join(', ')}]`);
}
