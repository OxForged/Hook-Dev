// SPDX-License-Identifier: MIT
/**
 * One async primitive, so every screen tells the truth the same way.
 *
 * The four states are deliberately distinct and none of them collapses into
 * another. In particular `error` never falls back to an example value: an
 * unreachable RPC and an empty result are opposite answers, and rendering the
 * second when you got the first is how a screen ends up quietly lying.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type AsyncState<T> =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly error: Error }
  | { readonly status: "ready"; readonly data: T };

export interface AsyncResource<T> {
  readonly state: AsyncState<T>;
  /** Re-runs the read. Safe to call from an event handler. */
  readonly reload: () => void;
}

export function useAsync<T>(
  read: () => Promise<T>,
  deps: readonly unknown[] = [],
): AsyncResource<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: "loading" });
  const [nonce, setNonce] = useState(0);
  const alive = useRef(true);

  // `read` is intentionally not a dependency: callers pass an inline closure,
  // which would be a new function on every render and loop forever.
  const readRef = useRef(read);
  readRef.current = read;

  useEffect(() => {
    alive.current = true;
    setState({ status: "loading" });

    readRef
      .current()
      .then((data) => {
        if (alive.current) setState({ status: "ready", data });
      })
      .catch((err: unknown) => {
        if (!alive.current) return;
        setState({
          status: "error",
          error: err instanceof Error ? err : new Error(String(err)),
        });
      });

    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => {
    setNonce((n) => n + 1);
  }, []);

  return { state, reload };
}
