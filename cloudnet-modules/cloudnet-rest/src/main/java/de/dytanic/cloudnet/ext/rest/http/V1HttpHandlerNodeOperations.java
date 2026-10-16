package de.dytanic.cloudnet.ext.rest.http;

import de.dytanic.cloudnet.common.document.gson.JsonDocument;
import de.dytanic.cloudnet.driver.network.http.IHttpContext;
import de.dytanic.cloudnet.driver.permission.IPermissionUser;
import de.dytanic.cloudnet.ext.rest.console.ConsoleBridge;
import de.dytanic.cloudnet.http.V1HttpHandler;

/** HTTP entrances for the existing permission-aware node commands. */
public class V1HttpHandlerNodeOperations extends V1HttpHandler {

  public V1HttpHandlerNodeOperations() {
    super("cloudnet.http.v1.cluster");
  }

  @Override
  public void handleOptions(String path, IHttpContext context) {
    this.sendOptions(context, "OPTIONS, POST, DELETE");
  }

  @Override
  public void handlePost(String path, IHttpContext context) {
    String node = context.request().pathParameters().get("node");
    if (node != null) {
      this.execute(context, node, context.request().bodyAsString());
      return;
    }
    try {
      JsonDocument body = JsonDocument.newDocument(context.request().bodyAsString());
      String id = body.getString("nodeUniqueId");
      String host = body.getString("host");
      int port = body.getInt("port");
      if (!token(id) || !token(host) || port < 1 || port > 65535) {
        this.send400Response(context, "Invalid node id, host or port");
        return;
      }
      if (this.getCloudNet().getNodeInfoProvider().getNode(id) != null) {
        this.send400Response(context, "Node already exists");
        return;
      }
      String address = host.contains(":") && !host.startsWith("[") ? "[" + host + "]" : host;
      this.execute(context, null, "cluster add " + id + " " + address + ":" + port, id, true);
    } catch (RuntimeException exception) {
      this.send400Response(context, "Invalid request body");
    }
  }

  @Override
  public void handleDelete(String path, IHttpContext context) {
    String node = context.request().pathParameters().get("node");
    if (!token(node)) {
      this.send400Response(context, "Invalid node id");
      return;
    }
    if (!this.configured(node)) {
      this.send400Response(context, "Node is not present in the cluster configuration");
      return;
    }
    this.execute(context, null, "cluster remove " + node, node, false);
  }

  private static boolean token(String value) {
    return value != null && !value.isEmpty() && value.indexOf('"') < 0
      && value.chars().noneMatch(Character::isWhitespace);
  }

  private void execute(IHttpContext context, String node, String command) {
    this.execute(context, node, command, null, false);
  }

  private boolean configured(String node) {
    return this.getCloudNet().getConfig().getClusterConfig().getNodes().stream()
      .anyMatch(entry -> entry.getUniqueId().equals(node));
  }

  private void execute(IHttpContext context, String node, String command, String changedNode, boolean expected) {
    IPermissionUser user = HTTP_SESSION.getUser(context);
    if (user == null) {
      context.response().statusCode(401);
    } else if (command.trim().isEmpty()) {
      this.send400Response(context, "Empty command");
      return;
    } else {
      JsonDocument result = ConsoleBridge.getInstance().command(node, user.getUniqueId(), command);
      if (result.getBoolean("success") && changedNode != null && this.configured(changedNode) != expected) {
        result.append("success", false).append("reason", "节点配置未改变，请查看命令返回信息");
      }
      context.response().statusCode(result.getBoolean("success") ? 200 : 400)
        .header("Content-Type", "application/json").body(result.toByteArray());
    }
    context.closeAfter(true).cancelNext();
  }
}
