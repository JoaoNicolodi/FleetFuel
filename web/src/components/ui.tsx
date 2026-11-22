import { useEffect, type ReactNode } from 'react';
import type { RefuelStatus } from '../api/types';

export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="card">
      {(title || actions) && (
        <header className="card-head">
          {title && <h2>{title}</h2>}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function Kpi({ label, value, tone }: { label: string; value: string | number; tone?: 'ok' | 'warn' | 'bad' }) {
  return (
    <div className={`kpi ${tone ?? ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

const STATUS_LABEL: Record<RefuelStatus, string> = { ACCEPTED: 'Aceito', FLAGGED: 'Revisar', REJECTED: 'Rejeitado' };

export function StatusBadge({ status }: { status: RefuelStatus }) {
  return <span className={`badge ${status.toLowerCase()}`}>{STATUS_LABEL[status]}</span>;
}

export function Loading({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div className="state">
      <span className="spinner" /> {label}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state error" role="alert">
      ⚠️ {message}
      {onRetry && (
        <button className="btn ghost" onClick={onRetry}>
          Tentar novamente
        </button>
      )}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="state muted">{children}</div>;
}

export function QuotaBar({ remaining, limit }: { remaining: number; limit?: number }) {
  if (!limit) return <span className="muted">{remaining.toLocaleString('pt-BR')} L restantes</span>;
  const usedPct = Math.min(100, Math.max(0, ((limit - remaining) / limit) * 100));
  const tone = usedPct >= 90 ? 'bad' : usedPct >= 70 ? 'warn' : 'ok';
  return (
    <div className="quota" title={`${usedPct.toFixed(0)}% usado`}>
      <div className="quota-track">
        <div className={`quota-fill ${tone}`} style={{ width: `${usedPct}%` }} />
      </div>
      <small>
        {remaining.toLocaleString('pt-BR')} / {limit.toLocaleString('pt-BR')} L
      </small>
    </div>
  );
}

export type ToastMsg = { id: number; text: string; tone: 'ok' | 'bad' };

export function Toasts({ items, onDismiss }: { items: ToastMsg[]; onDismiss: (id: number) => void }) {
  useEffect(() => {
    if (items.length === 0) return;
    const t = setTimeout(() => onDismiss(items[0]!.id), 4000);
    return () => clearTimeout(t);
  }, [items, onDismiss]);
  return (
    <div className="toasts">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`} onClick={() => onDismiss(t.id)}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
