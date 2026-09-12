// SPDX-License-Identifier: MIT
/**
 * The four states every data surface in this app must be able to render, kept
 * in one place so they cannot drift apart:
 *
 *   **loading**        a read is in flight
 *   **error**          the chain could not be reached, or the read reverted
 *   **empty**          the read succeeded and the answer is nothing
 *   **not configured** the tenant has not supplied an address yet
 *
 * They are visually distinct on purpose. Collapsing "the RPC is down" into "no
 * pools yet" tells a user the protocol is empty when it may be busy, and there
 * is no way for them to tell which they are looking at.
 *
 * There is no fifth state where a screen shows an example. If it cannot be
 * read, it is not rendered — the reason is said out loud instead.
 */

import type { ReactElement, ReactNode } from "react";

import type { AsyncState } from "../lib/useAsync";

export function Loading({ label = "Reading from chain" }: { label?: string }): ReactElement {
  return (
    <div className="state state-loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}…</span>
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
}: {
  error: Error;
  onRetry?: () => void;
}): ReactElement {
  return (
    <div className="state state-error" role="alert">
      <strong>Could not read the chain.</strong>
      <p className="state-detail">{error.message}</p>
      <p className="state-hint">
        Nothing below is being shown from a cache or an example. Check the RPC endpoints in{" "}
        <code>latch.config.ts</code>, then retry.
      </p>
      {onRetry !== undefined ? (
        <button type="button" className="btn btn-ghost" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function Empty({ title, detail }: { title: string; detail?: ReactNode }): ReactElement {
  return (
    <div className="state state-empty">
      <strong>{title}</strong>
      {detail === undefined ? null : <p className="state-detail">{detail}</p>}
    </div>
  );
}

export function NotConfigured({
  what,
  field,
  detail,
}: {
  what: string;
  field: string;
  detail?: ReactNode;
}): ReactElement {
  return (
    <div className="state state-unconfigured">
      <strong>{what} is not configured.</strong>
      <p className="state-detail">
        Set <code>{field}</code> in <code>latch.config.ts</code>.
      </p>
      {detail === undefined ? null : <p className="state-hint">{detail}</p>}
    </div>
  );
}

/**
 * Renders an async read through the four states.
 *
 * `isEmpty` is supplied by the caller because only the caller knows what empty
 * means for its shape — an empty array, a null field, a zero count.
 */
export function Async<T>({
  state,
  onRetry,
  loadingLabel,
  isEmpty,
  empty,
  children,
}: {
  state: AsyncState<T>;
  onRetry?: () => void;
  loadingLabel?: string;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  children: (data: T) => ReactNode;
}): ReactElement {
  if (state.status === "loading") {
    return <Loading {...(loadingLabel === undefined ? {} : { label: loadingLabel })} />;
  }
  if (state.status === "error") {
    return <ErrorState error={state.error} {...(onRetry === undefined ? {} : { onRetry })} />;
  }
  if (isEmpty !== undefined && isEmpty(state.data) && empty !== undefined) {
    return <>{empty}</>;
  }
  return <>{children(state.data)}</>;
}

/**
 * A provenance line.
 *
 * "Summed from logs since block N" is not a caveat to be tidied away; it is the
 * difference between a total and an estimate. Any figure derived from a log
 * scan must carry one of these.
 */
export function Provenance({ children }: { children: ReactNode }): ReactElement {
  return <p className="provenance">{children}</p>;
}
