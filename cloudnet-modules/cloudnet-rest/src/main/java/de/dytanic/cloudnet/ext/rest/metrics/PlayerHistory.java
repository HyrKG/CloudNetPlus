package de.dytanic.cloudnet.ext.rest.metrics;

import com.google.common.io.BaseEncoding;
import de.dytanic.cloudnet.CloudNet;
import de.dytanic.cloudnet.common.document.gson.JsonDocument;
import de.dytanic.cloudnet.driver.service.ServiceInfoSnapshot;
import java.util.List;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Stream;

/** Node and task totals are sampled before minute aggregation, independently of instance UUIDs. */
final class PlayerHistory implements AutoCloseable {
  private static final String FIELD = "Online-Count";
  private static final String[] TASK_FIELDS = { FIELD, "residentMemoryBytes", "cpuCores" };
  private static final BaseEncoding TASK_ENCODING = BaseEncoding.base16().lowerCase();
  private final MetricsHistory node;
  private final Path taskDirectory;
  private final Map<String, MetricsHistory> tasks = new ConcurrentHashMap<>();
  private volatile String historyReason;
  private volatile String samplingReason;
  private volatile long sampledAt;
  private long cleanedAt;

  PlayerHistory(Path directory) {
    this.node = new MetricsHistory(directory.resolve("node"), FIELD);
    this.taskDirectory = directory.resolve("tasks");
    try {
      Files.createDirectories(this.taskDirectory);
      try (Stream<Path> directories = Files.list(this.taskDirectory)) {
        directories.filter(Files::isDirectory).filter(path -> path.getFileName().toString().matches("(?:[0-9a-f]{2})+"))
          .forEach(path -> this.tasks.put(new String(TASK_ENCODING.decode(path.getFileName().toString()), StandardCharsets.UTF_8),
            new MetricsHistory(path, TASK_FIELDS)));
      }
    } catch (IOException exception) {
      this.historyReason = "任务人数历史目录读取失败";
    }
  }

  void sample(CloudNet cloud, List<ServiceInfoSnapshot> services, JsonDocument resources, long now) {
    try {
      Map<String, double[]> totals = new HashMap<>();
      cloud.getServiceTaskProvider().getPermanentServiceTasks().forEach(task -> totals.put(task.getName(), new double[3]));
      Set<String> invalid = new HashSet<>();
      JsonDocument processes = resources.getDocument("services");
      Double cores = MetricsPolicy.number(resources, "logicalCpuCount");
      double nodeTotal = 0;
      boolean nodeValid = true;
      for (ServiceInfoSnapshot info : services) {
        String task = info.getServiceId().getTaskName();
        double[] total = totals.computeIfAbsent(task, key -> new double[3]);
        boolean server = info.getServiceId().getEnvironment().isMinecraftServer();
        Double count = MetricsPolicy.fresh(info, now) ? MetricsPolicy.number(info.getProperties(), FIELD) : null;
        JsonDocument process = processes == null ? null : processes.getDocument(info.getServiceId().getUniqueId().toString());
        Double memory = process == null ? null : MetricsPolicy.number(process, "residentMemoryBytes");
        Double cpu = process == null ? null : MetricsPolicy.number(process, "cpuPercent");
        Double[] values = { count, memory, cpu == null || cores == null || cores <= 0 ? null : cpu * cores / 100 };
        for (int i = 0; i < values.length; i++) total[i] = values[i] == null ? Double.NaN : total[i] + values[i];
        if (count == null) {
          invalid.add(task);
          if (server) nodeValid = false;
        } else if (server) nodeTotal += count;
      }
      JsonDocument nodeSample = new JsonDocument("sampledAt", now);
      if (nodeValid) nodeSample.append(FIELD, nodeTotal);
      this.node.add(nodeSample);
      totals.forEach((task, total) -> {
        JsonDocument sample = new JsonDocument("sampledAt", now);
        for (int i = 0; i < TASK_FIELDS.length; i++) if (Double.isFinite(total[i])) sample.append(TASK_FIELDS[i], total[i]);
        this.tasks.computeIfAbsent(task, name -> new MetricsHistory(
          this.taskDirectory.resolve(TASK_ENCODING.encode(name.getBytes(StandardCharsets.UTF_8))), TASK_FIELDS)).add(sample);
      });
      this.sampledAt = now;
      this.samplingReason = invalid.isEmpty() ? null : "部分实例人数缺失或过期，已跳过对应汇总采样：" + String.join("、", invalid);
      if (now - this.cleanedAt >= MetricsPolicy.MINUTE) {
        this.cleanedAt = now;
        this.tasks.entrySet().removeIf(entry -> !totals.containsKey(entry.getKey()) && entry.getValue().discardIfEmpty());
      }
    } catch (RuntimeException exception) {
      this.samplingReason = "任务采集失败：" + exception.getClass().getSimpleName();
    } finally {
      this.node.idle();
      this.tasks.values().forEach(MetricsHistory::idle);
    }
  }

  JsonDocument readTasks(List<String> names, long from, long to) {
    Map<String, JsonDocument> points = new LinkedHashMap<>();
    for (String name : names) {
      MetricsHistory store = this.tasks.get(name);
      if (store != null) points.put(name, store.read(from, to));
    }
    return new JsonDocument("tasks", points).append("sampledAt", this.sampledAt)
      .append("historyReason", this.historyReason).append("samplingReason", this.samplingReason);
  }

  JsonDocument read(long from, long to) {
    Map<String, JsonDocument> taskPoints = new LinkedHashMap<>();
    this.tasks.forEach((name, store) -> taskPoints.put(name, store.read(from, to, FIELD)));
    JsonDocument result = this.node.read(from, to);
    String nodeReason = result.getString("historyReason");
    return result.append("tasks", taskPoints).append("sampledAt", this.sampledAt)
      .append("samplingReason", this.samplingReason)
      .append("historyReason", this.historyReason == null ? nodeReason
        : nodeReason == null ? this.historyReason : nodeReason + "；" + this.historyReason);
  }

  @Override
  public void close() {
    this.node.close();
    this.tasks.values().forEach(MetricsHistory::close);
  }
}
