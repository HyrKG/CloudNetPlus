import type { Address, Configuration, LifeCycle, ServiceSnapshot } from './types';
import { METRIC_MAX_AGE } from './monitoring';

export const lifecycleLabels: Record<LifeCycle, string> = {
  DEFINED: '已定义', PREPARED: '已就绪', RUNNING: '运行中', STOPPED: '已停止', DELETED: '已删除',
};

export const serviceName = (service: ServiceSnapshot) => {
  const id = service.configuration.serviceId;
  return `${id.taskName}-${id.taskServiceId}`;
};

export const taskTargetLabel = (task: Configuration) => {
  const target = task.properties?.targetServiceCount ?? -1;
  return target >= 0 ? String(target) : '未启用';
};

export const hasMetric = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

export const serviceTps = (service: ServiceSnapshot) => {
  const values = ['TPS-1m', 'TPS-5m', 'TPS-15m'].map(key => {
    const value = service.properties?.[key];
    return typeof value === 'number' && hasMetric(value) ? value : null;
  });
  const reason = service.lifeCycle !== 'RUNNING' ? '服务未运行'
    : !values.some(hasMetric) ? '尚未上报 TPS 或当前服务不支持'
      : Date.now() - service.creationTime > METRIC_MAX_AGE ? `数据已过期 · 快照 ${timeLabel(new Date(service.creationTime))}` : '';
  return { values: values.map(value => !reason && hasMetric(value) ? value.toFixed(2) : '—'), reason };
};

export const percent = (value: number | null | undefined) => hasMetric(value) ? `${value.toFixed(1)}%` : '—';
export const memoryMb = (value: number | null | undefined) => {
  if (!hasMetric(value)) return '—';
  return value >= 1024 ? `${(value / 1024).toFixed(1)} GiB` : `${Math.round(value)} MiB`;
};
export const memoryBytes = (value: number | null | undefined) => hasMetric(value) ? memoryMb(value / 1048576) : '—';
export const byteRate = (value: number | null | undefined) => {
  if (!hasMetric(value)) return '—';
  if (value >= 1048576) return `${(value / 1048576).toFixed(1)} MiB/s`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KiB/s`;
  return `${Math.round(value)} B/s`;
};
export const addressLabel = (address: Address | null | undefined) => address
  ? `${address.host.includes(':') ? `[${address.host}]` : address.host}:${address.port}` : '—';
export const timeLabel = (value: Date | null) => value?.toLocaleTimeString('zh-CN', { hour12: false }) ?? '—';
