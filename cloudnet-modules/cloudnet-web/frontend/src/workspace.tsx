import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigationType } from 'react-router';
import { api, ApiError, errorMessage, isUnauthorized } from './api';
import { Button, Dialog, Message, useNotice } from './components';
import { usePolling } from './usePolling';
import { LIVE_INTERVAL, RESOURCE_INTERVAL } from './monitoring';
import type { NodeMetrics, ServiceOperation, ServiceSnapshot } from './types';

export const WorkspaceContext = createContext({ onUnauthorized: () => {}, refreshToken: 0 });
export const useWorkspace = () => useContext(WorkspaceContext);

type Poll = ReturnType<typeof usePolling<unknown>>;
const DataContext = createContext(new Map<unknown, Poll>());
const FleetIndexContext = createContext({ metrics: new Map<string, NodeMetrics>(),
  servers: new Map<string, Set<string>>(), proxies: new Map<string, Set<string>>(),
  tasks: new Map<string, ServiceSnapshot[]>(), nodes: new Map<string, ServiceSnapshot[]>() });
export const useFleetIndex = () => useContext(FleetIndexContext);
export { useNotice } from './components';

interface PendingServiceOperation { operation: ServiceOperation; submittedAt: number; settledAt?: number; reason?: string; pid?: number }
const ServiceOperationsContext = createContext({
  pending: {} as Record<string, PendingServiceOperation>,
  run: async (_id: string, _operation: ServiceOperation): Promise<boolean> => false,
});
export const useServiceOperations = () => useContext(ServiceOperationsContext);

function useServiceOperationState(services: ReturnType<typeof usePolling<ServiceSnapshot[]>>) {
  const { onUnauthorized } = useWorkspace();
  const notify = useNotice();
  const pending = useRef<Record<string, PendingServiceOperation>>({});
  const [state, setState] = useState(pending.current);
  const requests = useRef(new Map<string, AbortController>());
  const publish = () => setState({ ...pending.current });
  useEffect(() => () => { requests.current.forEach(request => request.abort()); }, []);
  useEffect(() => {
    // A successful read alone does not confirm a stop: wait for server tracking or a terminal lifecycle.
    let changed = false;
    Object.entries(pending.current).forEach(([id, entry]) => {
      const service = services.data?.find(value => value.configuration.serviceId.uniqueId === id);
      const pid = service?.processSnapshot?.pid;
      if (entry.settledAt !== undefined && services.requestedAt >= entry.settledAt
        && (!service || service.webOperation || ['STOPPED', 'PREPARED', 'DELETED'].includes(service.lifeCycle)
          || service.lifeCycle === 'RUNNING' && entry.pid && entry.pid > 0 && pid && pid > 0 && pid !== entry.pid)) {
        delete pending.current[id]; changed = true;
      }
    });
    if (changed) publish();
  }, [services.requestedAt, services.data]);
  async function run(id: string, operation: ServiceOperation) {
    const service = services.data?.find(service => service.configuration.serviceId.uniqueId === id);
    const stopping = pending.current[id]?.operation === 'stop' || service?.webOperation;
    if (requests.current.has(id) || (stopping && ['start', 'stop', 'restart'].includes(operation))) return false;
    const controller = new AbortController();
    requests.current.set(id, controller);
    const entry: PendingServiceOperation = { operation, submittedAt: Date.now(), pid: service?.processSnapshot?.pid };
    pending.current[id] = entry; publish();
    try {
      await api.operate(id, operation, controller.signal);
      if (controller.signal.aborted) return false;
      notify(operation === 'stop' ? '停止请求已提交，等待实际状态确认。' : '操作已提交，实际状态以实例信息为准。');
      return true;
    } catch (cause) {
      if (controller.signal.aborted) return false;
      if (isUnauthorized(cause)) onUnauthorized();
      else notify(errorMessage(cause), [], 'error');
      entry.reason = '停止结果未确认，正在重新读取实际状态';
      if (cause instanceof ApiError && (cause.operationPending === false || [400, 401, 403, 404].includes(cause.status))) delete pending.current[id];
      return false;
    } finally {
      requests.current.delete(id);
      if (!controller.signal.aborted) {
        if (operation === 'stop') entry.settledAt = performance.now();
        else delete pending.current[id];
        publish(); services.refresh();
      }
    }
  }
  return { pending: state, run };
}

export function DataProvider({ children }: { children: ReactNode }) {
  const { onUnauthorized, refreshToken } = useWorkspace();
  const services = usePolling(api.services, LIVE_INTERVAL, onUnauthorized, refreshToken);
  const serviceOperations = useServiceOperationState(services);
  const nodes = usePolling(api.nodes, LIVE_INTERVAL, onUnauthorized, refreshToken);
  const players = usePolling(api.players, LIVE_INTERVAL, onUnauthorized, refreshToken);
  const metrics = usePolling(api.metrics, RESOURCE_INTERVAL, onUnauthorized, refreshToken);
  const tasks = usePolling(api.tasks, RESOURCE_INTERVAL, onUnauthorized, refreshToken);
  const metricIndex = useMemo(() => new Map(metrics.data?.nodes.map(node => [node.nodeUniqueId, node])), [metrics.data]);
  const playerIndex = useMemo(() => {
    const index = (key: 'server' | 'proxy') => {
      const result = new Map<string, Set<string>>();
      players.data?.forEach(player => {
        const id = player[key]?.uniqueId;
        if (!id) return;
        if (!result.has(id)) result.set(id, new Set());
        result.get(id)!.add(player.uniqueId);
      });
      return result;
    };
    return { servers: index('server'), proxies: index('proxy') };
  }, [players.data]);
  const serviceIndex = useMemo(() => {
    const index = (key: 'taskName' | 'nodeUniqueId') => {
      const result = new Map<string, ServiceSnapshot[]>();
      services.data?.forEach(service => {
        const id = service.configuration.serviceId[key];
        if (!result.has(id)) result.set(id, []);
        result.get(id)!.push(service);
      });
      return result;
    };
    return { tasks: index('taskName'), nodes: index('nodeUniqueId') };
  }, [services.data]);
  const index = useMemo(() => ({ metrics: metricIndex, ...playerIndex, ...serviceIndex }), [metricIndex, playerIndex, serviceIndex]);
  const entries: [unknown, Poll][] = [[api.services, services], [api.nodes, nodes], [api.players, players],
    [api.metrics, metrics], [api.tasks, tasks]];
  return <ServiceOperationsContext.Provider value={serviceOperations}><DataContext.Provider value={new Map(entries)}><FleetIndexContext.Provider value={index}>{children}</FleetIndexContext.Provider></DataContext.Provider></ServiceOperationsContext.Provider>;
}

export function useData<T>(loader: (signal: AbortSignal) => Promise<T>, interval = LIVE_INTERVAL, enabled = true) {
  const { onUnauthorized, refreshToken } = useWorkspace();
  const cached = useContext(DataContext).get(loader) as ReturnType<typeof usePolling<T>> | undefined;
  const local = usePolling(loader, interval, onUnauthorized, refreshToken, !cached && enabled);
  return cached ?? local;
}

export function ScrollMemory() {
  const location = useLocation();
  const navigation = useNavigationType();
  const positions = useRef(new Map<string, number>());
  const previousPath = useRef(location.pathname);
  useEffect(() => {
    const key = location.pathname + location.search;
    const changedPage = previousPath.current !== location.pathname;
    const restoredPosition = positions.current.get(key) ?? 0;
    previousPath.current = location.pathname;
    const frame = requestAnimationFrame(() => {
      if (navigation === 'POP') window.scrollTo(0, restoredPosition);
      else if (changedPage) window.scrollTo(0, 0);
    });
    const remember = () => positions.current.set(key, window.scrollY);
    remember();
    window.addEventListener('scroll', remember, { passive: true });
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', remember); };
  }, [location.pathname, location.search, navigation]);
  return null;
}

export function useOperation() {
  const { onUnauthorized } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const clearError = useCallback(() => setError(''), []);
  const notify = useNotice();
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function run<T>(action: (signal: AbortSignal) => Promise<T>, success?: (value: T) => void,
    message = '操作已提交。') {
    if (controller.current && !controller.current.signal.aborted) return;
    const request = new AbortController();
    controller.current = request;
    setBusy(true); setError('');
    try {
      const value = await action(request.signal);
      if (!request.signal.aborted) { if (message) notify(message); success?.(value); }
    } catch (cause) {
      if (request.signal.aborted) return;
      if (isUnauthorized(cause)) onUnauthorized();
      else setError(errorMessage(cause));
    } finally {
      if (!request.signal.aborted) { controller.current = null; setBusy(false); }
    }
  }
  return { busy, error, run, clearError };
}

export function Feedback({ operation }: { operation: { error: string } }) {
  return <Message>{operation.error}</Message>;
}

export function Tabs({ items }: { items: { to: string; label: string; end?: boolean }[] }) {
  return <nav className="resource-tabs" aria-label="详情导航">{items.map(item =>
    <NavLink key={item.to} to={item.to} end={item.end}
      className={({ isActive }) => isActive ? 'resource-tab active' : 'resource-tab'}>{item.label}</NavLink>)}</nav>;
}

export function Confirm({ title, children, busy, onCancel, onConfirm, error }:
  { title: string; children: ReactNode; busy: boolean; onCancel: () => void; onConfirm: () => void; error?: string }) {
  return <Dialog title={title} onClose={() => { if (!busy) onCancel(); }}>
    <div className="detail-body"><p>{children}</p><Message>{error}</Message>
      <div className="form-actions"><Button data-dialog-focus onClick={onCancel} disabled={busy}>取消</Button>
        <Button variant="primary" onClick={onConfirm} busy={busy}>确认操作</Button></div></div>
  </Dialog>;
}

export const resourceUrl = (kind: string, id: string) => `/${kind}/${encodeURIComponent(id)}`;
