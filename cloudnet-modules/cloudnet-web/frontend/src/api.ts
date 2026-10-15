import type { ClusterEntry, ServiceOperation, ServiceSnapshot, StatusSnapshot } from './types';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const isUnauthorized = (error: unknown) => error instanceof ApiError && error.status === 401;
export const errorMessage = (error: unknown) => error instanceof TypeError
  ? '无法连接 CloudNet，请检查节点是否运行及 REST 接口配置。'
  : error instanceof Error ? error.message : '请求失败，请重试。';

async function request<T>(path: string, signal: AbortSignal, authorization?: string): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'manual',
    signal,
    headers: authorization ? { Authorization: authorization } : undefined,
  });
  // REST redirects expired sessions to /auth; do not follow it into the browser's Basic login prompt.
  if (response.type === 'opaqueredirect' || response.status === 302 || response.status === 401) {
    throw new ApiError(401, authorization ? '用户名或密码错误。' : '登录已失效，请重新登录。');
  }
  if (!response.ok) {
    const body = response.headers.get('content-type')?.includes('application/json')
      ? await response.json() as { reason?: string } : null;
    const fallback = response.status === 403 ? '当前账号没有执行此操作的权限。'
      : response.status === 404 ? '资源不存在，服务可能已停止并自动删除。'
        : `请求失败（${response.status}）。`;
    throw new ApiError(response.status, body?.reason ? `${fallback} ${body.reason}` : fallback);
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  login(username: string, password: string, signal: AbortSignal) {
    const bytes = new TextEncoder().encode(`${username}:${password}`);
    const credentials = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
    return request<{ success: boolean; userUniqueId: string }>('/auth', signal, `Basic ${credentials}`);
  },
  logout: (signal: AbortSignal) => request<void>('/logout', signal),
  status: (signal: AbortSignal) => request<StatusSnapshot>('/status', signal),
  nodes: (signal: AbortSignal) => request<ClusterEntry[]>('/cluster', signal),
  services: (signal: AbortSignal) => request<ServiceSnapshot[]>('/services', signal),
  service: (id: string, signal: AbortSignal) => request<ServiceSnapshot>(`/services/${encodeURIComponent(id)}`, signal),
  logs: (id: string, signal: AbortSignal) => request<string[]>(`/services/${encodeURIComponent(id)}/log_json`, signal),
  operate: (id: string, operation: ServiceOperation, signal: AbortSignal) =>
    request<ServiceSnapshot>(`/services/${encodeURIComponent(id)}/${operation}`, signal),
};
