package de.dytanic.cloudnet.ext.rest.metrics;

import de.dytanic.cloudnet.common.document.gson.JsonDocument;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.HashSet;
import java.util.Set;
import java.util.TreeMap;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/** Shared minute aggregates for node and service metrics. */
final class MetricsHistory implements AutoCloseable {
  private static final long RETENTION = MetricsPolicy.RETENTION;
  private static final long HOUR = TimeUnit.HOURS.toMillis(1);
  private static final String[] NODE_FIELDS = { "cpuPercent", "memoryPercent", "usedMemoryBytes", "totalMemoryBytes",
    "diskReadBytesPerSecond", "diskWriteBytesPerSecond", "networkReceiveBytesPerSecond", "networkSendBytesPerSecond" };
  static final String[] SERVICE_FIELDS = { "cpuPercent", "residentMemoryBytes", "TPS-1m", "TPS-5m", "TPS-15m", "Online-Count" };
  private final Path directory;
  private final String[] fields;
  private final TreeMap<Long, JsonDocument> points = new TreeMap<>();
  private final Map<String, double[]> values = new LinkedHashMap<>();
  private long minute = -1;
  private JsonDocument devices;
  private volatile String error;
  private final Set<Long> dirtyHours = new HashSet<>();
  private long cleanedAt;

  MetricsHistory(Path directory, String... fields) {
    this.directory = directory;
    this.fields = fields.length == 0 ? NODE_FIELDS : fields;
    try {
      Files.createDirectories(directory);
      for (Path file : this.files()) {
        long hour = Long.parseLong(file.getFileName().toString().replace(".json", ""));
        if (hour + HOUR <= System.currentTimeMillis() - RETENTION) {
          Files.deleteIfExists(file);
          continue;
        }
        try {
          JsonDocument document = JsonDocument.newDocument(Files.readAllBytes(file));
          for (JsonDocument point : document.get("points", JsonDocument[].class)) {
            this.points.put(point.getLong("time"), point);
          }
        } catch (RuntimeException | IOException exception) {
          this.error = "部分历史文件读取失败：" + file.getFileName();
        }
      }
      this.idle();
    } catch (IOException exception) {
      this.error = "历史目录不可读写";
    }
  }

  synchronized void add(JsonDocument sample) {
    long next = sample.getLong("sampledAt") / 60000 * 60000;
    if (this.minute != next) {
      this.values.clear();
      this.minute = next;
      // A module restart within the same minute continues the saved aggregate.
      JsonDocument existing = this.points.get(next);
      if (existing != null) {
        for (String field : this.fields) {
          JsonDocument value = existing.getDocument("values").getDocument(field);
          if (value == null) continue;
          int count = value.getInt("samples");
          if (count > 0) this.values.put(field, new double[] { value.getDouble("average") * count, value.getDouble("peak"), count });
        }
      }
    }
    for (String field : this.fields) {
      Double value = MetricsPolicy.number(sample, field);
      if (value == null) continue;
      double[] aggregate = this.values.computeIfAbsent(field, ignored -> new double[3]);
      aggregate[0] += value;
      aggregate[1] = Math.max(aggregate[1], value);
      aggregate[2]++;
    }
    this.devices = sample.contains("diskDevices") || sample.contains("networkInterfaces")
      ? new JsonDocument("diskDevices", sample.get("diskDevices", String[].class))
        .append("networkInterfaces", sample.get("networkInterfaces", String[].class)) : null;
    if (!this.values.isEmpty()) {
      this.points.put(this.minute, this.point());
      this.dirtyHours.add(this.minute / HOUR * HOUR);
    }
  }

  synchronized JsonDocument read(long from, long to, String... selectedFields) {
    long start = Math.min(to, Math.max(from, System.currentTimeMillis() - RETENTION));
    List<JsonDocument> result = new ArrayList<>(this.points.subMap(start, true, to, true).values());
    if (selectedFields.length > 0) {
      result = result.stream().map(point -> {
        JsonDocument values = new JsonDocument();
        JsonDocument source = point.getDocument("values");
        for (String field : selectedFields) if (source.contains(field)) values.append(field, source.get(field));
        return new JsonDocument("time", point.getLong("time")).append("values", values);
      }).collect(Collectors.toList());
    }
    return new JsonDocument("points", result).append("historyReason", this.error);
  }

  // Only the module sampler calls maintenance; request threads only call read().
  void idle() {
    long now = System.currentTimeMillis();
    synchronized (this) {
      this.points.headMap(now - RETENTION).clear();
      if (this.minute >= 0 && now / MetricsPolicy.MINUTE * MetricsPolicy.MINUTE > this.minute) {
        this.minute = -1;
        this.values.clear();
      }
      if (now / MetricsPolicy.MINUTE == this.cleanedAt / MetricsPolicy.MINUTE) return;
      this.cleanedAt = now;
    }
    this.flush();
    try {
      for (Path file : this.files()) {
        long start = Long.parseLong(file.getFileName().toString().replace(".json", ""));
        if (start + HOUR <= now - RETENTION) Files.deleteIfExists(file);
      }
    } catch (IOException | RuntimeException exception) {
      this.error = "历史文件清理失败";
    }
  }

  private JsonDocument point() {
    JsonDocument fields = new JsonDocument();
    this.values.forEach((key, value) -> fields.append(key, new JsonDocument("average", value[0] / value[2])
      .append("peak", value[1]).append("samples", (int) value[2])));
    JsonDocument point = new JsonDocument("time", this.minute).append("values", fields);
    return this.devices == null ? point : point.append("devices", this.devices);
  }

  private List<Path> files() throws IOException {
    try (Stream<Path> stream = Files.list(this.directory)) {
      return stream.filter(path -> path.getFileName().toString().matches("[0-9]+\\.json"))
        .collect(Collectors.toList());
    }
  }

  private void flush() {
    Map<Long, JsonDocument> pending = new LinkedHashMap<>();
    synchronized (this) {
      for (long hour : this.dirtyHours) {
        pending.put(hour, new JsonDocument("points", new ArrayList<>(
          this.points.subMap(hour, true, hour + HOUR, false).values())));
      }
    }
    // The sampler owns all writes, including shutdown flushing. No disk I/O holds the read lock.
    pending.forEach((hour, document) -> {
      try {
        Files.createDirectories(this.directory);
        Path temporary = this.directory.resolve(hour + ".tmp");
        Files.write(temporary, document.toByteArray());
        Files.move(temporary, this.directory.resolve(hour + ".json"), StandardCopyOption.REPLACE_EXISTING);
        synchronized (this) { this.dirtyHours.remove(hour); }
        this.error = null;
      } catch (IOException | RuntimeException exception) {
        this.error = "历史保存失败，当前仅能读取内存中的数据";
      }
    });
  }

  boolean discardIfEmpty() {
    synchronized (this) {
      if (!this.points.isEmpty() || !this.dirtyHours.isEmpty() || this.minute >= 0) return false;
    }
    try {
      Files.deleteIfExists(this.directory);
      return true;
    } catch (IOException | RuntimeException exception) {
      return false;
    }
  }

  @Override
  public void close() { this.flush(); }
}
