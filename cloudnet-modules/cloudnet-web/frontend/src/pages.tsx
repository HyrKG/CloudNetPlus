import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Maximize2, Minimize2 } from 'lucide-react';
import { Button, EmptyState, PageHeading, Panel } from './components';
import { FleetErrors, fresh, NodeTable, Summary, TaskTable, useFleet } from './fleet';
import { Donut, topSlices, useChartColors, type Slice } from './charts';
import { hasMetric, lifecycleLabels, memoryBytes, memoryMb, percent } from './format';
import { MetricsTrends } from './MetricsTrends';
import { PlayerTrends } from './PlayerTrends';
import { resourceUrl } from './workspace';

export function OverviewPage() {
  const fleet = useFleet();
  const [params, setParams] = useSearchParams();
  const big = params.get('display') === 'wall';
  useEffect(() => {
    if (!big) return;
    const exit = (event: KeyboardEvent) => { if (event.key === 'Escape') setParams(previous => { const next = new URLSearchParams(previous); next.delete('display'); return next; }, { replace: true }); };
    window.addEventListener('keydown', exit);
    return () => window.removeEventListener('keydown', exit);
  }, [big, setParams]);
  const live = (fleet.metrics.data?.nodes ?? []).filter(fresh);
  const measured = live.filter(item => hasMetric(item.cpuPercent) && item.logicalCpuCount > 0);
  const cores = measured.reduce((sum, item) => sum + item.logicalCpuCount, 0);
  const cpu = cores ? measured.reduce((sum, item) => sum + item.cpuPercent * item.logicalCpuCount, 0) / cores : null;
  const sum = (field: 'usedMemoryBytes' | 'totalMemoryBytes' | 'availableMemoryBytes' | 'runningConfiguredMemoryMb' | 'maxMemoryMb') =>
    live.length ? live.reduce((total, item) => total + item[field], 0) : null;
  const playerTasks = new Map<string, number>();
  if (!fleet.players.error) for (const player of new Map((fleet.players.data ?? []).map(item => [item.uniqueId, item])).values()) {
    const name = player.server?.taskName;
    if (name) playerTasks.set(name, (playerTasks.get(name) ?? 0) + 1);
  }
  const memoryTasks = new Map<string, number>();
  const states = new Map<string, Slice>();
  for (const service of fleet.services.data ?? []) {
    const state = service.lifeCycle;
    const stateColors = { DEFINED: '#9333ea', PREPARED: '#2563eb', RUNNING: '#16a34a', STOPPED: '#ea580c', DELETED: '#8b8b93' };
    states.set(state, { id: state, name: lifecycleLabels[state], value: (states.get(state)?.value ?? 0) + 1, color: stateColors[state] });
    if (service.lifeCycle !== 'RUNNING') continue;
    const memory = fleet.serviceMetric(service)?.residentMemoryBytes;
    const name = service.configuration.serviceId.taskName;
    if (hasMetric(memory)) memoryTasks.set(name, (memoryTasks.get(name) ?? 0) + memory);
  }
  const slices = (map: Map<string, number>) => topSlices([...map].map(([name, value]) => ({ id: name, name, value, to: resourceUrl('tasks', name) })));
  const players = slices(playerTasks);
  const memory = slices(memoryTasks);
  const color = useChartColors([...players, ...memory].filter(item => item.id !== '__other').map(item => item.id));
  const colors = (items: Slice[]) => items.map(item => ({ ...item, color: item.color ?? color(item.id) }));
  return <><PageHeading title="运行概览" actions={<Button onClick={() => setParams(previous => {
    const next = new URLSearchParams(previous); big ? next.delete('display') : next.set('display', 'wall'); return next;
  }, { replace: true })}>{big ? <Minimize2 size={16} /> : <Maximize2 size={16} />}{big ? '退出大屏' : '大屏'}</Button>} />
    <FleetErrors sources={[fleet.services, fleet.nodes, fleet.tasks, fleet.players, fleet.metrics]} />
    <Summary items={[
      { label: '全网在线玩家', value: fleet.players.data && !fleet.players.error ? new Set(fleet.players.data.map(player => player.uniqueId)).size : '—' },
      { label: '运行 / 总实例', value: fleet.services.data ? `${fleet.services.data.filter(service => service.lifeCycle === 'RUNNING').length} / ${fleet.services.data.length}` : '—' },
      { label: '在线 / 总节点', value: fleet.nodes.data ? `${fleet.nodes.data.filter(node => node.nodeInfoSnapshot && Date.now() - node.nodeInfoSnapshot.creationTime < 15000).length} / ${fleet.nodes.data.length}` : '—' },
      { label: '整机 CPU · 核数加权', value: percent(cpu) },
      { label: '物理内存 · 已用 / 总量', value: `${memoryBytes(sum('usedMemoryBytes'))} / ${memoryBytes(sum('totalMemoryBytes'))}` },
      { label: '物理可用内存', value: memoryBytes(sum('availableMemoryBytes')) },
      { label: '运行配置 / 配置上限', value: `${memoryMb(sum('runningConfiguredMemoryMb'))} / ${memoryMb(sum('maxMemoryMb'))}` },
    ]} />
    <MetricsTrends />
    <PlayerTrends />
    <div className="overview-distributions"><Donut title="玩家分布 · 服务器任务" items={colors(players)} format={value => `${value} 人`} />
      <Donut title="进程内存 · 任务分布" items={colors(memory)} format={memoryBytes} />
      <Donut title="实例状态" items={[...states.values()]} format={value => `${value} 台`} /></div>
    <Panel title="任务运行" action={<Link to="/tasks">全部任务 →</Link>}>
      {fleet.tasks.data?.length ? <TaskTable tasks={fleet.tasks.data} /> : <EmptyState loading={fleet.tasks.loading} title="暂无任务" />}
    </Panel>
    <Panel title="节点资源" action={<Link to="/nodes">全部节点 →</Link>}>
      {fleet.nodes.data?.length ? <NodeTable nodes={fleet.nodes.data} /> : <EmptyState loading={fleet.nodes.loading} title="暂无节点" />}
    </Panel>
  </>;
}

