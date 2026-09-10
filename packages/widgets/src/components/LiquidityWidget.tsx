// SPDX-License-Identifier: MIT
/**
 * Drop-in liquidity widget, covering both pool types.
 *
 * The add/remove split is a tab; the CL/BIN split is not. The pool determines
 * which range editor renders, and the rest of the component - amounts, quote,
 * approvals, execution - is identical either way. That is the point of routing
 * both pool types through one `LiquidityRange` union.
 */

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { LiquidityRange, PoolInfo, PositionInfo } from "../adapters/protocol.js";
import { useWidgetContext } from "../context/WidgetProvider.js";
import { formatAmount, formatPercentFromPips, parseAmount } from "../core/format.js";
import {
  adjustRange,
  defaultRangeFor,
  describeRange,
  useAddLiquidityExecute,
  useAddLiquidityQuote,
  usePositions,
  useRemoveLiquidity,
} from "../hooks/useLiquidity.js";
import { useAccount, usePoolState, usePools } from "../hooks/useTokens.js";
import {
  ActionButton,
  AmountField,
  ErrorPanel,
  SegmentedControl,
  StatusRegion,
  SummaryList,
  SummaryRow,
  WidgetShell,
} from "./primitives.js";

/** Props for {@link LiquidityWidget}. */
export interface LiquidityWidgetProps {
  /** Pre-selects a pool by id. */
  readonly defaultPoolId?: string;
  readonly title?: string;
  /** Which tab opens first. */
  readonly defaultMode?: LiquidityMode;
}

/** Add or remove. */
export type LiquidityMode = "add" | "remove";

/** The styled liquidity widget. */
export function LiquidityWidget(props: LiquidityWidgetProps): JSX.Element {
  const { chain } = useWidgetContext();
  const pools = usePools();
  const accountResource = useAccount();
  const [mode, setMode] = useState<LiquidityMode>(props.defaultMode ?? "add");
  const [pool, setPool] = useState<PoolInfo | null>(null);

  useEffect(() => {
    const list = pools.data ?? [];
    if (list.length === 0) return;
    setPool((current) => {
      if (current !== null) return current;
      const preferred = props.defaultPoolId
        ? list.find((candidate) => candidate.id === props.defaultPoolId)
        : undefined;
      return preferred ?? list[0] ?? null;
    });
  }, [pools.data, props.defaultPoolId]);

  return (
    <WidgetShell
      title={props.title ?? "Liquidity"}
      subtitle={`Latch Protocol · ${chain.name}`}
    >
      <SegmentedControl<LiquidityMode>
        label="Liquidity action"
        value={mode}
        options={[
          { value: "add", label: "Add" },
          { value: "remove", label: "Remove" },
        ]}
        onChange={setMode}
      />

      <PoolSelect pools={pools.data ?? []} value={pool} onChange={setPool} />

      {pool === null ? (
        <StatusRegion message="No pools are configured for this deployment." />
      ) : mode === "add" ? (
        <AddLiquidityPanel pool={pool} account={accountResource.data} />
      ) : (
        <RemoveLiquidityPanel pool={pool} account={accountResource.data} />
      )}
    </WidgetShell>
  );
}

function PoolSelect(props: {
  readonly pools: readonly PoolInfo[];
  readonly value: PoolInfo | null;
  readonly onChange: (pool: PoolInfo) => void;
}): JSX.Element {
  return (
    <div className="latch-field">
      <label className="latch-label" htmlFor="latch-pool-select">
        Pool
      </label>
      <select
        id="latch-pool-select"
        className="latch-select"
        style={{ width: "100%", borderRadius: "var(--latch-radius-sm)" }}
        value={props.value?.id ?? ""}
        onChange={(event) => {
          const next = props.pools.find((pool) => pool.id === event.target.value);
          if (next !== undefined) props.onChange(next);
        }}
      >
        {props.pools.length === 0 ? <option value="">No pools available</option> : null}
        {props.pools.map((pool) => (
          <option key={pool.id} value={pool.id}>
            {pool.token0.symbol}/{pool.token1.symbol} · {pool.poolType} ·{" "}
            {formatPercentFromPips(pool.lpFeePips)}
          </option>
        ))}
      </select>
    </div>
  );
}

function AddLiquidityPanel(props: {
  readonly pool: PoolInfo;
  readonly account: `0x${string}` | null;
}): JSX.Element {
  const { pool } = props;
  const poolState = usePoolState(pool);
  const [range, setRange] = useState<LiquidityRange | null>(null);
  const [amount0Text, setAmount0Text] = useState("");
  const [amount1Text, setAmount1Text] = useState("");

  // Reset the range whenever the pool changes, then seed it from live state.
  useEffect(() => {
    setRange(null);
  }, [pool.id]);

  useEffect(() => {
    if (range !== null) return;
    const state = poolState.data;
    const seeded = defaultRangeFor(
      pool,
      state?.currentTick ?? null,
      state?.activeId ?? null,
    );
    if (seeded !== null) setRange(seeded);
  }, [pool, poolState.data, range]);

  const parsed0 = amount0Text.trim() === "" ? null : parseAmount(amount0Text, pool.token0.decimals);
  const parsed1 = amount1Text.trim() === "" ? null : parseAmount(amount1Text, pool.token1.decimals);
  const amount0 = parsed0 !== null && parsed0.ok ? parsed0.value : null;
  const amount1 = parsed1 !== null && parsed1.ok ? parsed1.value : null;

  const quote = useAddLiquidityQuote({
    pool,
    range,
    amount0Desired: amount0,
    amount1Desired: amount1,
  });

  const execution = useAddLiquidityExecute({ quote: quote.data ?? null });

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (execution.needsApproval) {
        void execution.approve();
        return;
      }
      void execution.execute();
    },
    [execution],
  );

  const buttonLabel = execution.needsApproval
    ? `Approve ${execution.approvals[0]?.token.symbol ?? ""}`
    : props.account === null
      ? "Connect a wallet"
      : "Add liquidity";

  const busy =
    execution.step === "approving" ||
    execution.step === "building" ||
    execution.step === "awaiting-signature" ||
    execution.step === "pending";

  return (
    <form onSubmit={handleSubmit} noValidate>
      {range === null ? (
        <StatusRegion message="Waiting for pool state to seed a default range." />
      ) : (
        <RangeEditor
          pool={pool}
          range={range}
          onChange={setRange}
          currentTick={poolState.data?.currentTick ?? null}
          activeId={poolState.data?.activeId ?? null}
        />
      )}

      <AmountField
        label={`Deposit ${pool.token0.symbol}`}
        value={amount0Text}
        onValueChange={setAmount0Text}
        token={pool.token0}
        tokens={[pool.token0]}
        error={parsed0 !== null && !parsed0.ok ? parsed0.message : null}
      />
      <AmountField
        label={`Deposit ${pool.token1.symbol}`}
        value={amount1Text}
        onValueChange={setAmount1Text}
        token={pool.token1}
        tokens={[pool.token1]}
        error={parsed1 !== null && !parsed1.ok ? parsed1.message : null}
      />

      {quote.data !== null && quote.data !== undefined ? (
        <SummaryList>
          <SummaryRow
            label={`${pool.token0.symbol} deposited`}
            value={formatAmount(quote.data.amount0, pool.token0.decimals)}
          />
          <SummaryRow
            label={`${pool.token1.symbol} deposited`}
            value={formatAmount(quote.data.amount1, pool.token1.decimals)}
          />
          <SummaryRow label="Liquidity" value={quote.data.liquidity.toString()} />
          <SummaryRow label="Range" value={describeRange(quote.data.range)} />
          {quote.data.binDistribution !== undefined ? (
            <SummaryRow
              label="Bins used"
              value={`${quote.data.binDistribution.length}`}
            />
          ) : null}
        </SummaryList>
      ) : null}

      <StatusRegion
        message={execution.statusMessage}
        tone={execution.step === "error" ? "error" : execution.step === "success" ? "success" : "neutral"}
      />

      <ActionButton
        type="submit"
        disabled={props.account === null || quote.data === null || busy}
        busy={busy}
      >
        {buttonLabel}
      </ActionButton>

      <ErrorPanel error={execution.error ?? quote.error} />
    </form>
  );
}

/**
 * The one place the pool types genuinely diverge in the UI.
 *
 * Concentrated liquidity gets a tick pair snapped to the pool's tick spacing;
 * the liquidity book gets a bin span around the active id. Both emit the same
 * `LiquidityRange` union, so nothing downstream branches again.
 */
function RangeEditor(props: {
  readonly pool: PoolInfo;
  readonly range: LiquidityRange;
  readonly onChange: (range: LiquidityRange) => void;
  readonly currentTick: number | null;
  readonly activeId: number | null;
}): JSX.Element {
  const { pool, range } = props;

  if (range.type === "CL") {
    return (
      <fieldset className="latch-field" style={{ margin: 0 }}>
        <legend className="latch-label" style={{ padding: "0 4px" }}>
          Price range (ticks, spacing {pool.tickSpacing ?? 1})
        </legend>
        <div className="latch-range-grid">
          <label className="latch-visually-hidden" htmlFor="latch-tick-lower">
            Lower tick
          </label>
          <input
            id="latch-tick-lower"
            type="number"
            step={pool.tickSpacing ?? 1}
            value={range.tickLower}
            onChange={(event) =>
              props.onChange({
                type: "CL",
                tickLower: Number(event.target.value),
                tickUpper: range.tickUpper,
              })
            }
          />
          <label className="latch-visually-hidden" htmlFor="latch-tick-upper">
            Upper tick
          </label>
          <input
            id="latch-tick-upper"
            type="number"
            step={pool.tickSpacing ?? 1}
            value={range.tickUpper}
            onChange={(event) =>
              props.onChange({
                type: "CL",
                tickLower: range.tickLower,
                tickUpper: Number(event.target.value),
              })
            }
          />
        </div>
        <div className="latch-meta">
          <span>
            {props.currentTick === null
              ? "Current tick unknown"
              : `Current tick ${props.currentTick}`}
          </span>
          <span>
            <button
              type="button"
              className="latch-chip"
              onClick={() => props.onChange(adjustRange(range, pool, 5))}
            >
              Widen
            </button>{" "}
            <button
              type="button"
              className="latch-chip"
              onClick={() => props.onChange(adjustRange(range, pool, -5))}
            >
              Narrow
            </button>
          </span>
        </div>
      </fieldset>
    );
  }

  const binCount = range.binIdUpper - range.binIdLower + 1;
  return (
    <fieldset className="latch-field" style={{ margin: 0 }}>
      <legend className="latch-label" style={{ padding: "0 4px" }}>
        Bin range (step {pool.binStep ?? 0})
      </legend>
      <label className="latch-label" htmlFor="latch-bin-width">
        Bins each side of active: {Math.floor((binCount - 1) / 2)}
      </label>
      <input
        id="latch-bin-width"
        className="latch-slider"
        type="range"
        min={0}
        max={30}
        value={Math.floor((binCount - 1) / 2)}
        onChange={(event) => {
          const half = Number(event.target.value);
          props.onChange({
            type: "BIN",
            activeIdDesired: range.activeIdDesired,
            binIdLower: range.activeIdDesired - half,
            binIdUpper: range.activeIdDesired + half,
            idSlippage: range.idSlippage,
          });
        }}
      />
      <div className="latch-meta">
        <span>{describeRange(range)}</span>
        <span>
          {props.activeId === null ? "Active bin unknown" : `Active bin ${props.activeId}`}
        </span>
      </div>
    </fieldset>
  );
}

function RemoveLiquidityPanel(props: {
  readonly pool: PoolInfo;
  readonly account: `0x${string}` | null;
}): JSX.Element {
  const positions = usePositions(props.account, props.pool);
  const [selected, setSelected] = useState<PositionInfo | null>(null);
  const [percentBps, setPercentBps] = useState(5_000);

  const list = useMemo(() => positions.data ?? [], [positions.data]);

  useEffect(() => {
    setSelected((current) => {
      if (current !== null && list.some((position) => position.id === current.id)) {
        return current;
      }
      return list[0] ?? null;
    });
  }, [list]);

  const removal = useRemoveLiquidity({ position: selected, percentBps });

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void removal.execute();
    },
    [removal],
  );

  if (props.account === null) {
    return <StatusRegion message="Connect a wallet to see your positions." />;
  }

  if (list.length === 0) {
    return (
      <StatusRegion
        message={
          positions.status === "loading"
            ? "Loading your positions"
            : positions.status === "error"
              ? (positions.error?.message ?? "Could not load positions")
              : "You have no positions in this pool."
        }
        tone={positions.status === "error" ? "error" : "neutral"}
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="latch-field">
        <label className="latch-label" htmlFor="latch-position-select">
          Position
        </label>
        <select
          id="latch-position-select"
          className="latch-select"
          style={{ width: "100%", borderRadius: "var(--latch-radius-sm)" }}
          value={selected?.id ?? ""}
          onChange={(event) => {
            const next = list.find((position) => position.id === event.target.value);
            setSelected(next ?? null);
          }}
        >
          {list.map((position) => (
            <option key={position.id} value={position.id}>
              {describeRange(position.range)}
            </option>
          ))}
        </select>
      </div>

      <div className="latch-field">
        <label className="latch-label" htmlFor="latch-remove-percent">
          Amount to withdraw: {(percentBps / 100).toFixed(0)}%
        </label>
        <input
          id="latch-remove-percent"
          className="latch-slider"
          type="range"
          min={1}
          max={100}
          value={Math.round(percentBps / 100)}
          onChange={(event) => setPercentBps(Number(event.target.value) * 100)}
        />
      </div>

      {removal.quote !== null ? (
        <SummaryList>
          <SummaryRow
            label={`${props.pool.token0.symbol} returned`}
            value={formatAmount(removal.quote.amount0, props.pool.token0.decimals)}
          />
          <SummaryRow
            label={`${props.pool.token1.symbol} returned`}
            value={formatAmount(removal.quote.amount1, props.pool.token1.decimals)}
          />
        </SummaryList>
      ) : null}

      <StatusRegion
        message={removal.statusMessage}
        tone={removal.step === "error" ? "error" : removal.step === "success" ? "success" : "neutral"}
      />

      <ActionButton
        type="submit"
        disabled={selected === null || removal.quote === null}
        busy={removal.step === "pending" || removal.step === "awaiting-signature"}
      >
        Remove liquidity
      </ActionButton>

      <ErrorPanel error={removal.error} />
    </form>
  );
}
