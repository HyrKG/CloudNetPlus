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

package de.dytanic.cloudnet.ext.web;

import de.dytanic.cloudnet.common.io.FileUtils;
import de.dytanic.cloudnet.driver.network.http.IHttpContext;
import de.dytanic.cloudnet.driver.network.http.MethodHttpHandlerAdapter;
import java.io.InputStream;

public final class WebHttpHandler extends MethodHttpHandlerAdapter {

  @Override
  public void handleGet(String path, IHttpContext context) throws Exception {
    String resource = context.request().path().substring(1);
    if (resource.isEmpty()) {
      resource = "index.html";
    }
    if (resource.contains("..") || resource.contains("\\")) {
      context.response().statusCode(404);
      context.closeAfter(true).cancelNext();
      return;
    }

    try (InputStream input = this.getClass().getClassLoader().getResourceAsStream("web/" + resource)) {
      if (input == null) {
        context.response().statusCode(404);
      } else {
        context.response()
          .statusCode(200)
          .header("Content-Type", this.contentType(resource))
          .header("Cache-Control", resource.equals("index.html") ? "no-cache" : "public, max-age=31536000, immutable")
          .body(FileUtils.toByteArray(input));
      }
    }
    context.closeAfter(true).cancelNext();
  }

  private String contentType(String resource) {
    String extension = resource.substring(resource.lastIndexOf('.') + 1);
    switch (extension) {
      case "html":
        return "text/html; charset=utf-8";
      case "js":
        return "text/javascript; charset=utf-8";
      case "css":
        return "text/css; charset=utf-8";
      case "json":
        return "application/json; charset=utf-8";
      case "svg":
        return "image/svg+xml";
      case "png":
        return "image/png";
      case "ico":
        return "image/x-icon";
      case "woff2":
        return "font/woff2";
      case "woff":
        return "font/woff";
      default:
        return "application/octet-stream";
    }
  }
}
