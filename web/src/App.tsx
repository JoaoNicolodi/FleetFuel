import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveSocket } from './hooks/useLiveSocket';
import { Dashboard } from './pages/Dashboard';
import { Vehicles } from './pages/Vehicles';
import { Refuels } from './pages/Refuels';
import { Audit } from './pages/Audit';
import { Toasts, type ToastMsg } from './components/ui';

const TABS = [
  { id: 'dashboard', label: 'Painel ao vivo' },
  { id: 'vehicles', label: 'Frota e cotas' },
  { id: 'refuels', label: 'Abastecimentos' },
  { id: 'audit', label: 'Auditoria' },
] as const;
type TabId = (typeof TABS)[number]['id'];

const STATUS_TEXT = { open: 'Tempo real conectado', connecting: 'Conectando…', reconnecting: 'Reconectando…' };

export default function App() {
  const [tab, setTab] = useState<TabId>(() => (location.hash.slice(1) as TabId) || 'dashboard');
  const live = useLiveSocket();
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const seq = useRef(0);

  const notify = useCallback((text: string, tone: 'ok' | 'bad' = 'ok') => {
    seq.current += 1;
    setToasts((t) => [...t, { id: seq.current, text, tone }]);
  }, []);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  useEffect(() => {
    location.hash = tab;
  }, [tab]);

  // Alerta visual quando chega um abastecimento rejeitado em tempo real.
  const lastFeed = live.feed[0];
  const lastAlerted = useRef<string | null>(null);
  useEffect(() => {
    if (!lastFeed || lastFeed.eventId === lastAlerted.current || live.lastMessageAt === null) return;
    if (lastAlerted.current !== null && lastFeed.type === 'refuel.rejected') {
      notify(`⛔ Abastecimento rejeitado: ${lastFeed.payload.plate} — ${lastFeed.payload.reviewReason ?? ''}`, 'bad');
    }
    lastAlerted.current = lastFeed.eventId;
  }, [lastFeed, live.lastMessageAt, notify]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          ⛽ <strong>FleetFuel</strong> <span className="muted">Gestão de Abastecimento de Frotas Públicas</span>
        </div>
        <span className={`conn ${live.status}`} aria-live="polite">
          <i /> {STATUS_TEXT[live.status]}
        </span>
      </header>
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      {live.status !== 'open' && (
        <div className="banner">Sem conexão em tempo real. Os dados podem estar desatualizados — reconectando automaticamente.</div>
      )}
      <main>
        {tab === 'dashboard' && <Dashboard live={live} />}
        {tab === 'vehicles' && <Vehicles revision={live.revision} notify={notify} />}
        {tab === 'refuels' && <Refuels revision={live.revision} />}
        {tab === 'audit' && <Audit revision={live.revision} />}
      </main>
      <Toasts items={toasts} onDismiss={dismiss} />
    </div>
  );
}
