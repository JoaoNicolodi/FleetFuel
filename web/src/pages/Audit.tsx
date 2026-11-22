import { useState } from 'react';
import { api, brl, currentMonth, dateTime, liters } from '../api/client';
import { useAsync } from '../hooks/useAsync';
import { Card, Empty, ErrorBox, Kpi, Loading } from '../components/ui';

function ChainVerification() {
  const [state, setState] = useState<{ loading: boolean; result: Awaited<ReturnType<typeof api.verifyLedger>> | null; error: string | null }>({
    loading: false,
    result: null,
    error: null,
  });

  const run = async () => {
    setState({ loading: true, result: null, error: null });
    try {
      setState({ loading: false, result: await api.verifyLedger(), error: null });
    } catch {
      setState({ loading: false, result: null, error: 'Não foi possível verificar o ledger' });
    }
  };

  const r = state.result;
  return (
    <div className="verify">
      <button className="btn" onClick={run} disabled={state.loading}>{state.loading ? 'Verificando…' : '🔒 Verificar integridade do ledger'}</button>
      {state.error && <ErrorBox message={state.error} />}
      {r && r.valid && (
        <p className="ok-text">✅ Cadeia íntegra: {r.entriesVerified} registros verificados. Hash atual: <code>{r.headHash?.slice(0, 16)}…</code></p>
      )}
      {r && !r.valid && <p className="bad-text">❌ {r.message}</p>}
    </div>
  );
}

function Report() {
  const [month, setMonth] = useState(currentMonth());
  const { data, loading, error, reload } = useAsync(() => api.monthlyReport(month), [month]);

  return (
    <Card
      title="Fechamento mensal"
      actions={
        <div className="inline">
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          <a className="btn ghost" href={api.monthlyReportCsvUrl(month)}>Exportar CSV</a>
        </div>
      }
    >
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : !data || data.byVehicle.length === 0 ? (
        <Empty>Sem movimentação em {month}.</Empty>
      ) : (
        <>
          <div className="kpis">
            <Kpi label="Abastecimentos" value={data.totals.refuels} />
            <Kpi label="Litros" value={liters(data.totals.liters)} />
            <Kpi label="Total" value={brl(data.totals.totalCents)} />
            <Kpi label="Rejeitados" value={data.totals.rejected} tone={data.totals.rejected ? 'bad' : undefined} />
            <Kpi label="Via sync offline" value={data.totals.offline} />
          </div>
          <h3>Por secretaria</h3>
          <table>
            <thead><tr><th>Secretaria</th><th>Veículos</th><th>Litros</th><th>Total</th></tr></thead>
            <tbody>
              {data.byDepartment.map((d) => (
                <tr key={d.department}><td>{d.department}</td><td>{d.vehicles}</td><td>{liters(d.liters)}</td><td>{brl(d.totalCents)}</td></tr>
              ))}
            </tbody>
          </table>
          <h3>Por veículo</h3>
          <table>
            <thead><tr><th>Placa</th><th>Abast.</th><th>Rej.</th><th>Litros</th><th>Total</th><th>km</th><th>km/L</th><th>R$/L</th></tr></thead>
            <tbody>
              {data.byVehicle.map((v) => (
                <tr key={v.vehicleId}>
                  <td><strong>{v.plate}</strong></td><td>{v.refuels}</td><td>{v.rejected}</td><td>{liters(v.liters)}</td>
                  <td>{brl(v.totalCents)}</td><td>{v.distanceKm}</td><td>{v.avgKmPerLiter ?? '—'}</td>
                  <td>{v.avgPricePerLiterCents ? brl(v.avgPricePerLiterCents) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Card>
  );
}

export function Audit({ revision }: { revision: number }) {
  const { data, loading, error, reload } = useAsync(() => api.ledger(), [revision]);
  return (
    <div className="grid">
      <Report />
      <Card title="Ledger imutável (últimos 100)" actions={<ChainVerification />}>
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <ErrorBox message={error} onRetry={reload} />
        ) : !data?.length ? (
          <Empty>O ledger ainda está vazio.</Empty>
        ) : (
          <table className="mono">
            <thead><tr><th>#</th><th>Evento</th><th>Origem</th><th>Quando</th><th>Hash</th><th>Anterior</th></tr></thead>
            <tbody>
              {data.map((e) => (
                <tr key={e.sequence}>
                  <td>{e.sequence}</td><td>{e.eventType}</td><td>{e.source}</td><td>{dateTime(e.occurredAt)}</td>
                  <td title={e.hash}>{e.hash.slice(0, 10)}…</td><td title={e.previousHash}>{e.previousHash.slice(0, 10)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
