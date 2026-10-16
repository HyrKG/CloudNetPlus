package de.dytanic.cloudnet.ext.rest.http;

import de.dytanic.cloudnet.common.document.gson.JsonDocument;
import de.dytanic.cloudnet.driver.network.http.IHttpContext;
import de.dytanic.cloudnet.driver.permission.IPermissionUser;
import de.dytanic.cloudnet.ext.rest.metrics.ResourceMetrics;
import de.dytanic.cloudnet.http.V1HttpHandler;

public final class V1HttpHandlerMetrics extends V1HttpHandler {
  public V1HttpHandlerMetrics() { super("cloudnet.http.v1.metrics"); }

  @Override
  public void handleOptions(String path, IHttpContext context) { this.sendOptions(context, "OPTIONS, GET"); }

  @Override
  public void handleGet(String path, IHttpContext context) {
    IPermissionUser user = HTTP_SESSION.getUser(context);
    ResourceMetrics metrics = ResourceMetrics.getInstance();
    if (user == null) {
      context.response().statusCode(401);
    } else if (metrics == null) {
      context.response().statusCode(503).header("Content-Type", "application/json")
        .body(new JsonDocument("reason", "节点资源采集未启动").toByteArray());
    } else {
      long range;
      String selected = context.request().queryParameters().getOrDefault("range", java.util.Collections.singletonList("1h")).get(0);
      switch (selected) {
        case "15m": range = 15 * 60000L; break;
        case "6h": range = 6 * 3600000L; break;
        case "24h": range = 24 * 3600000L; break;
        default: range = 3600000L; break;
      }
      String node = context.request().queryParameters().getOrDefault("node", java.util.Collections.singletonList(null)).get(0);
      long now = System.currentTimeMillis();
      java.util.List<JsonDocument> nodes;
      boolean serviceHistory = path.endsWith("/services/history");
      boolean playerHistory = path.endsWith("/players/history");
      boolean taskHistory = path.endsWith("/tasks/history");
      if (taskHistory) {
        java.util.List<String> tasks = context.request().queryParameters().getOrDefault("task", java.util.Collections.emptyList());
        if (tasks.isEmpty() || tasks.stream().anyMatch(String::isEmpty)) {
          this.send400Response(context, "请提供 task 参数，可重复指定");
          return;
        }
        nodes = metrics.taskHistory(user.getUniqueId(), tasks, node, now - range, now);
      } else if (playerHistory) {
        nodes = metrics.playerHistory(user.getUniqueId(), now - range, now);
      } else if (serviceHistory) {
        java.util.List<String> services = context.request().queryParameters().getOrDefault("service", java.util.Collections.emptyList());
        try {
          if (services.isEmpty()) throw new IllegalArgumentException();
          services = services.stream().map(value -> java.util.UUID.fromString(value).toString()).distinct()
            .collect(java.util.stream.Collectors.toList());
        } catch (IllegalArgumentException exception) {
          context.response().statusCode(400).header("Content-Type", "application/json")
            .body(new JsonDocument("reason", "请提供 service 参数，值为实例 UUID，可重复指定").toByteArray());
          context.closeAfter(true).cancelNext();
          return;
        }
        nodes = metrics.serviceHistory(user.getUniqueId(), services, now - range, now);
      } else {
        nodes = path.endsWith("/history") ? metrics.cluster(user.getUniqueId(), node, now - range, now)
          : metrics.cluster(user.getUniqueId());
      }
      JsonDocument result = new JsonDocument("nodes", nodes).append("generatedAt", now);
      if (serviceHistory || playerHistory || taskHistory) result.append("from", now - range).append("to", now).append("step", 60000);
      context.response().statusCode(200).header("Content-Type", "application/json").body(result.toByteArray());
    }
    context.closeAfter(true).cancelNext();
  }
}
