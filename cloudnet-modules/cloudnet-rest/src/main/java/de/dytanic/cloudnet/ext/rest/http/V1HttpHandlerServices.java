/*
 * Copyright 2019-2021 CloudNetService team & contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package de.dytanic.cloudnet.ext.rest.http;

import de.dytanic.cloudnet.driver.CloudNetDriver;
import com.google.gson.JsonObject;
import de.dytanic.cloudnet.common.document.gson.JsonDocument;
import de.dytanic.cloudnet.driver.network.http.HttpResponseCode;
import de.dytanic.cloudnet.driver.network.http.IHttpContext;
import de.dytanic.cloudnet.driver.service.ServiceInfoSnapshot;
import de.dytanic.cloudnet.http.V1HttpHandler;
import de.dytanic.cloudnet.ext.rest.tasks.TaskOperations;
import java.util.Queue;
import java.util.Objects;
import java.util.stream.Collectors;

public final class V1HttpHandlerServices extends V1HttpHandler {

  public V1HttpHandlerServices(String permission) {
    super(permission);
  }

  @Override
  public void handleOptions(String path, IHttpContext context) {
    this.sendOptions(context, "OPTIONS, GET, POST");
  }

  @Override
  public void handlePost(String path, IHttpContext context) {
    String uuid = context.request().pathParameters().get("uuid");
    ServiceInfoSnapshot service = CloudNetDriver.getInstance().getCloudServiceProvider().getCloudServices().stream()
      .filter(info -> info.getServiceId().getUniqueId().toString().equals(uuid)).findFirst().orElse(null);
    if (service == null) {
      context.response().statusCode(404);
      context.closeAfter(true).cancelNext();
      return;
    }
    String operation = context.request().pathParameters().get("operation");
    if (operation == null) {
      this.send400Response(context, "Missing operation");
      return;
    }
    if (this.handleStop(context, service, operation, false)) return;
    switch (operation) {
      case "start": service.provider().start(); break;
      case "restart": service.provider().restart(); break;
      case "kill": service.provider().kill(); break;
      case "delete": service.provider().delete(); break;
      case "includeTemplates": service.provider().includeWaitingServiceTemplates(); break;
      case "includeInclusions": service.provider().includeWaitingServiceInclusions(); break;
      case "deployResources": service.provider().deployResources(); break;
      case "command":
        String command = context.request().bodyAsString();
        if (command.trim().isEmpty() || service.getLifeCycle() != de.dytanic.cloudnet.driver.service.ServiceLifeCycle.RUNNING) {
          this.send400Response(context, "Command must not be empty and service must be running");
          return;
        }
        service.provider().runCommand(command);
        break;
      default:
        this.send400Response(context, "Unknown operation");
        return;
    }
    context.response().statusCode(200).header("Content-Type", "application/json")
      .body(new JsonDocument("success", true).toByteArray());
    context.closeAfter(true).cancelNext();
  }

  @Override
  public void handleGet(String path, IHttpContext context) {
    if (context.request().pathParameters().containsKey("uuid")) {
      ServiceInfoSnapshot serviceInfoSnapshot = CloudNetDriver.getInstance().getCloudServiceProvider()
        .getCloudServices().stream()
        .filter(serviceInfoSnapshot12 -> serviceInfoSnapshot12.getServiceId().getUniqueId().toString()
          .contains(context.request().pathParameters().get("uuid")))
        .findFirst()
        .orElse(null);

      if (serviceInfoSnapshot == null) {
        serviceInfoSnapshot = CloudNetDriver.getInstance().getCloudServiceProvider().getCloudServices().stream()
          .filter(serviceInfoSnapshot1 -> serviceInfoSnapshot1.getServiceId().getName()
            .contains(context.request().pathParameters().get("uuid")))
          .findFirst().orElse(null);
      }

      if (serviceInfoSnapshot == null) {
        context
          .response()
          .statusCode(HttpResponseCode.HTTP_NOT_FOUND)
          .context()
          .closeAfter(true)
          .cancelNext()
        ;

        return;
      }

      if (context.request().pathParameters().containsKey("operation")) {
        if (this.handleStop(context, serviceInfoSnapshot, context.request().pathParameters().get("operation").toLowerCase(), true)) return;
        switch (context.request().pathParameters().get("operation").toLowerCase()) {
          case "start": {
            serviceInfoSnapshot.provider().start();
            context
              .response()
              .statusCode(HttpResponseCode.HTTP_OK)
              .header("Content-Type", "application/json")
              .body(GSON.toJson(serviceInfoSnapshot))
            ;
          }
          break;
          case "restart": {
            serviceInfoSnapshot.provider().restart();
            context
              .response()
              .statusCode(HttpResponseCode.HTTP_OK)
              .header("Content-Type", "application/json")
              .body(GSON.toJson(serviceInfoSnapshot))
            ;
          }
          break;
          case "delete": {
            serviceInfoSnapshot.provider().delete();
            context
              .response()
              .statusCode(HttpResponseCode.HTTP_OK)
              .header("Content-Type", "application/json")
              .body(GSON.toJson(serviceInfoSnapshot))
            ;
          }
          break;
          case "log": {
            Queue<String> queue = serviceInfoSnapshot.provider().getCachedLogMessages();

            StringBuilder stringBuilder = new StringBuilder();

            for (String item : queue) {
              stringBuilder.append(item).append("\n");
            }

            context
              .response()
              .statusCode(HttpResponseCode.HTTP_OK)
              .header("Content-Type", "text/plain")
              .body(stringBuilder.toString())
            ;
          }
          break;
          case "log_json": {
            Queue<String> queue = serviceInfoSnapshot.provider().getCachedLogMessages();

            context
              .response()
              .statusCode(HttpResponseCode.HTTP_OK)
              .header("Content-Type", "application/json")
              .body(GSON.toJson(queue))
            ;
          }
          break;
          default:
            break;
        }
      } else {
        JsonObject snapshot = this.snapshot(serviceInfoSnapshot);
        context
          .response()
          .statusCode(snapshot == null ? HttpResponseCode.HTTP_NOT_FOUND : HttpResponseCode.HTTP_OK)
          .header("Content-Type", "application/json")
          .body(GSON.toJson(snapshot))
        ;
      }

      context
        .closeAfter(true)
        .cancelNext()
      ;
      return;
    }

    context
      .response()
      .header("Content-Type", "application/json")
      .body(GSON.toJson(CloudNetDriver.getInstance().getCloudServiceProvider().getCloudServices().stream()
        .filter(serviceInfoSnapshot -> {
          if (context.request().queryParameters().containsKey("name") &&
            !context.request().queryParameters().get("name").contains(serviceInfoSnapshot.getServiceId().getName())) {
            return false;
          }

          if (context.request().queryParameters().containsKey("task") &&
            !context.request().queryParameters().get("task")
              .contains(serviceInfoSnapshot.getServiceId().getTaskName())) {
            return false;
          }

          return !context.request().queryParameters().containsKey("node") ||
            context.request().queryParameters().get("node")
              .contains(serviceInfoSnapshot.getServiceId().getNodeUniqueId());
        }).map(this::snapshot).filter(Objects::nonNull).collect(Collectors.toList())))
      .statusCode(200)
      .context()
      .closeAfter(true)
      .cancelNext()
    ;
  }

  private boolean handleStop(IHttpContext context, ServiceInfoSnapshot service, String operation, boolean legacy) {
    TaskOperations tasks = TaskOperations.getInstance();
    if (!"stop".equals(operation) && !"start".equals(operation) && !"restart".equals(operation)) return false;
    JsonDocument result;
    if (tasks == null) result = TaskOperations.error(503, "REST 操作模块不可用，未提交操作").append("pending", false);
    else if ("stop".equals(operation)) result = tasks.stops().submit(service);
    else if (tasks.stops().isStopping(service.getServiceId().getUniqueId())) {
      result = TaskOperations.error(409, "实例停止结果尚未确认，不能启动或重启");
    } else return false;
    context.response().statusCode(result.getInt("code")).header("Content-Type", "application/json")
      .body(legacy && result.getInt("code") == 200
        ? GSON.toJson(this.snapshot(service)) : result.toJson());
    context.closeAfter(true).cancelNext();
    return true;
  }

  private JsonObject snapshot(ServiceInfoSnapshot service) {
    TaskOperations tasks = TaskOperations.getInstance();
    return tasks == null ? new JsonDocument(service).toJsonObject() : tasks.stops().snapshot(service);
  }
}
