import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { AlertCircle, Check, Cloud, Inbox, LoaderCircle, X } from 'lucide-react';
import { hasMetric, lifecycleLabels } from './format';
import type { LifeCycle } from './types';

export function Brand() {
  return <span className="brand"><span className="brand-mark"><Cloud size={22} strokeWidth={2.2} /></span>
    <span>CloudNet<span className="brand-suffix"> / web</span></span></span>;
}

export function Button({ children, variant = 'secondary', className = '', busy, disabled, ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost'; busy?: boolean }) {
  return <button type="button" {...props} disabled={disabled || busy}
    className={`button button-${variant} ${className}`} aria-busy={busy || undefined}>
    {busy && <LoaderCircle size={15} className="spin" />}{children}
  </button>;
}

export function Message({ children, kind = 'error' }: { children: ReactNode; kind?: 'error' | 'success' }) {
  if (!children) return null;
  return <div className={`message message-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
    {kind === 'error' ? <AlertCircle size={17} /> : <Check size={17} />}<span>{children}</span>
  </div>;
}

export function EmptyState({ loading = false, title = '暂无数据', description }:
  { loading?: boolean; title?: string; description?: string }) {
  return <div className="empty-state" role="status">
    {loading ? <LoaderCircle size={25} className="spin" /> : <Inbox size={26} />}
    <strong>{loading ? '加载中…' : title}</strong>
    {!loading && description && <span>{description}</span>}
  </div>;
}

export function StatusBadge({ value }: { value: LifeCycle }) {
  return <span className={`status-badge status-${value.toLowerCase()}`}>
    <span className="status-dot" />{lifecycleLabels[value]}
  </span>;
}

export function Meter({ value, max = 100 }: { value: number | null | undefined; max?: number | null }) {
  const valid = hasMetric(value) && hasMetric(max) && max > 0;
  const width = valid ? Math.min(100, value / max * 100) : 0;
  return <span className={`meter ${!valid ? 'meter-unavailable' : ''}`} aria-hidden="true">
    <span style={{ width: `${width}%` }} /></span>;
}

export function PageHeading({ title, actions, children }:
  { title: string; actions?: ReactNode; children?: ReactNode }) {
  return <div className="page-heading"><div><h1>{title}</h1>
    {children && <div className="page-heading-meta">{children}</div>}</div>{actions}</div>;
}

export function Panel({ title, action, children, className = '' }:
  { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`panel ${className}`}><div className="panel-heading">
    <h2>{title}</h2>{action}
  </div>{children}</section>;
}

export function Dialog({ title, onClose, children }:
  { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = ref.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return <dialog ref={ref} className="detail-dialog" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="dialog-content"><header className="dialog-heading">
      <div><span className="eyebrow">服务详情</span><h2 id={titleId}>{title}</h2></div>
      <Button variant="ghost" className="icon-button" onClick={onClose} aria-label="关闭服务详情" autoFocus>
        <X size={20} />
      </Button>
    </header>{children}</div>
  </dialog>;
}
