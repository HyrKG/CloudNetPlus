import { HISTORY_INTERVAL } from './monitoring';
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { api } from './api';
import { useChartColors } from './charts';
import { EmptyState, Message, Panel } from './components';
import { hasMetric } from './format';
import { HistoryLegend, HistoryRange, historyRanges, historyRows, TrendChart } from './TrendChart';
import { taskHistoryRows } from './TaskHistory';
import { useData } from './workspace';

const countLabel = (value: number | null | undefined) => hasMetric(value) ? `${value.toFixed(1)} 人` : '—';
const natural = (a: string, b: string) => a.localeCompare(b, 'zh-CN', { numeric: true });

export function PlayerTrends() {
  const [params] = useSearchParams();
  const requested = params.get('playerRange') || '1h';
  const range = historyRanges[requested] ? requested : '1h';
  const loader = useCallback(async (signal: AbortSignal) => ({ ...await api.playerHistory(range, signal), range }), [range]);
  const history = useData(loader, HISTORY_INTERVAL);
  const data = history.data?.range === range ? history.data : null;
  const chart = useMemo(() => {
    const nodes = [...(data?.nodes ?? [])].sort((a, b) => natural(a.nodeUniqueId, b.nodeUniqueId));
    const tasks = [...new Set(nodes.flatMap(node => Object.keys(node.tasks ?? {})))].sort(natural);
    const rows = historyRows([], data?.generatedAt ?? Date.now(), range);
    const byTime = new Map(rows.map(row => [row.time, row]));
    for (const node of nodes) {
      if (node.status !== 'available') continue;
      for (const point of node.points ?? []) {
        const row = byTime.get(point.time);
        if (row) row.values[`node:${node.nodeUniqueId}`] = point.values['Online-Count'];
      }
    }
    const totals = taskHistoryRows(nodes, tasks, data?.generatedAt ?? Date.now(), range, ['Online-Count']);
    for (const [task, points] of totals) for (const point of points) {
      const row = byTime.get(point.time);
      if (row) row.values[`task:${task}`] = point.values['Online-Count'];
    }
    return { rows, nodes, tasks };
  }, [data, range]);
  const nodeIds = chart.nodes.map(node => node.nodeUniqueId);
  const color = useChartColors([...nodeIds.map(id => `node:${id}`), ...chart.tasks.map(name => `task:${name}`)]);
  const errors = chart.nodes.flatMap(node => [node.reason, node.historyReason,
    ...Object.entries(node.tasks ?? {}).filter(([, entry]) => entry.historyReason).map(([name, entry]) => `${name}：${entry.historyReason}`)]
    .filter(Boolean).map(reason => `${node.nodeUniqueId}：${reason}`));
  return <section className="metrics-section player-trends"><div className="metrics-heading"><div><h2>在线人数趋势</h2></div>
    <HistoryRange label="在线人数趋势时间范围" value={range} param="playerRange" /></div>
    <Message>{history.error || [...new Set(errors)].join('；')}</Message>
    {!data && !history.error ? <EmptyState loading /> : <div className="trend-grid">{[
      { title: '节点在线人数', prefix: 'node', ids: nodeIds, hiddenKey: 'hiddenPlayerNode' },
      { title: '任务组在线人数', prefix: 'task', ids: chart.tasks, hiddenKey: 'hiddenPlayerTask' },
    ].map(group => {
      const hidden = new Set(params.getAll(group.hiddenKey));
      const series = group.ids.filter(id => !hidden.has(id)).map(id => ({ key: `${group.prefix}:${id}`, name: id, color: color(`${group.prefix}:${id}`) }));
      const hasData = chart.rows.some(row => series.some(item => hasMetric(row.values[item.key]?.average)));
      return <Panel key={group.prefix} title={group.title} className="trend-panel">
        <HistoryLegend param={group.hiddenKey} className="player-trend-legend"
          items={group.ids.map(id => ({ key: id, name: id, color: color(`${group.prefix}:${id}`) }))} />
        {hasData ? <TrendChart rows={chart.rows} series={series} format={countLabel} showPeak={group.prefix === 'node'} />
          : <EmptyState title={group.ids.length && !series.length ? '请选择要显示的曲线' : '暂无有效人数历史'} />}
      </Panel>;
    })}</div>}
  </section>;
}
