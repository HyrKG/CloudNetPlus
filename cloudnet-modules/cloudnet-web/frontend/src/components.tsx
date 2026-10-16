import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Check, Cloud, Inbox, Info, LoaderCircle, Moon, Sun, X } from 'lucide-react';
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

export function ThemeToggle({ dark, onToggle }: { dark: boolean; onToggle: () => void }) {
  const label = dark ? '切换至浅色模式' : '切换至深色模式';
  return <Button variant="ghost" className="icon-button" onClick={onToggle} aria-label={label} title={label}>
    {dark ? <Sun size={18} /> : <Moon size={18} />}
  </Button>;
}

type MessageKind = 'error' | 'success' | 'info';
interface Notification { id: string; text: ReactNode; kind: MessageKind; details?: string[]; version?: string; onDismiss?: () => void }
const NotificationContext = createContext({
  show: (_notification: Notification) => {},
  remove: (_id: string) => {},
  attachDialog: (_element: HTMLDialogElement): (() => void) => () => {},
});
export const useNotifications = () => useContext(NotificationContext);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<Notification[]>([]);
  const dialogs = useRef<HTMLDialogElement[]>([]);
  const [portal] = useState(() => document.createElement('div'));
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    if (!portal.isConnected) document.body.append(portal);
    return () => { mounted.current = false; portal.remove(); };
  }, [portal]);
  const dismissed = useRef(new Map<string, string | undefined>());
  const show = useCallback((item: Notification) => {
    if (dismissed.current.has(item.id) && dismissed.current.get(item.id) === item.version) return;
    setMessages(current => {
      const previous = current.find(value => value.id === item.id);
      if (previous && previous.version === item.version) return current;
      return previous ? current.map(value => value.id === item.id ? item : value) : [...current, item];
    });
  }, []);
  const remove = useCallback((id: string) => {
    dismissed.current.delete(id);
    setMessages(current => current.filter(item => item.id !== id));
  }, []);
  const attachDialog = useCallback((element: HTMLDialogElement) => {
    dialogs.current.push(element);
    element.append(portal);
    return () => {
      dialogs.current = dialogs.current.filter(dialog => dialog !== element);
      if (mounted.current) (dialogs.current[dialogs.current.length - 1] ?? document.body).append(portal);
    };
  }, [portal]);
  const context = useMemo(() => ({ show, remove, attachDialog }), [show, remove, attachDialog]);
  const sameMessage = (a: Notification, b: Notification) => a.id === b.id || (a.id.startsWith('message:')
    && b.id.startsWith('message:') && a.kind === b.kind && a.text === b.text);
  const visible = messages.filter((item, index) => messages.findIndex(other => sameMessage(item, other)) === index);
  return <NotificationContext.Provider value={context}>{children}{createPortal(
    <aside className="notification-stack" aria-label="页面消息">{visible.map(item =>
      <NotificationCard key={item.id} item={item} onClose={() => {
        messages.filter(other => sameMessage(item, other)).forEach(other => {
          if (other.version !== undefined) dismissed.current.set(other.id, other.version);
          other.onDismiss?.();
        });
        setMessages(current => current.filter(other => !sameMessage(item, other)));
      }} />)}</aside>, portal)}
  </NotificationContext.Provider>;
}

function NotificationCard({ item, onClose }: { item: Notification; onClose: () => void }) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (item.kind !== 'success' || item.details?.length || typeof item.text !== 'string') return;
    const timer = window.setTimeout(() => close.current(), 6000);
    return () => window.clearTimeout(timer);
  }, [item]);
  const Icon = item.kind === 'error' ? AlertCircle : item.kind === 'success' ? Check : Info;
  return <div className={`message message-${item.kind}`} role={item.kind === 'error' ? 'alert' : 'status'}>
    <Icon size={17} /><div className="notification-content">{item.text}
      {!!item.details?.length && <details><summary>查看未提交原因（{item.details.length}）</summary>
        <ul>{item.details.map((detail, index) => <li key={index}>{detail}</li>)}</ul></details>}
    </div><Button variant="ghost" className="icon-button notification-close" onClick={onClose} aria-label="关闭消息">
      <X size={16} /></Button>
  </div>;
}

export function useNotice() {
  const { show } = useContext(NotificationContext);
  const prefix = useId();
  const sequence = useRef(0);
  return useCallback((text: ReactNode, details: string[] = [], kind?: MessageKind) => {
    show({ id: `${prefix}:${++sequence.current}`, text, kind: kind ?? (details.length ? 'info' : 'success'), details });
  }, [show, prefix]);
}

export function Message({ children, kind = 'error' }: { children?: string | null; kind?: MessageKind }) {
  const id = `message:${useId()}`;
  const { show, remove } = useContext(NotificationContext);
  useEffect(() => {
    if (children) show({ id, text: children, kind, version: `${kind}:${children}` });
    else remove(id);
  }, [id, children, kind, show, remove]);
  useEffect(() => () => remove(id), [id, remove]);
  return null;
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

export function Dialog({ title, onClose, children, placement = 'center' }:
  { title: string; onClose: () => void; children: ReactNode; placement?: 'center' | 'right' }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const backdropPointer = useRef<number | null>(null);
  const backdropClick = useRef(false);
  const { attachDialog } = useContext(NotificationContext);
  useEffect(() => {
    const element = ref.current!;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const menu = active?.closest('details');
    const trigger = menu && !menu.open ? menu.querySelector('summary') : active;
    element.showModal();
    element.querySelector<HTMLElement>('[data-dialog-focus]')?.focus({ preventScroll: true });
    const detach = attachDialog(element);
    return () => { detach(); element.close(); if (trigger?.isConnected) trigger.focus({ preventScroll: true }); };
  }, [attachDialog]);
  return <dialog ref={ref} className={`detail-dialog ${placement === 'right' ? 'detail-drawer' : ''}`} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onPointerDown={event => {
      backdropClick.current = false;
      backdropPointer.current = event.button === 0 && event.target === event.currentTarget ? event.pointerId : null;
    }}
    onPointerCancel={() => { backdropPointer.current = null; backdropClick.current = false; }}
    onPointerUp={event => {
      backdropClick.current = event.pointerId === backdropPointer.current && event.target === event.currentTarget;
      backdropPointer.current = null;
    }}
    onClick={event => {
      if (backdropClick.current && event.target === event.currentTarget) onClose();
      backdropClick.current = false;
    }}>
    <div className="dialog-content"><header className="dialog-heading">
      <div><span className="eyebrow">CloudNet 运维</span><h2 id={titleId}>{title}</h2></div>
      <Button variant="ghost" className="icon-button" onClick={onClose} aria-label="关闭对话框" autoFocus>
        <X size={20} />
      </Button>
    </header>{children}</div>
  </dialog>;
}

export function MoreMenu({ label = '更多', icon, children }: { label?: string; icon?: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: Event) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target) && ref.current) ref.current.open = false;
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('focusin', closeOutside);
    return () => { document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('focusin', closeOutside); };
  }, [open]);
  return <details className="more-menu" ref={ref} onToggle={event => setOpen(event.currentTarget.open)} onKeyDown={event => {
    if (event.key === 'Escape' && ref.current?.open) {
      event.stopPropagation(); ref.current.open = false; ref.current.querySelector('summary')?.focus();
    }
  }}><summary className={`button button-secondary ${icon ? 'icon-button button-small' : ''}`} title={label} aria-label={label}>
    {icon ?? label}</summary><div onClick={event => {
      if (event.target instanceof Element && event.target.closest('button:not(:disabled), a') && ref.current) ref.current.open = false;
    }}>{children}</div></details>;
}
