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
export type ServiceOperation = 'start' | 'stop' | 'restart';

export interface ServiceSnapshot {
  creationTime: number;
  connectedTime: number;
  address: Address | null;
  connectAddress: Address | null;
  lifeCycle: LifeCycle;
  processSnapshot: ProcessSnapshot | null;
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
  processSnapshot: ProcessSnapshot | null;
}

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
