package de.dytanic.cloudnet.ext.rest.console;

import de.dytanic.cloudnet.CloudNet;
import de.dytanic.cloudnet.common.document.gson.JsonDocument;
import de.dytanic.cloudnet.common.logging.LogEntry;
import de.dytanic.cloudnet.driver.DriverEnvironment;
import de.dytanic.cloudnet.driver.channel.ChannelMessage;
import de.dytanic.cloudnet.driver.event.EventListener;
import de.dytanic.cloudnet.driver.event.events.channel.ChannelMessageReceiveEvent;
import de.dytanic.cloudnet.driver.network.http.websocket.IWebSocketChannel;
import de.dytanic.cloudnet.driver.network.http.websocket.IWebSocketListener;
import de.dytanic.cloudnet.driver.network.http.websocket.WebSocketFrameType;
import de.dytanic.cloudnet.driver.permission.IPermissionUser;
import de.dytanic.cloudnet.driver.permission.IPermissionManagement;
import de.dytanic.cloudnet.common.logging.LogLevel;
import de.dytanic.cloudnet.permission.command.DefaultPermissionUserCommandSender;
import de.dytanic.cloudnet.permission.command.IPermissionUserCommandSender;
import de.dytanic.cloudnet.driver.permission.Permission;
import de.dytanic.cloudnet.driver.service.ServiceInfoSnapshot;
import de.dytanic.cloudnet.event.log.LoggingEntryEvent;
import de.dytanic.cloudnet.event.service.CloudServiceConsoleLogReceiveEntryEvent;
import de.dytanic.cloudnet.console.ConsoleColor;
import de.dytanic.cloudnet.console.log.ColouredLogFormatter;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.Queue;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Supplier;
import java.nio.charset.StandardCharsets;

/** Bridges node-local log events through the existing authenticated cluster messenger. */
public final class ConsoleBridge implements AutoCloseable {

  private static final String CHANNEL = "cloudnet_rest_console";
  private static ConsoleBridge instance;
  private final CloudNet cloud = CloudNet.getInstance();
  private final Map<String, Stream> streams = new HashMap<>();
  private final Map<String, Subscription> subscriptions = new HashMap<>();
  private final Map<String, Socket> sockets = new HashMap<>();
  private final ConsoleDispatch forwarding = new ConsoleDispatch();
  private final ColouredLogFormatter formatter = new ColouredLogFormatter();
  private final ScheduledExecutorService timer = Executors.newSingleThreadScheduledExecutor(runnable -> {
    Thread thread = new Thread(runnable, "rest-console-subscriptions");
    thread.setDaemon(true);
    return thread;
  });
  private volatile boolean closed;

  public static ConsoleBridge getInstance() {
    return instance;
  }

  public synchronized void start() {
    instance = this;
    Stream node = new Stream(128);
    this.cloud.getQueuedConsoleLogHandler().getCachedQueuedLogEntries().forEach(entry -> node.add(format(entry)));
    this.streams.put("node:" + this.self(), node);
    this.cloud.getCloudServiceManager().getCloudServices().values().forEach(service -> {
      Stream stream = new Stream(this.cloud.getConfig().getMaxServiceConsoleLogCacheSize());
      service.getServiceConsoleLogCache().getCachedLogMessages().forEach(stream::add);
      this.streams.put("service:" + service.getServiceId().getUniqueId(), stream);
    });
    this.cloud.getEventManager().registerListener(this);
    this.timer.scheduleWithFixedDelay(() -> {
      try { this.expire(); } catch (RuntimeException ignored) { /* Retry subscription maintenance next time. */ }
    }, 15, 15, TimeUnit.SECONDS);
    this.timer.scheduleWithFixedDelay(() -> {
      try { this.disconnectOverloaded(); } catch (RuntimeException ignored) { /* Retry closing on the next tick. */ }
    }, 1, 1, TimeUnit.SECONDS);
  }

  public static String permission(String type) {
    return "service".equals(type) ? "cloudnet.http.v1.services.operation.get"
      : "node".equals(type) ? "cloudnet.http.v1.console.node.get" : null;
  }

  private String self() {
    return this.cloud.getComponentName();
  }

  private boolean allowed(UUID userId, String permission) {
    IPermissionUser user = this.cloud.getPermissionManagement().getUser(userId);
    return user != null && permission != null
      && this.cloud.getPermissionManagement().hasPermission(user, new Permission(permission, 1));
  }

  public JsonDocument command(String node, UUID user, String command) {
    if (node == null || node.equals(this.self())) {
      IPermissionUser account = this.cloud.getPermissionManagement().getUser(user);
      if (account == null) {
        return new JsonDocument("success", false).append("reason", "账号不存在");
      }
      // Delegate permissions to the existing sender and also publish asynchronous command output to the node log.
      DefaultPermissionUserCommandSender delegate = new DefaultPermissionUserCommandSender(account, this.cloud.getPermissionManagement());
      IPermissionUserCommandSender sender = new IPermissionUserCommandSender() {
        @Override public String getName() { return delegate.getName(); }
        @Override public boolean hasPermission(String permission) { return delegate.hasPermission(permission); }
        @Override public IPermissionUser getPermissionUser() { return delegate.getPermissionUser(); }
        @Override public IPermissionManagement getPermissionManagement() { return delegate.getPermissionManagement(); }
        @Override public Queue<String> getWrittenMessages() { return delegate.getWrittenMessages(); }
        @Override public void sendMessage(String message) {
          delegate.sendMessage(message);
          ConsoleBridge.this.cloud.getLogger().log(LogLevel.COMMAND, message);
        }
        @Override public void sendMessage(String... messages) {
          for (String message : messages) { this.sendMessage(message); }
        }
      };
      try {
        boolean success = this.cloud.getCommandMap().dispatchCommand(sender, command);
        return new JsonDocument("success", success).append("receivedMessages", sender.getWrittenMessages().toArray(new String[0]))
          .append("reason", success ? null : "命令不存在或没有执行权限");
      } catch (RuntimeException exception) {
        return new JsonDocument("success", false).append("reason", exception.getMessage());
      }
    }
    ChannelMessage response = this.query(node, "command", new JsonDocument("user", user.toString()).append("command", command));
    return response == null ? new JsonDocument("success", false).append("reason", "目标节点未连接或未安装新版 REST 模块")
      : response.getJson();
  }

  public void open(String type, String id, UUID user, String session, IWebSocketChannel channel, Supplier<Boolean> authorized) {
    String node = id;
    if ("service".equals(type)) {
      ServiceInfoSnapshot service = this.service(id);
      if (service == null) {
        channel.close(4404, "服务不存在");
        return;
      }
      node = service.getServiceId().getNodeUniqueId();
    } else if (this.cloud.getNodeInfoProvider().getNode(node) == null) {
      channel.close(4404, "节点不存在");
      return;
    }
    String subscription = UUID.randomUUID().toString();
    Socket socket = new Socket(subscription, node, session, channel, authorized);
    synchronized (this) {
      if (this.closed) {
        channel.close(4503, "REST 模块已停止");
        return;
      }
      this.sockets.put(subscription, socket);
    }
    channel.addListener(new IWebSocketListener() {
      @Override
      public void handle(IWebSocketChannel ignored, WebSocketFrameType frame, byte[] bytes) {
        if (frame == WebSocketFrameType.TEXT) {
          String message = new String(bytes, StandardCharsets.UTF_8);
          if (message.startsWith("ack:")) {
            try { socket.acknowledge(Long.parseLong(message.substring(4))); }
            catch (NumberFormatException ignoredMessage) { }
          } else ConsoleBridge.this.renew(socket);
        }
      }

      @Override
      public void handleClose(IWebSocketChannel ignored, AtomicInteger code, AtomicReference<String> reason) {
        ConsoleBridge.this.remove(socket);
      }
    });
    JsonDocument request = new JsonDocument("subscription", subscription).append("type", type).append("id", id)
      .append("user", user.toString());
    JsonDocument snapshot;
    if (node.equals(this.self())) {
      synchronized (this) {
        snapshot = this.subscribe(this.self(), request);
      }
    } else {
      de.dytanic.cloudnet.cluster.IClusterNodeServer target = this.cloud.getClusterNodeServerProvider().getNodeServer(node);
      if (target == null || !target.isConnected()) {
        snapshot = new JsonDocument("type", "error").append("code", 4500).append("message", "目标节点已断开");
      } else {
        java.util.concurrent.ScheduledFuture<?> timeout = this.timer.schedule(() -> {
          synchronized (this) {
            if (!socket.initialized) socket.initialize(new JsonDocument("type", "error").append("code", 4503)
              .append("message", "目标节点未响应或未安装新版 REST 模块"));
          }
        }, 3, TimeUnit.SECONDS);
        ChannelMessage.builder().channel(CHANNEL).message("subscribe").targetNode(node).json(request).build()
          .sendSingleQueryAsync().onComplete(response -> {
            if (response == null) return;
            timeout.cancel(false);
            synchronized (this) {
              if (!socket.initialized) socket.initialize(response.getJson());
            }
          });
        return;
      }
    }
    synchronized (this) {
      socket.initialize(snapshot);
    }
  }

  private ServiceInfoSnapshot service(String id) {
    try { return this.cloud.getCloudServiceProvider().getCloudService(UUID.fromString(id)); }
    catch (IllegalArgumentException exception) { return null; }
  }

  private ChannelMessage query(String node, String message, JsonDocument data) {
    return ChannelMessage.builder().channel(CHANNEL).message(message).targetNode(node).json(data).build()
      .sendSingleQueryAsync().get(3, TimeUnit.SECONDS, null);
  }

  private void send(String node, String message, JsonDocument data) {
    ChannelMessage.builder().channel(CHANNEL).message(message).targetNode(node).json(data).build().send();
  }

  private synchronized JsonDocument subscribe(String gateway, JsonDocument data) {
    String type = data.getString("type");
    String id = data.getString("id");
    UUID user = UUID.fromString(data.getString("user"));
    if (!this.allowed(user, permission(type))) {
      return new JsonDocument("type", "error").append("code", 4403).append("message", "没有控制台读取权限");
    }
    if ("service".equals(type)) {
      ServiceInfoSnapshot service = this.service(id);
      if (service == null || !service.getServiceId().getNodeUniqueId().equals(this.self())) {
        return new JsonDocument("type", "error").append("code", 4404).append("message", "服务不存在");
      }
    } else if (!this.self().equals(id)) {
      return new JsonDocument("type", "error").append("code", 4404).append("message", "节点不存在");
    }
    String key = type + ":" + id;
    Stream stream = this.streams.computeIfAbsent(key,
      ignored -> new Stream("node".equals(type) ? 128 : this.cloud.getConfig().getMaxServiceConsoleLogCacheSize()));
    String subscription = data.getString("subscription");
    this.subscriptions.put(gateway + "/" + subscription, new Subscription(gateway, subscription, key, user));
    return new JsonDocument("type", "snapshot").append("sequence", stream.sequence)
      .append("streamId", stream.id).append("firstSequence", stream.sequence - stream.lines.size() + 1)
      .append("lines", new ArrayList<>(stream.lines));
  }

  @EventListener
  public void onMessage(ChannelMessageReceiveEvent event) {
    if (!CHANNEL.equals(event.getChannel()) || event.getSender().getType() != DriverEnvironment.CLOUDNET) {
      return;
    }
    JsonDocument data = event.getData();
    if ("command".equals(event.getMessage())) {
      if (event.isQuery()) {
        UUID user = UUID.fromString(data.getString("user"));
        event.setJsonResponse(this.allowed(user, "cloudnet.http.v1.cluster.post")
          ? this.command(null, user, data.getString("command"))
          : new JsonDocument("success", false).append("reason", "没有节点命令权限"));
      }
      return;
    }
    synchronized (this) {
    String sender = event.getSender().getName();
    String key = sender + "/" + data.getString("subscription");
    switch (String.valueOf(event.getMessage())) {
      case "subscribe":
        if (event.isQuery()) {
          event.setJsonResponse(this.subscribe(sender, data));
        }
        break;
      case "unsubscribe": this.subscriptions.remove(key); break;
      case "renew":
        Subscription subscription = this.subscriptions.get(key);
        if (subscription != null) {
          subscription.updated = System.currentTimeMillis();
          this.deliver(subscription, new JsonDocument("type", "state").append("state", "connected"));
        }
        break;
      case "frame":
        Socket socket = this.sockets.get(data.getString("subscription"));
        if (socket != null && socket.node.equals(sender)) {
          socket.receive(data.getDocument("frame"));
        }
        break;
      default: break;
    }
    }
  }

  @EventListener
  public synchronized void onServiceLog(CloudServiceConsoleLogReceiveEntryEvent event) {
    this.append("service:" + event.getServiceInfoSnapshot().getServiceId().getUniqueId(), event.getMessage(),
      this.cloud.getConfig().getMaxServiceConsoleLogCacheSize());
  }

  @EventListener
  public synchronized void onNodeLog(LoggingEntryEvent event) {
    this.append("node:" + this.self(), format(event.getLogEntry()), 128);
  }

  private void append(String key, String line, int limit) {
    Stream stream = this.streams.computeIfAbsent(key, ignored -> new Stream(limit));
    stream.add(line);
    JsonDocument frame = new JsonDocument("type", "line").append("sequence", stream.sequence).append("line", line);
    for (Subscription subscription : this.subscriptions.values()) {
      if (subscription.key.equals(key)) this.deliver(subscription, frame);
    }
  }

  private void deliver(Subscription subscription, JsonDocument frame) {
    if (subscription.overloaded) return;
    if (subscription.gateway.equals(this.self())) {
      Socket socket = this.sockets.get(subscription.id);
      if (socket != null) {
        socket.receive(frame);
      }
    } else {
      JsonDocument data = new JsonDocument("subscription", subscription.id).append("frame", frame);
      this.forwarding.submit(data.toByteArray().length, () -> {
        if (!subscription.overloaded && !this.closed) this.send(subscription.gateway, "frame", data);
      }, () -> subscription.overloaded = true);
    }
  }

  private synchronized void renew(Socket socket) {
    if (!this.sockets.containsKey(socket.id)) {
      return;
    }
    if (!socket.authorized.get()) {
      socket.channel.close(4401, "会话或权限已失效");
      this.remove(socket);
      return;
    }
    socket.updated = System.currentTimeMillis();
    if (socket.node.equals(this.self())) {
      Subscription subscription = this.subscriptions.get(this.self() + "/" + socket.id);
      if (subscription != null) {
        subscription.updated = socket.updated;
        socket.receive(new JsonDocument("type", "state").append("state", "connected"));
      }
    } else {
      this.send(socket.node, "renew", new JsonDocument("subscription", socket.id));
    }
  }

  private synchronized void remove(Socket socket) {
    if (this.sockets.remove(socket.id) == null) {
      return;
    }
    socket.ended = true;
    socket.pending.clear();
    socket.outstanding.clear();
    if (socket.node.equals(this.self())) {
      this.subscriptions.remove(this.self() + "/" + socket.id);
    } else {
      this.send(socket.node, "unsubscribe", new JsonDocument("subscription", socket.id));
    }
  }

  public synchronized void closeSession(String session) {
    new ArrayList<>(this.sockets.values()).stream().filter(socket -> socket.session.equals(session)).forEach(socket -> {
      socket.channel.close(4401, "已退出登录");
      this.remove(socket);
    });
  }

  private synchronized void expire() {
    long oldest = System.currentTimeMillis() - 60000;
    new ArrayList<>(this.sockets.values()).forEach(socket -> {
      if (socket.updated < oldest || socket.received < oldest) {
        socket.channel.close(4500, "控制台连接已断开");
        this.remove(socket);
      }
    });
    new ArrayList<>(this.subscriptions.entrySet()).forEach(entry -> {
      Subscription subscription = entry.getValue();
      String type = subscription.key.substring(0, subscription.key.indexOf(':'));
      if (subscription.updated < oldest || !this.allowed(subscription.user, permission(type))) {
        this.deliver(subscription, new JsonDocument("type", "error").append("code", 4403).append("message", "订阅或权限已失效"));
        this.subscriptions.remove(entry.getKey());
      } else if ("service".equals(type) && this.service(subscription.key.substring(8)) == null) {
        this.deliver(subscription, new JsonDocument("type", "error").append("code", 4404).append("message", "服务已删除"));
        this.subscriptions.remove(entry.getKey());
      }
    });
    this.streams.keySet().removeIf(key -> key.startsWith("service:") && this.service(key.substring(8)) == null);
  }

  private synchronized void disconnectOverloaded() {
    for (Socket socket : new ArrayList<>(this.sockets.values())) {
      if (socket.overloaded) {
        socket.channel.close(4504, "日志处理积压，已断开保护节点，请稍后重连或查看历史");
        this.remove(socket);
      }
    }
    for (Map.Entry<String, Subscription> entry : new ArrayList<>(this.subscriptions.entrySet())) {
      Subscription subscription = entry.getValue();
      if (subscription.overloaded) {
        this.subscriptions.remove(entry.getKey());
        if (!subscription.gateway.equals(this.self())) {
          try { this.send(subscription.gateway, "frame", new JsonDocument("subscription", subscription.id).append("frame",
            new JsonDocument("type", "error").append("code", 4504).append("message", "日志转发积压，请稍后重连或查看历史"))); }
          catch (RuntimeException ignored) { }
        }
      }
    }
  }

  @Override
  public synchronized void close() {
    this.closed = true;
    this.timer.shutdownNow();
    this.cloud.getEventManager().unregisterListener(this);
    new ArrayList<>(this.subscriptions.values()).forEach(subscription -> {
      if (!subscription.gateway.equals(this.self())) {
        try { this.send(subscription.gateway, "frame", new JsonDocument("subscription", subscription.id).append("frame",
          new JsonDocument("type", "error").append("code", 4500).append("message", "目标 REST 模块已停止"))); }
        catch (RuntimeException ignored) { }
      }
    });
    new ArrayList<>(this.sockets.values()).forEach(socket -> {
      socket.channel.close(4500, "REST 模块已停止");
      this.remove(socket);
    });
    this.subscriptions.clear();
    this.streams.clear();
    this.forwarding.close();
    if (instance == this) instance = null;
  }

  private String format(LogEntry entry) {
    return ConsoleColor.toColouredString('&', ConsoleColor.toColouredString('§', this.formatter.format(entry)))
      + ConsoleColor.DEFAULT;
  }

  private static final class Stream {
    private final String id = UUID.randomUUID().toString();
    private final ArrayDeque<String> lines = new ArrayDeque<>();
    private final int limit;
    private long sequence;
    private long bytes;

    private Stream(int limit) {
      this.limit = Math.max(1, Math.min(ConsoleDispatch.MAX_FRAMES, limit));
    }

    private void add(String line) {
      this.lines.add(line);
      this.bytes += line.length() * 3L;
      this.sequence++;
      while (this.lines.size() > this.limit || this.bytes > ConsoleDispatch.MAX_BYTES) {
        this.bytes -= this.lines.removeFirst().length() * 3L;
      }
    }
  }

  private static final class Subscription {
    private final String gateway;
    private final String id;
    private final String key;
    private final UUID user;
    private long updated = System.currentTimeMillis();
    private volatile boolean overloaded;

    private Subscription(String gateway, String id, String key, UUID user) {
      this.gateway = gateway;
      this.id = id;
      this.key = key;
      this.user = user;
    }
  }

  private final class Socket {
    private final String id;
    private final String node;
    private final String session;
    private final IWebSocketChannel channel;
    private final Supplier<Boolean> authorized;
    private final ArrayDeque<JsonDocument> pending = new ArrayDeque<>();
    private final Map<Long, Integer> outstanding = new LinkedHashMap<>();
    private long pendingBytes;
    private long outstandingBytes;
    private long delivery;
    private volatile boolean overloaded;
    private boolean initialized;
    private volatile boolean ended;
    private long sequence;
    private long updated = System.currentTimeMillis();
    private long received = System.currentTimeMillis();

    private Socket(String id, String node, String session, IWebSocketChannel channel, Supplier<Boolean> authorized) {
      this.id = id;
      this.node = node;
      this.session = session;
      this.channel = channel;
      this.authorized = authorized;
    }

    private void initialize(JsonDocument snapshot) {
      if (this.ended) {
        return;
      }
      this.sequence = snapshot.getLong("sequence");
      this.write(snapshot);
      this.initialized = true;
      while (!this.pending.isEmpty()) {
        this.receive(this.pending.removeFirst());
      }
      this.pendingBytes = 0;
    }

    private void receive(JsonDocument frame) {
      this.received = System.currentTimeMillis();
      if (this.ended || this.overloaded) {
        return;
      }
      if (!this.initialized) {
        this.pendingBytes += frame.toByteArray().length;
        if (this.pending.size() >= ConsoleDispatch.MAX_FRAMES || this.pendingBytes > ConsoleDispatch.MAX_BYTES) {
          this.overloaded = true;
          return;
        }
        this.pending.add(frame);
      } else if (!"line".equals(frame.getString("type")) || frame.getLong("sequence") > this.sequence) {
        if ("line".equals(frame.getString("type"))) {
          this.sequence = frame.getLong("sequence");
        }
        this.write(frame);
      }
    }

    private void write(JsonDocument frame) {
      if (this.ended || this.overloaded) return;
      byte[] bytes = new JsonDocument().append(frame).append("delivery", ++this.delivery).toByteArray();
      if (this.outstanding.size() >= ConsoleDispatch.MAX_FRAMES || this.outstandingBytes + bytes.length > ConsoleDispatch.MAX_BYTES) {
        this.overloaded = true;
        return;
      }
      this.outstanding.put(this.delivery, bytes.length);
      this.outstandingBytes += bytes.length;
      ConsoleBridge.this.forwarding.submit(bytes.length, () -> {
        if (this.ended || this.overloaded) return;
        this.channel.sendWebSocketFrame(WebSocketFrameType.TEXT, bytes);
        if ("error".equals(frame.getString("type"))) {
          this.channel.close(frame.getInt("code"), frame.getString("message"));
          ConsoleBridge.this.remove(this);
        }
      }, () -> this.overloaded = true);
    }

    private void acknowledge(long delivery) {
      synchronized (ConsoleBridge.this) {
        Integer size = this.outstanding.remove(delivery);
        if (size != null) this.outstandingBytes -= size;
      }
    }
  }
}
