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

import de.dytanic.cloudnet.driver.module.ModuleLifeCycle;
import de.dytanic.cloudnet.driver.module.ModuleTask;
import de.dytanic.cloudnet.driver.network.HostAndPort;
import de.dytanic.cloudnet.driver.network.http.IHttpHandler;
import de.dytanic.cloudnet.driver.network.http.IHttpServer;
import de.dytanic.cloudnet.driver.network.netty.http.NettyHttpServer;
import de.dytanic.cloudnet.ext.rest.CloudNetRestModule;
import de.dytanic.cloudnet.module.NodeCloudNetModule;

public final class CloudNetWebModule extends NodeCloudNetModule {

  private IHttpServer webServer;

  @ModuleTask(event = ModuleLifeCycle.STARTED)
  public void registerWebConsole() throws Exception {
    String host = this.getConfig().getString("host", "127.0.0.1");
    int port = this.getConfig().getInt("port", 2813);
    this.getConfig().append("host", host).append("port", port);
    this.saveConfig();

    this.webServer = new NettyHttpServer();
    try {
      CloudNetRestModule.registerHttpHandlers(this.webServer);
      WebHttpHandler handler = new WebHttpHandler();
      this.webServer
        .registerHandler("/api/v1/players", IHttpHandler.PRIORITY_NORMAL,
          new WebPlayersHttpHandler("cloudnet.http.v1.players"))
        .registerHandler("/api/v1/players/actions/{action}", IHttpHandler.PRIORITY_NORMAL,
          new WebPlayersHttpHandler("cloudnet.http.v1.players.operation"))
        .registerHandler("/", IHttpHandler.PRIORITY_LOWEST, handler)
        .registerHandler("/*", IHttpHandler.PRIORITY_LOWEST, handler);
      if (!this.webServer.addListener(new HostAndPort(host, port))) {
        throw new IllegalStateException("Unable to bind CloudNet-Web to " + host + ":" + port);
      }
    } catch (Exception exception) {
      this.closeWebConsole();
      throw exception;
    }
    this.getLogger().info("CloudNet-Web is available at http://" + host + ":" + port + "/");
  }

  @ModuleTask(event = ModuleLifeCycle.STOPPED)
  public void closeWebConsole() throws Exception {
    if (this.webServer != null) {
      this.webServer.close();
      this.webServer = null;
    }
  }
}
