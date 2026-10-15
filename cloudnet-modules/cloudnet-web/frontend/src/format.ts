import type { Address, LifeCycle, ServiceSnapshot } from './types';

export const lifecycleLabels: Record<LifeCycle, string> = {
  DEFINED: '已定义', PREPARED: '已就绪', RUNNING: '运行中', STOPPED: '已停止', DELETED: '已删除',
};

export const serviceName = (service: ServiceSnapshot) => {
  const id = service.configuration.serviceId;
  return `${id.taskName}-${id.taskServiceId}`;
};

export const hasMetric = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

export const percent = (value: number | null | undefined) => hasMetric(value) ? `${value.toFixed(1)}%` : '—';
export const memoryMb = (value: number | null | undefined) => {
  if (!hasMetric(value)) return '—';
  return value >= 1024 ? `${(value / 1024).toFixed(1)} GiB` : `${Math.round(value)} MiB`;
};
export const memoryBytes = (value: number | null | undefined) => hasMetric(value) ? memoryMb(value / 1048576) : '—';
export const addressLabel = (address: Address | null | undefined) => address
  ? `${address.host.includes(':') ? `[${address.host}]` : address.host}:${address.port}` : '—';
export const timeLabel = (value: Date | null) => value?.toLocaleTimeString('zh-CN', { hour12: false }) ?? '—';
