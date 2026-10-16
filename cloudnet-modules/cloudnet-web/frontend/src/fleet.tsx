import { Link } from 'react-router';
import type { ReactNode } from 'react';
import { Donut, topSlices, useChartColors } from './charts';
import { api } from './api';
import { EmptyState, Message, Meter, Panel } from './components';
import { hasMetric, memoryBytes, memoryMb, percent, serviceName, timeLabel } from './format';
import type { ClusterEntry, Configuration, NodeMetrics, OnlinePlayer, ServiceSnapshot } from './types';
import { resourceUrl, useData, useFleetIndex } from './workspace';
import { TaskHistoryProvider, TaskSparkline } from './TaskHistory';
import { METRIC_MAX_AGE, RESOURCE_INTERVAL } from './monitoring';

export const isProxy = (service: ServiceSnapshot) => ['BUNGEECORD', 'VELOCITY', 'WATERDOG', 'WATERDOG_PE']
  .includes(service.configuration.serviceId.environment);
export const fresh = (node?: NodeMetrics) => node?.status === 'available' && Date.now() - node.sampledAt <= METRIC_MAX_AGE;
export const metricReason = (node?: NodeMetrics) => !node ? '尚无资源采样' : node.status !== 'available'
  ? node.reason || '采集不可用' : !fresh(node) ? `资源采样已过期 · ${timeLabel(new Date(node.sampledAt))}`
    : !hasMetric(node.cpuPercent) ? 'CPU 正在采样' : '';
export const playersFor = (players: OnlinePlayer[], services: ServiceSnapshot[]) => {
  const servers = new Set(services.filter(service => !isProxy(service)).map(service => service.configuration.serviceId.uniqueId));
  const proxies = new Set(services.filter(isProxy).map(service => service.configuration.serviceId.uniqueId));
  return Array.from(new Map(players.filter(player => servers.has(player.server?.uniqueId ?? '')
    || proxies.has(player.proxy?.uniqueId ?? '')).map(player => [player.uniqueId, player])).values());
};

export function playerCapacity(services: ServiceSnapshot[]) {
  let total = 0;
  for (const service of services) {
    if (service.lifeCycle !== 'RUNNING') continue;
    const value = service.properties?.['Max-Players'];
    if (!Number.isFinite(service.creationTime) || Date.now() - service.creationTime > METRIC_MAX_AGE
      || typeof value !== 'number' || !hasMetric(value) || !Number.isInteger(value)) return null;
    total += value;
  }
  return total;
}

export function useFleet() {
  const services = useData(api.services);
  const nodes = useData(api.nodes);
  const tasks = useData(api.tasks, RESOURCE_INTERVAL);
  const players = useData(api.players);
  const metrics = useData(api.metrics);
  const index = useFleetIndex();
  const nodeMetric = (id: string) => index.metrics.get(id);
  const serviceMetric = (service: ServiceSnapshot) => {
    const node = nodeMetric(service.configuration.serviceId.nodeUniqueId);
    return service.lifeCycle === 'RUNNING' && fresh(node) ? node?.services[service.configuration.serviceId.uniqueId] : undefined;
  };
  const playerCount = (items: ServiceSnapshot[]) => {
    if (!players.data || players.error) return null;
    const ids = new Set<string>();
    items.forEach(service => (isProxy(service) ? index.proxies : index.servers)
      .get(service.configuration.serviceId.uniqueId)?.forEach(id => ids.add(id)));
    return ids.size;
  };
  const playerLabel = (items: ServiceSnapshot[]) => {
    if (!services.data || services.error) return '—/—';
    const running = items.filter(item => item.lifeCycle === 'RUNNING');
    return `${running.length ? playerCount(running) ?? '—' : 0}/${playerCapacity(running) ?? '—'}`;
  };
  const servicePlayerLabel = (service: ServiceSnapshot) =>
    `${playerCount([service]) ?? '—'}/${service.lifeCycle === 'RUNNING' ? playerCapacity([service]) ?? '—' : '—'}`;
  const totals = (items: ServiceSnapshot[]) => {
    if (!services.data || services.error) return { memory: null, cores: null };
    const running = items.filter(item => item.lifeCycle === 'RUNNING');
    const memory = running.map(item => serviceMetric(item)?.residentMemoryBytes);
    const cpu = running.map(item => {
      const value = serviceMetric(item)?.cpuPercent;
      const cores = nodeMetric(item.configuration.serviceId.nodeUniqueId)?.logicalCpuCount;
      return hasMetric(value) && hasMetric(cores) && cores > 0 ? value * cores / 100 : undefined;
    });
    return { memory: memory.every(hasMetric) ? memory.reduce((a, b) => a + b, 0) : null,
      cores: cpu.every(hasMetric) ? cpu.reduce((a, b) => a + b, 0) : null };
  };
  return { services, nodes, tasks, players, metrics, index, nodeMetric, serviceMetric, playerCount, playerLabel, servicePlayerLabel, totals };
}

export function FleetErrors({ sources }: { sources: { error: string }[] }) {
  return <>{Array.from(new Set(sources.map(source => source.error).filter(Boolean))).map(error => <Message key={error}>{error}</Message>)}</>;
}

export function Summary({ items }: { items: { label: string; value: ReactNode; hint?: string; detail?: ReactNode }[] }) {
  return <div className="summary-strip">{items.map(item => <div key={item.label} title={item.hint}>
    <span>{item.label}</span><strong>{item.value}</strong>{item.detail}</div>)}</div>;
}

export function ServiceSummary({ services }: { services: ServiceSnapshot[] }) {
  const fleet = useFleet();
  const total = fleet.totals(services);
  return <Summary items={[
    { label: '运行 / 总实例', value: fleet.services.data ? `${services.filter(service => service.lifeCycle === 'RUNNING').length} / ${services.length}` : '—' },
    { label: '在线 / 容量', value: fleet.playerLabel(services) },
    { label: '进程内存合计', value: fleet.services.data ? memoryBytes(total.memory) : '—' },
    { label: 'CPU · 已用逻辑核', value: !fleet.services.data || total.cores === null ? '—' : total.cores.toFixed(2) },
  ]} />;
}

export function TaskTable({ tasks, nodeId, actions }: { tasks: Configuration[]; nodeId?: string; actions?: (task: Configuration) => ReactNode }) {
  const fleet = useFleet();
  return <TaskHistoryProvider tasks={tasks.map(task => task.name)} node={nodeId}><div className="table-scroll"><table className="service-table compact-table"><thead><tr>
    <th>任务</th><th>运行 / 总数</th><th>最低数量</th><th>玩家 / 容量</th><th>进程内存</th><th>CPU · 逻辑核</th><th>部署节点</th><th>状态</th><th />
  </tr></thead><tbody>{tasks.map(task => {
    const instances = (fleet.index.tasks.get(task.name) ?? []).filter(service => !nodeId || service.configuration.serviceId.nodeUniqueId === nodeId);
    const total = fleet.totals(instances);
    const deployed = Array.from(new Set(instances.map(item => item.configuration.serviceId.nodeUniqueId)));
    return <tr key={task.name}><td><Link className="resource-name" to={resourceUrl('tasks', task.name)}>{task.name}</Link></td>
      <td>{fleet.services.data ? `${instances.filter(item => item.lifeCycle === 'RUNNING').length} / ${instances.length}` : '—'}</td>
      <td>{task.minServiceCount ?? 0}</td>
      <td><div className="metric-trend"><span>{fleet.playerLabel(instances)}</span><TaskSparkline task={task.name} field="Online-Count" /></div></td>
      <td><div className="metric-trend"><span>{fleet.services.data ? memoryBytes(total.memory) : '—'}</span><TaskSparkline task={task.name} field="residentMemoryBytes" /></div></td>
      <td><div className="metric-trend"><span>{fleet.services.data && total.cores !== null ? total.cores.toFixed(2) : '—'}</span><TaskSparkline task={task.name} field="cpuCores" /></div></td>
      <td><div className="inline-links">{deployed.length ? deployed.map(id => <Link key={id} to={resourceUrl('nodes', id)}>{id}</Link>) : '—'}</div></td>
      <td>{task.maintenance ? '维护中' : '正常'}</td><td>{actions ? actions(task) : <Link to={resourceUrl('tasks', task.name)}>查看实例 →</Link>}</td></tr>;
  })}</tbody></table></div></TaskHistoryProvider>;
}

export function NodeTable({ nodes }: { nodes: ClusterEntry[] }) {
  const fleet = useFleet();
  return <div className="table-scroll"><table className="service-table compact-table"><thead><tr>
    <th>节点</th><th>CPU · 整机</th><th>系统已用 / 总内存</th><th>可用内存</th><th>运行配置 / 上限</th><th>实例 / 玩家</th><th />
  </tr></thead><tbody>{nodes.map(entry => {
    const id = entry.node.uniqueId;
    const metric = fleet.nodeMetric(id);
    const live = fresh(metric) ? metric : undefined;
    const instances = fleet.index.nodes.get(id) ?? [];
    return <tr key={id}><td><Link className="resource-name" to={resourceUrl('nodes', id)}>{id}</Link>
      <small className="cell-secondary">{metricReason(metric) || `更新于 ${timeLabel(new Date(metric!.sampledAt))}`}</small></td>
      <td>{percent(live?.cpuPercent)}<Meter value={live?.cpuPercent} /></td>
      <td>{memoryBytes(live?.usedMemoryBytes)} / {memoryBytes(live?.totalMemoryBytes)}
        <Meter value={live?.usedMemoryBytes} max={live?.totalMemoryBytes} /></td>
      <td>{memoryBytes(live?.availableMemoryBytes)}</td>
      <td>{memoryMb(live?.runningConfiguredMemoryMb)} / {memoryMb(live?.maxMemoryMb)}
        <small className="cell-secondary">预留 {memoryMb(live?.reservedMemoryMb)}</small></td>
      <td>{fleet.services.data ? instances.length : '—'} / {fleet.services.data ? fleet.playerCount(instances) ?? '—' : '—'}</td>
      <td><Link to={`${resourceUrl('nodes', id)}/console`}>后台</Link></td></tr>;
  })}</tbody></table></div>;
}

export function capacity(task: Configuration, node?: NodeMetrics) {
  const memory = task.processConfiguration?.maxHeapMemorySize;
  if (!fresh(node) || !node || !hasMetric(memory) || memory <= 0 || !hasMetric(node.cpuPercent)
    || !hasMetric(node.maxCpuPercent) || !hasMetric(node.availableMemoryBytes)
    || !hasMetric(node.maxMemoryMb) || !hasMetric(node.runningConfiguredMemoryMb)) return null;
  if (node.cpuPercent >= node.maxCpuPercent) return 0;
  // The node's start check is strictly less than maxMemory, including on an exact multiple.
  return Math.max(0, Math.ceil((node.maxMemoryMb - node.runningConfiguredMemoryMb) / memory) - 1);
}

export function CapacityTable({ task, nodeId = '', count }: { task: Configuration; nodeId?: string; count?: number }) {
  const fleet = useFleet();
  const nodes = (fleet.nodes.data ?? []).filter(entry => nodeId ? entry.node.uniqueId === nodeId
    : !task.associatedNodes?.length || task.associatedNodes.includes(entry.node.uniqueId));
  const requested = (task.processConfiguration?.maxHeapMemorySize ?? 0) * (count ?? 0);
  return <Panel title={count === undefined ? '扩容参考 · 可调度节点' : `启动预估 · 新增配置 ${memoryMb(requested)}`}>
    <FleetErrors sources={[fleet.nodes, fleet.metrics]} />
    {nodes.length ? <div className="table-scroll"><table className="service-table compact-table"><thead><tr>
      <th>节点</th>{count === undefined && <><th>本任务实例 / 玩家</th><th>本任务内存 / CPU 核</th></>}<th>CPU / 启动阈值</th><th>物理可用</th><th>运行配置 / 上限</th><th>预留额度</th><th>配置最多可新增</th>{count !== undefined && <th>启动后配置</th>}
    </tr></thead><tbody>{nodes.map(entry => {
      const metric = fleet.nodeMetric(entry.node.uniqueId);
      const live = fresh(metric) ? metric : undefined;
      const limit = capacity(task, metric);
      const instances = (fleet.index.tasks.get(task.name) ?? []).filter(service => service.configuration.serviceId.nodeUniqueId === entry.node.uniqueId);
      const total = fleet.totals(instances);
      return <tr key={entry.node.uniqueId}><td><Link to={resourceUrl('nodes', entry.node.uniqueId)}>{entry.node.uniqueId}</Link>
        <small className="cell-secondary">{metricReason(metric)}</small></td>
        {count === undefined && <><td>{fleet.services.data ? instances.length : '—'} / {fleet.services.data ? fleet.playerCount(instances) ?? '—' : '—'}</td>
          <td>{fleet.services.data ? memoryBytes(total.memory) : '—'} / {fleet.services.data && total.cores !== null ? total.cores.toFixed(2) : '—'}</td></>}
        <td>{percent(live?.cpuPercent)} / {percent(live?.maxCpuPercent)}</td><td>{memoryBytes(live?.availableMemoryBytes)}</td>
        <td>{memoryMb(live?.runningConfiguredMemoryMb)} / {memoryMb(live?.maxMemoryMb)}</td><td>{memoryMb(live?.reservedMemoryMb)}</td>
        <td>{limit === null ? '—' : `${limit} 台`}</td>{count !== undefined && <td>{live ? memoryMb(live.runningConfiguredMemoryMb + requested) : '—'}
          {limit !== null && count > limit && <small className="error-text cell-secondary">超出当前配置启动额度</small>}
          {live && requested * 1048576 > live.availableMemoryBytes && <small className="error-text cell-secondary">物理可用内存不足配置需求</small>}</td>}</tr>;
    })}</tbody></table></div> : <EmptyState loading={fleet.nodes.loading} title="暂无可调度节点" />}
    <p className="resource-note">实际承载能力受进程开销和玩家负载影响。
      {count !== undefined && !nodeId && '自动调度时，表中为单节点预估。'}</p>
  </Panel>;
}

export function ResourceCharts({ services }: { services: ServiceSnapshot[] }) {
  const fleet = useFleet();
  const running = services.filter(service => service.lifeCycle === 'RUNNING');
  const charts = (['cpuPercent', 'residentMemoryBytes'] as const).map(field => {
    const known = running.flatMap(service => {
      const value = fleet.serviceMetric(service)?.[field];
      return hasMetric(value) ? [{ name: serviceName(service), id: service.configuration.serviceId.uniqueId, value,
        to: resourceUrl('services', service.configuration.serviceId.uniqueId) }] : [];
    });
    return { field, data: topSlices(known) };
  });
  const color = useChartColors(charts.flatMap(chart => chart.data.filter(item => item.id !== '__other').map(item => item.id)));
  return <div className="resource-charts">{charts.map(({ field, data }) => {
    return <Donut key={field} title={field === 'cpuPercent' ? '服务 CPU 占比' : '服务进程内存占比'}
      items={data.map(item => ({ ...item, color: item.color ?? color(item.id) }))}
      format={field === 'cpuPercent' ? percent : memoryBytes} />;
  })}</div>;
}
