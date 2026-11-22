import { useState } from 'react';
import { api, brl, dateTime, liters } from '../api/client';
import type { Refuel } from '../api/types';
import { useAsync } from '../hooks/useAsync';
import { Card, Empty, ErrorBox, Loading, StatusBadge } from '../components/ui';

function PhotoModal({ refuel, onClose }: { refuel: Refuel; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="card-head">
          <h2>Hodômetro · {refuel.plate}</h2>
          <button className="btn ghost" onClick={onClose}>Fechar</button>
        </header>
        <img src={api.photoUrl(refuel.id)} alt="Foto do hodômetro" className="photo" />
        <dl className="details">
          <dt>Informado</dt><dd>{refuel.odometerKm.toLocaleString('pt-BR')} km</dd>
          <dt>Distância</dt><dd>{refuel.distanceKm ?? '—'} km</dd>
          <dt>Consumo</dt><dd>{refuel.kmPerLiter ?? '—'} km/L</dd>
          <dt>Motivo</dt><dd>{refuel.reviewReason ?? '—'}</dd>
        </dl>
      </div>
    </div>
  );
}

export function Refuels({ revision }: { revision: number }) {
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<Refuel | null>(null);
  const { data, loading, error, reload } = useAsync(() => api.listRefuels({ status }), [status, revision]);

  return (
    <Card
      title="Abastecimentos"
      actions={
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todos</option>
          <option value="ACCEPTED">Aceitos</option>
          <option value="FLAGGED">Para revisar</option>
          <option value="REJECTED">Rejeitados</option>
        </select>
      }
    >
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : !data?.length ? (
        <Empty>Nenhum abastecimento encontrado.</Empty>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Quando</th><th>Placa</th><th>Motorista / Posto</th><th>Volume</th><th>Valor</th><th>km/L</th><th>Status</th><th>Foto</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.id} className={r.status.toLowerCase()}>
                <td>
                  {dateTime(r.occurredAt)}
                  {r.offline && <><br /><small className="muted" title={`Recebido ${dateTime(r.receivedAt)}`}>📴 offline</small></>}
                </td>
                <td><strong>{r.plate}</strong></td>
                <td>{r.driverName}<br /><small className="muted">{r.stationName}</small></td>
                <td>{liters(r.liters)}</td>
                <td>{brl(r.totalCents)}</td>
                <td>{r.kmPerLiter ?? '—'}</td>
                <td>
                  <StatusBadge status={r.status} />
                  {r.status !== 'ACCEPTED' && <><br /><small className="muted">{r.reviewReason}</small></>}
                </td>
                <td><button className="btn ghost" onClick={() => setSelected(r)}>Ver</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {selected && <PhotoModal refuel={selected} onClose={() => setSelected(null)} />}
    </Card>
  );
}
