export interface Address {
  host: string;
  port: number;
}

export interface ProcessSnapshot {
  heapUsageMemory: number;
  maxHeapMemory: number;
  cpuUsage: number;
  pid: number;
}

export type LifeCycle = 'DEFINED' | 'PREPARED' | 'RUNNING' | 'STOPPED' | 'DELETED';
export type ServiceOperation = 'start' | 'stop' | 'restart' | 'kill' | 'delete'
  | 'includeTemplates' | 'includeInclusions' | 'deployResources';

export interface ServiceSnapshot {
  webOperation?: { operation: 'stop'; status: 'pending' | 'unconfirmed'; submittedAt: number; reason?: string | null };
  creationTime: number;
  connectedTime: number;
  address: Address | null;
  connectAddress: Address | null;
  lifeCycle: LifeCycle;
  processSnapshot: ProcessSnapshot | null;
  properties?: Record<string, unknown>;
  configuration: {
    serviceId: {
      uniqueId: string;
      taskName: string;
      taskServiceId: number;
      nodeUniqueId: string;
      environment: string;
    };
    runtime: string;
    port: number;
    staticService: boolean;
    autoDeleteOnStop: boolean;
    groups: string[];
    processConfig: {
      maxHeapMemorySize: number;
      jvmOptions: string[];
      processParameters: string[];
    } | null;
    [key: string]: unknown;
  };
}

export interface NodeInfo {
  uniqueId: string;
  listeners: Address[];
}

export interface NodeSnapshot {
  creationTime: number;
  version: string;
  currentServicesCount: number;
  usedMemory: number;
  reservedMemory: number;
  maxMemory: number;
  systemCpuUsage: number;
  maxCPUUsageToStartServices: number;
  processSnapshot: ProcessSnapshot | null;
}

export interface ServiceMetrics {
  cpuPercent: number;
  residentMemoryBytes: number;
  pid?: number;
  reason?: string;
}

export interface NodeMetrics {
  nodeUniqueId: string;
  status: 'available' | 'unavailable';
  sampledAt: number;
  reason?: string;
  logicalCpuCount: number;
  cpuPercent: number;
  totalMemoryBytes: number;
  usedMemoryBytes: number;
  availableMemoryBytes: number;
  runningConfiguredMemoryMb: number;
  reservedMemoryMb: number;
  maxMemoryMb: number;
  maxCpuPercent: number;
  services: Record<string, ServiceMetrics>;
  memoryPercent?: number;
  diskReadBytesPerSecond?: number;
  diskWriteBytesPerSecond?: number;
  networkReceiveBytesPerSecond?: number;
  networkSendBytesPerSecond?: number;
  diskDevices?: string[];
  networkInterfaces?: string[];
  diskReason?: string;
  networkReason?: string;
}

export interface MetricsResponse { nodes: NodeMetrics[] }
export type HistoryField = 'cpuPercent' | 'memoryPercent' | 'usedMemoryBytes' | 'totalMemoryBytes'
  | 'diskReadBytesPerSecond' | 'diskWriteBytesPerSecond' | 'networkReceiveBytesPerSecond' | 'networkSendBytesPerSecond';
export interface MetricAggregate { average: number; peak: number; samples: number }
export interface MetricPoint<Field extends string = HistoryField> {
  time: number;
  values: Partial<Record<Field, MetricAggregate>>;
  devices?: { diskDevices: string[]; networkInterfaces: string[] };
}
export interface NodeHistory {
  nodeUniqueId: string;
  status: 'available' | 'unavailable';
  reason?: string;
  historyReason?: string;
  points?: MetricPoint[];
}
export interface MetricsHistoryResponse { nodes: NodeHistory[]; generatedAt: number }
export type ServiceHistoryField = 'TPS-1m' | 'TPS-5m' | 'TPS-15m' | 'cpuPercent' | 'residentMemoryBytes' | 'Online-Count';
export interface ServiceHistory { points: MetricPoint<ServiceHistoryField>[]; historyReason?: string }
export interface ServiceHistoryNode {
  nodeUniqueId: string;
  status: 'available' | 'unavailable';
  reason?: string;
  historyReason?: string;
  services?: Record<string, ServiceHistory>;
}
export interface ServiceHistoryResponse {
  nodes: ServiceHistoryNode[];
  generatedAt: number;
  from: number;
  to: number;
  step: number;
}
export type TaskHistoryField = 'Online-Count' | 'residentMemoryBytes' | 'cpuCores';
export interface PlayerCountHistory { points: MetricPoint<TaskHistoryField>[]; historyReason?: string }
export interface PlayerHistoryNode {
  nodeUniqueId: string;
  status: 'available' | 'unavailable';
  reason?: string;
  historyReason?: string;
  samplingReason?: string;
  sampledAt?: number;
  points?: MetricPoint<'Online-Count'>[];
  tasks?: Record<string, PlayerCountHistory>;
}
export interface PlayerHistoryResponse {
  nodes: PlayerHistoryNode[];
  generatedAt: number;
  from: number;
  to: number;
  step: number;
}
export interface ConsoleLogFile { id: string; name: string; size: number; modifiedAt: number }
export interface ConsoleLogPage { lines: string[]; nextCursor: string | null; startLine: number; endLine: number }

export interface ClusterEntry {
  node: NodeInfo;
  nodeInfoSnapshot: NodeSnapshot | null;
}

export interface StatusSnapshot {
  Version: string | null;
  'Version-Title': string | null;
  Identity: NodeInfo;
  currentNetworkClusterNodeInfoSnapshot: NodeSnapshot | null;
  providedServicesCount: number;
  modules: string[];
}

export interface ServiceTemplate {
  storage: string;
  prefix: string;
  name: string;
  [key: string]: unknown;
}

export interface Configuration {
  name: string;
  templates: ServiceTemplate[];
  includes: unknown[];
  deployments: unknown[];
  properties: Record<string, unknown> & { targetServiceCount?: number };
  jvmOptions?: string[];
  processParameters?: string[];
  targetEnvironments?: string[];
  runtime?: string;
  javaCommand?: string | null;
  maintenance?: boolean;
  staticServices?: boolean;
  autoDeleteOnStop?: boolean;
  disableIpRewrite?: boolean;
  minServiceCount?: number;
  startPort?: number;
  associatedNodes?: string[];
  groups?: string[];
  deletedFilesAfterStop?: string[];
  processConfiguration?: {
    environment: string;
    maxHeapMemorySize: number;
    jvmOptions: string[];
    processParameters: string[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface CreateServicesResult {
  results: { success: boolean; service?: ServiceSnapshot; reason?: string }[];
}

export interface CommandResult {
  success: boolean;
  receivedMessages?: string[];
}

export type ConsoleType = 'service' | 'node';
export type ConsoleFrame =
  | { type: 'snapshot'; sequence: number; lines: string[]; streamId?: string; firstSequence?: number }
  | { type: 'line'; sequence: number; line: string }
  | { type: 'state'; state: string }
  | { type: 'error'; code: number; message: string };

export interface PlayerServiceReference {
  uniqueId: string;
  name: string;
  taskName: string;
  nodeUniqueId: string;
}

export interface OnlinePlayer {
  uniqueId: string;
  name: string;
  server: PlayerServiceReference | null;
  proxy: PlayerServiceReference | null;
  firstLoginTimeMillis: number;
  lastLoginTimeMillis: number;
}

export type PlayerAction = 'connect' | 'message' | 'kick';

export interface PlayerActionRequest {
  playerIds: string[];
  targetServiceId?: string;
  message?: string;
  reason?: string;
}

export interface PlayerActionResponse {
  results: {
    uniqueId: string;
    name: string | null;
    status: 'submitted' | 'not_submitted';
    reason?: string;
  }[];
}

export type TaskHistoryResponse = PlayerHistoryResponse;
export interface TaskOperation {
  id: string;
  task: string;
  action: 'minimum' | 'target' | 'stop' | 'clear-stop';
  status: 'queued' | 'saving' | 'stopping' | 'completed';
  count: number | null;
  minimumSaved: boolean;
  targetSaved: boolean;
  total: number;
  results: { id: string; name: string; node: string; status: 'submitted' | 'skipped' | 'not_submitted'; reason?: string }[];
  reason?: string;
  completedAt: number;
}
