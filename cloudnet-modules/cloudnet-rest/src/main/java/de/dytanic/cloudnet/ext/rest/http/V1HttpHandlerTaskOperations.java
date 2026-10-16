package de.dytanic.cloudnet.ext.rest.http;

import de.dytanic.cloudnet.common.document.gson.JsonDocument;
import de.dytanic.cloudnet.driver.network.http.IHttpContext;
import de.dytanic.cloudnet.driver.permission.IPermissionUser;
import de.dytanic.cloudnet.ext.rest.tasks.TaskOperations;
import de.dytanic.cloudnet.http.V1HttpHandler;

public final class V1HttpHandlerTaskOperations extends V1HttpHandler {
  public V1HttpHandlerTaskOperations() { super(null); }

  @Override
  public void handleOptions(String path, IHttpContext context) { this.sendOptions(context, "OPTIONS, GET, POST"); }

  @Override
  public void handleGet(String path, IHttpContext context) { this.request(path, context, false); }

  @Override
  public void handlePost(String path, IHttpContext context) { this.request(path, context, true); }

  private void request(String path, IHttpContext context, boolean post) {
    TaskOperations operations = TaskOperations.getInstance();
    IPermissionUser user = HTTP_SESSION.getUser(context);
    JsonDocument result;
    if (user == null) result = TaskOperations.error(401, "请重新登录");
    else if (operations == null) result = TaskOperations.error(503, "任务操作模块未启动");
    else if (post && context.request().pathParameters().containsKey("name")) {
      Integer count = null;
      boolean stop = path.endsWith("/stop");
      try {
        JsonDocument body = JsonDocument.newDocument(context.request().bodyAsString());
        if (stop) {
          if (!body.contains("clearMinimum") || !body.get("clearMinimum").isJsonPrimitive()
            || !body.get("clearMinimum").getAsJsonPrimitive().isBoolean()) throw new IllegalArgumentException();
          if (body.getBoolean("clearMinimum")) count = 0;
        } else {
          if (!body.contains("count") || !body.get("count").isJsonPrimitive()
            || !body.get("count").getAsJsonPrimitive().isNumber()) throw new IllegalArgumentException();
          double value = body.getDouble("count");
          if (!Double.isFinite(value) || value < 0 || value > Integer.MAX_VALUE || value != Math.floor(value)) throw new IllegalArgumentException();
          count = (int) value;
        }
      } catch (RuntimeException exception) { this.send400Response(context, "请提供非负整数 count，或布尔值 clearMinimum"); return; }
      result = operations.submit(user.getUniqueId(), context.request().pathParameters().get("name"), count, stop);
    } else if (!post && context.request().pathParameters().containsKey("id")) {
      result = operations.result(context.request().pathParameters().get("id"), user.getUniqueId());
    } else result = TaskOperations.error(405, "请求方法不支持");
    context.response().statusCode(result.getInt("code")).header("Content-Type", "application/json").body(result.toByteArray());
    context.closeAfter(true).cancelNext();
  }
}
