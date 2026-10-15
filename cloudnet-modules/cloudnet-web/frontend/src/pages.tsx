import { useEffect, useRef, useState } from 'react';
import { Activity, ArrowRight, Box, ChevronRight, Cpu, HardDrive, Network, Search, Server } from 'lucide-react';
import { api, errorMessage, isUnauthorized } from './api';
import { Button, EmptyState, Message, Meter, PageHeading, Panel } from './components';
import { addressLabel, hasMetric, lifecycleLabels, memoryMb, percent, serviceName, timeLabel } from './format';
import { operationLabels, ServiceDetail, ServiceTable, type PendingOperation } from './services';
import type { ClusterEntry, ServiceOperation } from './types';
import { usePolling } from './usePolling';

interface PageProps { onUnauthorized: () => void; refreshToken: number }

async function loadOverview(signal: AbortSignal) {
  const [status, nodes, services] = await Promise.all([api.status(signal), api.nodes(signal), api.services(signal)]);
  return { status, nodes, services };
}

function UpdateLabel({ updatedAt, refreshing, error }:
  { updatedAt: Date | null; refreshing: boolean; error: string }) {
  return <span className={`update-label ${error ? 'update-label-error' : ''}`}>
    <span className={`status-dot ${error ? 'dot-muted' : ''}`} />
    {error ? '刷新失败' : refreshing ? '正在同步' : '每 5 秒自动更新'}
    {updatedAt && <span className="update-time">上次更新 {timeLabel(updatedAt)}</span>}
  </span>;
}

export function OverviewPage({ onUnauthorized, refreshToken, onOpenService, onOpenNode, onServices, onNodes }:
  PageProps & { onOpenService: (id: string) => void; onOpenNode: (id: string) => void;
    onServices: () => void; onNodes: () => void }) {
  const poll = usePolling(loadOverview, 5000, onUnauthorized, refreshToken);
  const data = poll.data;
  const nodes = data?.nodes ?? [];
  const completeMemory = nodes.length > 0 && nodes.every(entry =>
    hasMetric(entry.nodeInfoSnapshot?.reservedMemory) && hasMetric(entry.nodeInfoSnapshot?.maxMemory));
  const reserved = completeMemory ? nodes.reduce((sum, entry) => sum + entry.nodeInfoSnapshot!.reservedMemory, 0) : null;
  const capacity = completeMemory ? nodes.reduce((sum, entry) => sum + entry.nodeInfoSnapshot!.maxMemory, 0) : null;
  const running = data?.services.filter(service => service.lifeCycle === 'RUNNING').length;
  const stats = [
    { label: '集群节点', value: data ? String(nodes.length).padStart(2, '0') : '—', icon: Network },
    { label: '服务实例', value: data ? String(data.services.length).padStart(2, '0') : '—', icon: Box },
    { label: '运行中', value: running === undefined ? '—' : String(running).padStart(2, '0'), icon: Activity },
    { label: '预留内存', value: memoryMb(reserved), note: `节点总容量 ${memoryMb(capacity)}`, icon: HardDrive },
  ];

  return <>
    <PageHeading title="运行概览" actions={
      <Button variant="primary" onClick={onServices}>管理服务<ArrowRight size={16} /></Button>}>
      <span>当前节点 <strong className="mono">{data?.status.Identity.uniqueId || '—'}</strong></span>
      <span>版本 <strong>{data?.status.Version || '—'}</strong></span>
    </PageHeading>
    <Message>{poll.error}</Message>
    <div className="section-line"><span className="section-label">网络状态</span><UpdateLabel {...poll} /></div>
    <section className="stats-grid" aria-label="网络指标">{stats.map(stat => <article className="stat-card" key={stat.label}>
      <div className="stat-top"><span>{stat.label}</span><stat.icon size={17} /></div>
      <strong className="stat-value">{stat.value}</strong>{stat.note && <small>{stat.note}</small>}
    </article>)}</section>
    <div className="overview-columns"><Panel title="节点资源"
      action={<Button variant="ghost" className="text-action" onClick={onNodes}>全部节点<ArrowRight size={15} /></Button>}>
      {poll.loading ? <EmptyState loading /> : nodes.length ? <div className="node-summary-list">
        {nodes.slice(0, 3).map(entry => <NodeCard key={entry.node.uniqueId} entry={entry} onOpen={onOpenNode} compact />)}
      </div> : <EmptyState title={poll.error ? '节点数据暂不可用' : '暂无节点'} />}
    </Panel><Panel title="服务状态分布" className="distribution-panel">
      <div className="distribution-total"><strong>{data ? data.services.length : '—'}</strong><span>服务实例</span>
        <span className="distribution-symbol"><Box size={31} strokeWidth={1.4} /></span></div>
      <div className="distribution-bar" aria-hidden="true">{Object.keys(lifecycleLabels).map(lifeCycle => {
        const count = data?.services.filter(service => service.lifeCycle === lifeCycle).length ?? 0;
        return count > 0 && <span key={lifeCycle} className={`distribution-${lifeCycle.toLowerCase()}`}
          style={{ flexGrow: count }} />;
      })}</div>
      <div className="distribution-legend">{Object.entries(lifecycleLabels).map(([lifeCycle, label]) =>
        <div key={lifeCycle}><span className={`legend-dot legend-${lifeCycle.toLowerCase()}`} />
          <span>{label}</span><strong>{data ? data.services.filter(service => service.lifeCycle === lifeCycle).length : '—'}</strong>
        </div>)}</div>
    </Panel></div>
    <Panel title="服务列表"
      action={<Button variant="ghost" className="text-action" onClick={onServices}>全部服务<ArrowRight size={15} /></Button>}>
      {poll.loading ? <EmptyState loading /> : data?.services.length
        ? <ServiceTable services={data.services.slice(0, 5)} onSelect={onOpenService} />
        : <EmptyState title={poll.error ? '服务数据暂不可用' : '暂无服务'} />}
    </Panel>
  </>;
}

function NodeCard({ entry, onOpen, compact = false }:
  { entry: ClusterEntry; onOpen: (id: string) => void; compact?: boolean }) {
  const snapshot = entry.nodeInfoSnapshot;
  return <article className={`node-card ${compact ? 'node-card-compact' : ''}`}>
    <button className="node-card-heading" onClick={() => onOpen(entry.node.uniqueId)}>
      <span className="node-icon"><Server size={18} /></span><span className="node-name"><strong>{entry.node.uniqueId}</strong>
        <small>{compact ? snapshot?.version || '暂无快照' : addressLabel(entry.node.listeners?.[0])}</small></span>
      <span className="node-service-count">{snapshot?.currentServicesCount ?? '—'} 个服务</span><ChevronRight size={15} />
    </button>
    <div className="node-metrics"><div><span><Cpu size={13} />CPU</span><strong>{percent(snapshot?.systemCpuUsage)}</strong>
      <Meter value={snapshot?.systemCpuUsage} /></div>
      <div><span><HardDrive size={13} />预留内存</span><strong>{memoryMb(snapshot?.reservedMemory)}
        <small> / {memoryMb(snapshot?.maxMemory)}</small></strong>
        <Meter value={snapshot?.reservedMemory} max={snapshot?.maxMemory} /></div></div>
    {!compact && <div className="node-card-footer"><span><span className={`status-dot ${snapshot ? '' : 'dot-muted'}`} />
      {snapshot ? snapshot.version : '暂无快照'}</span><span>已用 {memoryMb(snapshot?.usedMemory)}</span></div>}
  </article>;
}

export function NodesPage({ onUnauthorized, refreshToken, onOpenNode }:
  PageProps & { onOpenNode: (id: string) => void }) {
  const poll = usePolling(api.nodes, 5000, onUnauthorized, refreshToken);
  return <><PageHeading title="节点管理"
    actions={<span className="count-badge">{poll.data?.length ?? '—'} 个节点</span>} />
    <Message>{poll.error}</Message><div className="section-line"><span className="section-label">全部节点</span>
      <UpdateLabel {...poll} /></div>
    {poll.loading ? <Panel title="集群节点"><EmptyState loading /></Panel>
      : poll.data?.length ? <div className="nodes-grid">{poll.data.map(entry =>
        <NodeCard key={entry.node.uniqueId} entry={entry} onOpen={onOpenNode} />)}</div>
        : <Panel title="集群节点"><EmptyState title={poll.error ? '节点数据暂不可用' : '暂无节点'} /></Panel>}
  </>;
}

export function ServicesPage({ onUnauthorized, refreshToken, nodeFilter, setNodeFilter, selectedId, onSelect }:
  PageProps & { nodeFilter: string; setNodeFilter: (id: string) => void; selectedId: string | null;
    onSelect: (id: string | null) => void }) {
  const poll = usePolling(api.services, 5000, onUnauthorized, refreshToken);
  const [search, setSearch] = useState('');
  const [lifeCycle, setLifeCycle] = useState('');
  const [pending, setPending] = useState<PendingOperation | null>(null);
  const [operationError, setOperationError] = useState('');
  const [notice, setNotice] = useState('');
  const [operationRevision, setOperationRevision] = useState(0);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function operate(id: string, operation: ServiceOperation) {
    const controller = new AbortController();
    request.current = controller;
    setPending({ id, operation }); setOperationError(''); setNotice('');
    try {
      await api.operate(id, operation, controller.signal);
      if (controller.signal.aborted) return;
      setNotice(`${operationLabels[operation]}请求已提交，正在刷新服务状态。`);
      setOperationRevision(value => value + 1);
      poll.refresh();
    } catch (error) {
      if (controller.signal.aborted) return;
      if (isUnauthorized(error)) onUnauthorized();
      else setOperationError(errorMessage(error));
    } finally {
      if (!controller.signal.aborted) setPending(null);
    }
  }

  function select(id: string | null) { setOperationError(''); setNotice(''); onSelect(id); }
  const services = poll.data ?? [];
  const nodes = Array.from(new Set([...services.map(service => service.configuration.serviceId.nodeUniqueId),
    ...(nodeFilter ? [nodeFilter] : [])])).sort();
  const filtered = services.filter(service => {
    const id = service.configuration.serviceId;
    return serviceName(service).toLowerCase().includes(search.trim().toLowerCase())
      && (!nodeFilter || id.nodeUniqueId === nodeFilter) && (!lifeCycle || service.lifeCycle === lifeCycle);
  }).sort((left, right) => serviceName(left).localeCompare(serviceName(right), 'zh-CN', { numeric: true }));

  return <><PageHeading title="服务管理"
    actions={<span className="count-badge">{poll.data?.length ?? '—'} 个实例</span>} />
    <Message>{poll.error || operationError}</Message><Message kind="success">{notice}</Message>
    <div className="section-line"><span className="section-label">全部服务</span><UpdateLabel {...poll} /></div>
    <section className="panel"><div className="service-filters"><label className="search-field">
      <Search size={17} /><input type="search" aria-label="搜索服务名称" placeholder="搜索服务名称…"
        value={search} onChange={event => setSearch(event.target.value)} /></label>
      <div className="filter-selects"><label><span className="sr-only">所属节点</span>
        <select value={nodeFilter} onChange={event => setNodeFilter(event.target.value)}>
          <option value="">全部节点</option>{nodes.map(id => <option key={id} value={id}>{id}</option>)}</select></label>
        <label><span className="sr-only">生命周期</span><select value={lifeCycle} onChange={event => setLifeCycle(event.target.value)}>
          <option value="">全部状态</option>{Object.entries(lifecycleLabels).map(([value, label]) =>
            <option key={value} value={value}>{label}</option>)}</select></label></div>
    </div>
      {poll.loading ? <EmptyState loading /> : filtered.length ? <ServiceTable services={filtered} onSelect={select}
        pending={pending} onOperate={(id, operation) => void operate(id, operation)} />
        : <EmptyState title={poll.error && !poll.data ? '服务数据暂不可用' : services.length ? '没有匹配的服务' : '暂无服务'}
          description={services.length ? '调整筛选条件' : undefined} />}
      <div className="table-footer"><span>{poll.data ? `显示 ${filtered.length} / ${services.length} 个服务` : '等待服务数据'}</span></div>
    </section>
    {selectedId && <ServiceDetail key={selectedId} id={selectedId} refreshToken={refreshToken + operationRevision}
      onUnauthorized={onUnauthorized} onClose={() => select(null)} pending={pending}
      onOperate={(id, operation) => void operate(id, operation)} operationError={operationError} notice={notice} />}
  </>;
}
