/** Composition Root do Serviço B (Live / Sessão / Tempo Real). */
import { Redis } from 'ioredis';
import { randomBytes } from 'node:crypto';
import { RedisLiveStore, RedisSessionStore } from './infra/database/redis/redis-stores';
import { RedisPubSubBroadcaster, WebSocketHub } from './infra/websockets/websocket-hub';
import { connectRabbit, RabbitEventPublisher, startConsumer } from './infra/messaging/rabbitmq';
import { buildServer } from './infra/http/server';
import { EndSessionUseCase, IngestTelemetryUseCase, StartSessionUseCase, ValidateSessionUseCase } from './core/use-cases/session-use-cases';
import { GetLiveSnapshotUseCase, ProjectCoreEventUseCase } from './core/use-cases/live-projection-use-cases';

const env = {
  port: Number(process.env.PORT ?? 3002),
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  rabbitUrl: process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672',
};

async function main() {
  const log = (m: string) => console.log(`[live-service] ${m}`);

  // Redis exige conexões separadas para comandos e para SUBSCRIBE.
  const redis = new Redis(env.redisUrl, { maxRetriesPerRequest: 3 });
  const pub = new Redis(env.redisUrl);
  const sub = new Redis(env.redisUrl);

  const clock = { now: () => new Date() };
  const tokens = { next: () => randomBytes(24).toString('hex') };
  const sessions = new RedisSessionStore(redis);
  const live = new RedisLiveStore(redis);
  const broadcaster = new RedisPubSubBroadcaster(pub);
  const hub = new WebSocketHub(sub, log);
  await hub.start();

  const rabbit = await connectRabbit(env.rabbitUrl, log);
  const publisher = await RabbitEventPublisher.create(rabbit, log);

  const project = new ProjectCoreEventUseCase(live, broadcaster, clock);
  await startConsumer(
    rabbit,
    'live-service.q',
    ['refuel.*', 'quota.*', 'vehicle.*'],
    async (event) => {
      await project.execute(event);
    },
    log,
  );

  const app = await buildServer({
    start: new StartSessionUseCase(sessions, live, tokens, broadcaster, publisher, clock),
    end: new EndSessionUseCase(sessions, live, broadcaster, publisher, clock),
    validate: new ValidateSessionUseCase(sessions, clock),
    telemetry: new IngestTelemetryUseCase(sessions, live, broadcaster, clock),
    snapshot: new GetLiveSnapshotUseCase(sessions, live, clock),
    hub,
  });
  await app.listen({ port: env.port, host: '0.0.0.0' });

  const shutdown = async () => {
    await app.close();
    await rabbit.close().catch(() => undefined);
    redis.disconnect();
    pub.disconnect();
    sub.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
