/* ============================================================================
   The freeze guard — CLAUDE.md "Deployed and unfixable" §3, as a pure predicate.

   `freezeConfig` is one call, immediate and permanent. On the retired hook
   0x23CE…E446 (which hosts LTT1/LTT2) nothing on chain stops an owner freezing
   a pool whose beneficiary share is live while its roster is empty: the pot
   then accrues into `pendingBeneficiary` forever, because `settleBeneficiaries`
   RETURNS EARLY on zero total weight and the freeze has removed
   `setBeneficiaries`, the only repair. The current hook refuses that one state
   (`BeneficiariesRequired`), but not the rest of the rule below.

   THE RULE (§3). Never freeze a pool with non-zero `beneficiaryBps` until all
   three hold:
     1. `getBeneficiaries` is non-empty
     2. `totalWeight > 0`
     3. `pendingBeneficiary` is settled to dust on BOTH currencies

   Plus two refusals this surface adds, because a freeze makes them permanent
   context rather than repairable state:
     4. no queued or armed `getPendingConfig` proposal
     5. no pot that nothing can ever distribute (a residual `pendingBeneficiary`
        with zero total weight), even at `beneficiaryBps == 0`

   "SETTLED TO DUST" IS DERIVED FROM THE CONTRACT, NOT A THRESHOLD. A settlement
   credits each recipient `mulDiv(amount, weight, totalWeight)` (floored) and
   leaves the remainder in `pendingBeneficiary` (`RevShareHook.settleBeneficiaries`).
   So the pot is at dust exactly when a settlement run NOW would credit nobody
   anything: every floored share is zero. `distributableNow` computes that sum
   with the same integer arithmetic. No wei figure is invented here.

   PURE ON PURPOSE. No viem, no React, no import at all — so it runs under a
   plain test runner (`apps/web/test/freezeGuard.test.ts`) and so the UI and the
   test cannot disagree about what "safe to freeze" means.
   ============================================================================ */

export type ProposalState = 'none' | 'queued' | 'armed' | 'expired'

export interface PendingPot {
  /** Token symbol, for the explanation only. */
  symbol: string
  /** `pendingBeneficiary(poolId, currency)`. */
  amount: bigint
}

export interface FreezeGuardInput {
  /** `getConfig(poolId).beneficiaryBps`. */
  beneficiaryBps: number
  /** `getConfig(poolId).frozen`. */
  frozen: boolean
  /** `getBeneficiaries(poolId)` weights, in roster order. */
  weights: readonly bigint[]
  /** `totalWeight(poolId)`. */
  totalWeight: bigint
  /**
   * `pendingBeneficiary` for each of the pool's currencies. Must be exactly the
   * two currencies of the resolved pool key; anything else is refused, because
   * "both currencies" cannot be checked from one.
   */
  pots: readonly PendingPot[]
  /** Where `getPendingConfig` stands on the hook's own clock. */
  proposal: ProposalState
}

export interface FreezeCheck {
  id: 'not-frozen' | 'both-currencies' | 'roster' | 'weight' | 'weights-agree' | 'settled' | 'no-stranded-pot' | 'no-proposal'
  ok: boolean
  /** One line: what was checked. */
  label: string
  /** Why it passed or failed, with the figures read. */
  detail: string
}

export interface FreezeVerdict {
  allowed: boolean
  checks: FreezeCheck[]
}

/**
 * What `settleBeneficiaries` would credit to the roster if it ran now:
 * `Σ floor(amount · weight / totalWeight)`. Zero when `totalWeight` is zero,
 * because the contract returns early and credits nothing.
 */
export function distributableNow(amount: bigint, weights: readonly bigint[], totalWeight: bigint): bigint {
  if (amount <= 0n || totalWeight <= 0n) return 0n
  let sum = 0n
  for (const w of weights) {
    if (w > 0n) sum += (amount * w) / totalWeight
  }
  return sum
}

export function freezeGuard(input: FreezeGuardInput): FreezeVerdict {
  const checks: FreezeCheck[] = []
  const shareLive = input.beneficiaryBps > 0
  const weightSum = input.weights.reduce((a, w) => a + w, 0n)

  checks.push({
    id: 'not-frozen',
    ok: !input.frozen,
    label: 'The pool is not already frozen',
    detail: input.frozen ? '`getConfig.frozen` is already true.' : '`getConfig.frozen` is false.',
  })

  checks.push({
    id: 'both-currencies',
    ok: input.pots.length === 2,
    label: '`pendingBeneficiary` read on both currencies',
    detail:
      input.pots.length === 2
        ? `Read for ${input.pots.map((p) => p.symbol).join(' and ')}.`
        : `Read for ${input.pots.length} currenc${input.pots.length === 1 ? 'y' : 'ies'}; the rule needs both of the pool key's two.`,
  })

  if (shareLive) {
    checks.push({
      id: 'roster',
      ok: input.weights.length > 0,
      label: '`getBeneficiaries` is non-empty',
      detail:
        input.weights.length > 0
          ? `${input.weights.length} roster entr${input.weights.length === 1 ? 'y' : 'ies'}.`
          : `The roster is empty while beneficiaryBps is ${input.beneficiaryBps}. Every beneficiary cut after a freeze would accrue to nobody, forever.`,
    })
    checks.push({
      id: 'weight',
      ok: input.totalWeight > 0n,
      label: '`totalWeight > 0`',
      detail: `totalWeight reads ${input.totalWeight.toString()}.`,
    })
  }

  checks.push({
    id: 'weights-agree',
    ok: weightSum === input.totalWeight,
    label: 'The roster weights sum to `totalWeight`',
    detail:
      weightSum === input.totalWeight
        ? `Both read ${input.totalWeight.toString()}.`
        : `The entries sum to ${weightSum.toString()} but totalWeight reads ${input.totalWeight.toString()}. The readings disagree, so nothing about the pot can be concluded.`,
  })

  if (shareLive) {
    const unsettled = input.pots
      .map((p) => ({ p, moves: distributableNow(p.amount, input.weights, input.totalWeight) }))
      .filter((x) => x.moves > 0n || (input.totalWeight === 0n && x.p.amount > 0n))
    checks.push({
      id: 'settled',
      ok: input.pots.length === 2 && unsettled.length === 0,
      label: '`pendingBeneficiary` settled to dust on both currencies',
      detail:
        unsettled.length === 0
          ? input.pots.length === 2
            ? `A settlement now would credit nothing: ${input.pots.map((p) => `${p.symbol} pot ${p.amount.toString()}`).join(', ')} (base units).`
            : 'Cannot be judged without both currencies.'
          : `Not settled: ${unsettled
              .map((x) =>
                input.totalWeight === 0n
                  ? `${x.p.symbol} holds ${x.p.amount.toString()} that no roster can receive`
                  : `settleBeneficiaries would still credit ${x.moves.toString()} of ${x.p.symbol}'s ${x.p.amount.toString()}`,
              )
              .join('; ')}. Run settleBeneficiaries for each currency first.`,
    })
  } else {
    const stranded = input.pots.filter((p) => input.totalWeight === 0n && p.amount > 0n)
    checks.push({
      id: 'no-stranded-pot',
      ok: stranded.length === 0,
      label: 'No residual beneficiary pot that no roster could receive',
      detail:
        stranded.length === 0
          ? 'beneficiaryBps is 0 and nothing is stranded in pendingBeneficiary.'
          : `${stranded.map((p) => `${p.symbol} ${p.amount.toString()}`).join(', ')} sits in pendingBeneficiary with totalWeight 0. A freeze removes setBeneficiaries, so it could never be paid out.`,
    })
  }

  const liveProposal = input.proposal === 'queued' || input.proposal === 'armed'
  checks.push({
    id: 'no-proposal',
    ok: !liveProposal,
    label: 'No queued or armed configuration proposal',
    detail: liveProposal
      ? `A proposal is ${input.proposal}. Cancel it with cancelPendingConfig, or let it apply, and decide on the result before making anything permanent.`
      : input.proposal === 'expired'
        ? 'The only proposal has expired and can no longer be applied.'
        : '`getPendingConfig` holds no proposal.',
  })

  return { allowed: checks.every((c) => c.ok), checks }
}
