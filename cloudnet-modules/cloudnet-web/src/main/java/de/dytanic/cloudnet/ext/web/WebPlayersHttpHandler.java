package de.dytanic.cloudnet.ext.web;

import de.dytanic.cloudnet.common.document.gson.JsonDocument;
import de.dytanic.cloudnet.driver.network.http.IHttpContext;
import de.dytanic.cloudnet.driver.service.ServiceInfoSnapshot;
import de.dytanic.cloudnet.driver.service.ServiceLifeCycle;
import de.dytanic.cloudnet.ext.bridge.player.ICloudPlayer;
import de.dytanic.cloudnet.ext.bridge.player.IPlayerManager;
import de.dytanic.cloudnet.ext.bridge.player.NetworkServiceInfo;
import de.dytanic.cloudnet.ext.bridge.player.executor.PlayerExecutor;
import de.dytanic.cloudnet.http.V1HttpHandler;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

/** Web entrances for the existing Bridge online-player provider and executor. */
public final class WebPlayersHttpHandler extends V1HttpHandler {

  public WebPlayersHttpHandler(String permission) {
    super(permission);
  }

  @Override
  public void handleOptions(String path, IHttpContext context) {
    this.sendOptions(context, "OPTIONS, GET, POST");
  }

  @Override
  public void handleGet(String path, IHttpContext context) {
    IPlayerManager manager = this.playerManager(context);
    if (manager == null) {
      return;
    }
    List<JsonDocument> players = manager.onlinePlayers().asPlayers().stream().map(player -> {
      NetworkServiceInfo connected = player.getConnectedService();
      NetworkServiceInfo login = player.getLoginService();
      return new JsonDocument("uniqueId", player.getUniqueId()).append("name", player.getName())
        .append("server", connected != null && connected.getEnvironment().isMinecraftServer() ? serviceRef(connected) : null)
        .append("proxy", login != null && login.getEnvironment().isMinecraftProxy() ? serviceRef(login) : null)
        .append("firstLoginTimeMillis", player.getFirstLoginTimeMillis())
        .append("lastLoginTimeMillis", player.getLastLoginTimeMillis());
    }).collect(Collectors.toList());
    this.respond(context, 200, players);
  }

  @Override
  public void handlePost(String path, IHttpContext context) {
    String action = context.request().pathParameters().get("action");
    if (!"connect".equals(action) && !"message".equals(action) && !"kick".equals(action)) {
      this.send400Response(context, "不支持的玩家操作");
      return;
    }
    PlayerActionRequest request;
    UUID target = null;
    try {
      request = GSON.fromJson(context.request().bodyAsString(), PlayerActionRequest.class);
      if (request == null || request.playerIds == null || request.playerIds.length == 0) {
        this.send400Response(context, "请选择玩家");
        return;
      }
      if ("connect".equals(action)) {
        target = UUID.fromString(request.targetServiceId);
        if (this.targetService(target) == null) {
          this.send400Response(context, "目标必须是运行中的 Minecraft 服务实例");
          return;
        }
      } else if ("message".equals(action) && (request.message == null || request.message.trim().isEmpty())) {
        this.send400Response(context, "消息不能为空");
        return;
      }
    } catch (RuntimeException exception) {
      this.send400Response(context, "请求内容或目标服务 UUID 无效");
      return;
    }
    IPlayerManager manager = this.playerManager(context);
    if (manager == null) {
      return;
    }
    List<JsonDocument> results = new ArrayList<>();
    for (String id : request.playerIds) {
      JsonDocument result = new JsonDocument("uniqueId", id).appendNull("name").append("status", "not_submitted");
      try {
        ICloudPlayer player = manager.getOnlinePlayer(UUID.fromString(id));
        if (player == null) {
          result.append("reason", "玩家已离线");
        } else {
          result.append("name", player.getName());
          if (player.getLoginService() == null || !player.getLoginService().getEnvironment().isMinecraftProxy()) {
            result.append("reason", "玩家未通过代理登录，无法执行此操作");
          } else {
            PlayerExecutor executor = manager.getPlayerExecutor(player.getUniqueId());
            if ("connect".equals(action)) {
              ServiceInfoSnapshot service = this.targetService(target);
              if (service == null) {
                result.append("reason", "目标服务已停止或不存在");
              } else if (player.getConnectedService() != null && target.equals(player.getConnectedService().getUniqueId())) {
                result.append("reason", "已在目标服务器");
              } else {
                executor.connect(service.getServiceId().getName());
                result.append("status", "submitted");
              }
            } else {
              if ("message".equals(action)) {
                executor.sendChatMessage(request.message);
              } else {
                executor.kick(request.reason == null || request.reason.trim().isEmpty() ? "no reason given" : request.reason);
              }
              result.append("status", "submitted");
            }
          }
        }
      } catch (IllegalArgumentException exception) {
        result.append("reason", "玩家 UUID 无效或操作参数无效");
      } catch (RuntimeException exception) {
        result.append("reason", exception.getMessage() == null ? "操作提交失败" : exception.getMessage());
      }
      results.add(result);
    }
    this.respond(context, 200, new JsonDocument("results", results));
  }

  private IPlayerManager playerManager(IHttpContext context) {
    IPlayerManager manager = this.getCloudNet().getServicesRegistry().getFirstService(IPlayerManager.class);
    if (manager == null) {
      this.respond(context, 503, new JsonDocument("reason", "Bridge 玩家管理尚不可用"));
    }
    return manager;
  }

  private ServiceInfoSnapshot targetService(UUID id) {
    ServiceInfoSnapshot service = this.getCloudNet().getCloudServiceProvider().getCloudService(id);
    return service != null && service.getLifeCycle() == ServiceLifeCycle.RUNNING
      && service.getServiceId().getEnvironment().isMinecraftServer() ? service : null;
  }

  private static JsonDocument serviceRef(NetworkServiceInfo service) {
    return new JsonDocument("uniqueId", service.getUniqueId()).append("name", service.getServerName())
      .append("taskName", service.getTaskName()).append("nodeUniqueId", service.getServiceId().getNodeUniqueId());
  }

  private void respond(IHttpContext context, int status, Object body) {
    context.response().statusCode(status).header("Content-Type", "application/json").body(GSON.toJson(body));
    context.closeAfter(true).cancelNext();
  }

  private static final class PlayerActionRequest {
    private String[] playerIds;
    private String targetServiceId;
    private String message;
    private String reason;
  }
}
