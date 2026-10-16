package de.dytanic.cloudnet.ext.rest.http;

import de.dytanic.cloudnet.common.document.gson.JsonDocument;
import de.dytanic.cloudnet.driver.network.http.IHttpContext;
import de.dytanic.cloudnet.driver.permission.IPermissionUser;
import de.dytanic.cloudnet.driver.permission.Permission;
import de.dytanic.cloudnet.ext.rest.console.ConsoleLogs;
import de.dytanic.cloudnet.ext.rest.console.ConsoleBridge;
import de.dytanic.cloudnet.http.V1HttpHandler;
import java.util.Collections;

public final class V1HttpHandlerConsoleLogs extends V1HttpHandler {
  public V1HttpHandlerConsoleLogs() { super(null); }

  @Override
  public void handleGet(String path, IHttpContext context) {
    IPermissionUser user = HTTP_SESSION.getUser(context);
    if (user == null) {
      context.response().statusCode(401);
    } else {
      String permission = ConsoleBridge.permission(context.request().pathParameters().get("type"));
      if (permission == null || !this.getCloudNet().getPermissionManagement().hasPermission(user, new Permission(permission, 1))) {
        this.send403Response(context, "没有控制台读取权限");
        return;
      }
      ConsoleLogs logs = ConsoleLogs.getInstance();
      JsonDocument result = logs == null ? new JsonDocument("code", 503).append("reason", "日志读取未启动")
        : logs.read(context.request().pathParameters().get("type"), context.request().pathParameters().get("id"),
          user.getUniqueId(), context.request().pathParameters().get("fileId"),
          context.request().queryParameters().getOrDefault("cursor", Collections.singletonList(null)).get(0));
      context.response().statusCode(result.contains("code") ? result.getInt("code") : 200)
        .header("Content-Type", "application/json").body(result.toByteArray());
    }
    context.closeAfter(true).cancelNext();
  }
}
