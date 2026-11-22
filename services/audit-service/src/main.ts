/** Composition Root do Serviço C (Audit / Ledger). */
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { migrate, PgAuditUnitOfWork, PgLedgerReader } from './infra/database/postgres/pg-audit';
import { connectRabbit, startConsumer } from './infra/messaging/rabbitmq';
import { buildServer } from './infra/http/server';
import { ListLedgerUseCase, MonthlyReportUseCase, RecordEventUseCase, VerifyChainUseCase } from './core/use-cases/audit-use-cases';

const env = {
  port: Number(process.env.PORT ?? 3003),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://fleetfuel:fleetfuel@localhost:5433/audit',
  rabbitUrl: process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672',
};

async function main() {
  const log = (m: string) => console.log(`[audit-service] ${m}`);
  const pool = new Pool({ connectionString: env.databaseUrl, max: 10 });
  for (let i = 1; ; i++) {
    try { await pool.query('SELECT 1'); break; } catch {
      if (i >= 30) throw new Error('Postgres indisponível');
      log(`aguardando Postgres (${i}/30)...`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  await migrate(pool);

  const hasher = { sha256: (s: string) => createHash('sha256').update(s).digest('hex') };
  const clock = { now: () => new Date() };
  const reader = new PgLedgerReader(pool);
  const record = new RecordEventUseCase(new PgAuditUnitOfWork(pool), hasher, clock);

  const rabbit = await connectRabbit(env.rabbitUrl, log);
  // '#' = TODOS os eventos de A (refuel.*, quota.*, vehicle.*) e de B (session.*).
  await startConsumer(
    rabbit,
    'audit-service.q',
    ['#'],
    async (raw) => {
      const r = await record.execute(raw);
      return r.ok ? 'ok' : 'invalid';
    },
    log,
  );

  const app = await buildServer({
    list: new ListLedgerUseCase(reader),
    verify: new VerifyChainUseCase(reader, hasher),
    report: new MonthlyReportUseCase(reader),
    health: async () => ({ status: 'ok', service: 'audit-service', ledgerEntries: await reader.count() }),
  });
  await app.listen({ port: env.port, host: '0.0.0.0' });

  const shutdown = async () => {
    await app.close();
    await rabbit.close().catch(() => undefined);
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
