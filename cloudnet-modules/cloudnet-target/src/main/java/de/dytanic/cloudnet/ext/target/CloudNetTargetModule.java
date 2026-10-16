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

package de.dytanic.cloudnet.ext.target;

import de.dytanic.cloudnet.CloudNet;
import de.dytanic.cloudnet.cluster.NodeServer;
import de.dytanic.cloudnet.common.document.gson.JsonDocument;
import de.dytanic.cloudnet.driver.event.EventListener;
import de.dytanic.cloudnet.driver.module.ModuleLifeCycle;
import de.dytanic.cloudnet.driver.module.ModuleTask;
import de.dytanic.cloudnet.driver.service.ServiceInfoSnapshot;
import de.dytanic.cloudnet.driver.service.ServiceLifeCycle;
import de.dytanic.cloudnet.driver.service.ServiceTask;
import de.dytanic.cloudnet.event.instance.CloudNetTickEvent;
import de.dytanic.cloudnet.event.service.task.ServiceTaskAddEvent;
import de.dytanic.cloudnet.ext.bridge.BridgeServiceProperty;
import de.dytanic.cloudnet.module.NodeCloudNetModule;
import de.dytanic.cloudnet.service.ICloudService;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

public final class CloudNetTargetModule extends NodeCloudNetModule {

  private static final String TARGET_SERVICE_COUNT = "targetServiceCount";

  // Keep the running snapshot until the lifecycle confirms the stop, not just its submission.
  private final Map<String, ServiceInfoSnapshot> stopping = new HashMap<>();
  private volatile boolean active;
  private int ticks;

  @ModuleTask(event = ModuleLifeCycle.STARTED)
  public synchronized void start() {
    this.active = true;
    this.registerListener(this);
    this.synchronizeMinimums();
  }

  @ModuleTask(event = ModuleLifeCycle.STOPPED)
  public synchronized void stop() {
    this.active = false;
    this.getCloudNet().getEventManager().unregisterListener(this);
    this.stopping.clear();
    this.ticks = 0;
  }

  @EventListener
  public void handle(ServiceTaskAddEvent event) {
    int target = this.targetCount(event.getTask());
    if (this.active && target >= 0) {
      event.getTask().setMinServiceCount(target);
    }
  }

  @EventListener
  public synchronized void handle(CloudNetTickEvent event) {
    if (!this.active || !this.getCloudNet().getClusterNodeServerProvider().getSelfNode().isHeadNode()
      || ++this.ticks < CloudNet.TPS) {
      return;
    }
    this.ticks = 0;
    this.synchronizeMinimums();
    this.stopping.values().removeIf(this::hasStopped);

    Map<String, List<ServiceInfoSnapshot>> running = this.getCloudNet().getCloudServiceProvider().getCloudServices()
      .stream()
      .filter(service -> service.getLifeCycle() == ServiceLifeCycle.RUNNING)
      .collect(Collectors.groupingBy(service -> service.getServiceId().getTaskName()));

    for (ServiceTask task : this.getCloudNet().getServiceTaskProvider().getPermanentServiceTasks()) {
      int target = this.targetCount(task);
      List<ServiceInfoSnapshot> services = running.getOrDefault(task.getName(), Collections.emptyList());
      if (target < 0 || task.isMaintenance() || services.size() <= target
        || this.stopping.containsKey(task.getName())) {
        continue;
      }

      ServiceInfoSnapshot candidate = services.stream()
        .filter(service -> this.available(service.getServiceId().getNodeUniqueId()))
        .filter(service -> service.getProperty(BridgeServiceProperty.IS_EMPTY).orElse(false))
        .max(Comparator.comparingInt(service -> service.getServiceId().getTaskServiceId()))
        .orElse(null);
      if (candidate != null) {
        this.stopEmptyService(task.getName(), candidate.getServiceId().getUniqueId());
      }
    }
  }

  private int targetCount(ServiceTask task) {
    return task.getProperties().contains(TARGET_SERVICE_COUNT) ? task.getProperties().getInt(TARGET_SERVICE_COUNT) : -1;
  }

  private void synchronizeMinimums() {
    for (ServiceTask task : this.getCloudNet().getServiceTaskProvider().getPermanentServiceTasks()) {
      int target = this.targetCount(task);
      if (target >= 0 && task.getMinServiceCount() != target) {
        // Preserve extension properties that ServiceTask.makeClone() does not copy.
        ServiceTask updated = new JsonDocument(task).toInstanceOf(ServiceTask.class);
        updated.setMinServiceCount(target);
        this.getCloudNet().getServiceTaskProvider().addPermanentServiceTask(updated);
      }
    }
  }

  private void stopEmptyService(String name, UUID id) {
    ServiceTask task = this.getCloudNet().getServiceTaskProvider().getServiceTask(name);
    ServiceInfoSnapshot current = this.current(id);
    if (task == null || task.isMaintenance() || this.targetCount(task) < 0 || current == null
      || current.getLifeCycle() != ServiceLifeCycle.RUNNING
      || !this.available(current.getServiceId().getNodeUniqueId())
      || !current.getProperty(BridgeServiceProperty.IS_EMPTY).orElse(false)
      || this.getCloudNet().getCloudServiceProvider().getCloudServices(name).stream()
        .filter(service -> service.getLifeCycle() == ServiceLifeCycle.RUNNING).count() <= this.targetCount(task)) {
      return;
    }

    this.stopping.put(name, current);
    this.getLogger().info("Stopping surplus empty service " + current.getName() + " (target: "
      + this.targetCount(task) + ")");
    try {
      current.provider().stopAsync().fireExceptionOnFailure();
    } catch (RuntimeException exception) {
      // A failed submission can still have reached the owner; wait for its actual state.
      exception.printStackTrace();
    }
  }

  private boolean hasStopped(ServiceInfoSnapshot original) {
    if (!this.available(original.getServiceId().getNodeUniqueId())) {
      return false;
    }
    ServiceInfoSnapshot current = this.current(original.getServiceId().getUniqueId());
    return current == null || current.getLifeCycle() == ServiceLifeCycle.STOPPED
      || current.getLifeCycle() == ServiceLifeCycle.PREPARED || current.getLifeCycle() == ServiceLifeCycle.DELETED
      || current.getLifeCycle() == ServiceLifeCycle.RUNNING && original.getProcessSnapshot() != null
        && current.getProcessSnapshot() != null && original.getProcessSnapshot().getPid() > 0
        && current.getProcessSnapshot().getPid() > 0
        && original.getProcessSnapshot().getPid() != current.getProcessSnapshot().getPid();
  }

  private ServiceInfoSnapshot current(UUID id) {
    ICloudService local = this.getCloudNet().getCloudServiceManager().getCloudServices().get(id);
    if (local != null) {
      return local.getServiceInfoSnapshot();
    }
    ServiceInfoSnapshot service = this.getCloudNet().getCloudServiceProvider().getCloudService(id);
    return service != null && service.getServiceId().getNodeUniqueId().equals(this.getCloudNet().getComponentName())
      ? null : service;
  }

  private boolean available(String nodeId) {
    if (nodeId.equals(this.getCloudNet().getComponentName())) {
      return true;
    }
    NodeServer node = this.getCloudNet().getClusterNodeServerProvider().getNodeServer(nodeId);
    return node != null && node.isAvailable();
  }
}
