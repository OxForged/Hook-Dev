// SPDX-License-Identifier: MIT
/**
 * Launches created by the configured `LaunchpadKit`.
 *
 * A Latch launch is a pool whose LP fee starts high and decays block by block —
 * not a token sale. There is no cap, no allocation and no claim, so there is
 * nothing to draw a progress bar against and this screen does not draw one. It
 * shows the schedule, the fee the hook is charging right now, and whether the
 * first swap has happened.
 */

import { Link } from "react-router-dom";
import type { ReactElement } from "react";

import { Async, Empty, NotConfigured, Provenance } from "../components/States";
import { resolveConfig } from "../config/resolve";
import { explorerAddress } from "../lib/client";
import { count, formatPips, shortAddress } from "../lib/format";
import {
  blocksToSeconds,
  formatDuration,
  presetLabel,
  readLaunchBounds,
  readLaunches,
  type LaunchRecord,
} from "../lib/launches";
import { useAsync } from "../lib/useAsync";

const PHASE_LABEL: Record<LaunchRecord["phase"], string> = {
  scheduled: "Scheduled",
  decaying: "Fee decaying",
  settled: "Settled",
};

function tokenLabel(record: LaunchRecord): string {
  return record.launchTokenMeta?.symbol ?? shortAddress(record.launchToken);
}

function quoteLabel(record: LaunchRecord): string {
  return record.quoteTokenMeta?.symbol ?? shortAddress(record.quoteToken);
}

export function Launches(): ReactElement {
  const cfg = resolveConfig();

  const resource = useAsync(async () => {
    const [scan, bounds] = await Promise.all([readLaunches(), readLaunchBounds()]);
    return { scan, bounds };
  }, [cfg.launchpadKit]);

  if (cfg.launchpadKit === null) {
    return (
      <div className="page">
        <header className="page-head">
          <h1>Launch</h1>
        </header>
        <NotConfigured
          what="The launchpad"
          field="chain.launchpadKit"
          detail={
            <>
              Latch has no shared <code>LaunchpadKit</code> deployed on any chain yet, so there is
              nothing to point this at until either Latch ships one or you deploy your own. Run{" "}
              <code>npm run latch:verify</code> for the current state, and see the README section
              &ldquo;The launchpad half is not live yet&rdquo;.
            </>
          }
        />
      </div>
    );
  }

  /* Bound to a local so the narrowing above survives into the render callbacks.
     TS re-widens a property access inside a closure, and the provenance line at
     the bottom is inside one. */
  const kit = cfg.launchpadKit;

  return (
    <div className="page">
      <header className="page-head">
        <h1>Launch</h1>
        <p className="page-sub">
          Pools created through <code>{shortAddress(kit)}</code> with a decaying
          launch fee.
        </p>
        <Link className="btn btn-primary" to="/launch/new">
          New launch
        </Link>
      </header>

      <Async
        state={resource.state}
        onRetry={resource.reload}
        loadingLabel="Reading LaunchCreated logs"
        isEmpty={({ scan }) => scan.launches.length === 0}
        empty={
          <Empty
            title="No launches yet"
            detail="This kit has created none. That is a read of its logs, not a placeholder."
          />
        }
      >
        {({ scan, bounds }) => (
          <>
            <div className="cards">
              {scan.launches.map((record) => (
                <article className="card" key={record.poolId}>
                  <header className="card-head">
                    <h2>
                      {tokenLabel(record)} <span className="muted">/ {quoteLabel(record)}</span>
                    </h2>
                    <span className={`tag tag-${record.phase}`}>{PHASE_LABEL[record.phase]}</span>
                  </header>

                  <dl className="kv">
                    <dt>Fee now</dt>
                    <dd>
                      {record.currentFeePips === null ? (
                        <span className="muted">could not be read from the hook</span>
                      ) : (
                        formatPips(record.currentFeePips)
                      )}
                    </dd>

                    <dt>Schedule</dt>
                    <dd>
                      {formatPips(record.initialFeeBips)} to {formatPips(record.finalFeeBips)} over{" "}
                      {record.decayBlocks.toLocaleString()} blocks (
                      {formatDuration(blocksToSeconds(record.decayBlocks, bounds.blockTimeCentis))}{" "}
                      at {bounds.blockTimeCentis / 100}s per block)
                    </dd>

                    <dt>Starts</dt>
                    <dd className="mono">block {record.startBlock.toString()}</dd>

                    <dt>Max buy per tx</dt>
                    <dd>
                      {record.maxBuyPerTx === 0n ? (
                        <span className="muted">uncapped</span>
                      ) : (
                        `${record.maxBuyPerTx.toString()} raw units`
                      )}
                    </dd>

                    <dt>Preset</dt>
                    <dd>{presetLabel(record.preset)}</dd>

                    <dt>Operator</dt>
                    <dd>
                      <a href={explorerAddress(record.operator)} target="_blank" rel="noreferrer">
                        {shortAddress(record.operator)}
                      </a>
                    </dd>
                  </dl>

                  {!record.enabled ? (
                    <p className="warn-inline">
                      The launch schedule is disabled on the hook, so this pool charges its plain
                      LP fee rather than the decay above.
                    </p>
                  ) : null}
                  {record.launched ? (
                    <p className="state-hint">
                      Trading has started, so the schedule is frozen. It cannot be reconfigured.
                    </p>
                  ) : (
                    <p className="state-hint">
                      Not yet traded. The operator can still call <code>reconfigureLaunch</code>{" "}
                      until the start block.
                    </p>
                  )}
                </article>
              ))}
            </div>

            <Provenance>
              {count(scan.launches.length, "launch", "launches")}, read from{" "}
              <code>LaunchCreated</code> logs emitted by{" "}
              <code>{shortAddress(kit)}</code> since block{" "}
              {scan.fromBlock.toString()}, at block {scan.atBlock.toString()}. Fees and status come
              from the hook at <code>{shortAddress(scan.hook)}</code>, read live rather than from
              the creation event.
            </Provenance>
          </>
        )}
      </Async>
    </div>
  );
}
