import Fastify, { FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { Result } from '../../core/domain/shared/result';
import { DomainError } from '../../core/domain/shared/errors';
import { EndSessionUseCase, IngestTelemetryUseCase, StartSessionUseCase, ValidateSessionUseCase } from '../../core/use-cases/session-use-cases';
import { GetLiveSnapshotUseCase } from '../../core/use-cases/live-projection-use-cases';
import { WebSocketHub } from '../websockets/websocket-hub';

export interface HttpDeps {
  start: StartSessionUseCase;
  end: EndSessionUseCase;
  validate: ValidateSessionUseCase;
  telemetry: IngestTelemetryUseCase;
  snapshot: GetLiveSnapshotUseCase;
  hub: WebSocketHub;
}

const STATUS: Record<string, number> = { VALIDATION_ERROR: 400, INVALID_SESSION: 401 };

function reply<S>(res: FastifyReply, r: Result<S, DomainError>, okStatus = 200) {
  if (r.ok) return res.status(okStatus).send(r.value ?? { ok: true });
  return res.status(STATUS[r.error.code] ?? 400).send({ code: r.error.code, message: r.error.message });
}

const bearer = (h: string | undefined) => (h?.startsWith('Bearer ') ? h.slice(7) : '');

export async function buildServer(deps: HttpDeps) {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
  await app.register(cors, { origin: true });
  await app.register(websocket);

  app.get('/health', async () => ({ status: 'ok', service: 'live-service', websocketClients: deps.hub.size }));

  app.post<{ Body: { vehicleId: string; plate: string; driverName: string } }>(
    '/sessions',
    { schema: { body: { type: 'object', required: ['vehicleId', 'plate', 'driverName'] } } },
    async (req, res) => reply(res, await deps.start.execute(req.body), 201),
  );

  app.get<{ Params: { token: string } }>('/sessions/:token', async (req, res) => reply(res, await deps.validate.execute(req.params.token)));

  app.delete<{ Params: { token: string } }>('/sessions/:token', async (req, res) => reply(res, await deps.end.execute(req.params.token), 204));

  /** Ingestão de telemetria: token efêmero no header Authorization: Bearer <token>. */
  app.post<{ Body: { lat: number; lng: number; speedKmh?: number; recordedAt: string } }>(
    '/telemetry',
    { schema: { body: { type: 'object', required: ['lat', 'lng', 'recordedAt'] } } },
    async (req, res) => reply(res, await deps.telemetry.execute({ ...req.body, token: bearer(req.headers.authorization) }), 202),
  );

  app.get('/snapshot', async () => deps.snapshot.execute());

  /** WebSocket do painel: recebe o snapshot completo ao conectar e depois só os deltas. */
  app.get('/ws', { websocket: true }, async (socket) => {
    const snapshot = await deps.snapshot.execute();
    deps.hub.add(socket, { type: 'snapshot', data: snapshot, at: new Date().toISOString() });
  });

  return app;
}
