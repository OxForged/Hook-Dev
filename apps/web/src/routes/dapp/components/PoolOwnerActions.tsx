/* ============================================================================
   Pool-owner actions — the owner-gated half of the revenue-share surface.

   Everything else on these screens is a read or a permissionless nudge. This
   is the one place a pool's configuration can actually be changed, so it
   carries a different set of rules from `PermissionlessAction`:

   1. SIMULATE WITH AN ACCOUNT. Every function here reverts
      `NotPoolOwner(poolId, caller)` for the wrong sender. `useSimulateContract`
      defaults to no account, which simulates from the zero address — so the
      owner's own buttons would all read "you are not the owner". The account is
      passed explicitly and the simulation is disabled until a wallet exists.
      This is the single most important difference between the two components.

   2. THE PANEL DOES NOT APPEAR FOR NON-OWNERS. Not disabled — absent. A
      disabled control invites the reader to find the permission; an absent one
      correctly says this screen has nothing for them. The exception is the
      handover: the INCOMING owner sees exactly one action, `acceptPoolOwnership`,
      and nothing else.

   3. IRREVERSIBLE ACTIONS ASK FOR THE WORD. `freezeConfig` is permanent and
      ends the owner's power over the pool forever. It is behind a typed
      confirmation, because a `confirm()` dialog is a reflex and typing is not.
      (It is also the only browser-modal-free way to do this — a native dialog
      would block the extension's event loop.)

   4. VALIDATION MIRRORS THE CONTRACT, IT DOES NOT REPLACE IT. The split must
      sum to exactly 10000; the roster is capped at 8 entries with non-zero
      addresses and weights. Those checks are shown live so the reader is not
      told "no" by a wallet popup — but the simulation still runs, and the
      simulation is what enables the button. Client validation is a courtesy;
      the chain is the authority.

   WHAT IS DELIBERATELY NOT HERE: `configure`. It claims an unclaimed pool or
   reconfigures an uninitialised one — a deploy-time action. Offering it beside
   the management controls invites someone to try it on a live pool and collect
   a `PoolAlreadyConfigured` revert for their trouble.
   ============================================================================ */

import { LatchConnectButton } from '@latchprotocol/connect'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Abi, Address } from 'viem'
import { isAddress } from 'viem'
import {
  useAccount,
  useSimulateContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'

import { DEPLOYMENTS } from '../../../lib/chain'
import {
  REVSHARE_CHAIN_ID,
  bpsPct,
  decodeRevShareFailure,
  explorer,
  keyTuple,
  pipsPct,
  type PoolKeyStruct,
  type PoolOverview,
} from '../lib/revshare'
import { REV_SHARE_OWNER_ABI } from '../lib/revshareAbi'

const CHAIN_NAME = DEPLOYMENTS[REVSHARE_CHAIN_ID].name

/* Mirrors of contract constants. Named after the constant so a future change
   is greppable from either side. */
const MAX_BENEFICIARIES = 8
const MAX_TOTAL_WEIGHT = 10n ** 18n
const SPLIT_DENOMINATOR = 10_000
const MAX_FEE_PIPS = 100_000

/* ---------------------------------------------------------------------------
   OwnerAction — the send primitive
   --------------------------------------------------------------------------- */

interface OwnerActionProps {
  label: string
  /** One sentence: what this does on chain. Name the function, not a euphemism. */
  describes: string
  hook: Address
  functionName: string
  args: readonly unknown[]
  /** Set when the form is incomplete or invalid. Renders instead of the button. */
  invalid?: string | null
  /** Extra styling for the destructive ones. */
  tone?: 'default' | 'danger'
  /** Called once a receipt confirms, so the screen can refetch. */
  onConfirmed?: () => void
}

function OwnerAction({
  label,
  describes,
  hook,
  functionName,
  args,
  invalid = null,
  tone = 'default',
  onConfirmed,
}: OwnerActionProps) {
  const { address, isConnected, chainId } = useAccount()
  const { switchChain, isPending: switching } = useSwitchChain()

  const { writeContract, data: txHash, isPending: awaitingSignature, error: writeError } = useWriteContract()
  const receipt = useWaitForTransactionReceipt({ hash: txHash, chainId: REVSHARE_CHAIN_ID })

  const onChain = chainId === REVSHARE_CHAIN_ID

  /* The account is the whole point — see rule 1 in the header. Without it the
     simulation runs from address(0) and NotPoolOwner is guaranteed. */
  const canSimulate = invalid === null && !txHash && isConnected && onChain && address !== undefined

  const sim = useSimulateContract({
    address: hook,
    abi: REV_SHARE_OWNER_ABI as Abi,
    functionName,
    args: args as never,
    account: address,
    chainId: REVSHARE_CHAIN_ID,
    query: { enabled: canSimulate, retry: false, gcTime: 0 },
  })

  const simFailure = decodeRevShareFailure(sim.error)
  const writeFailure = decodeRevShareFailure(writeError)
  const ready = Boolean(sim.data) && canSimulate

  const submit = useCallback(() => {
    if (!sim.data) return
    writeContract(sim.data.request as never)
  }, [sim.data, writeContract])

  const confirmed = receipt.data?.status === 'success'
  const reverted = receipt.data?.status === 'reverted'

  /* Tell the parent to refetch, exactly once, on the transition to confirmed.
     IN AN EFFECT, NOT DURING RENDER: `onConfirmed` sets state in the screen
     above this one, and calling it from a render body is a write to another
     component mid-render — React warns, and under concurrent rendering the
     render can be discarded and replayed, firing it more than once.

     The ref, not state, holds "already reported": it must not itself trigger a
     render, and the guard has to survive the re-render that the parent's
     refetch causes. Keyed on the hash so a second action in the same session
     still reports. */
  const reportedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!confirmed || !txHash) return
    if (reportedRef.current === txHash) return
    reportedRef.current = txHash
    onConfirmed?.()
  }, [confirmed, txHash, onConfirmed])

  return (
    <div className="po-action">
      <p className="dapp-microlabel">{label}</p>
      <p className="live-note" style={{ marginTop: 4 }}>
        {describes}
      </p>

      {invalid !== null && (
        <p className="dp-hint dp-hint--err" style={{ marginTop: 8 }}>
          {invalid}
        </p>
      )}

      {invalid === null && (
        <>
          {!isConnected && (
            <div className="dp-gate" style={{ marginTop: 10 }}>
              <p className="dp-gate__title">Connect the owner wallet</p>
              <p className="dp-gate__body">
                This call is owner-gated, so unlike the maintenance calls on this screen it cannot
                even be simulated without an account — the hook would see a send from{' '}
                <code>address(0)</code>.
              </p>
              <LatchConnectButton variant="inline" label="Connect wallet" />
            </div>
          )}

          {isConnected && !onChain && (
            <div className="dp-gate dp-gate--warn" style={{ marginTop: 10 }}>
              <p className="dp-gate__title">Not deployed on this chain</p>
              <p className="dp-gate__body">
                RevShareHook is deployed on {CHAIN_NAME} and nowhere else — not because your wallet is on the wrong network, but because the hook has not been deployed to the chain you are on. Switching moves you to the only chain where these reads mean anything.
              </p>
              <button
                type="button"
                className="dapp-btn dapp-btn--sm"
                onClick={() => switchChain({ chainId: REVSHARE_CHAIN_ID })}
                disabled={switching}
              >
                {switching ? 'Switching…' : `Switch to ${CHAIN_NAME}`}
              </button>
            </div>
          )}

          {canSimulate && (
            <p
              className={
                sim.isFetching ? 'dapp-console__line is-shown' : ready ? 'dp-ok' : 'dp-hint dp-hint--err'
              }
              style={{ marginTop: 8 }}
              aria-live="polite"
            >
              {sim.isFetching
                ? 'Simulating from your address…'
                : ready
                  ? 'Simulated clean — the chain accepts this call from your address right now.'
                  : (simFailure?.message ?? 'Not simulated yet.')}
            </p>
          )}

          {canSimulate && !ready && simFailure?.name && (
            <p className="dapp-microlabel" style={{ marginTop: 2 }}>
              REVERTED WITH {simFailure.name}
            </p>
          )}

          {isConnected && onChain && !txHash && (
            <button
              type="button"
              className={
                tone === 'danger'
                  ? 'dapp-btn dapp-btn--sm po-btn--danger'
                  : 'dapp-btn dapp-btn--primary dapp-btn--sm'
              }
              style={{ marginTop: 10 }}
              onClick={submit}
              disabled={!ready || awaitingSignature}
            >
              {awaitingSignature ? 'Confirm in your wallet…' : label}
            </button>
          )}

          {writeFailure && (
            <p className="dp-hint dp-hint--err" style={{ marginTop: 8 }}>
              {writeFailure.message}
            </p>
          )}

          {txHash && (
            <div className="dp-tx" style={{ marginTop: 10 }} aria-live="polite">
              <p className="dp-tx__row">
                <span
                  className={
                    confirmed
                      ? 'dapp-dot dapp-dot--success dapp-dot--lg'
                      : reverted
                        ? 'dapp-dot dapp-dot--error dapp-dot--lg'
                        : 'dapp-dot dapp-dot--primary dapp-dot--lg dapp-dot--pulse'
                  }
                  aria-hidden="true"
                />
                {confirmed
                  ? 'Confirmed on chain.'
                  : reverted
                    ? 'Mined, but the transaction reverted. Nothing changed.'
                    : 'Broadcast. Waiting for a receipt — this is not a success yet.'}
              </p>
              <p className="dp-tx__hash">
                <a href={explorer(`tx/${txHash}`)} target="_blank" rel="noopener noreferrer">
                  {txHash}
                </a>
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------------------
   Roster editor
   --------------------------------------------------------------------------- */

interface Row {
  recipient: string
  weight: string
}

function rosterFrom(o: PoolOverview): Row[] {
  return o.beneficiaries.map((b) => ({ recipient: b.recipient, weight: b.weight.toString() }))
}

function RosterEditor({
  o,
  poolKey,
  onConfirmed,
}: {
  o: PoolOverview
  poolKey: PoolKeyStruct
  onConfirmed: () => void
}) {
  const [rows, setRows] = useState<Row[]>(() => rosterFrom(o))

  const parsed = useMemo(() => {
    const entries: { recipient: Address; weight: bigint }[] = []
    let problem: string | null = null

    for (const [i, r] of rows.entries()) {
      const addr = r.recipient.trim()
      const w = r.weight.trim()
      if (!isAddress(addr)) {
        problem ??= `Row ${i + 1}: “${addr || 'empty'}” is not an address.`
        continue
      }
      let weight: bigint
      try {
        weight = BigInt(w === '' ? '0' : w)
      } catch {
        problem ??= `Row ${i + 1}: weight “${w}” is not a whole number.`
        continue
      }
      if (weight <= 0n) {
        problem ??= `Row ${i + 1}: the contract rejects a zero weight. Remove the row instead.`
        continue
      }
      entries.push({ recipient: addr as Address, weight })
    }

    const total = entries.reduce((a, e) => a + e.weight, 0n)
    if (problem === null && rows.length > MAX_BENEFICIARIES) {
      problem = `MAX_BENEFICIARIES is ${MAX_BENEFICIARIES}; this roster has ${rows.length}.`
    }
    if (problem === null && total > MAX_TOTAL_WEIGHT) {
      problem = `Total weight ${total} exceeds MAX_TOTAL_WEIGHT (1e18).`
    }

    const dupes = entries
      .map((e) => e.recipient.toLowerCase())
      .filter((a, i, all) => all.indexOf(a) !== i)
    if (problem === null && dupes.length > 0) {
      problem =
        'The same recipient appears twice. The contract permits it, but the two weights simply add — ' +
        'combine them into one row so the roster reads honestly.'
    }

    return { entries, total, problem }
  }, [rows])

  const unchanged =
    parsed.problem === null &&
    parsed.entries.length === o.beneficiaries.length &&
    parsed.entries.every(
      (e, i) =>
        e.recipient.toLowerCase() === o.beneficiaries[i]?.recipient.toLowerCase() &&
        e.weight === o.beneficiaries[i]?.weight,
    )

  const set = (i: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  return (
    <div className="po-block">
      <div className="dapp-card__head">
        <h4 className="po-block__title">Beneficiary roster</h4>
        <span className="dapp-badge dapp-badge--mute">
          {parsed.entries.length} of {MAX_BENEFICIARIES} · total weight {parsed.total.toString()}
        </span>
      </div>

      <p className="live-note">
        Weights are relative, not percentages — a recipient receives{' '}
        <code>weight / totalWeight</code> of the beneficiary slice ({bpsPct(o.config.beneficiaryBps)}{' '}
        of the take). <strong>Replacing the roster settles the old one first</strong> for both
        currencies, so a change can never retroactively redirect value that accrued under the
        previous roster.
      </p>

      <div className="po-rows">
        {rows.map((r, i) => {
          const share =
            parsed.total > 0n && isAddress(r.recipient.trim()) && /^\d+$/.test(r.weight.trim())
              ? `${((Number(BigInt(r.weight.trim() || '0')) / Number(parsed.total)) * 100).toFixed(2)}%`
              : '—'
          return (
            <div className="po-row" key={i}>
              <label className="po-field">
                <span className="dapp-microlabel">RECIPIENT {i + 1}</span>
                <input
                  className="po-input"
                  value={r.recipient}
                  spellCheck={false}
                  placeholder="0x…"
                  onChange={(e) => set(i, { recipient: e.target.value })}
                />
              </label>
              <label className="po-field po-field--narrow">
                <span className="dapp-microlabel">WEIGHT</span>
                <input
                  className="po-input"
                  value={r.weight}
                  inputMode="numeric"
                  spellCheck={false}
                  onChange={(e) => set(i, { weight: e.target.value })}
                />
              </label>
              <span className="po-share" title="Share of the beneficiary slice">
                {share}
              </span>
              <button
                type="button"
                className="dapp-btn dapp-btn--sm"
                aria-label={`Remove recipient ${i + 1}`}
                onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            </div>
          )
        })}
      </div>

      <div className="po-rowactions">
        <button
          type="button"
          className="dapp-btn dapp-btn--sm"
          disabled={rows.length >= MAX_BENEFICIARIES}
          onClick={() => setRows((prev) => [...prev, { recipient: '', weight: '' }])}
        >
          Add recipient
        </button>
        <button type="button" className="dapp-btn dapp-btn--sm" onClick={() => setRows(rosterFrom(o))}>
          Reset to on-chain
        </button>
      </div>

      {rows.length === 0 && (
        <p className="live-note" style={{ marginTop: 8 }}>
          An empty roster is a valid call: it clears the roster entirely. Anything the pool accrues
          for beneficiaries afterwards waits in <code>pendingBeneficiary</code> —{' '}
          <code>settleBeneficiaries</code> returns quietly while total weight is zero — rather than
          being lost.
        </p>
      )}

      <OwnerAction
        label="setBeneficiaries"
        describes="Replaces the roster. Settles the outgoing roster for currency0 and currency1 first, in the same transaction."
        hook={o.hook}
        functionName="setBeneficiaries"
        args={[keyTuple(poolKey), parsed.entries.map((e) => [e.recipient, e.weight] as const)]}
        invalid={
          parsed.problem ??
          (unchanged ? 'The roster matches what is on chain. Nothing to send.' : null)
        }
        onConfirmed={onConfirmed}
      />
    </div>
  )
}

/* ---------------------------------------------------------------------------
   Config proposal
   --------------------------------------------------------------------------- */

function ProposeConfig({
  o,
  poolKey,
  onConfirmed,
}: {
  o: PoolOverview
  poolKey: PoolKeyStruct
  onConfirmed: () => void
}) {
  const c = o.config
  const [feePips, setFeePips] = useState(String(c.feePips))
  const [lp, setLp] = useState(String(c.lpDonateBps))
  const [ben, setBen] = useState(String(c.beneficiaryBps))
  const [dist, setDist] = useState(String(c.distributorBps))
  const [distributor, setDistributor] = useState(o.distributor ?? '')
  const [enabled, setEnabled] = useState(c.enabled)

  const parsed = useMemo(() => {
    const num = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : null)
    const f = num(feePips)
    const l = num(lp)
    const b = num(ben)
    const d = num(dist)
    if (f === null || l === null || b === null || d === null) {
      return { problem: 'Every field must be a whole number.', args: null, sum: 0 }
    }
    if (f > MAX_FEE_PIPS) {
      return { problem: `feePips ${f} exceeds MAX_FEE_PIPS (${MAX_FEE_PIPS} = 10%).`, args: null, sum: 0 }
    }
    const sum = l + b + d
    if (sum !== SPLIT_DENOMINATOR) {
      return {
        problem: `The split sums to ${sum}. The contract requires exactly ${SPLIT_DENOMINATOR} — the check is exact, not a ceiling.`,
        args: null,
        sum,
      }
    }
    const addr = distributor.trim()
    const distAddr = addr === '' ? '0x0000000000000000000000000000000000000000' : addr
    if (addr !== '' && !isAddress(addr)) {
      return { problem: 'The distributor is not a valid address.', args: null, sum }
    }
    if (d !== 0 && distAddr === '0x0000000000000000000000000000000000000000') {
      return { problem: 'A non-zero distributor share needs a distributor address.', args: null, sum }
    }
    return {
      problem: null,
      args: [f, l, b, d, distAddr as Address, enabled] as const,
      sum,
    }
  }, [feePips, lp, ben, dist, distributor, enabled])

  const delayBlocks = o.configDelayBlocks
  const raising = parsed.args !== null && parsed.args[0] > c.feePips

  return (
    <div className="po-block">
      <h4 className="po-block__title">Propose a configuration change</h4>
      <p className="live-note">
        Queues the change; it becomes applicable {delayBlocks.toString()} blocks later
        (<code>CONFIG_DELAY_BLOCKS</code>), and anyone may then call{' '}
        <code>applyPendingConfig</code> — the delay is the protection, not the caller. Only
        escalation waits: to <em>lower</em> the take use <code>reduceFee</code> below, which applies
        immediately.
      </p>

      <div className="po-grid">
        <label className="po-field">
          <span className="dapp-microlabel">FEE PIPS — currently {c.feePips} ({pipsPct(c.feePips)})</span>
          <input className="po-input" value={feePips} inputMode="numeric" onChange={(e) => setFeePips(e.target.value)} />
        </label>
        <label className="po-field">
          <span className="dapp-microlabel">TO LPs (BPS)</span>
          <input className="po-input" value={lp} inputMode="numeric" onChange={(e) => setLp(e.target.value)} />
        </label>
        <label className="po-field">
          <span className="dapp-microlabel">TO BENEFICIARIES (BPS)</span>
          <input className="po-input" value={ben} inputMode="numeric" onChange={(e) => setBen(e.target.value)} />
        </label>
        <label className="po-field">
          <span className="dapp-microlabel">TO DISTRIBUTOR (BPS)</span>
          <input className="po-input" value={dist} inputMode="numeric" onChange={(e) => setDist(e.target.value)} />
        </label>
        <label className="po-field po-field--wide">
          <span className="dapp-microlabel">DISTRIBUTOR ADDRESS — blank for none</span>
          <input
            className="po-input"
            value={distributor}
            spellCheck={false}
            placeholder="0x…"
            onChange={(e) => setDistributor(e.target.value)}
          />
        </label>
        <label className="po-check">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span>
            <code>enabled</code> — the hook takes its cut on swaps
          </span>
        </label>
      </div>

      <p className={parsed.sum === SPLIT_DENOMINATOR ? 'dp-ok' : 'dp-hint dp-hint--err'}>
        Split sums to {parsed.sum} / {SPLIT_DENOMINATOR}
      </p>

      {raising && (
        <p className="dp-hint dp-hint--warn">
          This raises the take from {c.feePips} to {parsed.args?.[0]} pips. That is the case the delay
          exists for — traders get {delayBlocks.toString()} blocks of notice.
        </p>
      )}

      <OwnerAction
        label="proposeConfig"
        describes={`Writes the proposal. It cannot be applied for ${delayBlocks.toString()} blocks, and it replaces any proposal already outstanding.`}
        hook={o.hook}
        functionName="proposeConfig"
        args={parsed.args === null ? [] : [keyTuple(poolKey), parsed.args]}
        invalid={parsed.problem}
        onConfirmed={onConfirmed}
      />

      {o.pending.effectiveBlock > 0n && (
        <OwnerAction
          label="cancelPendingConfig"
          describes="Withdraws the outstanding proposal. The live configuration is untouched."
          hook={o.hook}
          functionName="cancelPendingConfig"
          args={[keyTuple(poolKey)]}
          onConfirmed={onConfirmed}
        />
      )}
    </div>
  )
}

/* ---------------------------------------------------------------------------
   Immediate reductions, handover, and the one-way door
   --------------------------------------------------------------------------- */

function ReduceAndDisable({
  o,
  poolKey,
  onConfirmed,
}: {
  o: PoolOverview
  poolKey: PoolKeyStruct
  onConfirmed: () => void
}) {
  const [fee, setFee] = useState('')
  const trimmed = fee.trim()
  const valid = /^\d+$/.test(trimmed)
  const value = valid ? Number(trimmed) : null

  return (
    <div className="po-block">
      <h4 className="po-block__title">Reduce the take, or stop taking it</h4>
      <p className="live-note">
        Neither waits. Delay sits on escalation only — a pool owner giving back should never be
        queued behind a timer.
      </p>

      <label className="po-field">
        <span className="dapp-microlabel">NEW FEE PIPS — must be below {o.config.feePips}</span>
        <input className="po-input" value={fee} inputMode="numeric" placeholder={String(o.config.feePips)} onChange={(e) => setFee(e.target.value)} />
      </label>

      <OwnerAction
        label="reduceFee"
        describes="Lowers the cut immediately. It cannot raise it — the contract compares against the live value and reverts."
        hook={o.hook}
        functionName="reduceFee"
        args={value === null ? [] : [keyTuple(poolKey), value]}
        invalid={
          !valid
            ? 'Enter the new fee in pips.'
            : value !== null && value >= o.config.feePips
              ? `${value} is not below the current ${o.config.feePips} pips. Use proposeConfig to raise it.`
              : null
        }
        onConfirmed={onConfirmed}
      />

      {o.config.enabled && (
        <OwnerAction
          label="disable"
          describes="Stops the hook taking a cut on this pool from the next swap. Balances already accrued stay claimable — this does not strand anyone."
          hook={o.hook}
          functionName="disable"
          args={[keyTuple(poolKey)]}
          onConfirmed={onConfirmed}
        />
      )}
    </div>
  )
}

function Handover({
  o,
  poolKey,
  onConfirmed,
}: {
  o: PoolOverview
  poolKey: PoolKeyStruct
  onConfirmed: () => void
}) {
  const [next, setNext] = useState('')
  const trimmed = next.trim()
  const clearing = trimmed === '' || trimmed === '0x0000000000000000000000000000000000000000'

  return (
    <div className="po-block">
      <h4 className="po-block__title">Transfer ownership</h4>
      <p className="live-note">
        Two steps: you nominate, they accept. A one-step transfer would let a treasury migration end
        with the pool's configuration stranded at an address nobody controls. Leave the field blank
        to cancel a nomination already outstanding.
      </p>

      {o.pendingOwner && (
        <p className="dp-hint dp-hint--warn">
          Currently nominated: <code>{o.pendingOwner}</code>. They have not accepted yet, so you are
          still the owner.
        </p>
      )}

      <label className="po-field">
        <span className="dapp-microlabel">NEW OWNER</span>
        <input
          className="po-input"
          value={next}
          spellCheck={false}
          placeholder="0x… (blank to cancel)"
          onChange={(e) => setNext(e.target.value)}
        />
      </label>

      <OwnerAction
        label="transferPoolOwnership"
        describes={
          clearing
            ? 'Clears any outstanding nomination. You remain the owner.'
            : 'Nominates a new owner. Nothing changes until they call acceptPoolOwnership.'
        }
        hook={o.hook}
        functionName="transferPoolOwnership"
        args={[
          keyTuple(poolKey),
          clearing ? '0x0000000000000000000000000000000000000000' : (trimmed as Address),
        ]}
        invalid={!clearing && !isAddress(trimmed) ? 'That is not a valid address.' : null}
        onConfirmed={onConfirmed}
      />
    </div>
  )
}

function FreezeDoor({
  o,
  poolKey,
  onConfirmed,
}: {
  o: PoolOverview
  poolKey: PoolKeyStruct
  onConfirmed: () => void
}) {
  const [typed, setTyped] = useState('')
  const armed = typed.trim().toUpperCase() === 'FREEZE'

  return (
    <div className="po-block po-block--danger">
      <h4 className="po-block__title">Freeze this pool's configuration — permanent</h4>
      <p className="live-note">
        <strong>One-way.</strong> After this the fee, the split and the roster can never change
        again — not by you, not by the protocol, not by governance. Any outstanding proposal is
        discarded in the same call, so a freeze cannot be used to sneak one in. It is the strongest
        promise a pool owner can make to traders, and there is no undo.
      </p>

      <label className="po-field">
        <span className="dapp-microlabel">TYPE “FREEZE” TO ARM THE BUTTON</span>
        <input
          className="po-input"
          value={typed}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setTyped(e.target.value)}
        />
      </label>

      <OwnerAction
        label="freezeConfig"
        describes="Sets frozen = true on this pool, forever."
        hook={o.hook}
        functionName="freezeConfig"
        args={[keyTuple(poolKey)]}
        invalid={armed ? null : 'Type FREEZE above to arm this. It cannot be undone.'}
        tone="danger"
        onConfirmed={onConfirmed}
      />
    </div>
  )
}

/* ---------------------------------------------------------------------------
   The panel
   --------------------------------------------------------------------------- */

export function PoolOwnerActions({ o, onConfirmed }: { o: PoolOverview; onConfirmed: () => void }) {
  const { address, isConnected } = useAccount()

  const me = address?.toLowerCase()
  const isOwner = isConnected && me !== undefined && me === o.config.owner.toLowerCase()
  const isIncoming =
    isConnected && me !== undefined && o.pendingOwner !== null && me === o.pendingOwner.toLowerCase()

  const poolKey = o.resolution?.key ?? null

  /* Nothing for a visitor. Absent, not disabled — see rule 2. */
  if (!isOwner && !isIncoming) return null

  if (poolKey === null) {
    return (
      <section className="dapp-card hx-alert hx-alert--danger">
        <h3 className="dapp-card__title">You own this pool, but nothing can be sent</h3>
        <p className="live-note">
          Every owner call takes a <code>PoolKey</code> and this pool's could not be resolved — it
          has no distributor whose <code>poolKey()</code> could be read, and no{' '}
          <code>Initialize</code> log was found for its id. The key is not recoverable from the id
          by any means, so the controls are withheld rather than shown broken. Sending from a tool
          where you can supply the key by hand is the only route until a distributor exists.
        </p>
      </section>
    )
  }

  if (!isOwner && isIncoming) {
    return (
      <section className="dapp-card po-card">
        <div className="dapp-card__head">
          <h3 className="dapp-card__title">You have been nominated as this pool's owner</h3>
          <span className="dapp-badge dapp-badge--primary">INCOMING OWNER</span>
        </div>
        <p className="live-note">
          <code>{o.config.owner}</code> nominated your address. Ownership does not move until you
          accept, and accepting is the only action available to you here.
        </p>
        <OwnerAction
          label="acceptPoolOwnership"
          describes="Completes the handover. From this transaction on, the pool's configuration answers to your address."
          hook={o.hook}
          functionName="acceptPoolOwnership"
          args={[keyTuple(poolKey)]}
          onConfirmed={onConfirmed}
        />
      </section>
    )
  }

  return (
    <section className="dapp-card po-card">
      <div className="dapp-card__head">
        <h3 className="dapp-card__title">Owner actions</h3>
        <span className="dapp-badge dapp-badge--primary">YOU OWN THIS POOL</span>
      </div>

      <p className="live-note">
        Visible because the connected wallet matches <code>poolOwner({'{'}poolId{'}'})</code>. Every
        call below is simulated from your address before its button enables — a simulation that
        passes is the chain saying it will accept the transaction, not this screen guessing.
      </p>

      {o.config.frozen ? (
        <div className="dp-gate dp-gate--warn" style={{ marginTop: 12 }}>
          <p className="dp-gate__title">This pool is frozen</p>
          <p className="dp-gate__body">
            <code>freezeConfig</code> has already been called. The fee, the split and the roster are
            permanent, and every write below would revert <code>ConfigFrozen</code>. Ownership
            transfer still works — it moves who holds a power that no longer does anything to the
            configuration.
          </p>
        </div>
      ) : (
        <>
          <RosterEditor o={o} poolKey={poolKey} onConfirmed={onConfirmed} />
          <ProposeConfig o={o} poolKey={poolKey} onConfirmed={onConfirmed} />
          <ReduceAndDisable o={o} poolKey={poolKey} onConfirmed={onConfirmed} />
        </>
      )}

      <Handover o={o} poolKey={poolKey} onConfirmed={onConfirmed} />

      {!o.config.frozen && <FreezeDoor o={o} poolKey={poolKey} onConfirmed={onConfirmed} />}
    </section>
  )
}
