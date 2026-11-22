import Fastify from 'fastify';
import cors from '@fastify/cors';
import { ListLedgerUseCase, MonthlyReportUseCase, VerifyChainUseCase } from '../../core/use-cases/audit-use-cases';
import { MonthlyReport } from '../../core/use-cases/dtos';

export interface HttpDeps {
  list: ListLedgerUseCase;
  verify: VerifyChainUseCase;
  report: MonthlyReportUseCase;
  health: () => Promise<Record<string, unknown>>;
}

const brl = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');

function toCsv(r: MonthlyReport): string {
  const header = 'placa;secretaria;abastecimentos;rejeitados;sinalizados;litros;valor_rs;km_rodados;km_por_litro;preco_medio_litro';
  const lines = r.byVehicle.map((v) =>
    [v.plate, v.department, v.refuels, v.rejected, v.flagged, String(v.liters).replace('.', ','), brl(v.totalCents), v.distanceKm,
      v.avgKmPerLiter === null ? '' : String(v.avgKmPerLiter).replace('.', ','),
      v.avgPricePerLiterCents === null ? '' : brl(v.avgPricePerLiterCents)].join(';'),
  );
  return '﻿' + [header, ...lines].join('\n'); // BOM para o Excel abrir com acentos
}

/**
 * API SOMENTE LEITURA. O Serviço C não recebe comandos por HTTP:
 * todo dado entra pelo broker (eventos de A e B).
 */
export async function buildServer(deps: HttpDeps) {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
  await app.register(cors, { origin: true });

  app.get('/health', async () => deps.health());

  app.get<{ Querystring: { vehicleId?: string; type?: string; limit?: string; before?: string } }>('/ledger', async (req) => {
    const r = await deps.list.execute({
      aggregateId: req.query.vehicleId,
      eventType: req.query.type,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      beforeSequence: req.query.before ? Number(req.query.before) : undefined,
    });
    return r.ok ? r.value : [];
  });

  app.get('/ledger/verify', async (_req, res) => {
    const r = await deps.verify.execute();
    if (r.ok) return r.value;
    return res.status(409).send({ valid: false, code: r.error.code, message: r.error.message, sequence: r.error.sequence });
  });

  app.get<{ Querystring: { month: string; format?: string } }>('/reports/monthly', async (req, res) => {
    const r = await deps.report.execute(req.query.month ?? '');
    if (!r.ok) return res.status(400).send({ code: r.error.code, message: r.error.message });
    if (req.query.format === 'csv') {
      return res
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="fleetfuel-${r.value.month}.csv"`)
        .send(toCsv(r.value));
    }
    return r.value;
  });

  return app;
}
