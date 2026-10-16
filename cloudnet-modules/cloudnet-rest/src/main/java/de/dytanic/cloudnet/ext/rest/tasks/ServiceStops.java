package de.dytanic.cloudnet.ext.rest.tasks;

import com.google.gson.JsonObject;
import de.dytanic.cloudnet.CloudNet;
import de.dytanic.cloudnet.cluster.NodeServer;
import de.dytanic.cloudnet.common.document.gson.JsonDocument;
import de.dytanic.cloudnet.driver.service.ServiceInfoSnapshot;
import de.dytanic.cloudnet.driver.service.ServiceLifeCycle;
import de.dytanic.cloudnet.service.ICloudService;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/** Entry-local submission tracking; the core still owns the service lifecycle. */
public final class ServiceStops implements AutoCloseable {
  private final CloudNet cloud = CloudNet.getInstance();
  private final Map<UUID, Stop> pending = new ConcurrentHashMap<>();
  private volatile boolean closed;

  public JsonDocument submit(ServiceInfoSnapshot original) {
    UUID id = original.getServiceId().getUniqueId();
    Stop stop;
    ServiceInfoSnapshot current;
    synchronized (this) {
      if (this.closed) return result(503, "not_submitted", "REST 模块已停止");
      current = this.current(id);
      this.reconcile(id, current);
      if (this.pending.containsKey(id)) return result(409, "skipped", "实例已在停止中，未重复提交").append("pending", true);
      if (current == null || current.getLifeCycle() != ServiceLifeCycle.RUNNING) return result(409, "skipped", "实例已停止或删除");
      stop = new Stop(current);
      if (!this.available(stop.node)) return result(503, "not_submitted", "所属节点不可达，未提交停止");
      this.pending.put(id, stop);
    }
    try {
      if (this.closed || Thread.currentThread().isInterrupted()) {
        this.pending.remove(id, stop);
        return result(503, "not_submitted", "操作已中断，未提交停止");
      }
      current.provider().stopAsync().get(5, TimeUnit.SECONDS);
      return result(200, "submitted", "停止请求已提交，等待实际状态确认");
    } catch (InterruptedException exception) {
      Thread.currentThread().interrupt();
      stop.reason = "停止提交等待被中断，可能已执行；不会自动重发";
    } catch (TimeoutException exception) {
      stop.reason = "停止提交等待超时，可能已执行；不会自动重发";
    } catch (ExecutionException | RuntimeException exception) {
      stop.reason = "停止结果未确认：" + (exception.getCause() == null ? exception.getMessage() : exception.getCause().getMessage());
    }
    return result(503, "not_submitted", stop.reason).append("pending", true);
  }

  public synchronized boolean isStopping(UUID id) {
    this.reconcile(id, this.current(id));
    return this.pending.containsKey(id);
  }

  public synchronized JsonObject snapshot(ServiceInfoSnapshot original) {
    UUID id = original.getServiceId().getUniqueId();
    // Read the cache and clear terminal operations under the same lock. Stop events fire
    // before the global snapshot is replaced, and the caller may hold an older snapshot.
    ServiceInfoSnapshot service = this.current(id);
    this.reconcile(id, service);
    if (service == null) return null;
    JsonDocument result = new JsonDocument(service);
    Stop stop = this.pending.get(id);
    if (stop != null) {
      String reason = !this.available(stop.node) ? "所属节点不可达，停止结果未确认" : stop.reason;
      if (reason == null && System.currentTimeMillis() - stop.submittedAt >= 60_000) reason = "提交超过 60 秒，尚未确认停止；请查看后台或使用强制终止";
      result.append("webOperation", new JsonDocument("operation", "stop")
        .append("status", reason == null ? "pending" : "unconfirmed")
        .append("submittedAt", stop.submittedAt).append("reason", reason).toJsonObject());
    }
    return result.toJsonObject();
  }

  public synchronized void reconcile() {
    this.pending.keySet().forEach(id -> this.reconcile(id, this.current(id)));
  }

  private void reconcile(UUID id, ServiceInfoSnapshot service) {
    Stop stop = this.pending.get(id);
    if (stop != null && this.available(stop.node) && (service == null || service.getLifeCycle() == ServiceLifeCycle.STOPPED
        || service.getLifeCycle() == ServiceLifeCycle.PREPARED || service.getLifeCycle() == ServiceLifeCycle.DELETED
        || service.getLifeCycle() == ServiceLifeCycle.RUNNING && stop.pid > 0 && pid(service) > 0 && stop.pid != pid(service))) {
      this.pending.remove(id, stop);
    }
  }

  private ServiceInfoSnapshot current(UUID id) {
    ICloudService local = this.cloud.getCloudServiceManager().getCloudServices().get(id);
    if (local != null) return local.getServiceInfoSnapshot();
    ServiceInfoSnapshot snapshot = this.cloud.getCloudServiceProvider().getCloudService(id);
    // Local removal is authoritative even while the global cache is still being unregistered.
    return snapshot != null && snapshot.getServiceId().getNodeUniqueId().equals(this.cloud.getComponentName()) ? null : snapshot;
  }

  private static int pid(ServiceInfoSnapshot service) {
    return service.getProcessSnapshot() == null ? -1 : service.getProcessSnapshot().getPid();
  }

  private boolean available(String nodeId) {
    if (nodeId.equals(this.cloud.getComponentName())) return true;
    NodeServer node = this.cloud.getClusterNodeServerProvider().getNodeServer(nodeId);
    return node != null && node.isAvailable();
  }

  @Override
  public synchronized void close() {
    this.closed = true;
    this.pending.clear();
  }

  private static JsonDocument result(int code, String status, String reason) {
    return new JsonDocument("code", code).append("success", code == 200).append("status", status)
      .append("reason", reason).append("pending", code == 200);
  }

  private static final class Stop {
    final String node;
    final int pid;
    final long submittedAt = System.currentTimeMillis();
    volatile String reason;
    Stop(ServiceInfoSnapshot service) { this.node = service.getServiceId().getNodeUniqueId(); this.pid = pid(service); }
  }
}
