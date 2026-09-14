import type { TimelockOperation } from "./timelockOps.js";

/**
 * Alert rules. PURE: every input is a row the worker already wrote, so an alert
 * is always traceable to a read (`provenance`), and the rules are unit-tested
 * against the live state CLAUDE.md records.
 *
 * Severity ladder:
 *   CRITICAL  a safety mechanism cannot work right now (canceller cannot pay for
 *             a cancel; a do-not-queue call is queued; an owner is an unknown address)
 *   HIGH      a documented control is not in force, or value is at risk soon
 *   MEDIUM    degraded, unreadable, or drifting from the Ownership table
 *   LOW       worth knowing, not urgent
 *   INFO      context
 */

export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
export const SEVERITIES: readonly Severity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];

export interface Alert {
  id: string;
  severity: Severity;
  category: "governance" | "safety" | "indexer" | "revenue" | "moderation";
  chainId: number | null;
  title: string;
  detail: string;
  subject: string | null;
  /** Which read this came from: table, block, time. */
  provenance: string;
  /** In-panel page that acts on it. */
  action: { label: string; page: string } | null;
}

export interface OwnershipRow {
  chainId: number;
  contractKey: string;
  address: string;
  check: string;
  observed: string | null;
  expectedTier: string;
  expectedAddress: string | null;
  matches: boolean | null;
  readError: string | null;
  readAtBlock: string;
  readAt: string;
}

export interface AlertInputs {
  now: Date;
  chains: { chainId: number; lastIndexedBlock: string; headBlock: string; headObservedAt: string; maxLagBlocks: number | null; maxHeadAgeSeconds: number | null }[];
  governance: { chainId: number; safe: string; timelockCustody: string; timelockPolicy: string }[];
  ownership: OwnershipRow[];
  pendingConfigs: { chainId: number; hook: string; poolId: string; shape: string; status: string; effectiveContractBlock: string; expiryContractBlock: string | null; contractBlockNumber: string; readError: string | null; readAt: string; readAtBlock: string }[];
  opsBalances: { chainId: number; label: string; address: string; balanceWei: string; criticalWei: string | null; minWei: string | null; severity: string | null; actionsAffordable: string | null; gasPriceWei: string | null; readAt: string; readAtBlock: string }[];
  feeds: { chainId: number; label: string; proxy: string; heartbeatViolation: boolean | null; stalenessSeconds: number | null; heartbeatSeconds: number; error: string | null; readAt: string }[];
  stockTokens: { chainId: number; token: string; symbol: string | null; tokenPaused: boolean | null; uiMultiplier: string | null; readAt: string; readAtBlock: string; recentChanges: { readAt: string; previousPaused: boolean | null; tokenPaused: boolean | null; previousUiMultiplier: string | null; uiMultiplier: string | null }[] }[];
  timelockOps: TimelockOperation[];
  reconciliationMismatches: { chainId: number; kind: string; subject: string; detail: string | null; atBlock: string }[];
  pendingListings: number;
  /** Allowlisted Safe balances above their configured size, each with the Latch route read for it. Optional: absent when chain reads are off. */
  treasuryConversions?: { chainId: number; token: string; symbol: string; balanceRaw: string; balanceUnits: string; thresholdRaw: string; routeStatus: string; blockers: string[]; minOutWei: string | null; readAtBlock: string | null; readAt: string | null }[];
}

const ACCEPT_OWNERSHIP = "0x79ba5097";

/** A queued, not-cancelled custody-timelock operation that calls acceptOwnership() on `target`. */
export function queuedAcceptOwnership(ops: readonly TimelockOperation[], custodyTimelock: string, target: string): TimelockOperation | null {
  const t = target.toLowerCase();
  return (
    ops.find(
      (o) =>
        o.timelock.toLowerCase() === custodyTimelock.toLowerCase() &&
        o.status !== "CANCELLED" &&
        o.calls.some((c) => c.target.toLowerCase() === t && c.data.toLowerCase() === ACCEPT_OWNERSHIP),
    ) ?? null
  );
}

const CUSTODY_KEYS = new Set(["vault", "clPoolManagerOwner", "binPoolManagerOwner"]);
const short = (a: string | null) => (a && a.length === 42 ? `${a.slice(0, 6)}…${a.slice(-4)}` : (a ?? "null"));
const ZERO = "0x0000000000000000000000000000000000000000";

const CRITICAL_HAZARDS = new Set(["renounceOwnership", "updateDelay"]);
const HIGH_HAZARDS = new Set(["registerApp", "setProtocolFeeController", "transferPoolManagerOwnership", "revokeRole", "renounceRole"]);

export function computeAlerts(i: AlertInputs): Alert[] {
  const out: Alert[] = [];
  const push = (a: Alert) => out.push(a);
  const own = (r: OwnershipRow) => `ownership_snapshots @ block ${r.readAtBlock}, ${r.readAt}`;

  // --- indexer -------------------------------------------------------------
  for (const c of i.chains) {
    const lag = BigInt(c.headBlock) > BigInt(c.lastIndexedBlock) ? BigInt(c.headBlock) - BigInt(c.lastIndexedBlock) : 0n;
    const ageS = Math.round((i.now.getTime() - new Date(c.headObservedAt).getTime()) / 1000);
    const prov = `indexer_checkpoints: indexed ${c.lastIndexedBlock}, head ${c.headBlock} observed ${c.headObservedAt}`;
    if (c.maxHeadAgeSeconds !== null && ageS > c.maxHeadAgeSeconds) {
      push({ id: `indexer:${c.chainId}:head-age`, severity: "HIGH", category: "indexer", chainId: c.chainId, title: "Indexer has not observed the chain head recently", detail: `Last head observation ${ageS}s ago (threshold ${c.maxHeadAgeSeconds}s). Every figure in this panel is at least that old; the worker may be down or every RPC refusing.`, subject: null, provenance: prov, action: null });
    }
    if (c.maxLagBlocks !== null && lag > BigInt(c.maxLagBlocks)) {
      push({ id: `indexer:${c.chainId}:lag`, severity: "MEDIUM", category: "indexer", chainId: c.chainId, title: "Indexer is behind the head", detail: `${lag} blocks behind (threshold ${c.maxLagBlocks}).`, subject: null, provenance: prov, action: null });
    }
  }

  // --- ownership: the custody handover first --------------------------------
  const byContract = new Map<string, { owner?: OwnershipRow; pending?: OwnershipRow }>();
  for (const r of i.ownership) {
    if (r.check !== "owner" && r.check !== "pendingOwner") continue;
    const k = `${r.chainId}:${r.contractKey}`;
    const e = byContract.get(k) ?? {};
    if (r.check === "owner") e.owner = r;
    else e.pending = r;
    byContract.set(k, e);
  }
  for (const [, { owner, pending }] of byContract) {
    if (!owner) continue;
    const gov = i.governance.find((g) => g.chainId === owner.chainId);
    if (owner.readError || owner.observed === null) {
      push({ id: `own:${owner.chainId}:${owner.contractKey}:unreadable`, severity: "MEDIUM", category: "governance", chainId: owner.chainId, title: `owner() of ${owner.contractKey} could not be read`, detail: owner.readError ?? "no value", subject: owner.address, provenance: own(owner), action: null });
      continue;
    }
    if (owner.matches) {
      if (pending && pending.matches === false && pending.observed && pending.observed !== ZERO) {
        push({ id: `own:${owner.chainId}:${owner.contractKey}:pending`, severity: "MEDIUM", category: "governance", chainId: owner.chainId, title: `${owner.contractKey} has an ownership transfer pending`, detail: `owner() matches the table (${owner.expectedTier}) but pendingOwner() is ${pending.observed}. If accepted, ownership leaves its tier.`, subject: owner.address, provenance: own(pending), action: null });
      }
      continue;
    }
    const isCustody = CUSTODY_KEYS.has(owner.contractKey);
    const pendingIsCustody = gov && pending?.observed === gov.timelockCustody.toLowerCase();
    const ownerIsSafe = gov && owner.observed === gov.safe.toLowerCase();
    const knownGovernance = gov && [gov.safe, gov.timelockCustody, gov.timelockPolicy].map((x) => x.toLowerCase()).includes(owner.observed);

    if (isCustody && pendingIsCustody && gov) {
      // Stays HIGH until owner() READS the timelock. A queued or even executed
      // operation does not clear it; the next governance pass's read does.
      const op = queuedAcceptOwnership(i.timelockOps, gov.timelockCustody, owner.address);
      const fix = !op
        ? "No acceptOwnership() operation for it is indexed on the custody timelock. Do not schedule one without checking the chain: CLAUDE.md records three already queued at block 61,325,176."
        : op.status === "EXECUTED"
          ? `Operation ${op.operationId} executed at block ${op.executedAt?.blockNumber}; this clears when the next governance pass reads owner() as the timelock.`
          : op.status === "READY"
            ? `Operation ${op.operationId} is READY: anyone can call execute() on the custody timelock now.`
            : `Operation ${op.operationId} is queued; executable by anyone from ${op.readyAt}.`;
      push({
        id: `own:${owner.chainId}:${owner.contractKey}:custody-handover-unaccepted`,
        severity: "HIGH",
        category: "governance",
        chainId: owner.chainId,
        title: `${owner.contractKey}: custody handover proposed, not yet accepted`,
        detail: `owner() is ${ownerIsSafe ? "the Safe" : owner.observed} (${short(owner.observed)}); pendingOwner() is the 48 h custody timelock. Until the timelock accepts, ${owner.contractKey === "vault" ? "registerApp (irreversible, permanent fund access)" : "pause and fee authority over every pool"} needs only 2-of-3 Safe signatures with no public delay. ${fix}`,
        subject: owner.address,
        provenance: `${own(owner)}; pendingOwner read at block ${pending?.readAtBlock}${op ? `; operation from timelock_events tx ${op.scheduledAt.txHash}` : ""}`,
        action: op && op.status !== "EXECUTED" ? { label: op.status === "READY" ? "Prepare execute()" : "See the queued operation", page: op.status === "READY" ? "safe-actions" : "governance" } : null,
      });
      continue;
    }
    if (!knownGovernance) {
      push({ id: `own:${owner.chainId}:${owner.contractKey}:unknown-owner`, severity: "CRITICAL", category: "governance", chainId: owner.chainId, title: `${owner.contractKey} is owned by an address outside governance`, detail: `owner() is ${owner.observed}, which is not the Safe or either timelock. Expected ${owner.expectedTier} (${owner.expectedAddress}).`, subject: owner.address, provenance: own(owner), action: null });
      continue;
    }
    const severity = isCustody || owner.contractKey.endsWith("PoolManager") ? "HIGH" : owner.contractKey === "clPositionDescriptor" ? "LOW" : "MEDIUM";
    push({
      id: `own:${owner.chainId}:${owner.contractKey}:mismatch`,
      severity,
      category: "governance",
      chainId: owner.chainId,
      title: `${owner.contractKey} owner differs from the Ownership table`,
      detail: `Expected ${owner.expectedTier} (${short(owner.expectedAddress)}), owner() is ${short(owner.observed)}${pending?.observed && pending.observed !== ZERO ? `, pendingOwner() ${short(pending.observed)}` : ", nothing pending"}.${owner.contractKey === "clPositionDescriptor" ? " Cosmetic: the descriptor only sets a metadata URI." : ""}`,
      subject: owner.address,
      provenance: own(owner),
      action: null,
    });
  }

  // --- roles, guardians, treasury ------------------------------------------
  for (const r of i.ownership) {
    if (r.check === "owner" || r.check === "pendingOwner") continue;
    if (r.readError) {
      push({ id: `role:${r.chainId}:${r.contractKey}:${r.check}:unreadable`, severity: "MEDIUM", category: "governance", chainId: r.chainId, title: `${r.contractKey} ${r.check.split(":")[0]} could not be read`, detail: r.readError, subject: r.address, provenance: own(r), action: null });
      continue;
    }
    if (r.matches !== false) continue;
    let severity: Severity = "MEDIUM";
    let detail = `Expected: ${r.expectedTier}. Observed: ${r.observed}.`;
    if (r.check.startsWith("hasRole:PROPOSER_ROLE")) severity = "HIGH";
    else if (r.check.startsWith("hasRole:CANCELLER_ROLE")) {
      const custody = r.contractKey === "timelockCustody";
      severity = custody ? "HIGH" : "LOW";
      detail = custody
        ? "The dedicated canceller does not hold CANCELLER_ROLE on the custody timelock: a compromised Safe queueing updateDelay(0) has nobody to cancel it."
        : "The canceller does not hold CANCELLER_ROLE on the policy timelock. CLAUDE.md: low impact while that timelock holds only the cosmetic descriptor; move the descriptor to the Safe or grant the role.";
    } else if (r.check === "treasury") {
      severity = "HIGH";
      detail = `treasury() is ${r.observed}; sweep() pays whatever treasury() says. CLAUDE.md: protocol fees go to the Safe.`;
    }
    push({ id: `role:${r.chainId}:${r.contractKey}:${r.check}`, severity, category: "governance", chainId: r.chainId, title: `${r.contractKey}: ${r.check.replace(/:0x[0-9a-f]{40}$/, "")} is not as the Ownership table says`, detail, subject: r.address, provenance: own(r), action: null });
  }

  // --- timelock operations -------------------------------------------------
  for (const op of i.timelockOps) {
    if (op.status === "EXECUTED" || op.status === "CANCELLED") continue;
    const isAccept = op.calls.length > 0 && op.calls.every((c) => c.data.toLowerCase() === ACCEPT_OWNERSHIP);
    const prov = `timelock_events: CallScheduled tx ${op.scheduledAt.txHash} @ block ${op.scheduledAt.blockNumber}`;
    if (op.hazards.length) {
      const sev: Severity = op.hazards.some((h) => CRITICAL_HAZARDS.has(h)) ? "CRITICAL" : op.hazards.some((h) => HIGH_HAZARDS.has(h)) ? "HIGH" : "MEDIUM";
      push({ id: `tl:${op.chainId}:${op.operationId}`, severity: sev, category: "governance", chainId: op.chainId, title: `Queued ${op.tier} timelock call on the review list: ${op.hazards.join(", ")}`, detail: `Operation ${op.operationId} is ${op.status}${op.readyAt ? `, executable by anyone from ${op.readyAt}` : ""}. ${op.calls.find((c) => c.hazardNote)?.hazardNote ?? ""}`.trim(), subject: op.timelock, provenance: prov, action: { label: "Inspect the operation", page: "governance" } });
    } else if (isAccept) {
      push({ id: `tl:${op.chainId}:${op.operationId}`, severity: op.status === "READY" ? "LOW" : "INFO", category: "governance", chainId: op.chainId, title: `acceptOwnership() on ${short(op.calls[0]?.target ?? null)} is ${op.status === "READY" ? "ready to execute" : "queued"}`, detail: `Operation ${op.operationId}; ${op.status === "READY" ? "anyone can execute it now" : `executable by anyone from ${op.readyAt}`}. After execute(), re-read owner().`, subject: op.timelock, provenance: prov, action: { label: op.status === "READY" ? "Prepare execute()" : "Governance", page: op.status === "READY" ? "safe-actions" : "governance" } });
    } else if (op.status === "READY") {
      push({ id: `tl:${op.chainId}:${op.operationId}`, severity: "LOW", category: "governance", chainId: op.chainId, title: `A ${op.tier} timelock operation is ready`, detail: `Operation ${op.operationId} can be executed by anyone now.`, subject: op.timelock, provenance: prov, action: { label: "Inspect the operation", page: "governance" } });
    }
  }

  // --- RevShare pending configs --------------------------------------------
  for (const p of i.pendingConfigs) {
    const prov = `pending_config_hazards @ block ${p.readAtBlock}, contract clock ${p.contractBlockNumber}, ${p.readAt}`;
    if (p.status === "ARMED") {
      push({
        id: `pc:${p.chainId}:${p.hook}:${p.poolId}`,
        severity: "HIGH",
        category: "safety",
        chainId: p.chainId,
        title: `Armed RevShare proposal on pool ${short(p.poolId)}`,
        detail:
          p.shape === "legacy"
            ? `Matured at contract block ${p.effectiveContractBlock} and NEVER expires (legacy hook ${short(p.hook)}). applyPendingConfig is permissionless; disable/reduceFee do not clear it. Only cancelPendingConfig or freezeConfig does.`
            : `Matured at contract block ${p.effectiveContractBlock}, applicable by anyone until ${p.expiryContractBlock}.`,
        subject: p.hook,
        provenance: prov,
        action: null,
      });
    } else if (p.status === "UNKNOWN") {
      push({ id: `pc:${p.chainId}:${p.hook}:${p.poolId}`, severity: "MEDIUM", category: "safety", chainId: p.chainId, title: `Pending config unreadable on pool ${short(p.poolId)}`, detail: `The read failed (${p.readError ?? "no detail"}). Unknown is never shown as "no proposal".`, subject: p.hook, provenance: prov, action: null });
    } else if (p.status === "QUEUED") {
      push({ id: `pc:${p.chainId}:${p.hook}:${p.poolId}`, severity: "LOW", category: "safety", chainId: p.chainId, title: `RevShare proposal queued on pool ${short(p.poolId)}`, detail: `Matures at contract block ${p.effectiveContractBlock} (now ${p.contractBlockNumber}).`, subject: p.hook, provenance: prov, action: null });
    }
  }

  // --- ops balances ---------------------------------------------------------
  for (const b of i.opsBalances) {
    if (b.severity !== "CRITICAL" && b.severity !== "WARN") continue;
    const canceller = b.label === "canceller";
    push({
      id: `ops:${b.chainId}:${b.label}`,
      severity: b.severity === "CRITICAL" ? "CRITICAL" : "MEDIUM",
      category: "safety",
      chainId: b.chainId,
      title: `${b.label} balance below its ${b.severity === "CRITICAL" ? "critical" : "warning"} threshold`,
      detail: `${b.balanceWei} wei affords ${b.actionsAffordable ?? "?"} action(s) at ${b.gasPriceWei ?? "?"} wei/gas (critical below ${b.criticalWei} wei).${canceller ? " The canceller's only power is refusal, and it cannot refuse without gas. Fund it." : ""}`,
      subject: b.address,
      provenance: `ops_balances @ block ${b.readAtBlock}, ${b.readAt}`,
      action: { label: "Safety", page: "safety" },
    });
  }

  // --- feeds ----------------------------------------------------------------
  for (const f of i.feeds) {
    const prov = `feed_observations, ${f.readAt}`;
    if (f.error) push({ id: `feed:${f.chainId}:${f.proxy}:error`, severity: "MEDIUM", category: "safety", chainId: f.chainId, title: `${f.label} feed read failed`, detail: f.error, subject: f.proxy, provenance: prov, action: null });
    else if (f.heartbeatViolation) push({ id: `feed:${f.chainId}:${f.proxy}:stale`, severity: "MEDIUM", category: "safety", chainId: f.chainId, title: `${f.label} feed is stale`, detail: `${f.stalenessSeconds}s since update, heartbeat ${f.heartbeatSeconds}s. USD for tokens priced by it is withheld.`, subject: f.proxy, provenance: prov, action: null });
  }

  // --- stock tokens ---------------------------------------------------------
  for (const t of i.stockTokens) {
    const name = t.symbol ?? short(t.token);
    const prov = `stock_token_observations @ block ${t.readAtBlock}, ${t.readAt}`;
    if (t.tokenPaused === true) {
      push({ id: `stock:${t.chainId}:${t.token}:paused`, severity: "HIGH", category: "safety", chainId: t.chainId, title: `${name} is paused by its issuer`, detail: "tokenPaused() is true: transfers revert, so swaps and liquidity moves in every pool holding it fail until the issuer unpauses.", subject: t.token, provenance: prov, action: null });
    }
    for (const c of t.recentChanges) {
      const what = c.previousUiMultiplier !== c.uiMultiplier ? `uiMultiplier ${c.previousUiMultiplier} -> ${c.uiMultiplier}` : `tokenPaused ${c.previousPaused} -> ${c.tokenPaused}`;
      push({ id: `stock:${t.chainId}:${t.token}:change:${c.readAt}`, severity: "MEDIUM", category: "safety", chainId: t.chainId, title: `${name} issuer state changed`, detail: `${what} (observed ${c.readAt}). A multiplier change rescales what one raw token unit is worth in shares.`, subject: t.token, provenance: prov, action: null });
    }
  }

  // --- reconciliation -------------------------------------------------------
  for (const m of i.reconciliationMismatches) {
    push({ id: `rec:${m.chainId}:${m.kind}:${m.subject}`, severity: "HIGH", category: "revenue", chainId: m.chainId, title: `Reconciliation mismatch: ${m.kind}`, detail: m.detail ?? "log sums disagree with the on-chain counter", subject: m.subject, provenance: `reconciliations @ block ${m.atBlock}`, action: { label: "Revenue", page: "revenue" } });
  }

  if (i.pendingListings > 0) {
    push({ id: "moderation:pending", severity: "INFO", category: "moderation", chainId: null, title: `${i.pendingListings} listing submission(s) awaiting review`, detail: "Submitted through POST /v1/listings. Nothing is public until approved.", subject: null, provenance: "listing_submissions", action: { label: "Moderation", page: "moderation" } });
  }

  // --- treasury conversion ------------------------------------------------
  // INFO only, and only on a route that was actually read and accepted. A balance
  // with no Latch route raises nothing: "no route" is the normal state, not news.
  for (const t of i.treasuryConversions ?? []) {
    if (t.routeStatus !== "route") continue;
    push({
      id: `treasury:${t.chainId}:${t.token}:conversion-available`,
      severity: "INFO",
      category: "revenue",
      chainId: t.chainId,
      title: `Conversion available: ${t.balanceUnits} ${t.symbol} in the Safe`,
      detail: `The Safe holds more ${t.symbol} than its configured alert size (${t.thresholdRaw} raw) and a Latch route to native ETH exists${t.minOutWei ? `, min-out ${t.minOutWei} wei for the full balance` : ""}.${t.blockers.length ? ` Converting the full balance is currently refused: ${t.blockers.join("; ")}.` : ""} Nothing converts unless the Safe owners sign a prepared batch.`,
      subject: t.token,
      provenance: `balanceOf + CLQuoter eth_call @ block ${t.readAtBlock ?? "?"}, ${t.readAt ?? "?"}`,
      action: { label: "Treasury", page: "treasury" },
    });
  }

  const rank = (s: Severity) => SEVERITIES.indexOf(s);
  return out.sort((a, b) => rank(a.severity) - rank(b.severity) || a.title.localeCompare(b.title));
}

export function countBySeverity(alerts: readonly Alert[]): Record<Severity, number> {
  const c = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 } as Record<Severity, number>;
  for (const a of alerts) c[a.severity] += 1;
  return c;
}
