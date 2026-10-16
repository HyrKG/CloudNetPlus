package de.dytanic.cloudnet.ext.rest.http;

import de.dytanic.cloudnet.driver.network.http.IHttpContext;
import de.dytanic.cloudnet.driver.permission.IPermissionUser;
import de.dytanic.cloudnet.driver.permission.Permission;
import de.dytanic.cloudnet.ext.rest.console.ConsoleBridge;
import de.dytanic.cloudnet.http.V1HttpHandler;
import java.net.URI;

public final class V1HttpHandlerConsole extends V1HttpHandler {

  public V1HttpHandlerConsole() {
    super(null);
  }

  @Override
  public void handleGet(String path, IHttpContext context) {
    String type = context.request().pathParameters().get("type");
    String id = context.request().pathParameters().get("id");
    String permission = ConsoleBridge.permission(type);
    IPermissionUser user = HTTP_SESSION.getUser(context);
    if (user == null) {
      context.response().statusCode(401);
      context.closeAfter(true).cancelNext();
      return;
    }
    if (permission == null || !this.allowed(context, permission)) {
      this.send403Response(context, "permission required " + permission);
      return;
    }
    if (!context.request().hasHeader("Upgrade")) {
      context.response().statusCode(200).header("Content-Type", "application/json")
        .body("{\"success\":true}");
      context.closeAfter(true).cancelNext();
      return;
    }
    try {
      URI origin = URI.create(context.request().header("Origin"));
      if (!("http".equals(origin.getScheme()) || "https".equals(origin.getScheme()))
        || origin.getUserInfo() != null || !origin.getRawAuthority().equalsIgnoreCase(context.request().header("Host"))) {
        this.send403Response(context, "Same origin required");
        return;
      }
    } catch (RuntimeException exception) {
      this.send403Response(context, "Same origin required");
      return;
    }
    ConsoleBridge.getInstance().open(type, id, user.getUniqueId(),
      context.cookie("CloudNet-REST_V1-Session").getValue(), context.upgrade(), () -> this.allowed(context, permission));
    context.cancelNext();
  }

  private boolean allowed(IHttpContext context, String permission) {
    IPermissionUser user = HTTP_SESSION.getUser(context);
    return user != null && this.getCloudNet().getPermissionManagement().hasPermission(user, new Permission(permission, 1));
  }
}
