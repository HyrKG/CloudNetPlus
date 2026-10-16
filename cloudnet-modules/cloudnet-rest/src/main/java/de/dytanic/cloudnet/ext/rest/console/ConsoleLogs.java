package de.dytanic.cloudnet.ext.rest.console;

import de.dytanic.cloudnet.CloudNet;
import de.dytanic.cloudnet.common.document.gson.JsonDocument;
import de.dytanic.cloudnet.driver.DriverEnvironment;
import de.dytanic.cloudnet.driver.channel.ChannelMessage;
import de.dytanic.cloudnet.driver.event.EventListener;
import de.dytanic.cloudnet.driver.event.events.channel.ChannelMessageReceiveEvent;
import de.dytanic.cloudnet.driver.permission.IPermissionUser;
import de.dytanic.cloudnet.driver.permission.Permission;
import de.dytanic.cloudnet.driver.service.ServiceInfoSnapshot;
import de.dytanic.cloudnet.service.ICloudService;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import java.util.zip.GZIPInputStream;

/** Read-only access to existing logs; no new log archive or retention policy. */
public final class ConsoleLogs implements AutoCloseable {
  private static final String CHANNEL = "cloudnet_rest_console_files";
  private static ConsoleLogs instance;
  private final CloudNet cloud = CloudNet.getInstance();

  public static ConsoleLogs getInstance() { return instance; }
  public void start() { instance = this; this.cloud.getEventManager().registerListener(this); }

  public JsonDocument read(String type, String id, UUID user, String file, String cursor) {
    String node = id;
    if ("service".equals(type)) {
      ServiceInfoSnapshot service = this.cloud.getCloudServiceProvider().getCloudServices().stream()
        .filter(item -> item.getServiceId().getUniqueId().toString().equals(id)).findFirst().orElse(null);
      if (service == null) return error(404, "服务不存在或已删除，无法读取其工作目录");
      node = service.getServiceId().getNodeUniqueId();
    }
    JsonDocument request = new JsonDocument("type", type).append("id", id).append("user", user.toString())
      .append("file", file).append("cursor", cursor);
    if (this.cloud.getComponentName().equals(node)) return this.local(request);
    de.dytanic.cloudnet.cluster.IClusterNodeServer target = this.cloud.getClusterNodeServerProvider().getNodeServer(node);
    if (target == null || !target.isConnected()) return error(503, "目标节点不可达");
    try {
      ChannelMessage response = ChannelMessage.builder().channel(CHANNEL).message("read").targetNode(node).json(request)
        .build().sendSingleQueryAsync().get(10, TimeUnit.SECONDS, null);
      return response == null ? error(503, "日志读取超时或目标节点未安装新版 REST") : response.getJson();
    } catch (RuntimeException exception) {
      return error(503, "目标节点日志查询失败，请检查连接");
    }
  }

  private JsonDocument local(JsonDocument request) {
    String type = request.getString("type");
    String id = request.getString("id");
    IPermissionUser user = this.cloud.getPermissionManagement().getUser(UUID.fromString(request.getString("user")));
    String permission = ConsoleBridge.permission(type);
    if (user == null || permission == null || !this.cloud.getPermissionManagement().hasPermission(user, new Permission(permission, 1))) {
      return error(403, "没有控制台读取权限");
    }
    try {
      Path root;
      List<Path> candidates = new ArrayList<>();
      if ("node".equals(type)) {
        if (!id.equals(this.cloud.getComponentName())) return error(404, "节点不存在");
        root = Paths.get("local", "logs").toAbsolutePath().normalize();
        this.collect(root, root, candidates);
      } else {
        ICloudService service = this.cloud.getCloudServiceManager().getCloudServices().get(UUID.fromString(id));
        if (service == null) return error(404, "服务不存在或已删除");
        root = service.getDirectoryPath().toAbsolutePath().normalize();
        this.collect(root, root.resolve("logs"), candidates);
        this.collect(root, root.resolve(".wrapper").resolve("logs"), candidates);
        if (Files.isDirectory(root)) {
          try (Stream<Path> paths = Files.list(root)) {
            paths.filter(this::isLog).forEach(candidates::add);
          }
        }
      }
      if (!Files.isDirectory(root)) return error(404, "日志目录不存在，可能已随临时实例删除");
      Path realRoot = root.toRealPath();
      List<JsonDocument> files = new ArrayList<>();
      Path selected = null;
      for (Path path : candidates) {
        if (!path.toRealPath().startsWith(realRoot)) continue;
        String name = root.relativize(path).toString().replace('\\', '/');
        String fileId = encode(name);
        files.add(new JsonDocument("id", fileId).append("name", name).append("size", Files.size(path))
          .append("modifiedAt", Files.getLastModifiedTime(path).toMillis()));
        if (fileId.equals(request.getString("file"))) selected = path;
      }
      if (request.getString("file") == null) {
        files.sort(Comparator.comparingLong((JsonDocument item) -> item.getLong("modifiedAt")).reversed());
        return new JsonDocument("files", files);
      }
      if (selected == null) return error(404, "日志文件已删除或轮转，请刷新文件列表");
      return this.page(selected, request.getString("cursor"));
    } catch (IllegalArgumentException exception) {
      return error(400, "日志标识或分页游标无效");
    } catch (IOException exception) {
      return error(503, "无法读取日志文件：" + exception.getMessage());
    }
  }

  private boolean isLog(Path path) {
    return Files.isRegularFile(path) && path.getFileName().toString().matches("(?i).*(\\.log(\\.[0-9]+)?|\\.log\\.gz)$");
  }

  private void collect(Path root, Path directory, List<Path> paths) throws IOException {
    if (!Files.isDirectory(directory) || !directory.toRealPath().startsWith(root.toRealPath())) return;
    try (Stream<Path> stream = Files.walk(directory)) {
      paths.addAll(stream.filter(this::isLog).collect(Collectors.toList()));
    }
  }

  private JsonDocument page(Path file, String cursor) throws IOException {
    BasicFileAttributes attributes = Files.readAttributes(file, BasicFileAttributes.class);
    String identity = file.getFileName() + ":" + attributes.fileKey() + ":" + attributes.creationTime().toMillis();
    boolean gzip = file.getFileName().toString().toLowerCase(java.util.Locale.ROOT).endsWith(".gz");
    long before = Long.MAX_VALUE;
    if (cursor != null && !cursor.isEmpty()) {
      JsonDocument saved = JsonDocument.newDocument(new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8));
      if (!identity.equals(saved.getString("identity")) || attributes.size() < saved.getLong("size")
        || (gzip && attributes.lastModifiedTime().toMillis() != saved.getLong("modifiedAt"))) {
        return error(409, "日志文件已轮转或截断，请重新打开文件");
      }
      before = saved.getLong("before");
      if (before < 0) return error(400, "日志分页游标无效");
    }
    ArrayDeque<String> lines = new ArrayDeque<>();
    long count = 0;
    // Stream compressed and plain files with a bounded page buffer, never load the whole file into memory.
    try (InputStream input = Files.newInputStream(file);
         InputStream decoded = gzip ? new GZIPInputStream(input) : input;
         BufferedReader reader = new BufferedReader(new InputStreamReader(decoded, StandardCharsets.UTF_8))) {
      String line;
      while (count < before && (line = reader.readLine()) != null) {
        lines.addLast(line);
        if (lines.size() > 500) lines.removeFirst();
        count++;
      }
    }
    if (before != Long.MAX_VALUE && count < before) return error(409, "日志文件已截断，请重新打开文件");
    long start = count - lines.size();
    String next = start == 0 ? null : encode(new JsonDocument("before", start).append("identity", identity)
      .append("size", attributes.size()).append("modifiedAt", attributes.lastModifiedTime().toMillis()).toJson());
    return new JsonDocument("lines", new ArrayList<>(lines)).append("nextCursor", next)
      .append("startLine", start + 1).append("endLine", count);
  }

  private static String encode(String value) { return Base64.getUrlEncoder().withoutPadding().encodeToString(value.getBytes(StandardCharsets.UTF_8)); }
  private static JsonDocument error(int code, String reason) { return new JsonDocument("code", code).append("reason", reason); }

  @EventListener
  public void onMessage(ChannelMessageReceiveEvent event) {
    if (CHANNEL.equals(event.getChannel()) && "read".equals(event.getMessage()) && event.isQuery()
      && event.getSender().getType() == DriverEnvironment.CLOUDNET) event.setJsonResponse(this.local(event.getData()));
  }

  @Override
  public void close() { this.cloud.getEventManager().unregisterListener(this); if (instance == this) instance = null; }
}
