package de.dytanic.cloudnet.ext.rest.metrics;

import com.google.gson.JsonElement;
import de.dytanic.cloudnet.common.document.gson.JsonDocument;
import de.dytanic.cloudnet.driver.service.ServiceInfoSnapshot;
import de.dytanic.cloudnet.driver.service.ServiceLifeCycle;
import java.util.concurrent.TimeUnit;

final class MetricsPolicy {
  static final long SAMPLE_SECONDS = 30;
  static final long STALE_MILLIS = TimeUnit.SECONDS.toMillis(90);
  static final long MINUTE = TimeUnit.MINUTES.toMillis(1);
  static final long RETENTION = TimeUnit.HOURS.toMillis(24);

  private MetricsPolicy() { }

  static boolean fresh(ServiceInfoSnapshot info, long now) {
    return info.getLifeCycle() == ServiceLifeCycle.RUNNING && now - info.getCreationTime() <= STALE_MILLIS;
  }

  static Double number(JsonDocument document, String field) {
    JsonElement value = document.get(field);
    if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber()) return null;
    double number = value.getAsDouble();
    return Double.isFinite(number) && number >= 0 ? number : null;
  }
}
