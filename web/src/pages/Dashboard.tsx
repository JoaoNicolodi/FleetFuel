import type { LiveState } from '../hooks/useLiveSocket';
import { brl, dateTime, liters } from '../api/client';
import { Card, Empty, Kpi, QuotaBar } from '../components/ui';

const EVENT_LABEL: Record<string, string> = {
  'refuel.registered': '⛽ Abastecimento',
  'refuel.rejected': '⛔ Rejeitado',
  'quota.defined': '📋 Cota definida',
  'vehicle.registered': '🚗 Veículo cadastrado',
  'session.started': '🟢 Turno iniciado',
  'session.ended': '⚪ Turno encerrado',
};

function describe(type: string, p: Record<string, unknown>): string {
  switch (type) {
    case 'refuel.registered':
      return `${p.plate} · ${liters(Number(p.liters))} · ${brl(Number(p.totalCents))} · ${p.stationName}${p.status === 'FLAGGED' ? ' · ⚠️ consumo fora do padrão' : ''}${p.offline ? ' · 📴 sync offline' : ''}`;
    case 'refuel.rejected':
      return `${p.plate} · ${p.reviewReason ?? p.rejectionCode}`;
    case 'quota.defined':
      return `${p.plate} · ${p.month} · ${liters(Number(p.limitLiters))}`;
    case 'session.started':
    case 'session.ended':
      return `${p.plate} · ${p.driverName}`;
    default:
      return String(p.plate ?? '');
  }
}

export function Dashboard({ live }: { live: LiveState }) {
  const s = live.stats;
  const positions = Object.values(live.positions);
  const quotas = Object.values(live.quotas).sort((a, b) => a.remainingLiters - b.remainingLiters);

  return (
    <div className="grid">
      <div className="kpis">
        <Kpi label="Abastecimentos hoje" value={s?.refuels ?? '—'} />
        <Kpi label="Litros hoje" value={s ? liters(s.liters) : '—'} />
        <Kpi label="Gasto hoje" value={s ? brl(s.totalCents) : '—'} />
        <Kpi label="Rejeitados" value={s?.rejected ?? '—'} tone={s && s.rejected > 0 ? 'bad' : undefined} />
        <Kpi label="Para revisar" value={s?.flagged ?? '—'} tone={s && s.flagged > 0 ? 'warn' : undefined} />
        <Kpi label="Sincronizados offline" value={s?.offlineSynced ?? '—'} />
      </div>

      <Card title="Eventos em tempo real">
        {live.feed.length === 0 ? (
          <Empty>Aguardando eventos… faça um abastecimento pelo app.</Empty>
        ) : (
          <ul className="feed">
            {live.feed.map((e) => (
              <li key={e.eventId} className={`feed-item ${e.type.replace('.', '-')}`}>
                <span className="feed-type">{EVENT_LABEL[e.type] ?? e.type}</span>
                <span className="feed-desc">{describe(e.type, e.payload)}</span>
                <time>{dateTime(e.occurredAt)}</time>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="col">
        <Card title={`Veículos em turno (${live.sessions.length})`}>
          {live.sessions.length === 0 ? (
            <Empty>Nenhum motorista em turno.</Empty>
          ) : (
            <table>
              <thead>
                <tr><th>Placa</th><th>Motorista</th><th>Última posição</th></tr>
              </thead>
              <tbody>
                {live.sessions.map((ses) => {
                  const p = live.positions[ses.vehicleId];
                  return (
                    <tr key={ses.vehicleId}>
                      <td><strong>{ses.plate}</strong></td>
                      <td>{ses.driverName}</td>
                      <td>
                        {p ? (
                          <a href={`https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=16/${p.lat}/${p.lng}`} target="_blank" rel="noreferrer">
                            {p.lat.toFixed(4)}, {p.lng.toFixed(4)} {p.speedKmh !== null ? `· ${Math.round(p.speedKmh)} km/h` : ''}
                          </a>
                        ) : (
                          <span className="muted">sem GPS</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {positions.length > 0 && <small className="muted">{positions.length} veículo(s) com GPS ativo</small>}
        </Card>

        <Card title="Saldo de cotas (ao vivo)">
          {quotas.length === 0 ? (
            <Empty>As cotas aparecem aqui conforme forem definidas ou consumidas.</Empty>
          ) : (
            <ul className="quota-list">
              {quotas.map((q) => (
                <li key={q.vehicleId}>
                  <strong>{q.plate}</strong>
                  <QuotaBar remaining={q.remainingLiters} limit={q.limitLiters} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
