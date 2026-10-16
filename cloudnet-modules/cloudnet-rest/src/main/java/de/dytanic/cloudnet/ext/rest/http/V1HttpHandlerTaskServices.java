package de.dytanic.cloudnet.ext.rest.http;

import de.dytanic.cloudnet.common.document.gson.JsonDocument;
import de.dytanic.cloudnet.driver.CloudNetDriver;
import de.dytanic.cloudnet.driver.network.http.IHttpContext;
import de.dytanic.cloudnet.driver.service.ServiceConfiguration;
import de.dytanic.cloudnet.driver.service.ServiceInfoSnapshot;
import de.dytanic.cloudnet.driver.service.ServiceTask;
import de.dytanic.cloudnet.http.V1HttpHandler;
import java.util.ArrayList;
import java.util.List;

/** Creates temporary instances without changing the permanent task. */
public final class V1HttpHandlerTaskServices extends V1HttpHandler {

  public V1HttpHandlerTaskServices() {
    super("cloudnet.http.v1.tasks.services");
  }

  @Override
  public void handleOptions(String path, IHttpContext context) {
    this.sendOptions(context, "OPTIONS, POST");
  }

  @Override
  public void handlePost(String path, IHttpContext context) {
    ServiceTask task = CloudNetDriver.getInstance().getServiceTaskProvider()
      .getServiceTask(context.request().pathParameters().get("name"));
    if (task == null) {
      context.response().statusCode(404);
      context.closeAfter(true).cancelNext();
      return;
    }
    JsonDocument body;
    int count;
    try {
      body = JsonDocument.newDocument(context.request().bodyAsString());
      count = body.getInt("count");
      if (count < 1 || body.getDouble("count") != count) {
        this.send400Response(context, "count must be a positive integer");
        return;
      }
    } catch (RuntimeException exception) {
      this.send400Response(context, "Invalid request body");
      return;
    }
    String node = body.getString("nodeUniqueId");
    List<JsonDocument> results = new ArrayList<>();
    for (int i = 0; i < count; i++) {
      try {
        ServiceConfiguration.Builder builder = ServiceConfiguration.builder(task);
        if (node != null && !node.isEmpty()) {
          builder.node(node);
        }
        ServiceInfoSnapshot service = CloudNetDriver.getInstance().getCloudServiceFactory()
          .createCloudService(builder.build());
        if (service == null) {
          results.add(new JsonDocument("success", false).append("reason", "没有可用节点或节点资源不足"));
        } else {
          service.provider().start();
          results.add(new JsonDocument("success", true).append("service", service));
        }
      } catch (RuntimeException exception) {
        results.add(new JsonDocument("success", false).append("reason", exception.getMessage()));
      }
    }
    context.response().statusCode(200).header("Content-Type", "application/json")
      .body(new JsonDocument("results", results).toByteArray());
    context.closeAfter(true).cancelNext();
  }
}
