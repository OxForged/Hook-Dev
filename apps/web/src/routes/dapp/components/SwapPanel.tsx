/* ============================================================================
   The swap panel — the first surface in this dapp that can move a user's money.

   Everything else here reads. This sends, and the rules that follow from that
   are different in kind from the rules on a dashboard.

   1. NOTHING IS SENT WITHOUT A CLICK ON A BUTTON THAT SAYS WHAT IT DOES.
      There is no auto-submit, no "approve and swap" that fires two
      transactions off one press, and no retry loop. Each of the three possible
      transactions — the ERC-20 approval to Permit2, the Permit2 allowance to
      the router, and the swap — is its own labelled button and its own click.

   2. SIMULATE FIRST, AND SIMULATE AS THE USER. `useSimulateContract` defaults
      to no account, which simulates from `address(0)`: a zero-address
      simulation of a swap fails on the balance check every time, so the button
      would never enable and the reason shown would be a lie. This project has
      been bitten by exactly this twice (`PoolOwnerActions`, the Deploy
      pre-flight). `account` is passed on every simulation here, and the
      simulation is disabled until a wallet exists rather than being run from
      nowhere.

   3. THE QUOTE COMES FROM THE QUOTER. Not from reserves, not from
      `sqrtPriceX96` and a curve, not interpolated between two other quotes.
      `CLQuoter.quoteExactInputSingle` performs the real swap inside a vault
      lock and reverts with the answer, so it is the only figure on this screen
      that is what the trade would actually pay — net of the LP fee, the
      protocol fee and the hook's cut, all three. Every other number here is
      labelled as the component it is.

   4. A STALE QUOTE IS NEVER SHOWN AS A LIVE ONE. Typing invalidates the quote
      immediately; the re-quote is debounced but the OLD number does not sit on
      screen in the meantime pretending to describe the new amount.

   5. FOUR STATES, AND THEY DO NOT LOOK ALIKE.
        loading         a read is in flight, and it says which read
        error           the chain did not answer — no figures at all
        empty           the chain answered and there are no pools
        not-configured  a pool exists but cannot be traded from here, with the
                        specific reason (no liquidity / unreadable decimals /
                        router paused)

   6. NO DOLLAR FIGURES. LTT1 and LTT2 are unpriced test tokens. Amounts are
      token units with a symbol, always. No currency symbol and no fiat
      conversion appears on this surface, and none may be added: nothing on
      this chain prices these tokens, so any figure in money would be invented.

   WHAT THE READER IS OWED ABOUT THE HOOK
   --------------------------------------
   A pool's hook can take a cut of every swap, and `RevShareHook` on the live
   pool does. The panel shows the LP fee, the protocol fee for THIS DIRECTION
   (the two directions are configured independently), and the hook's cut with
   its split.

   It also shows the hook's PENDING configuration, which is the part a trader
   would otherwise never see. `disable()` and `reduceFee()` do not clear a
   matured proposal, and `applyPendingConfig()` is PERMISSIONLESS — so a pool
   can advertise a 0% cut while a 10% proposal sits armed, and anyone at all can
   land it in the next block. A quote taken before that block does not survive
   it. That is precisely what `amountOutMinimum` is for, and the slippage
   control says so in as many words.
   ============================================================================ */

import { LatchConnectButton } from '@latchprotocol/connect'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Abi, Address, Hex } from 'viem'
import {
  useAccount,
  useSimulateContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'

import { DEPLOYMENTS } from '../../../lib/chain'
import {
  DEFAULT_SLIPPAGE_BPS,
  MAX_UINT128,
  PERMIT2,
  PERMIT2_MAX_EXPIRATION,
  ROUTER,
  ROUTER_CALL_ABI,
  SLIPPAGE_PRESETS_BPS,
  SWAP_CHAIN_ID,
  SWAP_ERC20_ABI,
  bpsPct,
  decodeSwapFailure,
  deviationFromSpot,
  encodeExactInSingle,
  explorerAddressUrl,
  explorerTxUrl,
  formatAmount,
  formatAmountPlain,
  knownFeeFraction,
  minimumOut,
  parseAmount,
  permit2Abi,
  permit2Covers,
  pipsPct,
  quoteExactIn,
  readAllowances,
  shortHex,
  type AllowanceState,
  type DecodedFailure,
  type HookTake,
  type Quote,
  type SwapContext,
  type SwapPool,
  type SwapToken,
} from '../../../lib/swap'
import { useChainRead } from '../lib/useChainRead'

/* How long a built transaction stays valid. Short enough that a transaction
   stuck in a mempool for an hour cannot land against a pool that has moved,
   long enough to survive a slow wallet confirmation. */
const DEADLINE_SECONDS = 900

/* The re-quote debounce. Every quote is an eth_call against a rate-limited
   public RPC, so this is a budget as much as an ergonomic. */
const QUOTE_DEBOUNCE_MS = 450

/** Permit2's allowance is time-boxed by design; 30 days is the wallet default. */
const PERMIT2_APPROVAL_SECONDS = 30 * 24 * 60 * 60

const CHAIN_NAME = DEPLOYMENTS[SWAP_CHAIN_ID].name

export interface SwapPanelProps {
  /** Read once by the parent, so one render is one round of RPC calls. */
  context: SwapContext
  /** The pool to trade. The parent owns selection; this panel owns the trade. */
  pool: SwapPool
  /** What the pool's hook takes. `null` when the pool has no hook at all. */
  hook: HookTake | null
  /** Compact drops the methodology disclosure — for a sidebar on a pool page. */
  compact?: boolean
  /**
   * Called once a swap confirms. The parent's reads — liquidity, slot0, the
   * hook's pending config — are all stale the moment a trade lands, and
   * leaving them on screen would show pre-trade state under a confirmed
   * transaction.
   */
  onTraded?: () => void
}

/* ---------------------------------------------------------------------------
   Small shared parts
   --------------------------------------------------------------------------- */

function Failure({ failure }: { failure: DecodedFailure }) {
  return (
    <div className={`swap-failure swap-failure--${failure.kind}`} role="alert">
      <p className="swap-failure__head">
        {failure.name ? <code>{failure.name}</code> : 'The call failed'}
      </p>
      <p className="swap-failure__msg">{failure.message}</p>
      {/* The chain's own words, verbatim. A decoded message is a translation;
          the reader is entitled to the original underneath it. */}
      <p className="dp-failure__raw">{failure.detail}</p>
    </div>
  )
}

function Row({ label, children, tone }: { label: string; children: React.ReactNode; tone?: 'warn' }) {
  return (
    <div className={tone === 'warn' ? 'swap-row swap-row--warn' : 'swap-row'}>
      <span className="swap-row__label">{label}</span>
      <span className="swap-row__value">{children}</span>
    </div>
  )
}

/* ---------------------------------------------------------------------------
   One transaction: simulate as the user, then offer exactly one button.
   --------------------------------------------------------------------------- */

interface SendProps {
  label: string
  /** One sentence naming the function and what it does. Never a euphemism. */
  describes: string
  address: Address
  abi: Abi
  functionName: string
  args: readonly unknown[]
  /** Blocks the simulation with a reason the reader can act on. */
  blocked: string | null
  primary?: boolean
  onConfirmed?: () => void
}

function Send({
  label,
  describes,
  address: contract,
  abi,
  functionName,
  args,
  blocked,
  primary = false,
  onConfirmed,
}: SendProps) {
  const { address, isConnected, chainId } = useAccount()
  const { switchChain, isPending: switching } = useSwitchChain()
  const { writeContract, data: txHash, isPending: awaitingSignature, error: writeError } = useWriteContract()
  const receipt = useWaitForTransactionReceipt({ hash: txHash, chainId: SWAP_CHAIN_ID })

  const onChain = chainId === SWAP_CHAIN_ID

  /* Rule 2 in the header. Without `account` this simulates from address(0),
     which holds no tokens and no allowance — every button would read "you
     cannot afford this". */
  const canSimulate = blocked === null && !txHash && isConnected && onChain && address !== undefined

  const sim = useSimulateContract({
    address: contract,
    abi,
    functionName,
    args: args as never,
    account: address,
    chainId: SWAP_CHAIN_ID,
    query: { enabled: canSimulate, retry: false, gcTime: 0 },
  })

  const simFailure = decodeSwapFailure(sim.error)
  const writeFailure = decodeSwapFailure(writeError)
  const ready = Boolean(sim.data) && canSimulate

  const submit = useCallback(() => {
    if (!sim.data) return
    writeContract(sim.data.request as never)
  }, [sim.data, writeContract])

  const confirmed = receipt.data?.status === 'success'
  const reverted = receipt.data?.status === 'reverted'

  /* Told to the parent in an effect, exactly once. Calling a parent's setState
     from a render body is a cross-component write mid-render; React warns, and
     under concurrent rendering it can be dropped entirely. */
  const told = useRef(false)
  useEffect(() => {
    if (confirmed && !told.current) {
      told.current = true
      onConfirmed?.()
    }
  }, [confirmed, onConfirmed])

  if (!isConnected) {
    return (
      <div className="swap-send">
        <p className="swap-send__describes">{describes}</p>
        <LatchConnectButton />
      </div>
    )
  }

  if (!onChain) {
    return (
      <div className="swap-send">
        <p className="swap-send__describes">{describes}</p>
        <button
          type="button"
          className="dapp-btn dapp-btn--block"
          disabled={switching}
          onClick={() => switchChain({ chainId: SWAP_CHAIN_ID })}
        >
          {switching ? 'Switching…' : `Switch to ${CHAIN_NAME}`}
        </button>
      </div>
    )
  }

  return (
    <div className="swap-send">
      <p className="swap-send__describes">{describes}</p>

      {blocked !== null ? (
        <p className="swap-send__blocked">{blocked}</p>
      ) : sim.isLoading ? (
        <p className="swap-send__blocked" aria-busy="true">
          Simulating from your address…
        </p>
      ) : simFailure ? (
        <Failure failure={simFailure} />
      ) : null}

      <button
        type="button"
        className={
          primary ? 'dapp-btn dapp-btn--primary dapp-btn--block' : 'dapp-btn dapp-btn--block'
        }
        disabled={!ready || awaitingSignature || receipt.isLoading}
        data-busy={awaitingSignature || receipt.isLoading ? 'true' : 'false'}
        onClick={submit}
      >
        {awaitingSignature
          ? 'Confirm in your wallet…'
          : receipt.isLoading
            ? 'Waiting for the transaction…'
            : label}
      </button>

      {writeFailure ? <Failure failure={writeFailure} /> : null}

      {txHash ? (
        <p className="swap-send__tx">
          {confirmed ? 'Confirmed · ' : reverted ? 'Reverted on chain · ' : 'Submitted · '}
          <a className="hx-addr" href={explorerTxUrl(txHash)} target="_blank" rel="noopener noreferrer">
            {shortHex(txHash, 10, 8)}
          </a>
        </p>
      ) : null}
    </div>
  )
}

/* ---------------------------------------------------------------------------
   The panel
   --------------------------------------------------------------------------- */

export function SwapPanel({ context, pool, hook, compact = false, onTraded }: SwapPanelProps) {
  const { address, isConnected } = useAccount()

  const [zeroForOne, setZeroForOne] = useState(true)
  const [amountText, setAmountText] = useState('')
  const [debouncedText, setDebouncedText] = useState('')
  const [slippageBps, setSlippageBps] = useState<number>(DEFAULT_SLIPPAGE_BPS)
  const [customSlippage, setCustomSlippage] = useState('')

  const tokenIn: SwapToken = zeroForOne ? pool.token0 : pool.token1
  const tokenOut: SwapToken = zeroForOne ? pool.token1 : pool.token0

  /* Decimals are read from chain per token, never assumed. A hardcoded 18 is a
     bug waiting for the first 6-decimal pair, and it would be a bug that sends
     a trade a million times the intended size rather than one that throws. */
  const decimalsIn = tokenIn.decimals
  const decimalsOut = tokenOut.decimals
  const tradeable = decimalsIn !== null && decimalsOut !== null && pool.liquidity > 0n

  useEffect(() => {
    const t = setTimeout(() => setDebouncedText(amountText), QUOTE_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [amountText])

  /* THE CLOCK IS STATE, NOT `Date.now()` IN THE RENDER BODY.
     Two reasons, and the second is the expensive one. It is an impure read
     during render; and it feeds the arguments of a `useSimulateContract`, so a
     value that moves every frame re-keys that query every frame and turns a
     rate-limited public RPC into a denial of service against ourselves. Ticked
     once a minute, which is fine for an allowance expiry measured in days. */
  const [nowSeconds, setNowSeconds] = useState(0)
  useEffect(() => {
    const tick = () => setNowSeconds(Math.floor(Date.now() / 1000))
    tick()
    const id = setInterval(tick, 60_000)
    return () => clearInterval(id)
  }, [])

  const parsedIn = decimalsIn === null ? null : parseAmount(amountText, decimalsIn)
  const parsedDebounced = decimalsIn === null ? null : parseAmount(debouncedText, decimalsIn)

  /* `uint128` is the router's own type for `amountIn`, so anything above it is
     not a large trade — it is an unencodable one. Caught here rather than in
     the encoder: `encodeAbiParameters` THROWS on an out-of-range value, and it
     runs inside a `useMemo` during render, so an overflow would take the screen
     down instead of showing a validation message. */
  const overflows = parsedIn !== null && parsedIn > MAX_UINT128
  const amountIn = overflows ? null : parsedIn
  const debouncedIn =
    parsedDebounced !== null && parsedDebounced > MAX_UINT128 ? null : parsedDebounced

  /* The quote is keyed on the DEBOUNCED amount and the direction. A key change
     drops the previous answer, which is what stops a number for the old amount
     from sitting on screen while the new one is in flight. */
  const quoteKey =
    tradeable && debouncedIn !== null && debouncedIn > 0n && debouncedText === amountText
      ? `${pool.poolId}:${zeroForOne ? '0' : '1'}:${debouncedIn}`
      : null

  const { state: quoteState, reload: requote } = useChainRead<Quote>(quoteKey, () =>
    quoteExactIn(pool.key, zeroForOne, debouncedIn ?? 0n),
  )

  /* Allowances. Keyed on the wallet and the input token, and reloaded when an
     approval confirms — never assumed to have changed because a button was
     pressed. */
  const allowanceKey = address && tradeable ? `${address}:${tokenIn.address}` : null
  const { state: allowanceState, reload: reloadAllowances } = useChainRead<AllowanceState>(
    allowanceKey,
    () => readAllowances(address as Address, tokenIn.address),
  )

  const quote = quoteState.k === 'ready' ? quoteState.data : null
  const allowances = allowanceState.k === 'ready' ? allowanceState.data : null

  const amountOutMinimum = quote ? minimumOut(quote.amountOut, slippageBps) : null

  /* Built from the quote, so the deadline is fixed for the life of that quote
     rather than moving on every render — a moving argument would re-key the
     simulation query on each frame and hammer the RPC. */
  const deadline = quote ? BigInt(Math.floor(quote.takenAt / 1000) + DEADLINE_SECONDS) : null

  const routerCall = useMemo(() => {
    if (!quote || amountOutMinimum === null) return null
    return encodeExactInSingle({
      key: pool.key,
      zeroForOne,
      amountIn: quote.amountIn,
      amountOutMinimum,
    })
  }, [quote, amountOutMinimum, pool.key, zeroForOne])

  const swapArgs = useMemo(
    () => (routerCall && deadline !== null ? [routerCall.commands, routerCall.inputs, deadline] : []),
    [routerCall, deadline],
  )

  /* Zero means the tick above has not run yet. Treated as "unknown", never as
     "the epoch" — a clock of 0 makes every unexpired allowance look valid and
     would offer the swap button before the Permit2 leg had been checked. */
  const clockReady = nowSeconds > 0

  /* Rounded down to the hour so the argument is stable across renders. An
     expiration computed from a live clock changes every render, and every
     change re-runs the simulation. */
  const permit2Expiration = Math.min(
    nowSeconds - (nowSeconds % 3600) + PERMIT2_APPROVAL_SECONDS,
    PERMIT2_MAX_EXPIRATION,
  )

  const needsErc20Approval =
    allowances !== null && amountIn !== null && allowances.erc20ToPermit2 < amountIn
  const needsPermit2Approval =
    allowances !== null &&
    amountIn !== null &&
    (!clockReady || !permit2Covers(allowances, amountIn, nowSeconds))
  const insufficientBalance =
    allowances !== null && amountIn !== null && allowances.balance < amountIn

  const fees = knownFeeFraction(pool, zeroForOne, hook)
  const deviation = quote ? deviationFromSpot(pool, zeroForOne, quote.amountIn, quote.amountOut) : null

  const onSwapConfirmed = useCallback(() => {
    reloadAllowances()
    requote()
    onTraded?.()
  }, [reloadAllowances, requote, onTraded])

  const flip = useCallback(() => {
    setZeroForOne((v) => !v)
    setAmountText('')
    setDebouncedText('')
  }, [])

  /* Writes back the EXACT balance, unrounded and ungrouped. `formatAmount`
     groups thousands, and a grouped string put back into the field is rejected
     by `parseAmount` — a max button that quietly produces an unparseable
     amount is worse than no max button. */
  const setMax = useCallback(() => {
    if (!allowances || decimalsIn === null) return
    setAmountText(formatAmountPlain(allowances.balance, decimalsIn))
  }, [allowances, decimalsIn])

  /* ---- not-configured, as a first-class state ---------------------------- */

  if (context.routerPaused) {
    return (
      <section className="dapp-card swap-panel">
        <h2 className="dapp-card__title">Swapping is paused</h2>
        <p className="live-note">
          <code>UniversalRouter.paused()</code> reads true on {context.chainName}, so the router
          refuses every swap routed through it. The pools themselves are untouched — liquidity is
          not at risk and nothing here is broken. Only the router&rsquo;s owner can unpause it.
        </p>
      </section>
    )
  }

  if (decimalsIn === null || decimalsOut === null) {
    const unreadable = decimalsIn === null ? tokenIn : tokenOut
    return (
      <section className="dapp-card swap-panel">
        <h2 className="dapp-card__title">This pool cannot be traded from here</h2>
        <p className="live-note">
          <code>decimals()</code> could not be read from{' '}
          <a
            className="hx-addr"
            href={explorerAddressUrl(unreadable.address)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {shortHex(unreadable.address)}
          </a>
          . Every amount typed here has to be scaled by that number, and assuming 18 for a token
          that uses 6 would send a trade a million times the intended size. The panel refuses
          rather than guesses.
        </p>
      </section>
    )
  }

  if (pool.liquidity === 0n) {
    return (
      <section className="dapp-card swap-panel">
        <h2 className="dapp-card__title">No liquidity in this pool</h2>
        <p className="live-note">
          <code>CLPoolManager.getLiquidity</code> returns 0 for{' '}
          {pool.token0.symbol}/{pool.token1.symbol}. The pool is initialized and real, but there is
          nothing in range to trade against — any swap would revert{' '}
          <code>NotEnoughLiquidity</code> before it filled.
        </p>
      </section>
    )
  }

  /* ---- the trade ---------------------------------------------------------- */

  return (
    <section className="dapp-card swap-panel">
      <div className="dapp-card__bar">
        <h2 className="dapp-microlabel">SWAP</h2>
        <span className="swap-pair-chip">
          {pool.token0.symbol} / {pool.token1.symbol} · {pipsPct(pool.lpFeePips)}
        </span>
      </div>

      {/* ---- input ---- */}
      <div className="swap-field">
        <div className="swap-field__head">
          <label className="swap-field__label" htmlFor="swap-amount-in">
            You pay
          </label>
          <span className="swap-field__aside">
            {allowanceState.k === 'loading' ? (
              'reading balance…'
            ) : allowances ? (
              <>
                balance {formatAmount(allowances.balance, decimalsIn)} {tokenIn.symbol}
                <button type="button" className="swap-max" onClick={setMax}>
                  max
                </button>
              </>
            ) : isConnected ? (
              'balance unavailable'
            ) : (
              'connect to see your balance'
            )}
          </span>
        </div>
        <div className="swap-field__row">
          <input
            id="swap-amount-in"
            className="swap-input"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            placeholder="0.0"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
          />
          <span className="swap-token">{tokenIn.symbol}</span>
        </div>
        {amountText !== '' && overflows ? (
          <p className="swap-field__err">
            Larger than <code>uint128</code>, which is the type the router uses for{' '}
            <code>amountIn</code>. No amount this size can be encoded, let alone traded.
          </p>
        ) : amountText !== '' && amountIn === null ? (
          <p className="swap-field__err">
            Not a number. Digits and a single decimal point only — no separators.
          </p>
        ) : null}
      </div>

      <button type="button" className="swap-flip" onClick={flip} aria-label="Swap direction">
        <span aria-hidden="true">↓↑</span>
      </button>

      {/* ---- output ---- */}
      <div className="swap-field swap-field--out">
        <div className="swap-field__head">
          <span className="swap-field__label">You receive</span>
          <span className="swap-field__aside">
            {quote ? `quoted at block ${quote.atBlock}` : 'quoted from CLQuoter'}
          </span>
        </div>
        <div className="swap-field__row">
          <output className="swap-output" htmlFor="swap-amount-in">
            {quoteKey === null ? (
              <span className="swap-output__muted">—</span>
            ) : quoteState.k === 'loading' ? (
              <span className="swap-output__muted" aria-busy="true">
                quoting…
              </span>
            ) : quoteState.k === 'error' ? (
              <span className="swap-output__muted">no quote</span>
            ) : quote ? (
              formatAmount(quote.amountOut, decimalsOut)
            ) : (
              <span className="swap-output__muted">—</span>
            )}
          </output>
          <span className="swap-token">{tokenOut.symbol}</span>
        </div>
      </div>

      {quoteState.k === 'error' ? (
        <div className="swap-failure swap-failure--chain" role="alert">
          <p className="swap-failure__head">The quoter did not answer</p>
          <p className="swap-failure__msg">
            No figure is shown. {context.chainName} may be unreachable, or the pool may not hold the
            liquidity to fill this size — <code>CLQuoter</code> reverts{' '}
            <code>NotEnoughLiquidity</code> rather than quoting a partial fill. Either way this is
            not an estimate that can be shown with a caveat.
          </p>
          <p className="dp-failure__raw">{quoteState.message}</p>
          <button type="button" className="dapp-btn dapp-btn--sm" onClick={requote}>
            Quote again
          </button>
        </div>
      ) : null}

      {/* ---- what this trade costs ---- */}
      <div className="swap-facts">
        <Row label="Rate">
          {quote && quote.amountIn > 0n
            ? `1 ${tokenIn.symbol} ≈ ${formatAmount(
                (quote.amountOut * 10n ** BigInt(decimalsIn)) / quote.amountIn,
                decimalsOut,
              )} ${tokenOut.symbol}`
            : '—'}
        </Row>
        <Row label="LP fee">{pipsPct(pool.lpFeePips)}</Row>
        <Row label={`Protocol fee · ${zeroForOne ? '0→1' : '1→0'}`}>
          {pipsPct(zeroForOne ? pool.protocolFeeZeroForOnePips : pool.protocolFeeOneForZeroPips)}
          {!context.controllerWired ? (
            <span className="swap-row__note"> — no fee controller is wired to the pool manager</span>
          ) : null}
        </Row>
        <Row label="Hook cut">
          <HookCut hook={hook} />
        </Row>
        <Row label="Fees, composed">
          {`${(fees.totalFraction * 100).toFixed(4)}%`}
          <span className="swap-row__note">
            {' '}
            — protocol then LP on the input, hook on the output
          </span>
        </Row>
        <Row label="Below spot">
          {deviation === null ? (
            '—'
          ) : (
            <>
              {`${(deviation * 100).toFixed(4)}%`}
              <span className="swap-row__note">
                {' '}
                — includes the {(fees.totalFraction * 100).toFixed(4)}% above; the remainder is
                price impact
              </span>
            </>
          )}
        </Row>
        <Row label="Minimum received">
          {amountOutMinimum !== null
            ? `${formatAmount(amountOutMinimum, decimalsOut)} ${tokenOut.symbol}`
            : '—'}
        </Row>
      </div>

      <PendingConfigWarning hook={hook} blockNumber={context.blockNumber} />

      {/* ---- slippage ---- */}
      <div className="swap-slippage">
        <div className="swap-slippage__head">
          <span className="swap-field__label">Slippage tolerance</span>
          <span className="swap-field__aside">{bpsPct(slippageBps)}</span>
        </div>
        <div className="swap-slippage__row">
          {SLIPPAGE_PRESETS_BPS.map((bps) => (
            <button
              key={bps}
              type="button"
              className={bps === slippageBps ? 'swap-chip is-active' : 'swap-chip'}
              onClick={() => {
                setSlippageBps(bps)
                setCustomSlippage('')
              }}
            >
              {bpsPct(bps)}
            </button>
          ))}
          <input
            className="swap-slippage__custom"
            inputMode="decimal"
            placeholder="custom %"
            value={customSlippage}
            onChange={(e) => {
              const text = e.target.value
              setCustomSlippage(text)
              const pct = Number(text)
              if (Number.isFinite(pct) && pct >= 0 && pct <= 50) {
                setSlippageBps(Math.round(pct * 100))
              }
            }}
          />
        </div>
        <p className="dapp-note">
          <strong>This is your only protection.</strong> The router and the quoter both hardcode the
          price bound to <code>MIN_SQRT_RATIO + 1</code> / <code>MAX_SQRT_RATIO − 1</code>, so there
          is no price limit on the swap itself — <code>amountOutMinimum</code> is the whole of it,
          and it is enforced twice: once by the swap action and once by <code>TAKE_ALL</code> on the
          credit standing at the vault. If the pool moves, or the hook&rsquo;s cut changes between
          this quote and your transaction landing, this bound is what refuses the trade instead of
          filling it worse.
        </p>
      </div>

      {/* ---- approvals and the send ---- */}
      {amountIn !== null && amountIn > 0n && quote !== null && routerCall !== null ? (
        <div className="swap-steps">
          {insufficientBalance ? (
            <p className="swap-send__blocked">
              Your balance is {allowances ? formatAmount(allowances.balance, decimalsIn) : '—'}{' '}
              {tokenIn.symbol}, which does not cover this trade.
            </p>
          ) : null}

          {needsErc20Approval ? (
            <Send
              label={`Approve ${tokenIn.symbol} for Permit2`}
              describes={
                `Step 1 of 2. Calls ${tokenIn.symbol}.approve(Permit2, ${formatAmount(amountIn, decimalsIn)}). ` +
                'The router never touches your tokens directly — it pays the vault through Permit2, ' +
                'so an approval to the router alone would do nothing. This grants exactly this ' +
                'trade’s amount, not an unlimited allowance.'
              }
              address={tokenIn.address}
              abi={SWAP_ERC20_ABI as Abi}
              functionName="approve"
              args={[PERMIT2, amountIn]}
              blocked={insufficientBalance ? 'Not enough balance to approve for.' : null}
              onConfirmed={reloadAllowances}
            />
          ) : null}

          {!needsErc20Approval && needsPermit2Approval ? (
            <Send
              label="Approve the router on Permit2"
              describes={
                'Step 2 of 2. Calls Permit2.approve(token, router, amount, expiration). Permit2 ' +
                'allowances carry an expiry — this one is set 30 days out, and an expired ' +
                'allowance is what causes the AllowanceExpired revert on a first trade.'
              }
              address={PERMIT2}
              abi={permit2Abi as Abi}
              functionName="approve"
              args={[tokenIn.address, ROUTER, amountIn, permit2Expiration]}
              blocked={clockReady ? null : 'Reading the clock…'}
              onConfirmed={reloadAllowances}
            />
          ) : null}

          {!needsErc20Approval && !needsPermit2Approval ? (
            <Send
              primary
              label={`Swap ${formatAmount(amountIn, decimalsIn)} ${tokenIn.symbol}`}
              describes={
                `Calls UniversalRouter.execute with one command (INFI_SWAP, 0x10) carrying a plan of ` +
                `CL_SWAP_EXACT_IN_SINGLE → SETTLE_ALL → TAKE_ALL. You receive at least ` +
                `${formatAmount(amountOutMinimum ?? 0n, decimalsOut)} ${tokenOut.symbol} or the ` +
                `transaction reverts.`
              }
              address={ROUTER}
              abi={ROUTER_CALL_ABI}
              functionName="execute"
              args={swapArgs}
              blocked={
                insufficientBalance
                  ? 'Not enough balance for this trade.'
                  : allowanceState.k === 'loading'
                    ? 'Reading your allowances…'
                    : null
              }
              onConfirmed={onSwapConfirmed}
            />
          ) : null}
        </div>
      ) : (
        <p className="swap-send__blocked">
          {!isConnected
            ? 'Connect a wallet to trade. Quotes above are live and need no wallet.'
            : 'Enter an amount to get a quote.'}
        </p>
      )}

      {!compact ? <SwapMethodology pool={pool} hook={hook} routerCall={routerCall} /> : null}
    </section>
  )
}

/* ---------------------------------------------------------------------------
   The hook's cut, said precisely — including the case where it cannot be read.
   --------------------------------------------------------------------------- */

function HookCut({ hook }: { hook: HookTake | null }) {
  if (hook === null) return <>none — this pool has no hook attached</>

  if (!hook.readable) {
    return (
      <>
        unknown
        <span className="swap-row__note">
          {' '}
          — a hook is attached at{' '}
          <a
            className="hx-addr"
            href={explorerAddressUrl(hook.hook)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {shortHex(hook.hook)}
          </a>{' '}
          but it does not answer the RevShareHook reads, so this build cannot say what it takes.
          The quote above is still net of whatever it does take.
        </span>
      </>
    )
  }

  if (!hook.configured) return <>none — the hook has no configuration for this pool</>
  if (hook.globallyPaused) return <>none — the hook is globally paused, so no pool on it takes a cut</>
  if (!hook.enabled) return <>none — the cut is disabled for this pool</>

  return (
    <>
      {pipsPct(hook.feePips)} of the output
      <span className="swap-row__note">
        {' '}
        — split {bpsPct(hook.lpDonateBps)} back to LPs, {bpsPct(hook.beneficiaryBps)} to the
        beneficiary roster, {bpsPct(hook.distributorBps)} to the epoch distributor
        {hook.frozen ? '. This configuration is frozen and can never change.' : ''}
      </span>
    </>
  )
}

/* ---------------------------------------------------------------------------
   The armed proposal. This is the disclosure a trader would otherwise not get.
   --------------------------------------------------------------------------- */

function PendingConfigWarning({ hook, blockNumber }: { hook: HookTake | null; blockNumber: bigint }) {
  if (hook === null || !hook.readable || hook.pending === null) return null
  const p = hook.pending

  return (
    <div className={p.applicable ? 'swap-pending swap-pending--armed' : 'swap-pending'} role="note">
      <p className="swap-pending__head">
        {p.applicable
          ? 'A configuration change is armed and can be applied by anyone, right now'
          : `A configuration change is queued for block ${p.effectiveBlock}`}
      </p>
      <p className="swap-pending__body">
        The pool owner has proposed a cut of <strong>{pipsPct(p.feePips)}</strong>
        {p.enabled ? '' : ' (disabled)'} against the {pipsPct(hook.feePips)} in force today.{' '}
        {p.applicable ? (
          <>
            The delay has elapsed. <code>applyPendingConfig</code> is <strong>permissionless</strong>
            , so any address at all can land it in the next block — including in the same block as
            your swap. Neither <code>disable()</code> nor <code>reduceFee()</code> clears a matured
            proposal, so a pool advertising a low cut can still have this waiting.
          </>
        ) : (
          <>
            {p.blocksRemaining.toString()} blocks remain (head is {blockNumber.toString()}). Once the
            delay elapses, <code>applyPendingConfig</code> is permissionless and anyone can land it.
          </>
        )}{' '}
        Your <code>amountOutMinimum</code> is what protects a quote taken before that happens.
      </p>
    </div>
  )
}

/* ---------------------------------------------------------------------------
   Methodology — the house `.dapp-method` disclosure.
   --------------------------------------------------------------------------- */

function SwapMethodology({
  pool,
  hook,
  routerCall,
}: {
  pool: SwapPool
  hook: HookTake | null
  routerCall: { commands: Hex; inputs: readonly Hex[]; plan: Hex } | null
}) {
  return (
    <details className="dapp-method">
      <summary>How this trade is built and quoted</summary>
      <div className="dapp-method__body">
        <p>
          <strong>The quote.</strong> <code>CLQuoter.quoteExactInputSingle</code> at{' '}
          <a className="hx-addr" href={explorerAddressUrl(pool.key.poolManager)} target="_blank" rel="noopener noreferrer">
            the CL pool manager
          </a>
          &rsquo;s quoter. It is not a <code>view</code> function: it takes the vault lock, performs
          the real swap and reverts with the answer, so it is simulated rather than read. The figure
          is the swapper&rsquo;s own balance delta and is therefore already net of the LP fee, the
          protocol fee and any <code>hookDelta</code> the hook took in <code>afterSwap</code>.
        </p>
        <p>
          <strong>The transaction.</strong> One command byte, <code>0x10</code> (
          <code>Commands.INFI_SWAP</code>), whose input is{' '}
          <code>abi.encode(bytes actions, bytes[] params)</code>. The actions are{' '}
          <code>0x06</code> <code>CL_SWAP_EXACT_IN_SINGLE</code>, <code>0x0c</code>{' '}
          <code>SETTLE_ALL</code>, <code>0x0f</code> <code>TAKE_ALL</code>. Settle pays from, and
          take delivers to, <code>msgSender()</code> — the address that called{' '}
          <code>execute</code>. The router never custodies the funds.
        </p>
        <p>
          <strong>The price bound.</strong> Not a setting. Both{' '}
          <code>CLRouterBase._swapExactPrivate</code> and <code>CLQuoter._swap</code> hardcode{' '}
          <code>zeroForOne ? MIN_SQRT_RATIO + 1 : MAX_SQRT_RATIO − 1</code>. Passing 0 there reverts{' '}
          <code>InvalidSqrtPriceLimit</code>; there is no parameter here to get that wrong with.
        </p>
        <p>
          <strong>Payment.</strong> Permit2, at{' '}
          <a className="hx-addr" href={explorerAddressUrl(PERMIT2)} target="_blank" rel="noopener noreferrer">
            {shortHex(PERMIT2)}
          </a>
          . The router pays the vault with <code>PERMIT2.transferFrom</code>, so an ERC-20 approval
          to the router does nothing on its own. The router&rsquo;s own <code>PERMIT2</code> is an
          internal immutable with no getter, so this address comes from the deployment record and
          the simulation is what proves the two agree.
        </p>
        <p>
          <strong>Fees.</strong> LP fee and protocol fee are read from{' '}
          <code>CLPoolManager.getSlot0</code> for this pool — the protocol fee is a composite of
          both directions and is unpacked per direction, so the number shown is the one that applies
          to the way you are trading. The hook&rsquo;s cut is read from{' '}
          {hook === null ? (
            'nowhere: no hook is attached.'
          ) : (
            <>
              <code>getConfig</code> and <code>getPendingConfig</code> on{' '}
              <a className="hx-addr" href={explorerAddressUrl(hook.hook)} target="_blank" rel="noopener noreferrer">
                {shortHex(hook.hook)}
              </a>
              .
            </>
          )}
        </p>
        <p>
          <strong>&ldquo;Below spot&rdquo; is not price impact.</strong> Spot comes from{' '}
          <code>sqrtPriceX96</code> and carries no fees; the quote carries all three. The gap is
          fees plus impact, and one quote cannot separate them — so the fee total is printed beside
          it rather than folded into a single number that quietly means both.
        </p>
        {routerCall ? (
          <p>
            <strong>The exact bytes.</strong> <code>commands</code> = <code>{routerCall.commands}</code>,{' '}
            <code>inputs[0]</code> is {(routerCall.inputs[0]?.length ?? 2) / 2 - 1} bytes:
            <br />
            <code className="swap-calldata">{routerCall.plan}</code>
          </p>
        ) : null}
      </div>
    </details>
  )
}
