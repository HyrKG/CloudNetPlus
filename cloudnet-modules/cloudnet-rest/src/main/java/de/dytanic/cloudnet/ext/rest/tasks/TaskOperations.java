package de.dytanic.cloudnet.ext.rest.tasks;

import de.dytanic.cloudnet.CloudNet;
import de.dytanic.cloudnet.cluster.NodeServer;
import de.dytanic.cloudnet.common.document.gson.JsonDocument;
import de.dytanic.cloudnet.driver.DriverEnvironment;
import de.dytanic.cloudnet.driver.channel.ChannelMessage;
import de.dytanic.cloudnet.driver.event.EventListener;
import de.dytanic.cloudnet.driver.event.events.channel.ChannelMessageReceiveEvent;
import de.dytanic.cloudnet.driver.permission.IPermissionUser;
import de.dytanic.cloudnet.driver.permission.Permission;
import de.dytanic.cloudnet.driver.service.ServiceInfoSnapshot;
import de.dytanic.cloudnet.driver.service.ServiceLifeCycle;
import de.dytanic.cloudnet.driver.service.ServiceTask;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

/** Entry-node batches; lifecycle changes remain owned by the existing service provider. */
public final class TaskOperations implements AutoCloseable {
  private static final String CHANNEL = "cloudnet_rest_task_operations";
  private static final String TASK_PERMISSION = "cloudnet.http.v1.tasks.post";
  private static final String STOP_PERMISSION = "cloudnet.http.v1.services.operation.post";
  private static final String TARGET_SERVICE_COUNT = "targetServiceCount";
  private static volatile TaskOperations instance;
  private final CloudNet cloud = CloudNet.getInstance();
  private final ServiceStops serviceStops = new ServiceStops();
  private final Map<String, Job> jobs = new LinkedHashMap<>();
  private final ThreadPoolExecutor workers = new ThreadPoolExecutor(2, 2, 0, TimeUnit.SECONDS,
    new ArrayBlockingQueue<>(8), runnable -> {
      Thread thread = new Thread(runnable, "rest-task-operation");
      thread.setDaemon(true);
      return thread;
    }, new ThreadPoolExecutor.AbortPolicy());
  private final ScheduledExecutorService expiry = Executors.newSingleThreadScheduledExecutor(runnable -> {
    Thread thread = new Thread(runnable, "rest-task-operation-expiry");
    thread.setDaemon(true);
    return thread;
  });
  private volatile boolean closed;

  public static TaskOperations getInstance() { return instance; }
  public ServiceStops stops() { return this.serviceStops; }

  public void start() {
    instance = this;
    this.cloud.getEventManager().registerListener(this);
    this.expiry.scheduleWithFixedDelay(this::expire, 1, 1, TimeUnit.SECONDS);
  }

  private boolean permission(UUID id, String permission) {
    IPermissionUser user = this.cloud.getPermissionManagement().getUser(id);
    return user != null && this.cloud.getPermissionManagement().hasPermission(user, new Permission(permission, 1));
  }

  private boolean allowed(Job job) {
    return (job.count == null || this.permission(job.user, TASK_PERMISSION))
      && (!job.stop || this.permission(job.user, STOP_PERMISSION));
  }

  public synchronized JsonDocument submit(UUID user, String name, Integer count, boolean stop, boolean target) {
    this.expire();
    Job job = new Job(user, name, count, stop, target);
    if (!this.allowed(job)) return error(403, "没有任务数量修改或实例停止权限");
    ServiceTask task = this.cloud.getServiceTaskProvider().getServiceTask(name);
    if (task == null) return error(404, "任务不存在");
    if (!stop && !target && this.targetCount(task) >= 0) return error(409, "最低数量由目标数量控制，请先停用目标数量");
    job.task = task.getName();
    if (this.closed) return error(503, "REST 模块已停止");
    if (this.jobs.values().stream().anyMatch(item -> item.completedAt == 0 && item.task.equalsIgnoreCase(job.task))) {
      return error(409, "此任务已有未完成的数量修改或停止操作");
    }
    this.jobs.put(job.id, job);
    try { this.workers.execute(() -> this.execute(job)); }
    catch (RejectedExecutionException exception) {
      this.jobs.remove(job.id);
      return error(503, "任务操作繁忙：最多同时执行 2 批、排队 8 批，请稍后重试");
    }
    return new JsonDocument("code", 202).append("id", job.id);
  }

  public synchronized JsonDocument result(String id, UUID user) {
    this.expire();
    Job job = this.jobs.get(id);
    if (job == null || !job.user.equals(user)) return error(404, "操作记录不存在、已过期或入口 REST 已重启");
    if (!this.allowed(job)) return error(403, "已失去此操作所需权限");
    synchronized (job) {
      return new JsonDocument("code", 200).append("id", job.id).append("task", job.task)
        .append("action", job.stop ? job.count == null ? "stop" : "clear-stop" : job.target ? "target" : "minimum")
        .append("status", job.status).append("count", job.count).append("minimumSaved", job.minimumSaved)
        .append("targetSaved", job.targetSaved)
        .append("total", job.total).append("results", new ArrayList<>(job.results))
        .append("reason", job.reason).append("completedAt", job.completedAt);
    }
  }

  private void check(Job job) {
    if (this.closed || Thread.currentThread().isInterrupted()) throw new IllegalStateException("模块已停止，剩余操作未提交");
    if (!this.allowed(job)) throw new IllegalStateException("权限已失效，剩余操作未提交");
  }

  private String head() {
    NodeServer node = this.cloud.getClusterNodeServerProvider().getHeadNode();
    if (node == null || !node.isAvailable()) throw new IllegalStateException("调度主节点不可用");
    return node.getNodeInfo().getUniqueId();
  }

  private void sameHead(String expected) {
    if (!expected.equals(this.head())) throw new IllegalStateException("调度主节点发生变化，未继续停止");
  }

  private int targetCount(ServiceTask task) {
    return task.getProperties().contains(TARGET_SERVICE_COUNT) ? task.getProperties().getInt(TARGET_SERVICE_COUNT) : -1;
  }

  private JsonDocument countState(UUID user, String name) {
    if (!this.permission(user, TASK_PERMISSION)) return error(403, "主节点拒绝数量读取权限");
    ServiceTask task = this.cloud.getServiceTaskProvider().getServiceTask(name);
    return new JsonDocument("head", this.head()).append("count", task == null ? null : task.getMinServiceCount())
      .append(TARGET_SERVICE_COUNT, task == null ? null : this.targetCount(task));
  }

  private void confirmCounts(Job job, String head) throws InterruptedException {
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
    do {
      this.check(job);
      this.sameHead(head);
      JsonDocument state;
      if (head.equals(this.cloud.getComponentName())) state = this.countState(job.user, job.task);
      else {
        ChannelMessage response = ChannelMessage.builder().channel(CHANNEL).message("minimum")
          .targetNode(head).json(new JsonDocument("user", job.user.toString()).append("task", job.task))
          .build().sendSingleQueryAsync().get(Math.max(1, Math.min(TimeUnit.SECONDS.toNanos(3), deadline - System.nanoTime())), TimeUnit.NANOSECONDS, null);
        if (response == null) throw new IllegalStateException("主节点同步未确认，请检查节点连接及 REST 版本；未提交停止");
        state = response.getJson();
      }
      this.sameHead(head);
      if (state.getInt("code") == 403) throw new IllegalStateException(state.getString("reason"));
      if (!head.equals(state.getString("head"))) throw new IllegalStateException("主节点身份不一致，未提交停止");
      if (state.contains("count") && !state.get("count").isJsonNull() && state.getInt("count") == 0
        && state.contains(TARGET_SERVICE_COUNT) && !state.get(TARGET_SERVICE_COUNT).isJsonNull()
        && state.getInt(TARGET_SERVICE_COUNT) == job.expectedTarget) return;
      TimeUnit.MILLISECONDS.sleep(250);
    } while (System.nanoTime() < deadline);
    throw new IllegalStateException("主节点尚未同步最低数量与目标数量，请检查节点 REST 版本；未提交停止");
  }

  private void execute(Job job) {
    List<ServiceInfoSnapshot> batch = new ArrayList<>();
    int processed = 0;
    try {
      this.check(job);
      String head = job.stop && job.count != null ? this.head() : null;
      if (job.count != null) {
        synchronized (job) { job.status = "saving"; }
        ServiceTask latest = this.cloud.getServiceTaskProvider().getServiceTask(job.task);
        if (latest == null) throw new IllegalStateException("任务已删除");
        if (!job.stop && !job.target && this.targetCount(latest) >= 0) {
          throw new IllegalStateException("最低数量由目标数量控制，请先停用目标数量");
        }
        // makeClone() does not preserve every extension field; copy the complete serialized task.
        ServiceTask updated = new JsonDocument(latest).toInstanceOf(ServiceTask.class);
        boolean saveTarget = job.target || job.stop && this.targetCount(latest) >= 0;
        if (saveTarget) updated.getProperties().append(TARGET_SERVICE_COUNT, job.count);
        if (!job.target || job.count >= 0) updated.setMinServiceCount(job.count);
        job.expectedTarget = this.targetCount(updated);
        this.check(job);
        if (head != null) this.sameHead(head);
        if (!this.cloud.getServiceTaskProvider().addPermanentServiceTask(updated)) throw new IllegalStateException("任务数量保存被拒绝");
        synchronized (job) {
          job.minimumSaved = !job.target || job.count >= 0;
          job.targetSaved = saveTarget;
        }
        if (head != null) this.confirmCounts(job, head);
      }
      if (job.stop) {
        this.check(job);
        if (head != null) this.sameHead(head);
        batch = this.cloud.getCloudServiceProvider().getCloudServices(job.task).stream()
          .filter(service -> service.getLifeCycle() == ServiceLifeCycle.RUNNING).collect(Collectors.toList());
        synchronized (job) { job.total = batch.size(); job.status = "stopping"; }
        for (ServiceInfoSnapshot original : batch) {
          this.check(job);
          if (head != null) {
            this.sameHead(head);
            ServiceTask latest = this.cloud.getServiceTaskProvider().getServiceTask(job.task);
            if (latest == null || latest.getMinServiceCount() != 0 || this.targetCount(latest) != job.expectedTarget) {
              throw new IllegalStateException("最低数量或目标数量已变化，未继续停止");
            }
          }
          try {
            this.check(job);
            JsonDocument result = this.serviceStops.submit(original);
            this.record(job, original, result.getString("status"), result.getString("reason"));
          } catch (RuntimeException exception) { this.record(job, original, "not_submitted", exception.getMessage()); }
          processed++;
        }
      }
    } catch (InterruptedException exception) {
      Thread.currentThread().interrupt();
      synchronized (job) { job.reason = "模块已停止或操作被中断，剩余操作未提交；正在等待确认的实例可能已执行，请查看实际状态"; }
    } catch (RuntimeException exception) {
      synchronized (job) { job.reason = exception.getMessage() == null ? exception.getClass().getSimpleName() : exception.getMessage(); }
    } finally {
      for (int i = processed; i < batch.size(); i++) this.record(job, batch.get(i), "not_submitted", job.reason);
      synchronized (job) { job.status = "completed"; job.completedAt = System.currentTimeMillis(); }
      this.expire();
    }
  }

  private void record(Job job, ServiceInfoSnapshot service, String status, String reason) {
    synchronized (job) {
      job.results.add(new JsonDocument("id", service.getServiceId().getUniqueId().toString())
        .append("name", service.getServiceId().getName()).append("node", service.getServiceId().getNodeUniqueId())
        .append("status", status).append("reason", reason));
    }
  }

  private synchronized void expire() {
    this.serviceStops.reconcile();
    long now = System.currentTimeMillis();
    this.jobs.values().removeIf(job -> job.completedAt > 0 && now - job.completedAt >= TimeUnit.MINUTES.toMillis(10));
    List<Job> completed = this.jobs.values().stream().filter(job -> job.completedAt > 0)
      .sorted(Comparator.comparingLong(job -> job.completedAt)).collect(Collectors.toList());
    for (int i = 0; i < completed.size() - 32; i++) this.jobs.remove(completed.get(i).id);
  }

  @EventListener
  public void onMessage(ChannelMessageReceiveEvent event) {
    if (this.closed || !event.isQuery() || !CHANNEL.equals(event.getChannel()) || !"minimum".equals(event.getMessage())
      || event.getSender().getType() != DriverEnvironment.CLOUDNET) return;
    try { event.setJsonResponse(this.countState(UUID.fromString(event.getData().getString("user")), event.getData().getString("task"))); }
    catch (RuntimeException exception) { event.setJsonResponse(error(503, "主节点同步状态不可用")); }
  }

  @Override
  public synchronized void close() {
    this.closed = true;
    if (instance == this) instance = null;
    this.cloud.getEventManager().unregisterListener(this);
    this.expiry.shutdownNow();
    this.workers.shutdownNow();
    this.serviceStops.close();
    this.jobs.clear();
  }

  public static JsonDocument error(int code, String reason) { return new JsonDocument("code", code).append("reason", reason); }

  private static final class Job {
    final String id = UUID.randomUUID().toString();
    final UUID user;
    final Integer count;
    final boolean stop;
    final boolean target;
    final List<JsonDocument> results = new ArrayList<>();
    String task;
    String status = "queued";
    String reason;
    boolean minimumSaved;
    boolean targetSaved;
    int expectedTarget;
    int total;
    volatile long completedAt;
    Job(UUID user, String task, Integer count, boolean stop, boolean target) {
      this.user = user; this.task = task; this.count = count; this.stop = stop; this.target = target;
    }
  }
}
