// SPDX-License-Identifier: MIT
/**
 * Every fee a user of this app pays, read from chain, on one page.
 *
 * This screen exists because three separate parties take a cut of one trade and
 * nobody discloses the other two. A user told about one of three has been
 * misled by omission, and the front end is the only surface that can see all
 * three at once.
 *
 * It is also where the shared-core bargain is stated plainly: Latch's protocol
 * fee is not something this app can change, and that is the price of not
 * deploying and verifying nineteen contracts.
 */

import type { ReactElement } from "react";

import { Async, Provenance } from "../components/States";
import { resolveConfig } from "../config/resolve";
import { explorerAddress } from "../lib/client";
import { formatBps, formatPips, shortAddress } from "../lib/format";
import { readProtocolStatus } from "../lib/protocol";
import { useAsync } from "../lib/useAsync";

export function Fees(): ReactElement {
  const cfg = resolveConfig();
  const resource = useAsync(() => readProtocolStatus(), []);

  return (
    <div className="page page-narrow">
      <header className="page-head">
        <h1>Fees</h1>
        <p className="page-sub">
          Three fees stack on one trade. All three are below, and the on-chain two are read live.
        </p>
      </header>

      <section className="panel">
        <h2>1 · The pool&rsquo;s LP fee</h2>
        <p>
          Set by whoever created the pool, taken from the input, and paid to the liquidity
          providers in range. It differs per pool, so there is no single number to show here — the
          Pools screen lists each one, and the swap widget shows the fee on the route it picked.
        </p>
      </section>

      <Async
        state={resource.state}
        onRetry={resource.reload}
        loadingLabel="Reading the pool manager and fee controller"
      >
        {(status) => (
          <>
            <section className="panel">
              <h2>2 · Latch&rsquo;s protocol fee</h2>
              {!status.controllerWired ? (
                <p>
                  <strong>Zero.</strong> The shared pool manager&rsquo;s{" "}
                  <code>protocolFeeController</code> is the zero address, so no protocol fee is in
                  force on this chain today. A controller can be deployed and still be inert; this
                  is read from the slot that settles it rather than from the controller itself.
                </p>
              ) : (
                <>
                  <p>
                    <strong>{formatPips(status.effectiveProtocolFeePips)}</strong> of the input, set
                    by the controller at{" "}
                    <a
                      href={explorerAddress(status.feeController)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {shortAddress(status.feeController)}
                    </a>
                    .
                  </p>
                  {status.effectiveProtocolFeePips === 0 ? (
                    <p className="state-hint">
                      A controller is wired but is currently charging nothing, either because it is
                      disabled or because no default is set.
                    </p>
                  ) : null}
                </>
              )}
              <p className="state-hint">
                Capped at {formatPips(status.maxProtocolFeePips)} by core&rsquo;s{" "}
                <code>MAX_PROTOCOL_FEE</code>. This app cannot change it: the controller belongs to
                Latch governance, and that is the trade for running on core that is already
                deployed, verified and exercised.
              </p>
            </section>

            <section className="panel">
              <h2>3 · This app&rsquo;s fee</h2>
              {cfg.fee.active ? (
                <>
                  <p>
                    <strong>{formatBps(cfg.fee.bps)}</strong> of the swap <em>output</em>, paid to{" "}
                    <a href={explorerAddress(cfg.fee.wallet)} target="_blank" rel="noreferrer">
                      {cfg.fee.wallet}
                    </a>{" "}
                    in the same transaction as the swap.
                  </p>
                  <p className="state-hint">
                    Taken from the output, not the input, so it is not additive with the two above
                    — adding a pip figure and a bps figure taken from opposite sides of a trade
                    produces a number that is wrong in both directions.
                  </p>
                </>
              ) : (
                <p>
                  <strong>Nothing.</strong> <code>fee.bps</code> is 0 in{" "}
                  <code>latch.config.ts</code>, so this front end takes no cut.
                </p>
              )}
            </section>

            <section className="panel">
              <h2>Where this app runs</h2>
              <dl className="kv">
                <dt>Chain</dt>
                <dd>
                  {status.chainName} ({status.chainId})
                </dd>
                <dt>Vault</dt>
                <dd>
                  <a href={explorerAddress(status.vault)} target="_blank" rel="noreferrer">
                    {status.vault}
                  </a>
                </dd>
                <dt>Vault owner</dt>
                <dd className="mono">{status.vaultOwner}</dd>
                <dt>CL manager registered</dt>
                <dd>{status.clRegistered ? "yes" : "no — nothing will work"}</dd>
              </dl>
              <p className="state-hint">
                These are Latch&rsquo;s contracts, not this app&rsquo;s. Your pools live in that
                Vault. You did not deploy it, you cannot upgrade it, and neither can anyone
                operating this front end.
              </p>
            </section>

            <Provenance>Read at block {status.blockNumber.toString()}.</Provenance>
          </>
        )}
      </Async>
    </div>
  );
}
