import { useCallback } from 'react';
import { ExternalLink, Play, RefreshCw, Square, Terminal } from 'lucide-react';
import { api } from './api';
import { Button, Dialog, EmptyState, Message, Panel, StatusBadge } from './components';
import { addressLabel, memoryBytes, memoryMb, percent, serviceName, timeLabel } from './format';
import type { ServiceOperation, ServiceSnapshot } from './types';
import { usePolling } from './usePolling';

export interface PendingOperation { id: string; operation: ServiceOperation }
export const operationLabels: Record<ServiceOperation, string> = { start: '启动', stop: '停止', restart: '重启' };

export function ServiceActions({ service, pending, onOperate, compact = false }:
  { service: ServiceSnapshot; pending: PendingOperation | null;
    onOperate: (id: string, operation: ServiceOperation) => void; compact?: boolean }) {
  const id = service.configuration.serviceId.uniqueId;
  const running = service.lifeCycle === 'RUNNING';
  const startable = service.lifeCycle === 'PREPARED' || service.lifeCycle === 'STOPPED';
  const operation = running ? 'stop' : 'start';
  return <div className={`service-actions ${compact ? 'service-actions-compact' : ''}`}>
    <Button variant={compact ? 'secondary' : 'primary'} className={compact ? 'button-small' : ''}
      disabled={Boolean(pending) || (!running && !startable)}
      busy={pending?.id === id && pending.operation === operation}
      aria-label={`${operationLabels[operation]} ${serviceName(service)}`} onClick={() => onOperate(id, operation)}>
      {pending?.id !== id && (running ? <Square size={13} /> : <Play size={13} />)}{operationLabels[operation]}
    </Button>
    <Button className={compact ? 'icon-button button-small' : ''} disabled={Boolean(pending) || !running}
      busy={pending?.id === id && pending.operation === 'restart'}
      aria-label={`重启 ${serviceName(service)}`} title="重启服务" onClick={() => onOperate(id, 'restart')}>
      {!(pending?.id === id && pending.operation === 'restart') && <RefreshCw size={14} />}{!compact && '重启'}
    </Button>
  </div>;
}

export function ServiceTable({ services, onSelect, pending, onOperate }:
  { services: ServiceSnapshot[]; onSelect: (id: string) => void; pending?: PendingOperation | null;
    onOperate?: (id: string, operation: ServiceOperation) => void }) {
  return <div className="table-scroll"><table className="service-table"><thead><tr>
    <th>服务名称</th><th>状态</th><th>所属节点</th><th>CPU</th><th>堆内存</th><th className="align-right">操作</th>
  </tr></thead><tbody>{services.map(service => {
    const id = service.configuration.serviceId;
    return <tr key={id.uniqueId}>
      <td><button className="service-name" onClick={() => onSelect(id.uniqueId)}>
        <span className="service-icon"><Terminal size={17} /></span>
        <span><strong>{serviceName(service)}</strong><small>{id.taskName} · {id.environment}</small></span>
      </button></td>
      <td><StatusBadge value={service.lifeCycle} /></td>
      <td className="mono text-secondary">{id.nodeUniqueId}</td>
      <td className="metric-cell">{percent(service.processSnapshot?.cpuUsage)}</td>
      <td className="metric-cell"><span>{memoryBytes(service.processSnapshot?.heapUsageMemory)}</span>
        <small> / {memoryBytes(service.processSnapshot?.maxHeapMemory)}</small></td>
      <td><div className="table-actions">{onOperate && <ServiceActions service={service}
        pending={pending ?? null} onOperate={onOperate} compact />}
        <Button variant="ghost" className="icon-button button-small" title="查看详情"
          aria-label={`查看 ${serviceName(service)} 详情`} onClick={() => onSelect(id.uniqueId)}>
          <ExternalLink size={15} /></Button></div></td>
    </tr>;
  })}</tbody></table></div>;
}

export function ServiceDetail({ id, refreshToken, onUnauthorized, onClose, pending, onOperate, operationError, notice }:
  { id: string; refreshToken: number; onUnauthorized: () => void; onClose: () => void;
    pending: PendingOperation | null; onOperate: (id: string, operation: ServiceOperation) => void;
    operationError: string; notice: string }) {
  const loader = useCallback((signal: AbortSignal) => api.service(id, signal), [id]);
  const poll = usePolling(loader, 5000, onUnauthorized, refreshToken);
  const service = poll.data;
  return <Dialog title={service ? serviceName(service) : id} onClose={onClose}>
    <div className="detail-body"><Message>{poll.error || operationError}</Message>
      <Message kind="success">{notice}</Message>
      {poll.loading && <EmptyState loading />}
      {service && <>
        <div className="detail-toolbar"><div><StatusBadge value={service.lifeCycle} />
          <span className="text-secondary">{service.configuration.serviceId.nodeUniqueId}</span></div>
          <ServiceActions service={service} pending={pending} onOperate={onOperate} /></div>
        <div className="detail-metrics">
          <div><span>CPU 使用率</span><strong>{percent(service.processSnapshot?.cpuUsage)}</strong></div>
          <div><span>已用堆内存</span><strong>{memoryBytes(service.processSnapshot?.heapUsageMemory)}</strong></div>
          <div><span>最大堆内存</span><strong>{memoryBytes(service.processSnapshot?.maxHeapMemory)}</strong></div>
        </div>
        <Panel title="实例信息">
          <dl className="detail-fields">
            <div className="field-wide"><dt>实例 UUID</dt><dd>{id}</dd></div>
            <div><dt>服务地址</dt><dd>{addressLabel(service.address)}</dd></div>
            <div><dt>连接地址</dt><dd>{addressLabel(service.connectAddress)}</dd></div>
            <div><dt>所属任务</dt><dd>{service.configuration.serviceId.taskName}</dd></div>
            <div><dt>运行环境</dt><dd>{service.configuration.serviceId.environment}</dd></div>
            <div><dt>运行时</dt><dd>{service.configuration.runtime || '—'}</dd></div>
            <div><dt>配置堆内存</dt><dd>{memoryMb(service.configuration.processConfig?.maxHeapMemorySize)}</dd></div>
            <div><dt>静态服务</dt><dd>{service.configuration.staticService ? '是' : '否'}</dd></div>
            <div><dt>停止后自动删除</dt><dd>{service.configuration.autoDeleteOnStop ? '是' : '否'}</dd></div>
            <div className="field-wide"><dt>配置组</dt><dd>{service.configuration.groups?.join('、') || '—'}</dd></div>
          </dl>
        </Panel>
        <LogPanel id={id} onUnauthorized={onUnauthorized} refreshToken={refreshToken} />
      </>}
    </div>
  </Dialog>;
}

function LogPanel({ id, onUnauthorized, refreshToken }:
  { id: string; onUnauthorized: () => void; refreshToken: number }) {
  const loader = useCallback((signal: AbortSignal) => api.logs(id, signal), [id]);
  const poll = usePolling(loader, 2000, onUnauthorized, refreshToken);
  return <section className="log-panel" aria-label="服务日志"><header>
    <div><Terminal size={17} /><strong>运行日志</strong><span>缓存日志 · 每 2 秒刷新</span></div>
    <Button variant="ghost" className="log-refresh" onClick={poll.refresh} busy={poll.refreshing}>
      {!poll.refreshing && <RefreshCw size={14} />}刷新</Button>
  </header>{poll.error && <div className="log-error" role="alert">{poll.error}</div>}
    <pre tabIndex={0}>{poll.loading ? '加载中…' : poll.data?.length ? poll.data.join('\n') : '暂无日志'}</pre>
    <footer><span><span className={`status-dot ${poll.error ? 'dot-muted' : ''}`} />
      {poll.error ? '日志更新失败' : poll.refreshing ? '正在同步' : '自动同步'}</span>
      <span>上次更新 {timeLabel(poll.updatedAt)}</span></footer>
  </section>;
}
