import { HISTORY_INTERVAL } from './monitoring';
import { createContext, memo, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from './api';
import { EmptyState, Message, Panel } from './components';
import { hasMetric, memoryBytes, percent } from './format';
import { HistoryLegend, HistoryRange, historyRanges, historyRows, TrendChart, type TrendRow } from './TrendChart';
import type { ServiceHistoryField, ServiceHistoryResponse, ServiceSnapshot } from './types';
import { resourceUrl, useData } from './workspace';

interface HistoryState {
  ids: Set<string>;
  range: string;
  data: ServiceHistoryResponse | null;
  error: string;
  loading: boolean;
  rows: Map<string, TrendRow[]>;
  reasons: Map<string, string>;
}
const HistoryContext = createContext<HistoryState | null>(null);
const fields: Record<ServiceHistoryField, { name: string; color: string; format: (value: number | null | undefined) => string }> = {
  'TPS-1m': { name: 'TPS · 1 分钟', color: '#2563eb', format: value => hasMetric(value) ? value.toFixed(2) : '—' },
  'TPS-5m': { name: 'TPS · 5 分钟', color: '#ea580c', format: value => hasMetric(value) ? value.toFixed(2) : '—' },
  'TPS-15m': { name: 'TPS · 15 分钟', color: '#16a34a', format: value => hasMetric(value) ? value.toFixed(2) : '—' },
  cpuPercent: { name: 'CPU · 占整机', color: '#9333ea', format: percent },
  residentMemoryBytes: { name: '进程内存', color: '#0891b2', format: memoryBytes },
  'Online-Count': { name: '分钟平均在线人数', color: '#ea580c', format: value => hasMetric(value) ? `${value.toFixed(1)} 人` : '—' },
};
const charts: { title: string; fields: ServiceHistoryField[]; maximum?: number }[] = [
  { title: 'TPS', fields: ['TPS-1m', 'TPS-5m', 'TPS-15m'], maximum: 20 },
  { title: 'CPU', fields: ['cpuPercent'], maximum: 100 },
  { title: '进程内存', fields: ['residentMemoryBytes'] },
  { title: '在线人数', fields: ['Online-Count'] },
];
const sparkSeries = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, [{ key, ...value }]]));
const emptyRows: TrendRow[] = [];

function useServiceHistory(ids: string[], range: string) {
  const shared = useContext(HistoryContext);
  const cached = shared?.range === range && ids.every(id => shared.ids.has(id)) ? shared : null;
  const idKey = [...new Set(ids)].sort().join(',');
  const requestKey = `${range}:${idKey}`;
  const loader = useCallback(async (signal: AbortSignal) => {
    const result = idKey ? await api.serviceHistory(idKey.split(','), range, signal)
      : { nodes: [], generatedAt: Date.now(), from: 0, to: 0, step: 60000 };
    return { ...result, requestKey: `${range}:${idKey}` };
  }, [idKey, range]);
  const poll = useData(loader, HISTORY_INTERVAL, !cached && Boolean(idKey));
  const data = poll.data?.requestKey === requestKey ? poll.data : null;
  const local = useMemo(() => {
    const rows = new Map<string, TrendRow[]>();
    const reasons = new Map<string, string>();
    for (const node of data?.nodes ?? []) {
      const reason = poll.error || node.reason || node.historyReason;
      if (reason) reasons.set(node.nodeUniqueId, reason);
      for (const [id, entry] of Object.entries(node.services ?? {})) {
        rows.set(id, historyRows(entry.points, data!.generatedAt, range));
        if (entry.historyReason) reasons.set(id, entry.historyReason);
      }
    }
    return { ids: new Set(idKey ? idKey.split(',') : []), range, data, error: poll.error,
      loading: Boolean(idKey) && !data && !poll.error, rows, reasons };
  }, [idKey, range, data, poll.error]);
  return cached ?? local;
}

function historyFor(history: HistoryState, service: ServiceSnapshot) {
  const id = service.configuration.serviceId;
  const reason = history.error || history.reasons.get(id.nodeUniqueId) || history.reasons.get(id.uniqueId);
  return { rows: history.rows.get(id.uniqueId) ?? emptyRows, reason: reason ? `${id.nodeUniqueId}：${reason}` : '' };
}

export function ServiceHistoryProvider({ services, children }: { services: ServiceSnapshot[]; children: ReactNode }) {
  const history = useServiceHistory(services.map(service => service.configuration.serviceId.uniqueId), '15m');
  const reasons = [...new Set(services.map(service => historyFor(history, service).reason).filter(Boolean))];
  return <HistoryContext.Provider value={history}><Message>{reasons.join('；')}</Message>{children}</HistoryContext.Provider>;
}

export const ServiceSparkline = memo(function ServiceSparkline({ service, field }: { service: ServiceSnapshot; field: ServiceHistoryField }) {
  const history = useContext(HistoryContext)!;
  const { rows, reason } = historyFor(history, service);
  const config = fields[field];
  const hasData = rows.some(row => hasMetric(row.values[field]?.average));
  return <Link className="service-sparkline" to={`${resourceUrl('services', service.configuration.serviceId.uniqueId)}/monitor?range=15m`}
    aria-label={`查看${config.name}监控`} title={reason || `${config.name} · 最近 15 分钟 · 点击查看监控`}>
    {hasData ? <TrendChart rows={rows} series={sparkSeries[field]} format={config.format}
      maximum={field === 'cpuPercent' ? 100 : field.startsWith('TPS-') ? 20 : undefined} compact />
      : <span className="sparkline-empty">{history.loading ? '加载中' : reason ? '历史不可用' : '暂无历史'}</span>}
  </Link>;
});

export function ServiceMonitor({ service }: { service: ServiceSnapshot }) {
  const [params] = useSearchParams();
  const range = params.get('range') || '1h';
  const selectedRange = historyRanges[range] ? range : '1h';
  const history = useServiceHistory([service.configuration.serviceId.uniqueId], selectedRange);
  const { rows, reason } = historyFor(history, service);
  const hidden = new Set(params.getAll('hiddenTps'));
  return <section className="metrics-section service-monitor"><div className="metrics-heading"><div><h2>服务器监控</h2></div>
    <HistoryRange label="服务器监控时间范围" value={selectedRange} /></div>
    <Message>{reason}</Message>
    {history.loading ? <EmptyState loading /> : <div className="trend-grid">{charts.map(chart => {
      const series = chart.fields.filter(field => chart.fields.length === 1 || !hidden.has(field)).map(field => ({ key: field, ...fields[field] }));
      const hasData = rows.some(row => series.some(item => hasMetric(row.values[item.key]?.average)));
      return <Panel key={chart.title} title={chart.title} className="trend-panel">
        {chart.fields.length > 1 && <HistoryLegend param="hiddenTps" className="monitor-legend"
          items={chart.fields.map(field => ({ key: field, ...fields[field] }))} />}
        {hasData ? <TrendChart rows={rows} series={series} format={fields[chart.fields[0]].format} maximum={chart.maximum} />
          : <EmptyState title={series.length ? '暂无有效历史采样' : '请选择 TPS 曲线'} />}
      </Panel>;
    })}</div>}
  </section>;
}
