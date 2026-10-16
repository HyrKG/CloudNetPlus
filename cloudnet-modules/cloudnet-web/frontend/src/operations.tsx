import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Plus, Search } from 'lucide-react';
import { api } from './api';
import { Button, Dialog, EmptyState, Message, Meter, MoreMenu, PageHeading, Panel, useNotice } from './components';
import { Console } from './Console';
import { ServiceHistoryProvider, ServiceMonitor, ServiceSparkline } from './ServiceHistory';
import { addressLabel, lifecycleLabels, memoryBytes, memoryMb, percent, serviceName, serviceTps } from './format';
import { CapacityTable, FleetErrors, fresh, metricReason, NodeTable, ResourceCharts, Summary, TaskTable, useFleet } from './fleet';
import { PlayersPage } from './players';
import { operationLabels, ServiceActions, ServiceStatus, GroupedServiceTable } from './services';
import type { ConsoleType, ServiceOperation } from './types';
import { Confirm, Feedback, resourceUrl, Tabs, useData, useOperation, useServiceOperations } from './workspace';
import { ConfigurationPage } from './configuration';
import { TaskActions } from './TaskActions';

export function LaunchServices({ task = '', node = '', onClose, onCreated }:
  { task?: string; node?: string; onClose: () => void; onCreated?: () => void }) {
  const tasks = useData(api.tasks, 30000);
  const nodes = useData(api.nodes, 30000);
  const [selectedTask, setTask] = useState(task);
  const [selectedNode, setNode] = useState(node);
  const [count, setCount] = useState(1);
  const selectedConfig = tasks.data?.find(item => item.name === selectedTask);
  const notify = useNotice();
  const operation = useOperation();
  function submit(event: FormEvent) {
    event.preventDefault();
    void operation.run(signal => api.createServices(selectedTask, count, selectedNode, signal), value => {
      const submitted = value.results.filter(result => result.success).length;
      notify(<><strong>临时启动 · 已提交 {submitted} / {value.results.length} 台</strong>
        <p>已创建并提交启动，实际状态以实例详情为准。</p>
        <div className="inline-links">{value.results.map((result, index) => result.service &&
          <Link key={index} to={resourceUrl('services', result.service.configuration.serviceId.uniqueId)}>{serviceName(result.service)}</Link>)}</div></>,
      value.results.flatMap((result, index) => result.success ? [] : [`第 ${index + 1} 台：${result.reason || '创建失败'}`]));
      onCreated?.(); onClose();
    }, '');
  }
  return <Dialog title="临时启动服务" onClose={() => { if (!operation.busy) onClose(); }}>
    <form className="detail-body" onSubmit={submit}><p className="field-hint">按现有任务配置创建并启动实例，不修改最低数量或永久关联节点。</p>
      <Message>{tasks.error || nodes.error || operation.error}</Message>
      <fieldset className="configuration-fields form-grid" disabled={operation.busy}>
        <label>所属任务<select required value={selectedTask} onChange={event => setTask(event.target.value)}>
          <option value="">选择任务</option>{Array.from(new Set([...(tasks.data?.map(item => item.name) ?? []), ...(task ? [task] : [])]))
            .map(name => <option key={name}>{name}</option>)}</select></label>
        <label>运行节点<select value={selectedNode} onChange={event => setNode(event.target.value)}>
          <option value="">自动调度</option>{Array.from(new Set([...(nodes.data?.map(item => item.node.uniqueId) ?? []), ...(node ? [node] : [])]))
            .map(id => <option key={id}>{id}</option>)}</select></label>
        <label>实例数量<input type="number" min={1} step={1} required value={count} onChange={event => setCount(Number(event.target.value))} /></label>
      </fieldset>
      {selectedConfig && <CapacityTable task={selectedConfig} nodeId={selectedNode} count={count} />}
      <div className="form-actions"><Button onClick={onClose} disabled={operation.busy}>关闭</Button>
        <Button type="submit" variant="primary" busy={operation.busy} disabled={!selectedTask || count < 1}>启动 {count} 台</Button></div>
    </form></Dialog>;
}

function AddNode({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [id, setId] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState(1410);
  const operation = useOperation();
  return <Dialog title="加入集群节点" onClose={() => { if (!operation.busy) onClose(); }}><form className="detail-body" onSubmit={event => {
    event.preventDefault(); void operation.run(signal => api.addNode(id, host, port, signal), () => { onAdded(); onClose(); });
  }}><Message>{operation.error}</Message><div className="form-grid">
      <label>节点 ID<input required value={id} onChange={event => setId(event.target.value)} /></label>
      <label>节点地址<input required value={host} placeholder="例如 192.168.1.20" onChange={event => setHost(event.target.value)} /></label>
      <label>集群端口<input type="number" min={1} max={65535} required value={port} onChange={event => setPort(Number(event.target.value))} /></label>
    </div>
    <div className="form-actions"><Button onClick={onClose} disabled={operation.busy}>取消</Button>
      <Button type="submit" variant="primary" busy={operation.busy}>加入节点</Button></div></form></Dialog>;
}

export function NodesList() {
  const poll = useData(api.nodes);
  const fleet = useFleet();
  const [adding, setAdding] = useState(false);
  return <><PageHeading title="节点管理" actions={<Button variant="primary" onClick={() => setAdding(true)}><Plus size={16} />加入节点</Button>}>
    <span>{poll.data?.length ?? '—'} 个节点</span></PageHeading><Message>{poll.error}</Message>
    <FleetErrors sources={[fleet.services, fleet.metrics, fleet.players]} />
    {poll.loading ? <EmptyState loading /> : poll.data?.length ? <Panel title="节点资源"><NodeTable nodes={poll.data} /></Panel> : <EmptyState title="暂无节点" />}
    {adding && <AddNode onClose={() => setAdding(false)} onAdded={poll.refresh} />}</>;
}

export function NodePage() {
  const { id = '', tab = '' } = useParams();
  const fleet = useFleet();
  const { nodes, services, tasks } = fleet;
  const navigate = useNavigate();
  const [launch, setLaunch] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const operation = useOperation();
  const node = nodes.data?.find(entry => entry.node.uniqueId === id);
  const base = resourceUrl('nodes', id);
  const metric = fleet.nodeMetric(id);
  const live = fresh(metric) ? metric : undefined;
  const instances = services.data?.filter(service => service.configuration.serviceId.nodeUniqueId === id) ?? [];
  const associatedTasks = tasks.data?.filter(task => instances.some(service => service.configuration.serviceId.taskName === task.name)
    || !task.associatedNodes?.length || task.associatedNodes.includes(id)) ?? [];
  return <><PageHeading title={id} actions={<div className="heading-actions"><Button variant="primary" onClick={() => setLaunch(true)}>临时启动</Button>
    <MoreMenu><button onClick={() => setConfirm(true)} disabled={!node}>移除节点</button></MoreMenu>
    </div>}><Link to="/nodes">节点</Link></PageHeading>
    <Tabs items={[{ to: base, label: '资源与实例', end: true }, { to: `${base}/tasks`, label: '任务' }, { to: `${base}/console`, label: '控制台' }]} />
    <FleetErrors sources={[nodes, services, tasks, fleet.metrics, fleet.players]} /><Feedback operation={operation} />
    {!node ? <EmptyState loading={nodes.loading} title="节点不存在" /> : <>
      <Summary items={[
        { label: 'CPU · 整机', value: percent(live?.cpuPercent), hint: `${live?.logicalCpuCount ?? '—'} 个逻辑 CPU`, detail: <Meter value={live?.cpuPercent} /> },
        { label: '系统已用 / 总内存', value: `${memoryBytes(live?.usedMemoryBytes)} / ${memoryBytes(live?.totalMemoryBytes)}`, detail: <Meter value={live?.usedMemoryBytes} max={live?.totalMemoryBytes} /> },
        { label: '物理可用', value: memoryBytes(live?.availableMemoryBytes) },
        { label: '运行配置 / 上限', value: `${memoryMb(live?.runningConfiguredMemoryMb)} / ${memoryMb(live?.maxMemoryMb)}`, detail: <small>预留 {memoryMb(live?.reservedMemoryMb)}</small> },
        { label: '实例 / 玩家', value: services.data ? `${instances.length} / ${fleet.playerCount(instances) ?? '—'}` : '—' },
      ]} />
      {metricReason(metric) && <p className="sampling-note">{metricReason(metric)}</p>}
      {tab === 'console' ? <Console key={`node/${id}`} type="node" id={id} />
        : tab === 'tasks' ? <Panel title="已部署及可调度任务"><TaskTable tasks={associatedTasks} nodeId={id} /></Panel>
        : <><ResourceCharts services={instances} /><Panel title="节点实例">
          {instances.length ? <GroupedServiceTable services={instances} onSelect={uuid => navigate(resourceUrl('services', uuid))} />
            : <EmptyState loading={services.loading} title="暂无实例" />}</Panel>
          <Panel title="任务分布"><TaskTable tasks={associatedTasks} nodeId={id} /></Panel></>}
    </>}
    {launch && <LaunchServices node={id} onClose={() => setLaunch(false)} onCreated={services.refresh} />}
    {confirm && <Confirm title={`移除节点 ${id}`} busy={operation.busy} error={operation.error} onCancel={() => setConfirm(false)}
      onConfirm={() => void operation.run(signal => api.removeNode(id, signal), () => { nodes.refresh(); navigate('/nodes'); })}>
      确认从入口节点的集群配置移除 {id}？将执行现有 cluster remove 操作。</Confirm>}
  </>;
}

export function ServicesList() {
  const fleet = useFleet();
  const poll = useData(api.services);
  const nodes = useData(api.nodes);
  const tasks = useData(api.tasks);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [launch, setLaunch] = useState(false);
  const serviceOperations = useServiceOperations();
  const q = params.get('q') || '';
  const node = params.get('node') || '';
  const task = params.get('task') || '';
  const state = params.get('state') || '';
  const sort = params.get('sort') || 'name';
  const kind = params.get('kind') || '';
  function filter(key: string, value: string) {
    setParams(previous => { const next = new URLSearchParams(previous); value ? next.set(key, value) : next.delete(key); return next; }, { replace: true });
  }
  const filtered = (poll.data ?? []).filter(service => (serviceName(service).toLowerCase().includes(q.toLowerCase())
    || service.configuration.serviceId.taskName.toLowerCase().includes(q.toLowerCase()))
    && (!node || service.configuration.serviceId.nodeUniqueId === node)
    && (!task || service.configuration.serviceId.taskName === task) && (!state || service.lifeCycle === state)
    && (!kind || (['BUNGEECORD', 'VELOCITY', 'WATERDOG', 'WATERDOG_PE'].includes(service.configuration.serviceId.environment) ? 'proxy' : 'server') === kind));
  const matchingTasks = new Set(filtered.map(service => service.configuration.serviceId.taskName));
  const visibleTasks = (tasks.data ?? []).filter(item => matchingTasks.has(item.name)
    || (!node && !state && !kind && (!task || item.name === task) && item.name.toLowerCase().includes(q.toLowerCase())));
  const nodeOptions = Array.from(new Set([...(nodes.data?.map(entry => entry.node.uniqueId) ?? []),
    ...(poll.data?.map(service => service.configuration.serviceId.nodeUniqueId) ?? []), ...(node ? [node] : [])]));
  const taskOptions = Array.from(new Set([...(tasks.data?.map(item => item.name) ?? []),
    ...(poll.data?.map(service => service.configuration.serviceId.taskName) ?? []), ...(task ? [task] : [])]));
  if (params.get('create') === '1') return <ConfigurationPage kind="tasks" creating />;
  const createParams = new URLSearchParams(params); createParams.set('create', '1');
  return <><PageHeading title="服务器" actions={<div className="heading-actions">
    <Link className="button button-secondary" to={`/services?${createParams}`}><Plus size={16} />创建任务</Link>
    <Button variant="primary" onClick={() => setLaunch(true)}>临时启动</Button></div>}>
    <span>{poll.data?.length ?? '—'} 个实例</span></PageHeading><FleetErrors sources={[poll, nodes, tasks, fleet.players, fleet.metrics]} />
    <section className="panel unified-services"><div className="service-filters"><label className="search-field"><Search size={16} />
      <input type="search" aria-label="搜索任务或实例" placeholder="搜索任务或实例" value={q} onChange={event => filter('q', event.target.value)} /></label>
      <div className="filter-selects"><select aria-label="服务类型" value={kind} onChange={event => filter('kind', event.target.value)}>
        <option value="">全部类型</option><option value="server">服务器</option><option value="proxy">代理</option></select>
        <select aria-label="排序" value={sort} onChange={event => filter('sort', event.target.value)}><option value="name">按名称</option><option value="players">玩家最多</option>
          <option value="cpu">CPU 最高</option><option value="memory">内存最高</option></select><select aria-label="所属节点" value={node} onChange={event => filter('node', event.target.value)}>
        <option value="">全部节点</option>{nodeOptions.map(id => <option key={id}>{id}</option>)}</select>
        <select aria-label="所属任务" value={task} onChange={event => filter('task', event.target.value)}>
          <option value="">全部任务</option>{taskOptions.map(name => <option key={name}>{name}</option>)}</select>
        <select aria-label="生命周期" value={state} onChange={event => filter('state', event.target.value)}><option value="">全部状态</option>
          {Object.entries(lifecycleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div></div>
      {poll.loading || tasks.loading ? <EmptyState loading /> : <GroupedServiceTable services={filtered} tasks={visibleTasks}
        nodeId={node} filtered={Boolean(q || node || task || state || kind)} actions={item => <TaskActions task={item} compact />}
        onSelect={id => navigate(resourceUrl('services', id))}
        onOperate={(id, op) => { void serviceOperations.run(id, op); }} />}
      <div className="table-footer">显示 {filtered.length} / {poll.data?.length ?? 0} 个实例</div></section>
    {launch && <LaunchServices task={task} node={node} onClose={() => setLaunch(false)} onCreated={poll.refresh} />}
  </>;
}

export function ServicePage() {
  const { id = '', tab = '' } = useParams();
  const fleet = useFleet();
  const poll = fleet.services;
  const service = poll.data?.find(item => item.configuration.serviceId.uniqueId === id);
  const [params, setParams] = useSearchParams();
  const workspace = useRef<HTMLDivElement>(null);
  const view = params.get('view') === 'players' ? 'players' : 'console';
  const focusedPlayer = fleet.players.data?.find(player => player.uniqueId === params.get('player'));
  useEffect(() => {
    if (!service) return;
    const target = workspace.current?.querySelector<HTMLInputElement>(view === 'players' ? '.embedded-players input[type="search"]' : '.console-input input');
    if (target && !target.disabled) target.focus({ preventScroll: true });
  }, [id, view, Boolean(service)]);
  const navigate = useNavigate();
  const serviceOperations = useServiceOperations();
  const pending = serviceOperations.pending[id];
  const busy = Boolean(pending && pending.settledAt === undefined);
  const [confirm, setConfirm] = useState<ServiceOperation | null>(null);
  const base = resourceUrl('services', id);
  async function operate(op: ServiceOperation) {
    if (await serviceOperations.run(id, op)) {
      setConfirm(null);
      if (op === 'delete') navigate('/services');
    }
  }
  if (!service) return <><PageHeading title="服务详情" /><Message>{poll.error}</Message>
    <EmptyState loading={poll.loading} title="服务不存在或已删除" /></>;
  const metric = fleet.serviceMetric(service);
  const tps = serviceTps(service);
  const metricIssue = service.lifeCycle === 'RUNNING'
    ? metric?.reason || metricReason(fleet.nodeMetric(service.configuration.serviceId.nodeUniqueId)) || (!metric ? '尚无进程采样' : '')
    : '服务未运行';
  const more: ServiceOperation[] = ['kill', 'delete', 'includeTemplates', 'includeInclusions', 'deployResources'];
  return <ServiceHistoryProvider services={[service]}><div className="service-header"><PageHeading title={serviceName(service)} actions={<div className="heading-actions">
    <ServiceActions service={service} onOperate={(_, op) => { void operate(op); }} />
    <MoreMenu label="更多操作">{more.map(op =>
      <button key={op} disabled={busy || (op === 'kill' && service.lifeCycle !== 'RUNNING')}
        onClick={() => { if (op === 'kill' || op === 'delete') setConfirm(op); else operate(op); }}>{operationLabels[op]}</button>)}</MoreMenu></div>}>
    <ServiceStatus service={service} /><Link to={resourceUrl('tasks', service.configuration.serviceId.taskName)}>任务 {service.configuration.serviceId.taskName}</Link>
    <Link to={resourceUrl('nodes', service.configuration.serviceId.nodeUniqueId)}>节点 {service.configuration.serviceId.nodeUniqueId}</Link></PageHeading>
    <Tabs items={[{ to: base, label: '工作台', end: true }, { to: `${base}/monitor`, label: '监控' }, { to: `${base}/info`, label: '实例信息' },
      { to: `${base}/configuration`, label: '配置' }]} /><FleetErrors sources={[poll, fleet.players, fleet.metrics]} />
    <div className="service-summary"><Summary items={[
      { label: '在线 / 容量', value: <Link className="player-count-link" to={`${base}?view=players`}>{fleet.servicePlayerLabel(service)}</Link>,
        detail: <ServiceSparkline service={service} field="Online-Count" /> },
      { label: 'TPS · 1／5／15 分钟', value: tps.values.join(' / '), hint: tps.reason,
        detail: <><ServiceSparkline service={service} field="TPS-1m" />{tps.reason && <small>{tps.reason}</small>}</> },
      { label: 'CPU · 占整机', value: percent(metric?.cpuPercent), detail: <ServiceSparkline service={service} field="cpuPercent" /> },
      { label: '进程内存', value: memoryBytes(metric?.residentMemoryBytes),
        detail: <ServiceSparkline service={service} field="residentMemoryBytes" /> },
      { label: 'JVM 堆 / 上限', value: `${memoryBytes(service.lifeCycle === 'RUNNING' ? service.processSnapshot?.heapUsageMemory : null)} / ${memoryBytes(service.processSnapshot?.maxHeapMemory)}` },
      { label: '配置额度', value: memoryMb(service.configuration.processConfig?.maxHeapMemorySize) },
    ]} /></div></div>
    {metricIssue && <p className="sampling-note">{metricIssue}</p>}
    {tab === 'monitor' ? <ServiceMonitor service={service} />
      : tab === 'configuration' ? <Panel title="当前实例配置" action={<Link to={`${resourceUrl('tasks', service.configuration.serviceId.taskName)}/configuration`}>编辑所属任务</Link>}>
        <pre className="configuration-preview">{JSON.stringify(service.configuration, null, 2)}</pre></Panel>
      : tab === 'info' ? <><Panel title="实例信息"><dl className="detail-fields resource-fields"><div className="field-wide"><dt>实例 UUID</dt><dd>{id}</dd></div>
          <div><dt>服务地址</dt><dd>{addressLabel(service.address)}</dd></div><div><dt>连接地址</dt><dd>{addressLabel(service.connectAddress)}</dd></div>
          <div><dt>运行环境</dt><dd>{service.configuration.serviceId.environment}</dd></div><div><dt>运行时</dt><dd>{service.configuration.runtime || '—'}</dd></div>
          <div><dt>静态实例</dt><dd>{service.configuration.staticService ? '是' : '否'}</dd></div>
          <div><dt>停止后自动删除</dt><dd>{service.configuration.autoDeleteOnStop ? '是' : '否'}</dd></div>
          <div className="field-wide"><dt>配置分组</dt><dd>{service.configuration.groups?.join('、') || '无'}</dd></div></dl></Panel></>
      : <><div className="workbench-switch" role="tablist" aria-label="工作台区域">{(['console', 'players'] as const).map(value =>
        <Button key={value} role="tab" aria-selected={view === value} onClick={() => setParams(previous => {
          const next = new URLSearchParams(previous); next.set('view', value); return next;
        })}>{value === 'console' ? '实时后台' : '在线玩家'}</Button>)}</div>
        {focusedPlayer && <div className="resource-context">当前玩家：<strong>{focusedPlayer.name}</strong><span>{focusedPlayer.server?.name || '尚未进入服务器'}</span></div>}
        <div className={`service-workbench view-${view}`} ref={workspace}>
          <div className="workbench-console"><Console key={`service/${id}`} type="service" id={id} running={service.lifeCycle === 'RUNNING'} focusCommand={view === 'console'} /></div>
          <aside className="workbench-players"><div className="panel-heading"><h2>在线玩家</h2><span>{fleet.playerCount([service]) ?? '—'} 人</span></div>
            <PlayersPage service={service} /></aside>
        </div></>}
    {confirm && <Confirm title={`${operationLabels[confirm]} ${serviceName(service)}`} busy={busy}
      onCancel={() => setConfirm(null)} onConfirm={() => { void operate(confirm); }}>确认{operationLabels[confirm]} {serviceName(service)}？
      {confirm === 'delete' ? '删除运行中的实例会强制停止该进程。' : '将调用 CloudNet 的强制终止操作。'}</Confirm>}
  </ServiceHistoryProvider>;
}

export function ConsolePage() {
  const nodes = useData(api.nodes);
  const services = useData(api.services);
  const [params, setParams] = useSearchParams();
  const type: ConsoleType = params.get('type') === 'service' ? 'service' : 'node';
  const id = params.get('id') || '';
  const options = type === 'node' ? nodes.data?.map(entry => ({ id: entry.node.uniqueId, name: entry.node.uniqueId })) ?? []
    : services.data?.map(service => ({ id: service.configuration.serviceId.uniqueId, name: serviceName(service) })) ?? [];
  const running = type === 'node' || services.data?.some(service => service.configuration.serviceId.uniqueId === id && service.lifeCycle === 'RUNNING') === true;
  return <><PageHeading title="控制台" />
    <Message>{type === 'node' ? nodes.error : services.error}</Message>
    <div className="console-selector"><label>对象类型<select value={type} onChange={event => setParams({ type: event.target.value })}>
      <option value="node">节点</option><option value="service">服务实例</option></select></label>
      <label>管理对象<select value={id} onChange={event => setParams({ type, id: event.target.value })}><option value="">选择对象</option>
        {id && !options.some(option => option.id === id) && <option value={id}>{id}</option>}
        {options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
      {id && <Link className="button button-secondary" to={resourceUrl(type === 'node' ? 'nodes' : 'services', id)}>查看详情</Link>}</div>
    {id ? <Console key={`${type}/${id}`} type={type} id={id} running={running} /> : <Panel title="选择管理对象"><EmptyState title="选择节点或服务实例以打开控制台" /></Panel>}
  </>;
}
