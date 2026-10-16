import { createContext, memo, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from './api';
import { EmptyState, Message, Panel } from './components';
import { hasMetric, memoryBytes } from './format';
import { HISTORY_INTERVAL } from './monitoring';
import { HistoryRange, historyRanges, historyRows, TrendChart, type TrendRow } from './TrendChart';
import type { PlayerHistoryNode, TaskHistoryField } from './types';
import { resourceUrl, useData } from './workspace';

export const taskHistoryFields: TaskHistoryField[] = ['Online-Count', 'residentMemoryBytes', 'cpuCores'];
const fields = {
  'Online-Count': { name: '分钟平均在线人数', color: '#ea580c', format: (value: number | null | undefined) => hasMetric(value) ? `${value.toFixed(1)} 人` : '—' },
  residentMemoryBytes: { name: '进程内存合计', color: '#0891b2', format: memoryBytes },
  cpuCores: { name: 'CPU · 已用逻辑核', color: '#9333ea', format: (value: number | null | undefined) => hasMetric(value) ? `${value.toFixed(2)} 核` : '—' },
};
const series = Object.fromEntries(taskHistoryFields.map(key => [key, [{ key, ...fields[key] }]]));
const emptyRows: TrendRow[] = [];

/** Every configured node contributes; missing values remain gaps, never partial cluster totals. */
export function taskHistoryRows(nodes: PlayerHistoryNode[], tasks: string[], generatedAt: number, range: string,
  selectedFields: TaskHistoryField[] = taskHistoryFields, local = false) {
  const result = new Map<string, TrendRow[]>();
  for (const task of tasks) {
    const points = nodes.map(node => new Map((node.status === 'available' ? node.tasks?.[task]?.points ?? [] : [])
      .map(point => [point.time, point.values])));
    const rows = historyRows([], generatedAt, range);
    for (const row of rows) for (const field of selectedFields) {
      const values = points.map(node => node.get(row.time)?.[field]);
      if (values.length && values.every(value => value && hasMetric(value.average) && value.samples > 0)) {
        row.values[field] = {
          average: values.reduce((sum, value) => sum + value!.average, 0),
          samples: Math.min(...values.map(value => value!.samples)),
          // Peaks from different nodes are not simultaneous and must not be added.
          ...(local && values.length === 1 ? { peak: values[0]!.peak } : {}),
        };
      }
    }
    result.set(task, rows);
  }
  return result;
}

function useTaskHistory(tasks: string[], range: string, node: string) {
  const key = JSON.stringify([...new Set(tasks)].sort());
  const requestKey = JSON.stringify([key, range, node]);
  const loader = useCallback(async (signal: AbortSignal) => ({
    ...await api.taskHistory(JSON.parse(key), range, node, signal), requestKey,
  }), [key, range, node, requestKey]);
  const poll = useData(loader, HISTORY_INTERVAL, tasks.length > 0);
  const data = poll.data?.requestKey === requestKey ? poll.data : null;
  return useMemo(() => {
    const names = JSON.parse(key) as string[];
    const errors = data?.nodes.flatMap(entry => [entry.reason, entry.historyReason,
      ...Object.entries(entry.tasks ?? {}).map(([name, task]) => task.historyReason ? `${name}：${task.historyReason}` : '')]
      .filter(Boolean).map(reason => `${entry.nodeUniqueId}：${reason}`)) ?? [];
    return { rows: taskHistoryRows(data?.nodes ?? [], names, data?.generatedAt ?? Date.now(), range, taskHistoryFields, Boolean(node)),
      error: poll.error || [...new Set(errors)].join('；'), loading: names.length > 0 && !data && !poll.error, node };
  }, [key, range, node, data, poll.error]);
}
const Context = createContext<ReturnType<typeof useTaskHistory> | null>(null);

export function TaskHistoryProvider({ tasks, node = '', children }: { tasks: string[]; node?: string; children: ReactNode }) {
  const history = useTaskHistory(tasks, '15m', node);
  return <Context.Provider value={history}><Message>{history.error}</Message>{children}</Context.Provider>;
}

export const TaskSparkline = memo(function TaskSparkline({ task, field }: { task: string; field: TaskHistoryField }) {
  const history = useContext(Context)!;
  const rows = history.rows.get(task) ?? emptyRows;
  const params = new URLSearchParams({ range: '15m', ...(history.node ? { node: history.node } : {}) });
  return <Link className="service-sparkline" to={`${resourceUrl('tasks', task)}/monitor?${params}`}
    title={`${fields[field].name} · 最近 15 分钟${history.node ? ` · ${history.node}` : ''}`} aria-label={`查看 ${task} ${fields[field].name}`}>
    {rows.some(row => hasMetric(row.values[field]?.average)) ? <TrendChart rows={rows} series={series[field]}
      format={fields[field].format} compact showPeak={Boolean(history.node)} />
      : <span className="sparkline-empty">{history.loading ? '加载中' : history.error ? '历史不可用' : '暂无历史'}</span>}
  </Link>;
});

export function TaskMonitor({ task }: { task: string }) {
  const [params, setParams] = useSearchParams();
  const requested = params.get('range') || '1h';
  const range = historyRanges[requested] ? requested : '1h';
  const node = params.get('node') || '';
  const history = useTaskHistory([task], range, node);
  const rows = history.rows.get(task) ?? emptyRows;
  return <section className="metrics-section"><div className="metrics-heading"><h2>任务监控{node ? ` · ${node}` : ' · 全部节点'}</h2>
    <HistoryRange label="任务监控时间范围" value={range} /></div>
    {node && <button className="text-link" onClick={() => setParams(previous => { const next = new URLSearchParams(previous); next.delete('node'); return next; })}>查看全部节点</button>}
    <Message>{history.error}</Message>
    <p className="resource-note">显示分钟平均值。缺少必要节点或有效采样的分钟保留断点；资源历史从升级后开始积累。</p>
    {history.loading ? <EmptyState loading /> : <div className="trend-grid">{taskHistoryFields.map(field => <Panel key={field} title={fields[field].name} className="trend-panel">
      {rows.some(row => hasMetric(row.values[field]?.average)) ? <TrendChart rows={rows} series={series[field]} format={fields[field].format} showPeak={Boolean(node)} />
        : <EmptyState title="暂无完整有效采样" />}
    </Panel>)}</div>}
  </section>;
}
