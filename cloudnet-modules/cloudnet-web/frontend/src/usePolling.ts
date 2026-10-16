import { useCallback, useEffect, useState } from 'react';
import { errorMessage, isUnauthorized } from './api';

export function usePolling<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  interval: number,
  onUnauthorized: () => void,
  refreshToken = 0,
  enabled = true,
) {
  const [state, setState] = useState<{ data: T | null; error: string; updatedAt: Date | null; requestedAt: number }>({
    data: null, error: '', updatedAt: null, requestedAt: 0,
  });
  const [refreshing, setRefreshing] = useState(true);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      const requestedAt = performance.now();
      setRefreshing(true);
      try {
        const data = await loader(controller.signal);
        if (!controller.signal.aborted) setState({ data, error: '', updatedAt: new Date(), requestedAt });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (isUnauthorized(error)) {
          onUnauthorized();
          return;
        }
        setState(previous => ({ ...previous, error: errorMessage(error) }));
      } finally {
        if (!controller.signal.aborted) {
          setRefreshing(false);
          timer = setTimeout(load, interval);
        }
      }
    }
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [loader, interval, onUnauthorized, revision, refreshToken, enabled]);

  return { ...state, refreshing, loading: state.data === null && !state.error, refresh };
}
