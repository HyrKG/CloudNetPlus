package de.dytanic.cloudnet.ext.rest.metrics;

import de.dytanic.cloudnet.CloudNet;
import de.dytanic.cloudnet.common.concurrent.ITask;
import de.dytanic.cloudnet.common.document.gson.JsonDocument;
import de.dytanic.cloudnet.driver.DriverEnvironment;
import de.dytanic.cloudnet.driver.channel.ChannelMessage;
import de.dytanic.cloudnet.driver.event.EventListener;
import de.dytanic.cloudnet.driver.event.events.channel.ChannelMessageReceiveEvent;
import de.dytanic.cloudnet.driver.permission.IPermissionUser;
import de.dytanic.cloudnet.driver.permission.Permission;
import de.dytanic.cloudnet.driver.service.ProcessSnapshot;
import de.dytanic.cloudnet.driver.service.ServiceInfoSnapshot;
import de.dytanic.cloudnet.driver.service.ServiceLifeCycle;
import java.io.IOException;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import java.nio.file.Path;
import java.util.concurrent.Executors;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.stream.Stream;
import oshi.SystemInfo;
import oshi.hardware.CentralProcessor;
import oshi.hardware.GlobalMemory;
import oshi.hardware.HWDiskStore;
import oshi.hardware.NetworkIF;
import oshi.software.os.OSProcess;

/** Node-local sampling; HTTP readers and cluster queries only read the latest immutable snapshot. */
public final class ResourceMetrics implements AutoCloseable {
  public static final String PERMISSION = "cloudnet.http.v1.metrics.get";
  private static final String CHANNEL = "cloudnet_rest_metrics";
  private static ResourceMetrics instance;
  private final CloudNet cloud = CloudNet.getInstance();
  private final ScheduledExecutorService sampler = Executors.newSingleThreadScheduledExecutor(runnable -> {
    Thread thread = new Thread(() -> {
      try { runnable.run(); }
      finally {
        boolean interrupted = Thread.interrupted();
        try { this.closeHistories(); }
        finally { if (interrupted) Thread.currentThread().interrupt(); }
      }
    }, "rest-resource-metrics");
    thread.setDaemon(true);
    return thread;
  });
  private SystemInfo system;
  private long[] previousTicks;
  private Map<UUID, OSProcess> previousProcesses = new HashMap<>();
  private volatile JsonDocument snapshot;
  private volatile MetricsHistory history;
  private volatile PlayerHistory playerHistory;
  private final Path directory;
  private volatile boolean ready;
  private volatile boolean closed;
  private final Path serviceHistoryDirectory;
  private final Map<String, MetricsHistory> serviceHistories = new ConcurrentHashMap<>();
  private volatile String serviceHistoryReason;
  private long serviceHistoryCleanup;
  private final Map<String, long[]> diskCounters = new HashMap<>();
  private final Map<String, long[]> networkCounters = new HashMap<>();

  public ResourceMetrics(Path directory) {
    this.directory = directory;
    this.serviceHistoryDirectory = directory.resolve("metrics/services");
  }

  private void restore() {
    this.history = new MetricsHistory(this.directory.resolve("metrics"));
    this.playerHistory = new PlayerHistory(this.directory.resolve("metrics/players"));
    try {
      Files.createDirectories(this.serviceHistoryDirectory);
      try (Stream<Path> directories = Files.list(this.serviceHistoryDirectory)) {
        directories.filter(Files::isDirectory).filter(path -> path.getFileName().toString()
          .matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"))
          .forEach(path -> this.serviceHistories.put(path.getFileName().toString(),
            new MetricsHistory(path, MetricsHistory.SERVICE_FIELDS)));
      }
    } catch (IOException exception) {
      this.serviceHistoryReason = "服务器历史目录读取失败";
    }
    this.ready = true;
  }

  public static ResourceMetrics getInstance() { return instance; }

  public void start() {
    instance = this;
    this.snapshot = unavailable(this.cloud.getComponentName(), "正在采集");
    this.cloud.getEventManager().registerListener(this);
    this.sampler.scheduleWithFixedDelay(() -> {
      if (this.closed) return;
      try {
        if (!this.ready) this.restore();
        this.sample();
      } catch (RuntimeException | LinkageError exception) {
        this.snapshot = unavailable(this.cloud.getComponentName(), "采样失败，下一轮重试：" + exception.getClass().getSimpleName());
      }
    }, 0, MetricsPolicy.SAMPLE_SECONDS, TimeUnit.SECONDS);
  }

  private void sample() {
    long now = System.currentTimeMillis();
    List<ServiceInfoSnapshot> running = new ArrayList<>();
    this.cloud.getCloudServiceManager().getCloudServices().values().forEach(service -> {
      if (service.getLifeCycle() == ServiceLifeCycle.RUNNING) running.add(service.getServiceInfoSnapshot());
    });
    try {
      if (this.system == null) this.system = new SystemInfo();
      CentralProcessor cpu = this.system.getHardware().getProcessor();
      GlobalMemory memory = this.system.getHardware().getMemory();
      int cores = cpu.getLogicalProcessorCount();
      long[] ticks = cpu.getSystemCpuLoadTicks();
      double load = this.previousTicks == null ? -1 : cpu.getSystemCpuLoadBetweenTicks(this.previousTicks) * 100;
      this.previousTicks = ticks;
      Map<String, JsonDocument> services = new LinkedHashMap<>();
      Map<UUID, OSProcess> next = new HashMap<>();
      running.forEach(service -> {
        UUID id = service.getServiceId().getUniqueId();
        ProcessSnapshot process = service.getProcessSnapshot();
        JsonDocument value = new JsonDocument("cpuPercent", -1).append("residentMemoryBytes", -1);
        try {
          OSProcess current = process == null || process.getPid() <= 0 ? null
            : this.system.getOperatingSystem().getProcess(process.getPid());
          if (current == null || current.getState() == OSProcess.State.INVALID) {
            value.append("reason", "进程采样不可用");
          } else {
            OSProcess previous = this.previousProcesses.get(id);
            boolean comparable = previous != null && previous.getProcessID() == current.getProcessID()
              && previous.getStartTime() == current.getStartTime();
            value.append("cpuPercent", comparable ? current.getProcessCpuLoadBetweenTicks(previous) / cores * 100 : -1)
              .append("residentMemoryBytes", current.getResidentSetSize()).append("pid", current.getProcessID());
            if (!comparable) value.append("reason", "CPU 正在采样");
            next.put(id, current);
          }
        } catch (RuntimeException exception) {
          value.append("reason", "进程采集失败");
        }
        services.put(id.toString(), value);
      });
      this.previousProcesses = next;
      long total = memory.getTotal();
      long available = memory.getAvailable();
      JsonDocument result = new JsonDocument("nodeUniqueId", this.cloud.getComponentName())
        .append("status", "available").append("sampledAt", System.currentTimeMillis())
        .append("logicalCpuCount", cores).append("cpuPercent", load)
        .append("totalMemoryBytes", total).append("availableMemoryBytes", available)
        .append("usedMemoryBytes", total - available)
        .append("memoryPercent", total > 0 ? (total - available) * 100.0 / total : -1)
        .append("runningConfiguredMemoryMb", this.cloud.getCloudServiceManager().getCurrentUsedHeapMemory())
        .append("reservedMemoryMb", this.cloud.getCloudServiceManager().getCurrentReservedMemory())
        .append("maxMemoryMb", this.cloud.getConfig().getMaxMemory())
        .append("maxCpuPercent", this.cloud.getConfig().getMaxCPUUsageToStartServices())
        .append("services", services);
      this.sampleIo(result, true);
      this.sampleIo(result, false);
      this.snapshot = result;
      this.history.add(result);
    } catch (RuntimeException | LinkageError exception) {
      this.previousTicks = null;
      this.previousProcesses.clear();
      this.diskCounters.clear();
      this.networkCounters.clear();
      this.snapshot = unavailable(this.cloud.getComponentName(), "系统资源采集失败：" + exception.getClass().getSimpleName());
    }
    try { this.playerHistory.sample(this.cloud, running, this.snapshot, now); }
    catch (RuntimeException exception) { this.serviceHistoryReason = "人数历史维护失败"; }
    this.sampleServiceHistory(running, now);
    this.history.idle();
  }

  private void sampleServiceHistory(List<ServiceInfoSnapshot> services, long now) {
    JsonDocument processes = this.snapshot.getDocument("services");
    Set<String> running = new HashSet<>();
    services.forEach(service -> {
      String id = service.getServiceId().getUniqueId().toString();
      running.add(id);
      JsonDocument sample = new JsonDocument("sampledAt", now);
      JsonDocument process = processes == null ? null : processes.getDocument(id);
      if (process != null) sample.append("cpuPercent", process.get("cpuPercent"))
        .append("residentMemoryBytes", process.get("residentMemoryBytes"));
      if (MetricsPolicy.fresh(service, now)) {
        for (String field : new String[] { "TPS-1m", "TPS-5m", "TPS-15m", "Online-Count" }) {
          if (service.getProperties().contains(field)) sample.append(field, service.getProperties().get(field));
        }
      }
      try {
        this.serviceHistories.computeIfAbsent(id, key -> new MetricsHistory(
          this.serviceHistoryDirectory.resolve(key), MetricsHistory.SERVICE_FIELDS)).add(sample);
      } catch (RuntimeException exception) {
        this.serviceHistoryReason = "实例历史采样失败：" + id;
      }
    });
    this.serviceHistories.values().forEach(MetricsHistory::idle);
    if (now - this.serviceHistoryCleanup >= MetricsPolicy.MINUTE) {
      this.serviceHistoryCleanup = now;
      this.serviceHistories.entrySet().removeIf(entry -> !running.contains(entry.getKey()) && entry.getValue().discardIfEmpty());
    }
  }

  private void sampleIo(JsonDocument result, boolean disk) {
    String first = disk ? "diskReadBytesPerSecond" : "networkReceiveBytesPerSecond";
    String second = disk ? "diskWriteBytesPerSecond" : "networkSendBytesPerSecond";
    String devices = disk ? "diskDevices" : "networkInterfaces";
    String reason = disk ? "diskReason" : "networkReason";
    Map<String, long[]> previous = disk ? this.diskCounters : this.networkCounters;
    Map<String, long[]> next = new LinkedHashMap<>();
    result.append(first, -1).append(second, -1).append(devices, new ArrayList<>());
    try {
      long time = System.nanoTime();
      if (disk) {
        for (HWDiskStore device : this.system.getHardware().getDiskStores()) {
          next.put(device.getName(), new long[] { device.getReadBytes(), device.getWriteBytes(), time });
        }
      } else {
        for (NetworkIF device : this.system.getHardware().getNetworkIFs(false)) {
          next.put(device.getName(), new long[] { device.getBytesRecv(), device.getBytesSent(), time });
        }
      }
      result.append(devices, new ArrayList<>(next.keySet()));
      boolean valid = !next.isEmpty();
      double read = 0;
      double write = 0;
      for (Map.Entry<String, long[]> entry : next.entrySet()) {
        long[] current = entry.getValue();
        long[] before = previous.get(entry.getKey());
        if (before == null || current[0] < before[0] || current[1] < before[1] || current[2] <= before[2]) {
          valid = false;
          continue;
        }
        double seconds = (current[2] - before[2]) / 1_000_000_000.0;
        read += (current[0] - before[0]) / seconds;
        write += (current[1] - before[1]) / seconds;
      }
      previous.clear();
      previous.putAll(next);
      if (valid) result.append(first, read).append(second, write);
      else result.append(reason, next.isEmpty() ? "没有可用采集设备" : "等待两次连续采样，或设备计数已重置");
    } catch (RuntimeException | LinkageError exception) {
      previous.clear();
      result.append(reason, "设备 IO 采集不可用");
    }
  }

  public List<JsonDocument> cluster(UUID user) {
    return this.cluster(user, null, 0, 0);
  }

  public List<JsonDocument> cluster(UUID user, String nodeId, long from, long to) {
    return this.cluster(user, nodeId, from, to, null, to > 0 ? "history" : "snapshot");
  }

  public List<JsonDocument> serviceHistory(UUID user, List<String> services, long from, long to) {
    return this.cluster(user, null, from, to, services, "service-history");
  }

  public List<JsonDocument> playerHistory(UUID user, long from, long to) {
    return this.cluster(user, null, from, to, null, "player-history");
  }

  public List<JsonDocument> taskHistory(UUID user, List<String> tasks, String node, long from, long to) {
    return this.cluster(user, node, from, to, tasks, "task-history");
  }

  private List<JsonDocument> cluster(UUID user, String nodeId, long from, long to, List<String> services, String message) {
    List<JsonDocument> results = new ArrayList<>();
    if (nodeId == null || nodeId.equals(this.cloud.getComponentName())) {
      results.add(this.localResponse(message, services, from, to));
    }
    Map<String, ITask<ChannelMessage>> queries = new LinkedHashMap<>();
    this.cloud.getClusterNodeServerProvider().getNodeServers().forEach(node -> {
      String id = node.getNodeInfo().getUniqueId();
      if (id.equals(this.cloud.getComponentName())) return;
      if (nodeId != null && !nodeId.equals(id)) return;
      if (!node.isConnected()) {
        results.add(unavailable(id, "节点未连接"));
      } else {
        try {
          queries.put(id, ChannelMessage.builder().channel(CHANNEL).message(message).targetNode(id)
            .json(new JsonDocument("user", user.toString()).append("from", from).append("to", to)
              .append("task-history".equals(message) ? "tasks" : "services", services)).build().sendSingleQueryAsync());
        } catch (RuntimeException exception) {
          results.add(unavailable(id, "节点采样查询失败"));
        }
      }
    });
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3);
    queries.forEach((id, query) -> {
      ChannelMessage response = query.get(Math.max(1, deadline - System.nanoTime()), TimeUnit.NANOSECONDS, null);
      results.add(response == null ? unavailable(id, "采集不可用，请检查节点 REST 版本及连接") : response.getJson());
    });
    return results;
  }

  private JsonDocument localResponse(String message, List<String> services, long from, long to) {
    if (this.closed || !this.ready) return unavailable(this.cloud.getComponentName(), "采样未就绪或模块已停止");
    long now = System.currentTimeMillis();
    to = Math.min(to, now);
    from = Math.min(to, Math.max(from, now - MetricsPolicy.RETENTION));
    switch (message) {
      case "service-history": return this.localServiceHistory(services, from, to);
      case "history": return this.localHistory(from, to);
      case "task-history":
        return this.playerHistory.readTasks(services, from, to).append("nodeUniqueId", this.cloud.getComponentName())
          .append("status", "available").append("from", from).append("to", to).append("step", MetricsPolicy.MINUTE);
      case "player-history":
        return this.playerHistory.read(from, to).append("nodeUniqueId", this.cloud.getComponentName())
          .append("status", "available").append("from", from).append("to", to).append("step", MetricsPolicy.MINUTE);
      default: return this.snapshot;
    }
  }

  private JsonDocument localHistory(long from, long to) {
    return this.history.read(from, to).append("nodeUniqueId", this.cloud.getComponentName())
      .append("status", "available").append("from", from).append("to", to).append("step", MetricsPolicy.MINUTE);
  }

  private JsonDocument localServiceHistory(List<String> ids, long from, long to) {
    Map<String, JsonDocument> services = new LinkedHashMap<>();
    for (String id : ids) {
      MetricsHistory store = this.serviceHistories.get(id);
      if (store != null) services.put(id, store.read(from, to));
    }
    return new JsonDocument("nodeUniqueId", this.cloud.getComponentName()).append("status", "available")
      .append("from", from).append("to", to).append("step", MetricsPolicy.MINUTE).append("services", services)
      .append("historyReason", this.serviceHistoryReason);
  }

  private static JsonDocument unavailable(String node, String reason) {
    return new JsonDocument("nodeUniqueId", node).append("status", "unavailable").append("reason", reason)
      .append("sampledAt", 0);
  }

  @EventListener
  public void onMessage(ChannelMessageReceiveEvent event) {
    if (!CHANNEL.equals(event.getChannel()) || !event.isQuery()
      || !("snapshot".equals(event.getMessage()) || "history".equals(event.getMessage())
        || "task-history".equals(event.getMessage()) || "service-history".equals(event.getMessage()) || "player-history".equals(event.getMessage()))
      || event.getSender().getType() != DriverEnvironment.CLOUDNET) return;
    IPermissionUser user = this.cloud.getPermissionManagement().getUser(UUID.fromString(event.getData().getString("user")));
    event.setJsonResponse(user != null && this.cloud.getPermissionManagement().hasPermission(user, new Permission(PERMISSION, 1))
      ? this.localResponse(event.getMessage(), "task-history".equals(event.getMessage()) || "service-history".equals(event.getMessage())
        ? java.util.Arrays.asList(event.getData().get("task-history".equals(event.getMessage()) ? "tasks" : "services", String[].class)) : null,
        event.getData().getLong("from"), event.getData().getLong("to"))
      : unavailable(this.cloud.getComponentName(), "没有资源读取权限"));
  }

  private void closeHistories() {
    if (this.history != null) this.history.close();
    if (this.playerHistory != null) this.playerHistory.close();
    this.serviceHistories.values().forEach(MetricsHistory::close);
  }

  @Override
  public void close() {
    this.closed = true;
    this.cloud.getEventManager().unregisterListener(this);
    if (instance == this) instance = null;
    this.sampler.shutdownNow();
    try { this.sampler.awaitTermination(5, TimeUnit.SECONDS); }
    catch (InterruptedException exception) { Thread.currentThread().interrupt(); }
    // Worker termination flushes after sampling has ended, never concurrently with it.
  }
}
