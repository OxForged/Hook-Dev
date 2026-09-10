/* ============================================================================
   Register a Latch — the dapp's first write path.

   A Latch is a hook contract attached to a pool; "hook" below always means the
   EVM-level integration point, never the product.

   This screen used to be a 2.2-second timer that turned a button green and said
   "Register on Base ✓". Nothing was signed, nothing was submitted, and Base is
   not a chain Latch is deployed on. All of it is gone.

   What it does now: takes a deployed Latch address plus the five `HookMetadata`
   fields and calls `LatchHookRegistry.register` on Ethereum Sepolia. Listing is
   permissionless, free and has no allowlist — anyone can list any Latch — and it
   is also IRREVERSIBLE, because the registry has no `unregister` by design.

   Three rules this screen is built around:

     1. NO STATE IS SHOWN THAT THE CHAIN HAS NOT CONFIRMED. "Registered" appears
        only when a transaction receipt came back with status success. A mined
        transaction that reverted is rendered as a failure, loudly, because a
        receipt is not the same thing as a success.

     2. THE USER LEARNS WHY IT WILL FAIL BEFORE THEY PAY FOR THE ANSWER. The
        registry rejects six distinct conditions, and every one of them is
        checked by simulating `register` with `eth_call` first. The custom error
        that comes back is decoded and named — HookAlreadyRegistered,
        HookHasNoCode, PermissionsUnreadable, ReservedBitsSet,
        PermissionDependencyMissing, ZeroAddress, and the metadata bounds.

     3. CAPABILITY IS READ OFF THE LATCH, NEVER TYPED IN. There is deliberately
        no field for permissions. The bitmap is read from the Latch's own
        `getHooksRegistrationBitmap()` and expanded by the registry's own pure
        classifiers, the same ones the marketplace uses, so a Latch cannot be
        described one way here and another way there.
   ============================================================================ */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { LatchConnectButton } from '@latchprotocol/connect'
import { useAccount, useSimulateContract, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { getAddress, type Address } from 'viem'

import { registryAbi } from '../../../lib/abi/registry'
import { RISK_LABEL, explorerAddress, explorerTx } from '../../../lib/chain'
import { DOT_BY_STATE, loadDeploy, type CheckState, type PreflightCheck } from '../data/deploy.ts'
import {
  EMPTY_DRAFT,
  REGISTRY_ADDRESS,
  REGISTRY_CHAIN_ID,
  REGISTRY_CHAIN_NAME,
  decodeRegistryFailure,
  formatBitmap,
  isHookAddressValid,
  parseChainIds,
  probeHook,
  readRegistryLimits,
  toMetadataArg,
  validateDraft,
  type DraftField,
  type HookProbe,
  type MetadataDraft,
  type RegistryLimits,
} from '../lib/registryWrite.ts'
import { dappPath } from '../paths.ts'

/** Enough that a paste settles before we spend three RPC calls on it. */
const PROBE_DEBOUNCE_MS = 350

/** What a finished probe can say. */
type ProbeOutcome = { k: 'ready'; probe: HookProbe } | { k: 'error'; message: string }

type ProbeState = { k: 'idle' } | { k: 'reading' } | ProbeOutcome

const RISK_BADGE = ['dapp-badge dapp-badge--mute', 'dapp-badge dapp-badge--warn', 'dapp-badge dapp-badge--danger']

function num(value: number): string {
  return value.toLocaleString('en-US')
}

function short(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address
}

function toneOf(line: string): string {
  if (line.startsWith('✓')) return 'is-ok'
  if (line.startsWith('✗')) return 'is-err'
  if (line.startsWith('·')) return 'is-idle'
  return 'is-run'
}

export default function Deploy() {
  const { steps } = useMemo(() => loadDeploy(), [])
  const { isConnected, chainId, address: account } = useAccount()
  const { switchChain, isPending: switching, error: switchError } = useSwitchChain()

  const [hookInput, setHookInput] = useState('')
  const [draft, setDraft] = useState<MetadataDraft>(EMPTY_DRAFT)
  const [limits, setLimits] = useState<RegistryLimits | null>(null)
  const [limitsError, setLimitsError] = useState<string | null>(null)
  /* Keyed by the address it describes, so a result that arrives after the field
     has moved on is never shown against the wrong Latch. */
  const [probeResult, setProbeResult] = useState<{ for: Address; outcome: ProbeOutcome } | null>(null)

  /* The registry's own byte bounds. Read, not hardcoded — a redeploy with
     different limits must not leave this form validating against stale ones. */
  useEffect(() => {
    let off = false
    readRegistryLimits()
      .then((l) => !off && setLimits(l))
      .catch((e) => !off && setLimitsError(e instanceof Error ? e.message : 'unreachable'))
    return () => {
      off = true
    }
  }, [])

  const trimmedHook = hookInput.trim()
  const hookAddress: Address | null = isHookAddressValid(trimmedHook) ? getAddress(trimmedHook) : null

  /* Probe the address the moment it becomes a valid one. This is read-only and
     costs the user nothing; it is what puts the Latch's real capabilities on
     screen before anybody is asked to sign for them. */
  useEffect(() => {
    if (!hookAddress) return
    let off = false
    const id = setTimeout(() => {
      probeHook(hookAddress)
        .then((probe) => !off && setProbeResult({ for: hookAddress, outcome: { k: 'ready', probe } }))
        .catch(
          (e) =>
            !off &&
            setProbeResult({
              for: hookAddress,
              outcome: { k: 'error', message: e instanceof Error ? e.message : 'unreachable' },
            }),
        )
    }, PROBE_DEBOUNCE_MS)
    return () => {
      off = true
      clearTimeout(id)
    }
  }, [hookAddress])

  /* Derived, never stored: with no address there is nothing to say, and with an
     address whose result has not landed yet the honest answer is "reading". */
  const probeState: ProbeState = !hookAddress
    ? { k: 'idle' }
    : probeResult?.for === hookAddress
      ? probeResult.outcome
      : { k: 'reading' }

  const issues = useMemo(() => validateDraft(hookInput, draft, limits), [hookInput, draft, limits])
  const issueFor = useCallback(
    (field: DraftField) => issues.find((i) => i.field === field)?.message ?? null,
    [issues],
  )

  const metadata = useMemo(() => toMetadataArg(draft), [draft])
  const parsedChains = useMemo(() => parseChainIds(draft.chainIdsText), [draft.chainIdsText])

  const onRegistryChain = chainId === REGISTRY_CHAIN_ID
  const formClean = issues.length === 0 && hookAddress !== null

  /* ---- transaction ------------------------------------------------------ */

  const {
    writeContract,
    data: txHash,
    isPending: awaitingSignature,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract()

  const receipt = useWaitForTransactionReceipt({ hash: txHash, chainId: REGISTRY_CHAIN_ID })

  /* Simulation is switched off the instant a transaction exists: re-simulating
     a registration that has just landed would revert HookAlreadyRegistered and
     paint a red error over a genuine success. */
  const simulationEnabled = isConnected && onRegistryChain && formClean && !txHash

  const sim = useSimulateContract({
    address: REGISTRY_ADDRESS,
    abi: registryAbi,
    functionName: 'register',
    args: hookAddress ? [hookAddress, metadata] : undefined,
    chainId: REGISTRY_CHAIN_ID,
    query: { enabled: simulationEnabled, retry: false, gcTime: 0 },
  })

  const simFailure = decodeRegistryFailure(sim.error)
  const writeFailure = decodeRegistryFailure(writeError)
  const simulated = Boolean(sim.data) && simulationEnabled

  const confirmed = receipt.data?.status === 'success'
  const mined = receipt.data !== undefined
  const revertedOnChain = receipt.data?.status === 'reverted'

  const submit = useCallback(() => {
    if (!sim.data) return
    writeContract(sim.data.request)
  }, [sim.data, writeContract])

  const startOver = useCallback(() => {
    resetWrite()
    setHookInput('')
    setDraft(EMPTY_DRAFT)
    setProbeResult(null)
  }, [resetWrite])

  /* ---- derived presentation --------------------------------------------- */

  const probe = probeState.k === 'ready' ? probeState.probe : null

  /* Step strip driven by facts, not a timer. */
  const activeThrough = confirmed
    ? 3
    : txHash || awaitingSignature
      ? 3
      : simulated || sim.isFetching || simFailure
        ? 2
        : probe
          ? 1
          : 0

  const codeState: CheckState = !hookAddress
    ? 'idle'
    : probeState.k === 'reading'
      ? 'pending'
      : probe
        ? probe.hasCode
          ? 'ok'
          : 'fail'
        : 'idle'

  const notListedState: CheckState = !probe ? (hookAddress ? 'pending' : 'idle') : probe.alreadyRegistered ? 'fail' : 'ok'

  const bitmapState: CheckState = !probe
    ? hookAddress
      ? 'pending'
      : 'idle'
    : !probe.hasCode
      ? 'idle'
      : probe.bitmapReadable
        ? 'ok'
        : 'fail'

  const acceptedState: CheckState = !probe || !probe.bitmapReadable ? 'idle' : probe.bitmapValid ? 'ok' : 'fail'

  const metadataState: CheckState = limits === null ? 'pending' : issues.some((i) => i.field !== 'hook') ? 'fail' : 'ok'

  const simState: CheckState = !simulationEnabled
    ? 'idle'
    : sim.isFetching
      ? 'pending'
      : simFailure
        ? 'fail'
        : sim.data
          ? 'ok'
          : 'idle'

  const checks: PreflightCheck[] = [
    {
      name: 'Contract code at address',
      value: !probe ? '—' : probe.hasCode ? `${num(probe.codeSize)} bytes` : 'no code',
      state: codeState,
    },
    {
      name: 'Not already listed',
      value: !probe ? '—' : probe.alreadyRegistered ? 'already registered' : 'slot free',
      state: notListedState,
    },
    {
      name: 'Bitmap readable by registry',
      value: !probe ? '—' : probe.bitmapReadable ? formatBitmap(probe.permissions ?? 0) : 'unreadable',
      state: bitmapState,
    },
    {
      name: 'Bitmap core would accept',
      value: !probe || !probe.bitmapReadable ? '—' : probe.bitmapValid ? 'well formed' : 'rejected',
      state: acceptedState,
    },
    {
      name: 'Metadata within limits',
      value:
        limits === null
          ? 'reading limits…'
          : issues.some((i) => i.field !== 'hook')
            ? 'over limit'
            : `name ≤ ${limits.maxNameBytes}B`,
      state: metadataState,
    },
    {
      name: 'register() simulation',
      value: !simulationEnabled
        ? '—'
        : sim.isFetching
          ? 'calling…'
          : simFailure
            ? (simFailure.name ?? 'revert')
            : sim.data
              ? 'would succeed'
              : '—',
      state: simState,
    },
  ]

  /* The console is a transcript of calls that actually happened. Every line is
     the result of an RPC round trip, in the order it was made. */
  const lines: string[] = []
  if (!hookAddress) {
    lines.push('· enter a deployed Latch address to begin')
  } else {
    lines.push(`→ eth_getCode(${short(hookAddress)}) on ${REGISTRY_CHAIN_NAME}`)
    if (probeState.k === 'reading') lines.push('→ reading…')
    if (probeState.k === 'error') lines.push(`✗ RPC error: ${probeState.message}`)
    if (probe) {
      lines.push(probe.hasCode ? `✓ ${num(probe.codeSize)} bytes of code` : '✗ no code at this address')
      if (probe.hasCode) {
        lines.push(
          probe.alreadyRegistered ? '✗ registry.isRegistered → true' : '✓ registry.isRegistered → false',
        )
        lines.push('→ hook.getHooksRegistrationBitmap()')
        lines.push(
          probe.bitmapReadable
            ? `✓ ${formatBitmap(probe.permissions ?? 0)} · ${probe.callbacks.length} callback${probe.callbacks.length === 1 ? '' : 's'}`
            : '✗ unreadable within the registry probe budget',
        )
        if (probe.bitmapReadable) {
          lines.push(
            probe.bitmapValid
              ? '✓ registry.isValidBitmap → true'
              : '✗ registry.isValidBitmap → false',
          )
        }
      }
    }
    if (simulationEnabled) {
      lines.push(`→ eth_call register(…) from ${short(account ?? '')}`)
      if (sim.isFetching) lines.push('→ simulating…')
      else if (simFailure) lines.push(`✗ ${simFailure.name ?? 'revert'}`)
      else if (sim.data) lines.push('✓ simulation succeeded — safe to sign')
    }
    if (txHash) {
      lines.push(`→ eth_sendRawTransaction → ${short(txHash)}`)
      if (!mined) lines.push('→ waiting for the receipt…')
      else if (confirmed) lines.push('✓ receipt status 1 — registered')
      else lines.push('✗ receipt status 0 — the transaction reverted on chain')
    }
  }

  /* ---- button ----------------------------------------------------------- */

  const buttonLabel = awaitingSignature
    ? 'Confirm in your wallet…'
    : txHash && !mined
      ? 'Waiting for confirmation…'
      : confirmed
        ? 'Registered'
        : sim.isFetching
          ? 'Simulating…'
          : simulated
            ? 'Register Latch'
            : 'Register Latch'

  const busy = awaitingSignature || (Boolean(txHash) && !mined) || sim.isFetching
  const submitDisabled = !simulated || busy || Boolean(txHash)

  const field = (
    id: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
    props: { placeholder?: string; area?: boolean; mono?: boolean; error?: string | null; hint?: string } = {},
  ) => (
    <div className="dp-field">
      <label className="dapp-microlabel dapp-microlabel--tight" htmlFor={id}>
        {label}
      </label>
      {props.area ? (
        <textarea
          id={id}
          className="dp-input dp-input--area"
          rows={3}
          value={value}
          placeholder={props.placeholder}
          disabled={Boolean(txHash)}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          id={id}
          type="text"
          spellCheck={false}
          autoComplete="off"
          className={props.mono ? 'dp-input dp-input--mono' : 'dp-input'}
          value={value}
          placeholder={props.placeholder}
          disabled={Boolean(txHash)}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {props.hint && !props.error && <p className="dp-hint">{props.hint}</p>}
      {props.error && <p className="dp-hint dp-hint--err">{props.error}</p>}
    </div>
  )

  return (
    <div className="dapp-row dapp-row--deploy">
      <div className="dapp-stack">
        <ol className="dapp-steps">
          {steps.map((s, i) => (
            <li key={s.n} className={i <= activeThrough ? 'dapp-step is-active' : 'dapp-step'}>
              <span className="dapp-step__num" aria-hidden="true">
                {s.n}
              </span>
              <span className="dapp-step__body">
                <span className="dapp-step__name">{s.name}</span>
                <span className="dapp-step__hint">{s.hint}</span>
              </span>
            </li>
          ))}
        </ol>

        <section className="dapp-card dapp-card--config">
          <h2 className="dapp-card__title dapp-card__title--lg">Register a Latch</h2>
          <p className="dp-lede">
            Listing is permissionless, free and has no allowlist. It is also permanent — the
            registry has no <code>unregister</code>, deliberately, so that a warning about a Latch
            can never be deleted by whoever it warns about. Registering writes to{' '}
            <a
              href={explorerAddress(REGISTRY_CHAIN_ID, REGISTRY_ADDRESS)}
              target="_blank"
              rel="noopener noreferrer"
            >
              LatchHookRegistry
            </a>{' '}
            on {REGISTRY_CHAIN_NAME}, the only chain it is deployed on.
          </p>

          {/* Wallet state is a first-class part of the form, never a dead button. */}
          {!isConnected && (
            <div className="dp-gate">
              <p className="dp-gate__title">Connect a wallet to register</p>
              <p className="dp-gate__body">
                Registration is a transaction you sign. Nothing on this screen is submitted for you,
                and reading the Latch below costs nothing and needs no wallet.
              </p>
              <LatchConnectButton variant="inline" label="Connect wallet" />
            </div>
          )}

          {isConnected && !onRegistryChain && (
            <div className="dp-gate dp-gate--warn">
              <p className="dp-gate__title">Wrong network</p>
              <p className="dp-gate__body">
                LatchHookRegistry exists only on {REGISTRY_CHAIN_NAME} (chain {REGISTRY_CHAIN_ID}).
                Your wallet is on chain {chainId ?? 'unknown'}, where that address holds no contract
                — a transaction sent from there would be signed and then fail.
              </p>
              <button
                type="button"
                className="dapp-btn dapp-btn--sm dapp-btn--primary"
                disabled={switching}
                onClick={() => switchChain({ chainId: REGISTRY_CHAIN_ID })}
              >
                {switching ? 'Switching…' : `Switch to ${REGISTRY_CHAIN_NAME}`}
              </button>
              {switchError && <p className="dp-hint dp-hint--err">{switchError.message}</p>}
            </div>
          )}

          <div className="dapp-fields">
            {field('dp-hook', 'LATCH CONTRACT ADDRESS', hookInput, setHookInput, {
              placeholder: '0x…',
              mono: true,
              error: issueFor('hook'),
              hint: 'Already deployed. Permissions are read off this contract — never declared here.',
            })}
            {field('dp-name', 'NAME', draft.name, (v) => setDraft((d) => ({ ...d, name: v })), {
              placeholder: 'FeeLatch',
              error: issueFor('name'),
              hint: limits ? `Required · up to ${limits.maxNameBytes} bytes` : 'Required',
            })}
            {field(
              'dp-desc',
              'DESCRIPTION',
              draft.description,
              (v) => setDraft((d) => ({ ...d, description: v })),
              {
                area: true,
                placeholder: 'What this Latch does, in the author’s own words.',
                error: issueFor('description'),
                hint: limits
                  ? `Prose, never a capability claim · up to ${num(limits.maxDescriptionBytes)} bytes`
                  : 'Prose, never a capability claim.',
              },
            )}
            {field(
              'dp-source',
              'SOURCE URI',
              draft.sourceURI,
              (v) => setDraft((d) => ({ ...d, sourceURI: v })),
              {
                placeholder: 'https://github.com/…',
                mono: true,
                error: issueFor('sourceURI'),
                hint: 'Required before a curator can mark this source-verified.',
              },
            )}
            {field(
              'dp-audit',
              'AUDIT URI',
              draft.auditURI,
              (v) => setDraft((d) => ({ ...d, auditURI: v })),
              {
                placeholder: 'https://… (optional)',
                mono: true,
                error: issueFor('auditURI'),
                hint: 'Optional. Required before a curator can mark this audited.',
              },
            )}
            {field(
              'dp-chains',
              'CHAIN IDS',
              draft.chainIdsText,
              (v) => setDraft((d) => ({ ...d, chainIdsText: v })),
              {
                placeholder: '11155111',
                mono: true,
                error: issueFor('chainIds'),
                hint:
                  parsedChains.error === null
                    ? `Informational claim · ${parsedChains.ids.length} id${parsedChains.ids.length === 1 ? '' : 's'}${limits ? ` · max ${limits.maxChains}` : ''}`
                    : undefined,
              },
            )}
          </div>

          {limitsError && (
            <p className="hx-alert">
              The registry&rsquo;s metadata limits could not be read ({limitsError}), so length
              checks are not being applied here. The simulation below still enforces them.
            </p>
          )}

          {/* The one authority on whether this will work. */}
          {simFailure && (
            <div className="hx-alert hx-alert--danger dp-failure" role="status">
              <p className="dp-failure__name">
                {simFailure.kind === 'contract'
                  ? `Registry would revert: ${simFailure.name ?? 'unknown error'}`
                  : 'Simulation could not complete'}
              </p>
              <p className="dp-failure__body">{simFailure.message}</p>
              <p className="dp-failure__raw">{simFailure.detail}</p>
            </div>
          )}

          {writeFailure && !txHash && (
            <div
              className={
                writeFailure.kind === 'rejected'
                  ? 'hx-note dp-failure'
                  : 'hx-alert hx-alert--danger dp-failure'
              }
              role="status"
            >
              <p className="dp-failure__name">
                {writeFailure.kind === 'rejected' ? 'Signature rejected' : 'Transaction not sent'}
              </p>
              <p className="dp-failure__body">{writeFailure.message}</p>
            </div>
          )}

          {simulated && !txHash && (
            <p className="dp-ok" role="status">
              Simulated against {REGISTRY_CHAIN_NAME} at the current block: <code>register()</code>{' '}
              would succeed. Signing is the next step and it is irreversible.
            </p>
          )}

          {!confirmed && (
            <button
              type="button"
              className="dapp-btn dapp-btn--block dapp-btn--primary"
              data-busy={busy ? 'true' : undefined}
              aria-busy={busy}
              disabled={submitDisabled}
              onClick={submit}
            >
              {buttonLabel}
            </button>
          )}

          {confirmed && (
            <button type="button" className="dapp-btn dapp-btn--block dapp-btn--ghost" onClick={startOver}>
              Register another Latch
            </button>
          )}
        </section>
      </div>

      <div className="dapp-stack">
        {/* What the user is actually listing, read off the Latch itself. */}
        <section className="dapp-card dp-caps-card" aria-live="polite">
          <h2 className="dapp-microlabel">PERMISSIONS READ FROM THE LATCH</h2>

          {!hookAddress && (
            <p className="dapp-empty dp-gap">
              Enter a Latch address above. Its permission bitmap is read from its own
              <code> getHooksRegistrationBitmap()</code> — a submitter cannot declare permissions
              their code does not have.
            </p>
          )}

          {hookAddress && probeState.k === 'reading' && (
            <p className="dapp-empty dp-gap">Reading {short(hookAddress)}&hellip;</p>
          )}

          {probeState.k === 'error' && (
            <p className="hx-alert dp-gap">
              Could not reach {REGISTRY_CHAIN_NAME}: {probeState.message}. Nothing is shown rather
              than a stale or assumed bitmap.
            </p>
          )}

          {probe && !probe.hasCode && (
            <p className="hx-alert hx-alert--danger dp-gap">
              No contract code at this address on {REGISTRY_CHAIN_NAME}. It is an externally owned
              account, a typo, or a contract deployed on a different chain.
            </p>
          )}

          {probe && probe.hasCode && !probe.bitmapReadable && (
            <p className="hx-alert hx-alert--danger dp-gap">
              This contract did not answer <code>getHooksRegistrationBitmap()</code> with one clean
              uint16 inside the registry&rsquo;s probe budget. Core makes the same call when a pool
              is initialised, so a Latch it cannot read can never back a pool.
            </p>
          )}

          {probe && probe.alreadyRegistered && (
            <p className="hx-alert dp-gap">
              This Latch is already listed.{' '}
              <Link to={dappPath('marketplace')}>See it in the marketplace</Link> — registration
              happens once and there is no unregister.
            </p>
          )}

          {probe && probe.bitmapReadable && (
            <>
              <p className="hx-badges dp-gap">
                <span className={RISK_BADGE[probe.risk ?? 0]}>{RISK_LABEL[probe.risk ?? 0]}</span>
                <span className={probe.bitmapValid ? 'dapp-badge dapp-badge--ok' : 'dapp-badge dapp-badge--danger'}>
                  {probe.bitmapValid ? 'CORE-VALID BITMAP' : 'CORE WOULD REJECT'}
                </span>
              </p>

              {!probe.bitmapValid && (
                <p className="hx-alert hx-alert--danger">
                  Malformed bitmap — it carries reserved bits 14-15, or a returns-delta bit without
                  the callback that bit depends on. The simulation below names which.
                </p>
              )}

              <div className={`hx-caps ${probe.takesSwapCut || probe.canTrapLiquidity ? 'hx-caps--danger' : ''}`}>
                <p className="dapp-microlabel dapp-microlabel--tight">WHAT THIS LATCH CAN DO</p>
                <ul className="hx-caps__list">
                  {probe.claims.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>

              {probe.callbacks.length > 0 && (
                <p className="dapp-tags dp-gap">
                  {probe.callbacks.map((c) => (
                    <span key={c} className="dapp-tag">
                      {c}
                    </span>
                  ))}
                </p>
              )}

              <div className="dapp-latch__foot">
                <span className="dapp-stat">
                  <span className="dapp-stat__label">BITMAP</span>
                  <span className="dapp-stat__value">{formatBitmap(probe.permissions ?? 0)}</span>
                </span>
                <span className="dapp-stat">
                  <span className="dapp-stat__label">CODE SIZE</span>
                  <span className="dapp-stat__value">{num(probe.codeSize)} B</span>
                </span>
                <span className="dapp-stat hx-links">
                  <span className="dapp-stat__label">CONTRACT</span>
                  <span className="hx-links__row">
                    <a
                      href={explorerAddress(REGISTRY_CHAIN_ID, probe.address)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {short(probe.address)}
                    </a>
                  </span>
                </span>
              </div>
            </>
          )}
        </section>

        <section className="dapp-console">
          <div className="dapp-console__bar">
            <span className="dapp-dot dapp-dot--primary dapp-dot--flat" aria-hidden="true" />
            <h2 className="dapp-console__title">pre-flight — every line is one rpc call</h2>
          </div>
          <div className="dapp-console__body" aria-live="polite">
            {lines.map((t, i) => (
              <p key={`${i}-${t}`} className={`dapp-console__line is-shown ${toneOf(t)}`}>
                {t}
              </p>
            ))}
          </div>
        </section>

        {/* Transaction lifecycle. Never a success state the chain did not give us. */}
        {(txHash || awaitingSignature) && (
          <section className="dapp-card dp-tx" aria-live="polite">
            <h2 className="dapp-microlabel">TRANSACTION</h2>

            {awaitingSignature && !txHash && (
              <p className="dp-tx__row">
                <span className="dapp-dot dapp-dot--primary dapp-dot--lg dapp-dot--pulse" aria-hidden="true" />
                Awaiting your signature. Nothing has been broadcast yet.
              </p>
            )}

            {txHash && (
              <>
                <p className="dp-tx__row">
                  <span
                    className={
                      confirmed
                        ? 'dapp-dot dapp-dot--success dapp-dot--lg'
                        : revertedOnChain
                          ? 'dapp-dot dapp-dot--error dapp-dot--lg'
                          : 'dapp-dot dapp-dot--primary dapp-dot--lg dapp-dot--pulse'
                    }
                    aria-hidden="true"
                  />
                  {confirmed
                    ? 'Confirmed on chain.'
                    : revertedOnChain
                      ? 'Mined, but the transaction reverted. Nothing was registered.'
                      : 'Broadcast. Waiting for a receipt — this is not a success yet.'}
                </p>
                <p className="dp-tx__hash">
                  <a href={explorerTx(REGISTRY_CHAIN_ID, txHash)} target="_blank" rel="noopener noreferrer">
                    {txHash}
                  </a>
                </p>
                {receipt.data && (
                  <p className="dp-tx__meta">
                    block {num(Number(receipt.data.blockNumber))} · gas used{' '}
                    {num(Number(receipt.data.gasUsed))} · status {receipt.data.status}
                  </p>
                )}
                {receipt.isError && (
                  <p className="dp-hint dp-hint--err">
                    The receipt could not be fetched: {receipt.error?.message}. The transaction may
                    still be pending — check the explorer link above rather than trusting this
                    screen.
                  </p>
                )}
                {confirmed && (
                  <p className="dp-ok">
                    Listed as <strong>Unverified</strong> — every Latch enters there, and only a
                    curator moves it up.{' '}
                    <Link to={dappPath('marketplace')}>Find it in the marketplace</Link>.
                  </p>
                )}
                {revertedOnChain && (
                  <p className="dp-hint dp-hint--err">
                    A receipt is not a success. This one carries status 0, so no record was written
                    and the gas was spent for nothing.
                  </p>
                )}
              </>
            )}
          </section>
        )}

        <section className="dapp-card">
          <h2 className="dapp-microlabel">PRE-FLIGHT CHECKS</h2>
          <ul className="dapp-checks">
            {checks.map((c) => (
              <li key={c.name} className="dapp-checks__row">
                <span
                  className={`${DOT_BY_STATE[c.state]}${c.state === 'idle' ? ' dp-dot--idle' : ''}`}
                  aria-hidden="true"
                />
                <span className="dapp-checks__name">{c.name}</span>
                <span className={c.state === 'fail' ? 'dapp-checks__value is-error' : 'dapp-checks__value'}>
                  {c.value}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
