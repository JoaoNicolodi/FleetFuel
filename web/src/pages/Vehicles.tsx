import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, currentMonth } from '../api/client';
import { useAsync } from '../hooks/useAsync';
import { Card, Empty, ErrorBox, Loading, QuotaBar } from '../components/ui';

type Notify = (text: string, tone?: 'ok' | 'bad') => void;

function VehicleForm({ onCreated, notify }: { onCreated: () => void; notify: Notify }) {
  const [form, setForm] = useState({ plate: '', model: '', department: '', fuelType: 'GASOLINA', expectedKmPerLiter: '10', initialOdometerKm: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.createVehicle({
        plate: form.plate,
        model: form.model,
        department: form.department,
        fuelType: form.fuelType,
        expectedKmPerLiter: Number(form.expectedKmPerLiter),
        initialOdometerKm: form.initialOdometerKm ? Number(form.initialOdometerKm) : undefined,
      });
      notify(`Veículo ${form.plate.toUpperCase()} cadastrado`);
      setForm({ ...form, plate: '', model: '', initialOdometerKm: '' });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="form" onSubmit={submit}>
      <label>Placa<input required value={form.plate} onChange={set('plate')} placeholder="IXA1B23" maxLength={8} /></label>
      <label>Modelo<input required value={form.model} onChange={set('model')} placeholder="Fiat Strada" /></label>
      <label>Secretaria<input required value={form.department} onChange={set('department')} placeholder="Saúde" /></label>
      <label>
        Combustível
        <select value={form.fuelType} onChange={set('fuelType')}>
          <option>GASOLINA</option><option>ETANOL</option><option>DIESEL</option>
        </select>
      </label>
      <label>Consumo esperado (km/L)<input type="number" step="0.1" min="1" required value={form.expectedKmPerLiter} onChange={set('expectedKmPerLiter')} /></label>
      <label>Hodômetro inicial (km)<input type="number" min="0" value={form.initialOdometerKm} onChange={set('initialOdometerKm')} /></label>
      {error && <p className="field-error">{error}</p>}
      <button className="btn" disabled={saving}>{saving ? 'Salvando…' : 'Cadastrar veículo'}</button>
    </form>
  );
}

function QuotaEditor({ vehicleId, month, current, onSaved, notify }: { vehicleId: string; month: string; current?: number; onSaved: () => void; notify: Notify }) {
  const [value, setValue] = useState(current ? String(current) : '');
  const [saving, setSaving] = useState(false);
  useEffect(() => setValue(current ? String(current) : ''), [current]);

  const save = async () => {
    setSaving(true);
    try {
      await api.setQuota(vehicleId, month, Number(value));
      notify('Cota atualizada');
      onSaved();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : 'Erro ao salvar cota', 'bad');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="inline">
      <input type="number" min="1" className="small" value={value} onChange={(e) => setValue(e.target.value)} placeholder="litros" />
      <button className="btn ghost" disabled={saving || !value} onClick={save}>{saving ? '…' : 'Salvar'}</button>
    </div>
  );
}

export function Vehicles({ revision, notify }: { revision: number; notify: Notify }) {
  const [month, setMonth] = useState(currentMonth());
  // `revision` muda a cada evento recebido no WebSocket → recarrega os saldos sem polling.
  const { data, loading, error, reload } = useAsync(() => api.listVehicles(month), [month, revision]);

  return (
    <div className="grid two">
      <Card title="Novo veículo">
        <VehicleForm onCreated={reload} notify={notify} />
      </Card>
      <Card title="Frota e cotas" actions={<input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />}>
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <ErrorBox message={error} onRetry={reload} />
        ) : !data?.length ? (
          <Empty>Nenhum veículo cadastrado.</Empty>
        ) : (
          <table>
            <thead>
              <tr><th>Placa</th><th>Modelo / Secretaria</th><th>Hodômetro</th><th>Saldo {month}</th><th>Definir cota</th></tr>
            </thead>
            <tbody>
              {data.map((v) => (
                <tr key={v.id}>
                  <td><strong>{v.plate}</strong><br /><small className="muted">{v.fuelType}</small></td>
                  <td>{v.model}<br /><small className="muted">{v.department}</small></td>
                  <td>{v.lastOdometerKm?.toLocaleString('pt-BR') ?? '—'} km</td>
                  <td>{v.quota ? <QuotaBar remaining={v.quota.remainingLiters} limit={v.quota.limitLiters} /> : <span className="muted">sem cota</span>}</td>
                  <td><QuotaEditor vehicleId={v.id} month={month} current={v.quota?.limitLiters} onSaved={reload} notify={notify} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
