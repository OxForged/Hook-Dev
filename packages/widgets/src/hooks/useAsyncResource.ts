// SPDX-License-Identifier: MIT
/**
 * A small async-resource hook.
 *
 * The widgets deliberately do not depend on a data-fetching library: an
 * embeddable widget that drags TanStack Query into a host's bundle - and its
 * provider into the host's tree - is a widget teams decline to embed. This is
 * the minimum that behaves correctly: it cancels stale results, exposes a real
 * status enum rather than a pile of booleans, and never resolves into a
 * component that has unmounted.
 */

import { useCallback, useEffect, useRef, useState } from "react";

/** Lifecycle of an async resource. */
export type AsyncStatus = "idle" | "loading" | "success" | "error";

/** State of an async resource. */
export interface AsyncResource<T> {
  readonly status: AsyncStatus;
  readonly data: T | null;
  readonly error: Error | null;
  /** `Date.now()` of the last successful load. */
  readonly updatedAt: number | null;
  /** True while refreshing over previously loaded data. */
  readonly isRefreshing: boolean;
  refetch(): void;
}

/** Options for {@link useAsyncResource}. */
export interface UseAsyncResourceOptions {
  /** Skip fetching entirely. The resource stays `idle`. */
  readonly enabled?: boolean;
  /** Poll interval in milliseconds. Omit or set 0 to disable polling. */
  readonly refetchIntervalMs?: number;
}

function toError(cause: unknown): Error {
  if (cause instanceof Error) return cause;
  return new Error(String(cause));
}

/**
 * Runs `loader` whenever `deps` change, with cancellation of stale results.
 *
 * `loader` must be stable or memoised by the caller; `deps` is what actually
 * triggers a refetch.
 */
export function useAsyncResource<T>(
  loader: () => Promise<T>,
  deps: readonly unknown[],
  options: UseAsyncResourceOptions = {},
): AsyncResource<T> {
  const { enabled = true, refetchIntervalMs = 0 } = options;

  const [status, setStatus] = useState<AsyncStatus>("idle");
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const mounted = useRef(true);
  const requestId = useRef(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refetch = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      setIsRefreshing(false);
      return;
    }

    requestId.current += 1;
    const id = requestId.current;
    const hadData = data !== null;

    if (hadData) setIsRefreshing(true);
    else setStatus("loading");

    void loaderRef
      .current()
      .then((result) => {
        if (!mounted.current || id !== requestId.current) return;
        setData(result);
        setError(null);
        setStatus("success");
        setUpdatedAt(Date.now());
        setIsRefreshing(false);
      })
      .catch((cause: unknown) => {
        if (!mounted.current || id !== requestId.current) return;
        setError(toError(cause));
        setStatus("error");
        setIsRefreshing(false);
      });
    // `data` is intentionally excluded: including it would refetch on every
    // successful load. It is read only to decide between "loading" and
    // "refreshing", which is a presentation detail.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, reloadToken, ...deps]);

  useEffect(() => {
    if (!enabled || refetchIntervalMs <= 0) return;
    const handle = setInterval(refetch, refetchIntervalMs);
    return () => clearInterval(handle);
  }, [enabled, refetchIntervalMs, refetch]);

  return { status, data, error, updatedAt, isRefreshing, refetch };
}
