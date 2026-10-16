import type { ClusterEntry, CommandResult, Configuration, ConsoleType, CreateServicesResult, MetricsResponse,
  TaskHistoryResponse, TaskOperation, MetricsHistoryResponse, ServiceHistoryResponse, ServiceHistoryNode, PlayerHistoryResponse, ConsoleLogFile, ConsoleLogPage,
  OnlinePlayer, PlayerAction, PlayerActionRequest, PlayerActionResponse,
  ServiceOperation, ServiceSnapshot, ServiceTemplate, StatusSnapshot } from './types';

export class ApiError extends Error {
  constructor(public status: number, message: string, public operationPending?: boolean) {
    super(message);
  }
}

export const isUnauthorized = (error: unknown) => error instanceof ApiError && error.status === 401;
export const errorMessage = (error: unknown) => error instanceof TypeError
  ? '无法连接 CloudNet，请检查节点是否运行及 REST 接口配置。'
  : error instanceof Error ? error.message : '请求失败，请重试。';

async function request<T>(path: string, signal: AbortSignal,
  options: { method?: string; body?: unknown; authorization?: string } = {}): Promise<T> {
  const { authorization, method = 'GET', body } = options;
  const response = await fetch(`/api/v1${path}`, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'manual',
    signal,
    headers: {
      ...(authorization ? { Authorization: authorization } : {}),
      ...(body !== undefined ? { 'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json' } : {}),
    },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  // REST redirects expired sessions to /auth; do not follow it into the browser's Basic login prompt.
  if (response.type === 'opaqueredirect' || response.status === 302 || response.status === 401) {
    throw new ApiError(401, authorization ? '用户名或密码错误。' : '登录已失效，请重新登录。');
  }
  if (!response.ok) {
    const body = response.headers.get('content-type')?.includes('application/json')
      ? await response.json() as { reason?: string; receivedMessages?: string[]; pending?: boolean } : null;
    const fallback = response.status === 403 ? '当前账号没有执行此操作的权限。'
      : response.status === 404 ? '资源不存在或已失效。'
        : `请求失败（${response.status}）。`;
    throw new ApiError(response.status, body?.receivedMessages?.length ? body.receivedMessages.join('\n')
      : body?.reason ? `${fallback} ${body.reason}` : fallback, body?.pending);
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  login(username: string, password: string, signal: AbortSignal) {
    const bytes = new TextEncoder().encode(`${username}:${password}`);
    const credentials = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
    return request<{ success: boolean; userUniqueId: string }>('/auth', signal, { authorization: `Basic ${credentials}` });
  },
  logout: (signal: AbortSignal) => request<void>('/logout', signal),
  status: (signal: AbortSignal) => request<StatusSnapshot>('/status', signal),
  nodes: (signal: AbortSignal) => request<ClusterEntry[]>('/cluster', signal),
  metrics: (signal: AbortSignal) => request<MetricsResponse>('/metrics', signal),
  metricsHistory: (node: string, range: string, signal: AbortSignal) =>
    request<MetricsHistoryResponse>(`/metrics/history?${new URLSearchParams({ ...(node ? { node } : {}), range })}`, signal),
  playerHistory: (range: string, signal: AbortSignal) =>
    request<PlayerHistoryResponse>(`/metrics/players/history?${new URLSearchParams({ range })}`, signal),
  serviceHistory: async (ids: string[], range: string, signal: AbortSignal): Promise<ServiceHistoryResponse> => {
    // Keep repeated UUID parameters within the HTTP server's request-line limit.
    const batches = Array.from({ length: Math.ceil(ids.length / 64) }, (_, index) => ids.slice(index * 64, (index + 1) * 64));
    const results = await Promise.all(batches.map(batch => {
      const params = new URLSearchParams({ range });
      batch.forEach(id => params.append('service', id));
      return request<ServiceHistoryResponse>(`/metrics/services/history?${params}`, signal);
    }));
    const nodes = new Map<string, ServiceHistoryNode>();
    for (const result of results) for (const node of result.nodes) {
      const previous = nodes.get(node.nodeUniqueId);
      nodes.set(node.nodeUniqueId, { ...node, services: { ...previous?.services, ...node.services },
        status: previous?.status === 'available' ? 'available' : node.status,
        reason: [...new Set([previous?.reason, node.reason].filter(Boolean))].join('；'),
        historyReason: [...new Set([previous?.historyReason, node.historyReason].filter(Boolean))].join('；') });
    }
    return { ...results[0], nodes: [...nodes.values()] };
  },
  taskHistory: (tasks: string[], range: string, node: string, signal: AbortSignal) => {
    const params = new URLSearchParams({ range, ...(node ? { node } : {}) });
    tasks.forEach(task => params.append('task', task));
    return request<TaskHistoryResponse>(`/metrics/tasks/history?${params}`, signal);
  },
  setTaskMinimum: (name: string, count: number, signal: AbortSignal) =>
    request<{ id: string }>(`/tasks/${encodeURIComponent(name)}/minimum-services`, signal, { method: 'POST', body: { count } }),
  setTaskTarget: (name: string, count: number, signal: AbortSignal) =>
    request<{ id: string }>(`/tasks/${encodeURIComponent(name)}/target-services`, signal, { method: 'POST', body: { count } }),
  stopTask: (name: string, clearMinimum: boolean, signal: AbortSignal) =>
    request<{ id: string }>(`/tasks/${encodeURIComponent(name)}/stop`, signal, { method: 'POST', body: { clearMinimum } }),
  taskOperation: (id: string, signal: AbortSignal) => request<TaskOperation>(`/task-operations/${encodeURIComponent(id)}`, signal),
  services: (signal: AbortSignal) => request<ServiceSnapshot[]>('/services', signal),
  service: (id: string, signal: AbortSignal) => request<ServiceSnapshot>(`/services/${encodeURIComponent(id)}`, signal),
  logs: (id: string, signal: AbortSignal) => request<string[]>(`/services/${encodeURIComponent(id)}/log_json`, signal),
  operate: (id: string, operation: ServiceOperation, signal: AbortSignal) =>
    request<{ success: boolean }>(`/services/${encodeURIComponent(id)}/${operation}`, signal, { method: 'POST' }),
  tasks: (signal: AbortSignal) => request<Configuration[]>('/tasks', signal),
  groups: (signal: AbortSignal) => request<Configuration[]>('/groups', signal),
  templates: (signal: AbortSignal) => request<ServiceTemplate[]>('/local_templates', signal),
  saveConfiguration: (kind: 'tasks' | 'groups', config: Configuration, signal: AbortSignal) =>
    request<void>(`/${kind}`, signal, { method: 'POST', body: config }),
  deleteConfiguration: (kind: 'tasks' | 'groups', name: string, signal: AbortSignal) =>
    request<void>(`/${kind}/${encodeURIComponent(name)}`, signal, { method: 'DELETE' }),
  createServices: (task: string, count: number, nodeUniqueId: string, signal: AbortSignal) =>
    request<CreateServicesResult>(`/tasks/${encodeURIComponent(task)}/services`, signal,
      { method: 'POST', body: { count, nodeUniqueId: nodeUniqueId || null } }),
  command: (type: ConsoleType, id: string, command: string, signal: AbortSignal) =>
    request<CommandResult>(`/${type === 'node' ? 'cluster' : 'services'}/${encodeURIComponent(id)}/command`, signal,
      { method: 'POST', body: command }),
  consoleAccess: (type: ConsoleType, id: string, signal: AbortSignal) =>
    request<{ success: boolean }>(`/console/${type}/${encodeURIComponent(id)}`, signal),
  consoleFiles: (type: ConsoleType, id: string, signal: AbortSignal) =>
    request<{ files: ConsoleLogFile[] }>(`/console/${type}/${encodeURIComponent(id)}/logs`, signal),
  consoleHistory: (type: ConsoleType, id: string, file: string, cursor: string | null, signal: AbortSignal) =>
    request<ConsoleLogPage>(`/console/${type}/${encodeURIComponent(id)}/logs/${encodeURIComponent(file)}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, signal),
  addNode: (nodeUniqueId: string, host: string, port: number, signal: AbortSignal) =>
    request<CommandResult>('/cluster', signal, { method: 'POST', body: { nodeUniqueId, host, port } }),
  removeNode: (id: string, signal: AbortSignal) =>
    request<CommandResult>(`/cluster/${encodeURIComponent(id)}`, signal, { method: 'DELETE' }),
  players: (signal: AbortSignal) => request<OnlinePlayer[]>('/players', signal),
  playerAction: (action: PlayerAction, body: PlayerActionRequest, signal: AbortSignal) =>
    request<PlayerActionResponse>(`/players/actions/${action}`, signal, { method: 'POST', body }),
};
