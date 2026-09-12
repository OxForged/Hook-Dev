// SPDX-License-Identifier: MIT
/**
 * Swap.
 *
 * The widget itself comes from `@latchprotocol/widgets`, which encodes the call
 * against the real Universal Router and takes this app's fee as a `TAKE_PORTION`
 * action inside the swap plan. Everything around it exists to make the cost
 * legible: the fee this front end takes is disclosed on the page rather than
 * only in a settings panel, because a fee a user finds out about afterwards is
 * a fee they were not told about.
 */

import { SwapWidget, useWidgetContext } from "@latchprotocol/widgets";
import type { ReactElement } from "react";
import { Link } from "react-router-dom";

import { Empty, NotConfigured } from "../components/States";
import { resolveConfig } from "../config/resolve";
import { formatBps } from "../lib/format";

export function Swap(): ReactElement {
  const cfg = resolveConfig();
  const { adapter } = useWidgetContext();
  const tokenCount = cfg.tokens.length;

  return (
    <div className="page page-narrow">
      <header className="page-head">
        <h1>Swap</h1>
        <p className="page-sub">
          Routed through the Latch core deployed on {cfg.core.name}. Your pools, our Vault.
        </p>
      </header>

      {tokenCount === 0 ? (
        <NotConfigured
          what="The token list"
          field="tokens"
          detail={
            <>
              A swap picker with no tokens in it is not a swap screen. Add the tokens you want to
              list; symbols and decimals are read back off each contract, so a wrong entry is
              reported rather than shown.
            </>
          }
        />
      ) : (
        <SwapWidget title="Swap" />
      )}

      <section className="disclosure">
        <h2>What this swap costs</h2>
        <ul>
          <li>
            <strong>Pool LP fee</strong> — set by whoever created the pool, taken from the input.
            It differs per pool; the widget shows the one being routed through.
          </li>
          <li>
            <strong>Latch protocol fee</strong> — set by Latch governance on the shared pool
            manager and capped at 0.4% by core. It is frequently zero.{" "}
            <Link to="/fees">Read the live value.</Link>
          </li>
          <li>
            <strong>This app&rsquo;s fee</strong> —{" "}
            {cfg.fee.active ? (
              <>
                {formatBps(cfg.fee.bps)} of the swap <em>output</em>, paid to{" "}
                <code>{cfg.fee.wallet}</code> in the same transaction as the swap.
              </>
            ) : (
              <>nothing. This front end takes no fee today.</>
            )}
          </li>
        </ul>
        {adapter.isMock ? (
          <Empty
            title="This build is running against the mock adapter"
            detail="No figure on this screen came from a chain. Do not ship this build."
          />
        ) : null}
      </section>
    </div>
  );
}
