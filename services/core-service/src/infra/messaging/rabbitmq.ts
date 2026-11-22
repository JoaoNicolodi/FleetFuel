import amqp, { ConfirmChannel } from 'amqplib';

export type AmqpConnection = Awaited<ReturnType<typeof amqp.connect>>;

export const EVENTS_EXCHANGE = 'fleetfuel.events';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Conecta no RabbitMQ com retry (no docker-compose o broker pode subir depois do serviço). */
export async function connectRabbit(url: string, log: (msg: string) => void): Promise<AmqpConnection> {
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

/** Canal com Publisher Confirms: só marcamos o outbox como publicado após o ACK do broker. */
export async function createPublisher(conn: AmqpConnection): Promise<ConfirmChannel> {
  const ch = await conn.createConfirmChannel();
  await ch.assertExchange(EVENTS_EXCHANGE, 'topic', { durable: true });
  return ch;
}
