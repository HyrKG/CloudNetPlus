import { HISTORY_INTERVAL } from './monitoring';
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { api } from './api';
import { useChartColors } from './charts';
import { EmptyState, Message, Panel } from './components';
import { fresh, useFleet } from './fleet';
import { byteRate, hasMetric, memoryBytes, percent } from './format';
import type { HistoryField } from './types';
import { HistoryLegend, HistoryRange, historyRows, historyRanges as ranges, TrendChart } from './TrendChart';
import { useData } from './workspace';

const fields: { title: string; fields: HistoryField[]; labels: string[]; percent: boolean }[] = [
  { title: '节点 CPU', fields: ['cpuPercent'], labels: ['CPU'], percent: true },
  { title: '节点内存', fields: ['memoryPercent'], labels: ['内存'], percent: true },
  { title: '磁盘 IO', fields: ['diskReadBytesPerSecond', 'diskWriteBytesPerSecond'], labels: ['读取', '写入'], percent: false },
  { title: '网络 IO', fields: ['networkReceiveBytesPerSecond', 'networkSendBytesPerSecond'], labels: ['接收', '发送'], percent: false },
];

export function MetricsTrends() {
  const fleet = useFleet();
  const [params, setParams] = useSearchParams();
  const node = params.get('node') || '';
  const range = params.get('range') || '1h';
  const selectedRange = ranges[range] ? range : '1h';
  const requestKey = `${node}:${selectedRange}`;
  const loader = useCallback(async (signal: AbortSignal) => ({ ...await api.metricsHistory(node, selectedRange, signal),
    requestKey: `${node}:${selectedRange}` }), [node, selectedRange]);
  const history = useData(loader, HISTORY_INTERVAL);
  const data = history.data?.requestKey === requestKey ? history.data : null;
  const nodes = (fleet.nodes.data ?? []).map(item => item.node.uniqueId).filter(id => !node || id === node);
  if (node && !nodes.includes(node)) nodes.push(node);
  const color = useChartColors(nodes);
  const hidden = new Set(params.getAll('hiddenNode'));
  const shown = nodes.filter(id => !hidden.has(id));
  function set(key: string, value: string) {
    setParams(previous => { const next = new URLSearchParams(previous); value ? next.set(key, value) : next.delete(key); return next; }, { replace: true });
  }
  const rows = useMemo(() => {
    const result = new Map(historyRows([], data?.generatedAt ?? Date.now(), selectedRange).map(row => [row.time, row]));
    for (const entry of data?.nodes ?? []) {
      for (const point of entry.points ?? []) {
        const row = result.get(point.time);
        if (row) for (const [field, value] of Object.entries(point.values)) row.values[`${entry.nodeUniqueId}:${field}`] = value;
      }
    }
    return [...result.values()];
  }, [data, selectedRange]);
  const reasons = (data?.nodes ?? []).filter(entry => nodes.includes(entry.nodeUniqueId))
    .map(entry => (entry.reason || entry.historyReason) ? `${entry.nodeUniqueId}：${entry.reason || entry.historyReason}` : '').filter(Boolean);

  return <section className="metrics-section"><div className="metrics-heading"><div><h2>资源趋势</h2></div>
    <div className="filter-selects"><select aria-label="趋势节点" value={node} onChange={event => set('node', event.target.value)}>
      <option value="">全部节点</option>{Array.from(new Set([...(fleet.nodes.data ?? []).map(item => item.node.uniqueId), ...(node ? [node] : [])]))
        .map(id => <option key={id}>{id}</option>)}</select>
      <HistoryRange label="趋势时间范围" value={selectedRange} /></div></div>
    <Message>{history.error || reasons.join('；')}</Message>
    <HistoryLegend param="hiddenNode" items={nodes.map(id => ({ key: id, name: id, color: color(id) }))} />
    {!data && !history.error ? <EmptyState loading /> : <div className="trend-grid">{fields.map(chart => {
      const series = shown.flatMap(id => chart.fields.map((field, index) => ({ key: `${id}:${field}`, id, field, index, name: `${id} · ${chart.labels[index]}` })));
      const hasData = rows.some(row => series.some(item => hasMetric(row.values[item.key]?.average)));
      const format = chart.percent ? percent : byteRate;
      return <Panel key={chart.title} title={chart.title} className="trend-panel" action={chart.fields.length > 1
        ? <span className="line-style-legend">实线：{chart.labels[0]} · 虚线：{chart.labels[1]}</span> : undefined}>
        {hasData ? <TrendChart rows={rows} series={series.map(item => ({ ...item, color: color(item.id), dashed: Boolean(item.index) }))}
          format={format} maximum={chart.percent ? 100 : undefined} extra={(row, item) => {
            const source = series.find(value => value.key === item.key)!;
            return source.field === 'memoryPercent' ? <small>{memoryBytes(row.values[`${source.id}:usedMemoryBytes`]?.average)} / {memoryBytes(row.values[`${source.id}:totalMemoryBytes`]?.average)}</small> : null;
          }} /> : <EmptyState title={shown.length ? '暂无有效历史采样' : '请选择要显示的节点'} />}
      </Panel>;
    })}</div>}
    <details className="sampling-devices"><summary>采集设备与当前 IO · 网络包含节点间通信</summary>
      {nodes.map(id => { const metric = fleet.nodeMetric(id); const live = fresh(metric) ? metric : undefined;
        return <div key={id}><strong>{id}</strong><span>磁盘：{metric?.diskDevices?.join('、') || '未采集'} · 读 {byteRate(live?.diskReadBytesPerSecond)} / 写 {byteRate(live?.diskWriteBytesPerSecond)} {metric?.diskReason}</span>
          <span>网卡：{metric?.networkInterfaces?.join('、') || '未采集'} · 收 {byteRate(live?.networkReceiveBytesPerSecond)} / 发 {byteRate(live?.networkSendBytesPerSecond)} {metric?.networkReason}</span></div>;
      })}</details>
  </section>;
}
