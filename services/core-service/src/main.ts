/**
 * Composition Root do Serviço A: o ÚNICO lugar que conhece todas as
 * implementações concretas e as injeta nos casos de uso.
 */
import { createPool, migrate, PgUnitOfWork } from './infra/database/postgres/pg-unit-of-work';
import { PgQuotaRepository, PgRefuelRepository, PgVehicleRepository } from './infra/database/postgres/pg-repositories';
import { LocalDiskPhotoStorage } from './infra/storage/photo-storage';
import { SystemClock, UuidGenerator } from './infra/system';
import { connectRabbit, createPublisher } from './infra/messaging/rabbitmq';
import { OutboxRelay } from './infra/messaging/outbox-relay';
import { buildServer } from './infra/http/server';
import { RegisterVehicleUseCase } from './core/use-cases/register-vehicle';
import { SetMonthlyQuotaUseCase } from './core/use-cases/set-monthly-quota';
import { RegisterRefuelUseCase } from './core/use-cases/register-refuel';
import { GetVehicleBalanceUseCase, ListRefuelsUseCase, ListVehiclesUseCase } from './core/use-cases/queries';

const env = {
  port: Number(process.env.PORT ?? 3001),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://fleetfuel:fleetfuel@localhost:5432/core',
  rabbitUrl: process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672',
  photosDir: process.env.PHOTOS_DIR ?? './data/photos',
};

async function main() {
  const log = (msg: string) => console.log(`[core-service] ${msg}`);

  const pool = createPool(env.databaseUrl);
  await waitForDb(pool, log);
  await migrate(pool);

  const uow = new PgUnitOfWork(pool);
  const clock = new SystemClock();
  const ids = new UuidGenerator();
  const photos = new LocalDiskPhotoStorage(env.photosDir);
  const vehicles = new PgVehicleRepository(pool);
  const quotas = new PgQuotaRepository(pool);
  const refuels = new PgRefuelRepository(pool);

  const rabbit = await connectRabbit(env.rabbitUrl, log);
  const publisher = await createPublisher(rabbit);
  const relay = new OutboxRelay(pool, publisher, log);
  relay.start();

  const app = buildServer({
    registerVehicle: new RegisterVehicleUseCase(uow, ids, clock),
    setQuota: new SetMonthlyQuotaUseCase(uow, ids, clock),
    registerRefuel: new RegisterRefuelUseCase(uow, photos, ids, clock),
    getBalance: new GetVehicleBalanceUseCase(vehicles, quotas, clock),
    listVehicles: new ListVehiclesUseCase(vehicles, quotas, clock),
    listRefuels: new ListRefuelsUseCase(refuels),
    refuels,
    photos,
    health: async () => {
      const { rows } = await pool.query("SELECT count(*)::int AS pending FROM outbox WHERE published_at IS NULL");
      return { status: 'ok', service: 'core-service', outboxPending: rows[0].pending };
    },
  });

  await app.listen({ port: env.port, host: '0.0.0.0' });

  const shutdown = async () => {
    log('encerrando...');
    relay.stop();
    await app.close();
    await rabbit.close().catch(() => undefined);
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

async function waitForDb(pool: ReturnType<typeof createPool>, log: (m: string) => void) {
  for (let i = 1; i <= 30; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch {
      log(`aguardando Postgres (${i}/30)...`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error('Postgres indisponível');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
