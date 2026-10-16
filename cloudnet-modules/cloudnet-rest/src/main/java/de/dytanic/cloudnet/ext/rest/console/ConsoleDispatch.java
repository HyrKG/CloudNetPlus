package de.dytanic.cloudnet.ext.rest.console;

import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/** Network forwarding never runs on the log producer thread. */
final class ConsoleDispatch implements AutoCloseable {
  static final int MAX_FRAMES = 1024;
  static final int MAX_BYTES = 4 * 1024 * 1024;
  private final AtomicInteger bytes = new AtomicInteger();
  private final ThreadPoolExecutor worker = new ThreadPoolExecutor(1, 1, 0, TimeUnit.SECONDS,
    new ArrayBlockingQueue<>(MAX_FRAMES), runnable -> {
      Thread thread = new Thread(runnable, "rest-console-forward");
      thread.setDaemon(true);
      return thread;
    }, new ThreadPoolExecutor.AbortPolicy());

  void submit(int size, Runnable action, Runnable rejected) {
    if (size > MAX_BYTES || this.bytes.addAndGet(size) > MAX_BYTES) {
      if (size <= MAX_BYTES) this.bytes.addAndGet(-size);
      rejected.run();
      return;
    }
    try {
      this.worker.execute(() -> {
        try { action.run(); }
        catch (RuntimeException exception) { rejected.run(); }
        finally { this.bytes.addAndGet(-size); }
      });
    } catch (RejectedExecutionException exception) {
      this.bytes.addAndGet(-size);
      rejected.run();
    }
  }

  @Override public void close() { this.worker.shutdownNow(); }
}
