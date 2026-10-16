import { ChevronDown, LoaderCircle, Play, RefreshCw, Square, Terminal } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Button, EmptyState, StatusBadge } from './components';
import { memoryBytes, memoryMb, percent, serviceName, serviceTps } from './format';
import { metricReason, useFleet } from './fleet';
import { resourceUrl, useServiceOperations } from './workspace';
import { ServiceHistoryProvider, ServiceSparkline } from './ServiceHistory';
import { TaskHistoryProvider, TaskSparkline } from './TaskHistory';
import type { Configuration, ServiceOperation, ServiceSnapshot } from './types';

export const operationLabels: Record<ServiceOperation, string> = {
  start: '启动', stop: '停止', restart: '重启', kill: '强制终止', delete: '删除实例',
  includeTemplates: '应用待处理模板', includeInclusions: '应用待处理远程资源', deployResources: '部署资源',
};

function useServiceStop(service: ServiceSnapshot) {
  const { pending } = useServiceOperations();
  const local = pending[service.configuration.serviceId.uniqueId];
  const stop = service.webOperation ?? (local?.operation === 'stop' ? local : undefined);
  if (!stop) return null;
  const reason = stop.reason || (Date.now() - stop.submittedAt >= 60_000 ? '提交超过 60 秒，停止结果尚未确认；请查看后台或使用强制终止' : '停止请求已提交，等待实际状态确认');
  const unconfirmed = Boolean(stop.reason) || ('status' in stop && stop.status === 'unconfirmed') || Date.now() - stop.submittedAt >= 60_000;
  return { reason, label: unconfirmed ? '停止未确认' : '停止中', unconfirmed };
}

export function ServiceStatus({ service }: { service: ServiceSnapshot }) {
  const stop = useServiceStop(service);
  return stop ? <span className="status-badge status-stopping" title={stop.reason} aria-live="polite">
    {stop.unconfirmed ? <span className="status-dot" /> : <LoaderCircle size={12} className="spin" />}{stop.label}</span>
    : <StatusBadge value={service.lifeCycle} />;
}

export function ServiceActions({ service, onOperate, compact = false }:
  { service: ServiceSnapshot;
    onOperate: (id: string, operation: ServiceOperation) => void; compact?: boolean }) {
  const id = service.configuration.serviceId.uniqueId;
  const { pending } = useServiceOperations();
  const active = pending[id];
  const stop = useServiceStop(service);
  const running = service.lifeCycle === 'RUNNING';
  const startable = service.lifeCycle === 'PREPARED' || service.lifeCycle === 'STOPPED';
  const operation = running ? 'stop' : 'start';
  return <div className={`service-actions ${compact ? 'service-actions-compact' : ''}`}>
    <Button variant={compact ? 'secondary' : 'primary'} className={`${compact ? 'button-small' : ''} ${stop ? 'button-stopping' : ''}`}
      disabled={Boolean(active || stop) || (!running && !startable)}
      busy={stop ? !stop.unconfirmed : active?.operation === operation}
      title={stop?.reason || `${operationLabels[operation]}实例 · ${serviceName(service)}`}
      aria-label={`${stop?.label || operationLabels[operation]}实例 · ${serviceName(service)}`} onClick={() => onOperate(id, operation)}>
      {!stop && active?.operation !== operation && (running ? <Square size={13} /> : <Play size={13} />)}{stop?.label || operationLabels[operation]}
    </Button>
    <Button className={compact ? 'icon-button button-small' : ''} disabled={Boolean(active || stop) || !running}
      busy={active?.operation === 'restart'}
      aria-label={`重启实例 · ${serviceName(service)}`} title={`重启实例 · ${serviceName(service)}`} onClick={() => onOperate(id, 'restart')}>
      {active?.operation !== 'restart' && <RefreshCw size={14} />}{!compact && '重启'}
    </Button>
  </div>;
}

export function ServiceTable(props: Parameters<typeof ServiceRows>[0]) {
  return <ServiceHistoryProvider services={props.services}><ServiceRows {...props} /></ServiceHistoryProvider>;
}

function ServiceRows({ services, onSelect, onOperate, grouped = false }:
  { services: ServiceSnapshot[]; onSelect: (id: string) => void;
    onOperate?: (id: string, operation: ServiceOperation) => void; grouped?: boolean }) {
  const fleet = useFleet();
  return <div className="table-scroll"><table className="service-table compact-table"><thead><tr>
    <th>{grouped ? '服务器' : '服务器 / 任务'}</th><th>状态</th><th>节点</th><th>玩家 / 容量</th><th>TPS · 1 分钟</th><th>CPU · 占整机</th><th>进程内存</th><th>配置内存</th><th className="align-right">操作</th>
  </tr></thead><tbody>{services.map(service => {
    const id = service.configuration.serviceId;
    const metric = fleet.serviceMetric(service);
    const tps = serviceTps(service);
    const reason = service.lifeCycle !== 'RUNNING' ? '服务未运行' : metric?.reason || metricReason(fleet.nodeMetric(id.nodeUniqueId)) || (!metric ? '尚无进程采样' : '');
    return <tr key={id.uniqueId}>
      <td><button className="service-name" onClick={() => onSelect(id.uniqueId)}>
        <span className="service-icon"><Terminal size={17} /></span>
        <span><strong>{serviceName(service)}</strong></span>
      </button>{!grouped && <Link className="cell-secondary" to={resourceUrl('tasks', id.taskName)}>{id.taskName}</Link>}</td>
      <td><ServiceStatus service={service} /></td>
      <td><Link to={resourceUrl('nodes', id.nodeUniqueId)}>{id.nodeUniqueId}</Link></td>
      <td><div className="metric-trend"><Link className="player-count-link" to={`${resourceUrl('services', id.uniqueId)}?view=players`}>{fleet.servicePlayerLabel(service)}</Link>
        <ServiceSparkline service={service} field="Online-Count" /></div></td>
      <td className="metric-cell"><div className="metric-trend"><span title={tps.reason || '最近 1 分钟 TPS'}>{tps.values[0]}</span>
        <ServiceSparkline service={service} field="TPS-1m" /></div></td>
      <td className="metric-cell"><div className="metric-trend"><span title={reason}>{percent(metric?.cpuPercent)}</span>
        <ServiceSparkline service={service} field="cpuPercent" /></div></td>
      <td className="metric-cell"><div className="metric-trend"><span title={reason}>{memoryBytes(metric?.residentMemoryBytes)}</span>
        <ServiceSparkline service={service} field="residentMemoryBytes" /></div>
        <small className="cell-secondary">堆 {memoryBytes(service.lifeCycle === 'RUNNING' ? service.processSnapshot?.heapUsageMemory : null)}</small></td>
      <td>{memoryMb(service.configuration.processConfig?.maxHeapMemorySize)}</td>
      <td><div className="table-actions">{onOperate && <ServiceActions service={service}
        onOperate={onOperate} compact />}
        <Link className="button button-secondary button-small" to={`${resourceUrl('services', id.uniqueId)}?view=console`}><Terminal size={14} />后台</Link></div></td>
    </tr>;
  })}</tbody></table></div>;
}

export function GroupedServiceTable({ tasks, nodeId = '', filtered = false, actions, ...props }:
  Parameters<typeof ServiceTable>[0] & { tasks?: Configuration[]; nodeId?: string; filtered?: boolean;
    actions?: (task: Configuration) => ReactNode }) {
  const fleet = useFleet();
  const [params, setParams] = useSearchParams();
  const collapsed = new Set(params.getAll('collapsed'));
  const sort = params.get('sort') || 'name';
  const groups = new Map<string, ServiceSnapshot[]>();
  tasks?.forEach(task => groups.set(task.name, []));
  props.services.forEach(service => {
    const task = service.configuration.serviceId.taskName;
    if (!groups.has(task)) groups.set(task, []);
    groups.get(task)!.push(service);
  });
  const configurations = new Map((tasks ?? fleet.tasks.data ?? []).map(task => [task.name, task]));
  const value = (services: ServiceSnapshot[]) => sort === 'players' ? fleet.playerCount(services) ?? -1
    : sort === 'cpu' ? fleet.totals(services).cores ?? -1 : sort === 'memory' ? fleet.totals(services).memory ?? -1 : 0;
  const entries = [...groups].sort(([a, left], [b, right]) => value(right) - value(left) || a.localeCompare(b, 'zh-CN', { numeric: true }));
  const historyTasks = new Set(tasks ? entries.filter(([name, services]) => configurations.has(name)
    && services.length === (fleet.index.tasks.get(name) ?? []).filter(service => !nodeId
      || service.configuration.serviceId.nodeUniqueId === nodeId).length).map(([name]) => name) : []);
  function save(next: Set<string>) {
    setParams(previous => { const result = new URLSearchParams(previous); result.delete('collapsed');
      [...next].forEach(name => result.append('collapsed', name)); return result; }, { replace: true });
  }
  return <TaskHistoryProvider tasks={[...historyTasks]} node={nodeId}>
    <ServiceHistoryProvider services={props.services.filter(service => !collapsed.has(service.configuration.serviceId.taskName))}>
    <div className="service-groups"><div className="group-controls"><span>{entries.length} 个任务组</span>
    <Button variant="ghost" className="button-small" onClick={() => save(new Set())}>全部展开</Button>
    <Button variant="ghost" className="button-small" onClick={() => save(new Set([...collapsed, ...groups.keys()]))}>全部折叠</Button></div>
    {entries.map(([name, services]) => {
      const hidden = collapsed.has(name);
      const task = configurations.get(name);
      const total = fleet.totals(services);
      const itemValue = (service: ServiceSnapshot) => sort === 'cpu' ? fleet.serviceMetric(service)?.cpuPercent ?? -1 : value([service]);
      const ordered = [...services].sort((a, b) => itemValue(b) - itemValue(a) || serviceName(a).localeCompare(serviceName(b), 'zh-CN', { numeric: true }));
      return <section className="service-group" key={name}><div className={`service-group-heading ${tasks ? 'task-group-heading' : ''}`}>
        <div className="group-identity"><button className="group-toggle" aria-expanded={!hidden}
          aria-label={`${hidden ? '展开' : '折叠'}任务 ${name}`} onClick={() => {
          const next = new Set(collapsed); hidden ? next.delete(name) : next.add(name); save(next);
        }}><ChevronDown size={16} className={hidden ? 'collapsed' : ''} /></button>
          <div className="group-title">{task ? <Link title={name} to={resourceUrl('tasks', name)}>{name}</Link> : <strong title={name}>{name}</strong>}
            <small>{services.filter(item => item.lifeCycle === 'RUNNING').length} / {services.length} 运行
              {tasks && task && <> · 集群最低数量 {task.minServiceCount ?? 0}{task.maintenance && ' · 维护中'}</>}
              {tasks && !task && ' · 无任务配置'}{filtered && ' · 筛选范围'}</small></div></div>
        <div className="group-summary"><div><span>在线 / 容量</span><strong>{fleet.playerLabel(services)}</strong>
          {historyTasks.has(name) && <TaskSparkline task={name} field="Online-Count" />}</div>
          <div><span>进程内存</span><strong>{memoryBytes(total.memory)}</strong>
            {historyTasks.has(name) && <TaskSparkline task={name} field="residentMemoryBytes" />}</div>
          {tasks && <div><span>CPU · 逻辑核</span><strong>{total.cores === null ? '—' : total.cores.toFixed(2)}</strong>
            {historyTasks.has(name) && <TaskSparkline task={name} field="cpuCores" />}</div>}</div>
        {task && actions && <div className="group-actions">{actions(task)}</div>}</div>
        {!hidden && (ordered.length ? <ServiceRows {...props} services={ordered} grouped /> : <EmptyState title="暂无实例" />)}</section>;
  })}{!entries.length && <EmptyState title="暂无匹配的任务或实例" />}</div></ServiceHistoryProvider></TaskHistoryProvider>;
}

