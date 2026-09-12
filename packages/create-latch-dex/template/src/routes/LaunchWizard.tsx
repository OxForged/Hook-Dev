// SPDX-License-Identifier: MIT
/**
 * The launch wizard: one `LaunchpadKit.createLaunch` call, built here.
 *
 * Three things this screen refuses to do, each for a reason that cost somebody
 * real money the last time it was not refused:
 *
 *   * **It does not guess the bounds.** `MAX_DECAY_BLOCKS`, `MAX_START_DELAY`
 *     and the fee ceilings are read off the deployed hook. They are block
 *     counts, so their wall-clock meaning depends entirely on the chain's block
 *     time — a million blocks is about 139 days at 12 seconds and about 28
 *     hours at a tenth of a second. A wizard that assumed one of those would
 *     offer schedules the contract rejects.
 *
 *   * **It does not send without simulating.** Every guard in the kit is a
 *     revert, which makes `simulateContract` a complete and free pre-flight.
 *     The Create button is disabled until a simulation succeeds.
 *
 *   * **It does not decide the price for you, and it says what the price
 *     means.** Initialising a pool fixes its starting price permanently. An
 *     empty pool at a wrong price is a trap for whoever provides liquidity
 *     first, and there is no undo.
 */

import { useState, type FormEvent, type ReactElement } from "react";
import { parseUnits, type Address } from "viem";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";

import { Async, NotConfigured } from "../components/States";
import { resolveConfig } from "../config/resolve";
import { explorerTx } from "../lib/client";
import { buildCreateLaunch, type LaunchDraft } from "../lib/createLaunch";
import { formatDuration, blocksToSeconds, PRESETS, readLaunchBounds } from "../lib/launches";
import { formatPips } from "../lib/format";
import { useAsync } from "../lib/useAsync";

const CUSTOM_PRESET = PRESETS.indexOf("Custom");

interface FormState {
  launchToken: string;
  quoteToken: string;
  tickSpacing: string;
  startPrice: string;
  preset: number;
  initialFeeBips: string;
  finalFeeBips: string;
  decayBlocks: string;
  startDelaySeconds: string;
  maxBuyPerTx: string;
  seedLaunchTokenAmount: string;
  seedQuoteTokenAmount: string;
}

const EMPTY: FormState = {
  launchToken: "",
  quoteToken: "",
  tickSpacing: "60",
  startPrice: "",
  preset: 0,
  initialFeeBips: "100000",
  finalFeeBips: "3000",
  decayBlocks: "1000",
  startDelaySeconds: "0",
  maxBuyPerTx: "0",
  seedLaunchTokenAmount: "0",
  seedQuoteTokenAmount: "0",
};

type Phase =
  | { kind: "idle" }
  | { kind: "simulating" }
  | { kind: "simulated"; poolId: string }
  | { kind: "sending" }
  | { kind: "sent"; hash: string }
  | { kind: "failed"; message: string };

export function LaunchWizard(): ReactElement {
  const cfg = resolveConfig();
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const wagmiClient = usePublicClient();

  const bounds = useAsync(() => readLaunchBounds(), [cfg.launchpadKit]);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [decimals, setDecimals] = useState({ launch: 18, quote: 18 });

  if (cfg.launchpadKit === null) {
    return (
      <div className="page page-narrow">
        <header className="page-head">
          <h1>New launch</h1>
        </header>
        <NotConfigured what="The launchpad" field="chain.launchpadKit" />
      </div>
    );
  }
  const kit = cfg.launchpadKit;

  function set<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((current) => ({ ...current, [key]: value }));
    setPhase({ kind: "idle" });
  }

  function draftFrom(): LaunchDraft {
    return {
      launchToken: form.launchToken as Address,
      quoteToken: form.quoteToken as Address,
      tickSpacing: Number(form.tickSpacing),
      startPrice: form.startPrice,
      launchTokenDecimals: decimals.launch,
      quoteTokenDecimals: decimals.quote,
      preset: form.preset,
      initialFeeBips: Number(form.initialFeeBips),
      finalFeeBips: Number(form.finalFeeBips),
      decayBlocks: Number(form.decayBlocks),
      startDelaySeconds: Number(form.startDelaySeconds),
      maxBuyPerTx: parseUnits(form.maxBuyPerTx || "0", decimals.quote),
      operator: (address ?? "0x0000000000000000000000000000000000000000") as Address,
      seedLaunchTokenAmount: parseUnits(form.seedLaunchTokenAmount || "0", decimals.launch),
      seedQuoteTokenAmount: parseUnits(form.seedQuoteTokenAmount || "0", decimals.quote),
      positionRecipient: (address ?? "0x0000000000000000000000000000000000000000") as Address,
      deadlineSeconds: 20 * 60,
    };
  }

  async function onSimulate(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (address === undefined || wagmiClient === undefined) {
      setPhase({ kind: "failed", message: "Connect a wallet first." });
      return;
    }
    setPhase({ kind: "simulating" });
    try {
      const call = await buildCreateLaunch(draftFrom());
      /* A raw `call` rather than `simulateContract`, so what is simulated is
         byte-identical to what would be sent. Simulating a re-encoded version of
         the same intent is how a wizard passes its own check and reverts on chain. */
      await wagmiClient.call({
        account: address,
        to: call.to,
        data: call.data,
        value: call.value,
      });
      setPhase({ kind: "simulated", poolId: call.poolId });
    } catch (err) {
      setPhase({
        kind: "failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function onSend(): Promise<void> {
    if (walletClient === undefined || address === undefined) return;
    setPhase({ kind: "sending" });
    try {
      const call = await buildCreateLaunch(draftFrom());
      const hash = await walletClient.sendTransaction({
        to: call.to,
        data: call.data,
        value: call.value,
      });
      setPhase({ kind: "sent", hash });
    } catch (err) {
      setPhase({ kind: "failed", message: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <div className="page page-narrow">
      <header className="page-head">
        <h1>New launch</h1>
        <p className="page-sub">
          One transaction: create the pool, set the decaying launch fee, and seed liquidity from
          your wallet.
        </p>
      </header>

      <Async state={bounds.state} onRetry={bounds.reload} loadingLabel="Reading the kit's limits">
        {(limits) => (
          <form className="form" onSubmit={(e) => void onSimulate(e)}>
            <fieldset>
              <legend>Pair</legend>

              <label>
                Launch token address
                <input
                  value={form.launchToken}
                  onChange={(e) => set("launchToken", e.target.value)}
                  placeholder="0x…"
                  required
                />
              </label>
              <label>
                Launch token decimals
                <input
                  type="number"
                  min={0}
                  max={36}
                  value={decimals.launch}
                  onChange={(e) => setDecimals((d) => ({ ...d, launch: Number(e.target.value) }))}
                />
              </label>

              <label>
                Quote token address
                <input
                  value={form.quoteToken}
                  onChange={(e) => set("quoteToken", e.target.value)}
                  placeholder="0x…"
                  required
                />
              </label>
              <label>
                Quote token decimals
                <input
                  type="number"
                  min={0}
                  max={36}
                  value={decimals.quote}
                  onChange={(e) => setDecimals((d) => ({ ...d, quote: Number(e.target.value) }))}
                />
              </label>

              <label>
                Tick spacing
                <input
                  type="number"
                  min={1}
                  value={form.tickSpacing}
                  onChange={(e) => set("tickSpacing", e.target.value)}
                  required
                />
              </label>

              <label>
                Starting price, quote tokens per launch token
                <input
                  value={form.startPrice}
                  onChange={(e) => set("startPrice", e.target.value)}
                  placeholder="0.0001"
                  required
                />
                <small>
                  This fixes the pool&rsquo;s price permanently and there is no undo. An empty pool
                  at a wrong price is a trap for whoever adds liquidity first.
                </small>
              </label>
            </fieldset>

            <fieldset>
              <legend>Launch fee schedule</legend>

              <label>
                Preset
                <select
                  value={form.preset}
                  onChange={(e) => set("preset", Number(e.target.value))}
                >
                  {PRESETS.map((name, index) => (
                    <option key={name} value={index}>
                      {name}
                    </option>
                  ))}
                </select>
                <small>
                  A preset&rsquo;s numbers are compiled into the kit, so this app cannot show them
                  without guessing. Choose <code>Custom</code> to set them explicitly and see
                  exactly what will be applied.
                </small>
              </label>

              {form.preset === CUSTOM_PRESET ? (
                <>
                  <label>
                    Opening fee, in pips (max {formatPips(limits.maxInitialFeeBips)})
                    <input
                      type="number"
                      min={0}
                      max={limits.maxInitialFeeBips}
                      value={form.initialFeeBips}
                      onChange={(e) => set("initialFeeBips", e.target.value)}
                    />
                    <small>{formatPips(Number(form.initialFeeBips) || 0)} of every trade</small>
                  </label>

                  <label>
                    Final fee, in pips (max {formatPips(limits.maxFinalFeeBips)})
                    <input
                      type="number"
                      min={0}
                      max={limits.maxFinalFeeBips}
                      value={form.finalFeeBips}
                      onChange={(e) => set("finalFeeBips", e.target.value)}
                    />
                    <small>{formatPips(Number(form.finalFeeBips) || 0)} once decay ends</small>
                  </label>

                  <label>
                    Decay window, in blocks (max {limits.maxDecayBlocks.toLocaleString()})
                    <input
                      type="number"
                      min={1}
                      max={limits.maxDecayBlocks}
                      value={form.decayBlocks}
                      onChange={(e) => set("decayBlocks", e.target.value)}
                    />
                    <small>
                      about{" "}
                      {formatDuration(
                        blocksToSeconds(Number(form.decayBlocks) || 0, limits.blockTimeCentis),
                      )}{" "}
                      at the {limits.blockTimeCentis / 100}s block time this kit was configured
                      with. The contract counts blocks, not seconds.
                    </small>
                  </label>
                </>
              ) : (
                <p className="state-hint">
                  The preset supplies the opening fee, the final fee and the decay window. The
                  simulation below will show whether the result is within the hook&rsquo;s limits.
                </p>
              )}

              <label>
                Start delay, in seconds
                <input
                  type="number"
                  min={0}
                  value={form.startDelaySeconds}
                  onChange={(e) => set("startDelaySeconds", e.target.value)}
                />
                <small>
                  Converted to a block count by the kit. Its ceiling is{" "}
                  {limits.maxStartDelay.toString()} blocks, about{" "}
                  {formatDuration(blocksToSeconds(limits.maxStartDelay, limits.blockTimeCentis))}.
                </small>
              </label>

              <label>
                Max buy per transaction, in quote tokens (0 for uncapped)
                <input
                  value={form.maxBuyPerTx}
                  onChange={(e) => set("maxBuyPerTx", e.target.value)}
                />
              </label>
            </fieldset>

            <fieldset>
              <legend>Seed liquidity</legend>
              <p className="state-hint">
                Taken from your wallet in the same transaction, over the full tick range. The
                position NFT is minted to you.
              </p>
              <p className="state-hint">
                <strong>Approve first.</strong> The kit pulls both sides with a plain ERC-20{" "}
                <code>transferFrom</code>, so each token needs an <code>approve</code> to{" "}
                <code>{kit}</code> — not to Permit2, which the kit only uses internally
                afterwards. Without it the simulation below fails, which is the point of running
                it.
              </p>
              <p className="state-hint">
                A fee-on-transfer token delivers less than it is asked for. The kit measures what
                actually arrived and seeds that, so the position will be slightly smaller than the
                amounts you type here.
              </p>
              <label>
                Launch tokens to seed
                <input
                  value={form.seedLaunchTokenAmount}
                  onChange={(e) => set("seedLaunchTokenAmount", e.target.value)}
                />
              </label>
              <label>
                Quote tokens to seed
                <input
                  value={form.seedQuoteTokenAmount}
                  onChange={(e) => set("seedQuoteTokenAmount", e.target.value)}
                />
              </label>
            </fieldset>

            <div className="form-actions">
              <button type="submit" className="btn btn-ghost" disabled={phase.kind === "simulating"}>
                {phase.kind === "simulating" ? "Simulating…" : "Simulate"}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={phase.kind !== "simulated"}
                onClick={() => void onSend()}
              >
                Create launch
              </button>
            </div>

            {phase.kind === "simulated" ? (
              <p className="state state-ok">
                Simulation succeeded. Pool id <code className="mono">{phase.poolId}</code>.
              </p>
            ) : null}
            {phase.kind === "failed" ? (
              <p className="state state-error" role="alert">
                {phase.message}
              </p>
            ) : null}
            {phase.kind === "sent" ? (
              <p className="state state-ok">
                Submitted.{" "}
                <a href={explorerTx(phase.hash)} target="_blank" rel="noreferrer">
                  View transaction
                </a>
              </p>
            ) : null}

            <p className="state-hint">
              Creating a launch through <code>{kit}</code>. This app takes nothing from it: the kit
              rejects any native value beyond the exact seed amount, and the launch fee accrues to
              in-range liquidity providers through core, not to the launchpad or to this front end.
            </p>
          </form>
        )}
      </Async>
    </div>
  );
}
