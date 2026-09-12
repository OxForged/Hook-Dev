// SPDX-License-Identifier: MIT
/**
 * Pools on the shared core, from `Initialize` logs.
 *
 * Two honesty constraints shape this screen.
 *
 * **The list is scoped, and says so.** There is no on-chain enumeration of
 * pools, so this is a log scan from the block Latch was deployed. The
 * provenance line under the table is not decoration.
 *
 * **A hook is disclosed, never rated.** Every row says whether a pool has a
 * hook and what its permission bitmap allows. It does not say whether that hook
 * is safe, because this app cannot know — a bitmap tells you what a contract is
 * *able* to do, and nothing at all about what it will do.
 */

import { LiquidityWidget } from "@latchprotocol/widgets";
import { useState, type ReactElement } from "react";

import { Async, Empty, Provenance } from "../components/States";
import { resolveConfig } from "../config/resolve";
import { capabilityReport, RISK_LABEL } from "../lib/capability";
import { explorerAddress } from "../lib/client";
import { count, formatPips, shortAddress } from "../lib/format";
import { readPools, type PoolRecord } from "../lib/pools";
import { useAsync } from "../lib/useAsync";

function pairLabel(pool: PoolRecord): string {
  const a = pool.token0?.symbol ?? shortAddress(pool.currency0);
  const b = pool.token1?.symbol ?? shortAddress(pool.currency1);
  return `${a} / ${b}`;
}

function HookCell({ pool }: { pool: PoolRecord }): ReactElement {
  if (!pool.hasHook) return <span className="muted">none</span>;

  const report = capabilityReport(pool.hookBitmap);

  return (
    <div className="hook-cell">
      <a href={explorerAddress(pool.hooks)} target="_blank" rel="noreferrer">
        {shortAddress(pool.hooks)}
      </a>
      <span className="tag">{RISK_LABEL[report.riskClass]}</span>
      <ul className="capability-list">
        {report.claims.map((claim) => (
          <li key={claim}>{claim}</li>
        ))}
      </ul>
      {report.valid ? null : (
        <p className="warn-inline">
          This pool&rsquo;s hook bitmap is not a valid combination. Treat the pool as
          unclassifiable, not as safe.
        </p>
      )}
      <p className="state-hint">
        Read off the pool key. It says what this contract is <em>able</em> to do, not what it
        does, and it is not an audit.
      </p>
    </div>
  );
}

export function Pools(): ReactElement {
  const cfg = resolveConfig();
  const resource = useAsync(() => readPools(), []);
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="page">
      <header className="page-head">
        <h1>Pools</h1>
        <p className="page-sub">
          Every pool initialised on the shared CL pool manager at{" "}
          <code>{shortAddress(cfg.contracts.clPoolManager)}</code>.
        </p>
      </header>

      <Async
        state={resource.state}
        onRetry={resource.reload}
        loadingLabel="Scanning Initialize logs"
        isEmpty={(scan) => scan.pools.length === 0}
        empty={
          <Empty
            title="No pools yet"
            detail="Nothing has been initialised on this pool manager since the block Latch was deployed. This is a read of the chain, not a placeholder."
          />
        }
      >
        {(scan) => (
          <>
            <table className="table">
              <thead>
                <tr>
                  <th>Pair</th>
                  <th>LP fee</th>
                  <th>Tick spacing</th>
                  <th>Latch (hook)</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {scan.pools.map((pool) => (
                  <tr key={pool.id}>
                    <td>
                      <span className="pair">{pairLabel(pool)}</span>
                      {pool.token0 === null || pool.token1 === null ? (
                        <p className="warn-inline">
                          One side&rsquo;s ERC-20 metadata could not be read, so it is shown as an
                          address rather than a guessed symbol.
                        </p>
                      ) : null}
                    </td>
                    <td>{formatPips(pool.lpFeePips)}</td>
                    <td>{pool.tickSpacing}</td>
                    <td>
                      <HookCell pool={pool} />
                    </td>
                    <td className="mono">#{pool.createdAtBlock.toString()}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setSelected(selected === pool.id ? null : pool.id)}
                      >
                        {selected === pool.id ? "Close" : "Liquidity"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <Provenance>
              {count(scan.pools.length, "pool")}, read from{" "}
              <code>Initialize</code> logs emitted by the CL pool manager between block{" "}
              {scan.fromBlock.toString()} and {scan.toBlock.toString()}. A pool created before
              block {scan.fromBlock.toString()} would not appear, and none can exist, because that
              is the block the pool manager was deployed.
            </Provenance>

            {selected === null ? null : (
              <section className="panel">
                <LiquidityWidget defaultPoolId={selected} />
              </section>
            )}
          </>
        )}
      </Async>
    </div>
  );
}
