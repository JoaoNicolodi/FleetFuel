import Fastify, { FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import { Result } from '../../core/domain/shared/result';
import { DomainError } from '../../core/domain/shared/errors';
import { RegisterVehicleUseCase } from '../../core/use-cases/register-vehicle';
import { SetMonthlyQuotaUseCase } from '../../core/use-cases/set-monthly-quota';
import { RegisterRefuelUseCase } from '../../core/use-cases/register-refuel';
import { GetVehicleBalanceUseCase, ListRefuelsUseCase, ListVehiclesUseCase } from '../../core/use-cases/queries';
import { PhotoStorage } from '../../core/use-cases/ports/services';
import { RefuelRepository } from '../../core/use-cases/ports/repositories';
import { toHttpError } from './error-mapper';

export interface HttpDeps {
  registerVehicle: RegisterVehicleUseCase;
  setQuota: SetMonthlyQuotaUseCase;
  registerRefuel: RegisterRefuelUseCase;
  getBalance: GetVehicleBalanceUseCase;
  listVehicles: ListVehiclesUseCase;
  listRefuels: ListRefuelsUseCase;
  refuels: RefuelRepository;
  photos: PhotoStorage;
  health: () => Promise<Record<string, unknown>>;
}

/** Controller genérico: Result ok → status de sucesso; Result fail → erro mapeado. */
function reply<S>(res: FastifyReply, result: Result<S, DomainError>, successStatus = 200) {
  if (result.ok) return res.status(successStatus).send(result.value);
  const { status, body } = toHttpError(result.error);
  return res.status(status).send(body);
}

export function buildServer(deps: HttpDeps) {
  // bodyLimit alto porque o app envia a foto do hodômetro em base64.
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, bodyLimit: 8 * 1024 * 1024 });
  app.register(cors, { origin: true });

  app.get('/health', async () => deps.health());

  app.post<{ Body: Record<string, unknown> }>(
    '/vehicles',
    {
      schema: {
        body: {
          type: 'object',
          required: ['plate', 'model', 'department', 'fuelType', 'expectedKmPerLiter'],
          properties: {
            plate: { type: 'string' },
            model: { type: 'string' },
            department: { type: 'string' },
            fuelType: { type: 'string' },
            expectedKmPerLiter: { type: 'number' },
            initialOdometerKm: { type: 'integer' },
          },
        },
      },
    },
    async (req, res) => reply(res, await deps.registerVehicle.execute(req.body as never), 201),
  );

  app.get<{ Querystring: { month?: string } }>('/vehicles', async (req, res) =>
    reply(res, await deps.listVehicles.execute(req.query.month)),
  );

  app.get<{ Params: { id: string }; Querystring: { month?: string } }>('/vehicles/:id/balance', async (req, res) =>
    reply(res, await deps.getBalance.execute(req.params.id, req.query.month)),
  );

  app.put<{ Params: { id: string; month: string }; Body: { limitLiters: number } }>(
    '/vehicles/:id/quotas/:month',
    { schema: { body: { type: 'object', required: ['limitLiters'], properties: { limitLiters: { type: 'number' } } } } },
    async (req, res) =>
      reply(res, await deps.setQuota.execute({ vehicleId: req.params.id, month: req.params.month, limitLiters: req.body.limitLiters })),
  );

  /**
   * POST /refuels — usado tanto online quanto pela fila de sincronização offline.
   * A chave de idempotência pode vir no header `Idempotency-Key` ou no campo `clientId`.
   * 201 = criado | 200 = já existia (replay) | 422 = rejeitado por regra de negócio.
   */
  app.post<{ Body: Record<string, unknown> }>(
    '/refuels',
    {
      schema: {
        body: {
          type: 'object',
          required: ['vehicleId', 'driverName', 'stationName', 'liters', 'odometerKm', 'pricePerLiterCents', 'occurredAt', 'photoBase64'],
        },
      },
    },
    async (req, res) => {
      const headerKey = req.headers['idempotency-key'];
      const body = { ...req.body, clientId: (typeof headerKey === 'string' && headerKey) || req.body.clientId };
      const result = await deps.registerRefuel.execute(body as never);
      if (result.ok) return res.status(result.value.replayed ? 200 : 201).send(result.value);
      return reply(res, result);
    },
  );

  app.get<{ Querystring: { vehicleId?: string; status?: string; limit?: string } }>('/refuels', async (req, res) =>
    reply(
      res,
      await deps.listRefuels.execute({
        vehicleId: req.query.vehicleId,
        status: req.query.status,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      }),
    ),
  );

  /** Foto do hodômetro para o gestor conferir no painel. */
  app.get<{ Params: { id: string } }>('/refuels/:id/photo', async (req, res) => {
    const refuel = await deps.refuels.findById(req.params.id);
    if (!refuel) return res.status(404).send({ code: 'NOT_FOUND', message: 'Abastecimento não encontrado' });
    const photo = await deps.photos.read(refuel.snapshot().photoKey);
    if (!photo) return res.status(404).send({ code: 'NOT_FOUND', message: 'Foto não encontrada' });
    return res.header('content-type', photo.mimeType).header('cache-control', 'private, max-age=3600').send(Buffer.from(photo.data));
  });

  // Falhas inesperadas (infra). Violação de UNIQUE vira 409 em vez de 500.
  app.setErrorHandler((err: Error & { code?: string; validation?: unknown; statusCode?: number }, _req, res) => {
    if (err.validation) return res.status(400).send({ code: 'VALIDATION_ERROR', message: err.message });
    if (err.code === '23505') return res.status(409).send({ code: 'CONFLICT', message: 'Registro duplicado' });
    if (err.code === '55P03') return res.status(503).send({ code: 'LOCK_TIMEOUT', message: 'Sistema ocupado, tente novamente' });
    app.log.error(err);
    return res.status(err.statusCode ?? 500).send({ code: 'INTERNAL_ERROR', message: 'Erro interno' });
  });

  return app;
}
