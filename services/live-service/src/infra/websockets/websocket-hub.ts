import type { Redis } from 'ioredis';
import type { WebSocket } from 'ws';
import { RealtimeBroadcaster } from '../../core/use-cases/ports';

const CHANNEL = 'live:broadcast';

/**
 * Broadcaster via Redis Pub/Sub. Por que não mandar direto para os sockets?
 * Se o Serviço B rodar com 3 réplicas atrás do gateway, cada painel está
 * conectado em UMA réplica só. Publicando no Redis, todas as réplicas
 * recebem e repassam aos seus próprios clientes.
 */
export class RedisPubSubBroadcaster implements RealtimeBroadcaster {
  constructor(private readonly pub: Redis) {}
  async broadcast(type: string, data: unknown) {
    await this.pub.publish(CHANNEL, JSON.stringify({ type, data, at: new Date().toISOString() }));
  }
}

/** Mantém os sockets conectados NESTA réplica e repassa as mensagens do canal Redis. */
export class WebSocketHub {
  private readonly clients = new Set<WebSocket>();

  constructor(
    private readonly sub: Redis,
    private readonly log: (m: string) => void,
  ) {}

  async start() {
    await this.sub.subscribe(CHANNEL);
    this.sub.on('message', (_channel: string, message: string) => this.fanOut(message));
    // Heartbeat: derruba conexões mortas (celular/aba que sumiu sem fechar o socket).
    setInterval(() => {
      for (const ws of this.clients) {
        const alive = (ws as WebSocket & { isAlive?: boolean }).isAlive;
        if (alive === false) {
          ws.terminate();
          this.clients.delete(ws);
          continue;
        }
        (ws as WebSocket & { isAlive?: boolean }).isAlive = false;
        ws.ping();
      }
    }, 30_000).unref();
  }

  add(ws: WebSocket, initialMessage: unknown) {
    (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
    ws.on('pong', () => ((ws as WebSocket & { isAlive?: boolean }).isAlive = true));
    ws.on('close', () => this.clients.delete(ws));
    ws.on('error', () => this.clients.delete(ws));
    this.clients.add(ws);
    ws.send(JSON.stringify(initialMessage));
    this.log(`painel conectado (${this.clients.size} ativos)`);
  }

  get size() {
    return this.clients.size;
  }

  private fanOut(message: string) {
    for (const ws of this.clients) {
      if (ws.readyState === 1 /* OPEN */) ws.send(message);
    }
  }
}
