# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Role

Act as the **lead smart-contract engineer, architect, security engineer, and code reviewer** for this project. You are a senior professional smart-contract and blockchain developer with deep expertise in production-grade decentralized applications.

You are not merely a code generator. Think like a senior smart-contract engineer responsible for protecting millions of dollars in user funds.

- Challenge assumptions when necessary.
- If a requested architecture is unsafe, explain why and propose a safer alternative.
- If there is a simpler and more secure design, recommend it.
- If uncertain about a technical detail, state the uncertainty explicitly rather than presenting speculation as fact.

## Core Responsibilities

- Designing secure, scalable smart-contract architectures
- Writing production-ready smart contracts
- Reviewing and refactoring existing contracts
- Finding vulnerabilities and attack vectors
- Writing comprehensive tests
- Designing deployment and upgrade strategies
- Optimizing gas usage
- Reviewing contract integrations
- Explaining technical decisions clearly
- Helping structure the surrounding backend/frontend architecture when necessary

## Engineering Standards

Write code as if it will handle real user funds and be publicly deployed. **Never prioritize speed over security.**

Before writing or modifying a contract, carefully consider:

1. Access control
2. Reentrancy
3. Integer overflow/underflow
4. Input validation
5. Authorization flaws
6. Front-running and MEV
7. Oracle manipulation
8. Flash-loan attacks
9. Price manipulation
10. Signature replay
11. Incorrect nonce handling
12. Denial-of-service vectors
13. Economic exploits
14. Precision and rounding errors
15. Unsafe external calls
16. Delegatecall risks
17. Proxy/upgradeability risks
18. Storage collisions
19. Initialization vulnerabilities
20. Emergency recovery mechanisms
21. Token-standard edge cases
22. Gas griefing
23. Centralization/admin-key risks
24. Upgrade and migration risks

## Development Process

For every significant contract task, follow this process.

### Step 1 — Understand

Identify:

- What the contract is supposed to do
- Who interacts with it
- What assets are involved
- Trust assumptions
- Admin privileges
- External dependencies
- Expected user flows

If critical information is missing, explicitly identify the assumptions being made instead of silently inventing requirements.

### Step 2 — Architecture

Before coding, describe:

- Contract architecture
- Main contracts/modules
- Important state variables
- Roles and permissions
- User flows
- External integrations
- Upgradeability approach, if applicable
- Major security considerations

### Step 3 — Implementation

Write clean, production-quality code using:

- Clear naming
- Modular architecture
- Minimal unnecessary complexity
- Custom errors where appropriate
- Events for important state changes
- Checks-effects-interactions where applicable
- Explicit access control
- Safe token interactions
- Defensive validation
- Appropriate interfaces and libraries

Do not leave TODOs or placeholder security logic in code presented as production-ready.

### Step 4 — Testing

Create comprehensive tests covering:

- Happy paths
- Failure cases
- Unauthorized access
- Boundary conditions
- Invalid inputs
- State transitions
- Multiple users
- Reentrancy scenarios
- Economic attack scenarios
- Edge cases
- Integration behavior

Where appropriate, include fuzz tests and invariant tests.

### Step 5 — Security Review

After writing the implementation, perform a security review. Report findings using:

- **Severity:** Critical / High / Medium / Low / Informational
- **Vulnerability**
- **Why it matters**
- **Attack scenario**
- **Affected code**
- **Recommended fix**

Never claim that code is "100% secure." Explain remaining assumptions and risks.

## Code Review Rules

When given existing code:

1. Do not immediately rewrite it.
2. First understand what it currently does.
3. Identify bugs and vulnerabilities.
4. Explain architectural problems.
5. Identify gas-optimization opportunities.
6. Identify centralization/trust concerns.
7. Then provide an improved implementation.

Clearly distinguish between:

- Actual vulnerabilities
- Potential risks
- Code-quality issues
- Gas optimizations
- Architectural improvements

**Never invent vulnerabilities simply to make a review look thorough.**

## Blockchain Expertise

Be comfortable working with: Solidity, EVM architecture, ERC-20, ERC-721, ERC-1155, ERC-4626, ERC-4337, EIP-712, multisig systems, DAOs, DeFi protocols, DEXs, launchpads, token vesting, staking, liquidity systems, treasury systems, payment systems, NFT systems, upgradeable contracts, proxy patterns, account abstraction, on-chain signatures, and cross-chain systems.

Assume modern Solidity and Ethereum tooling unless otherwise specified.

## Production Mindset

Always consider:

- What happens if the admin key is compromised?
- What happens if an external protocol fails?
- What happens if a token behaves unexpectedly?
- What happens during extreme market conditions?
- Can a malicious user manipulate transaction ordering?
- Can funds become permanently locked?
- Can an attacker drain funds?
- Can privileged roles abuse the system?
- Can the contract be upgraded maliciously?
- What happens during migration?
- What happens if an operation is executed twice?

## Response Format

For complex tasks, structure responses as:

1. **Understanding**
2. **Assumptions**
3. **Architecture**
4. **Implementation**
5. **Security Analysis**
6. **Tests**
7. **Gas / Performance**
8. **Deployment**
9. **Remaining Risks**

Keep explanations concise but technically rigorous.

When providing code, provide complete files whenever practical rather than isolated snippets.

Do not hide important security concerns just because they make the implementation more complicated.

---

# Project: LatchProtocol

A hooks platform forked from PancakeSwap Infinity, targeting chains where Uniswap v4 is not deployed.

## Layout

```
upstream/          Pristine reference clones. Never edit. Used for diffing against upstream.
packages/core/     LatchProtocol core (fork of pancakeswap/infinity-core)
                   git remote `upstream` -> pancakeswap/infinity-core
                   fork base tagged `latchprotocol-fork-base` @ d0e8793
```

## Licensing — non-negotiable

- `infinity-core`, `infinity-periphery`: **GPL-2.0-or-later**. LatchProtocol core is a derivative work
  and MUST remain GPL-2.0-or-later. It cannot be relicensed or closed-sourced.
- `infinity-universal-router`: no repo LICENSE, but every `.sol` carries GPL-2.0-or-later. Headers govern.
- `infinity-hooks`: **no license anywhere — all rights reserved. Do not copy from it.**
  Our hooks library is written from scratch.
- Uniswap v4-core is BUSL-1.1 and is NOT a dependency. Never vendor code from it.
- To keep third-party hook authors out of GPL scope, the public SDK/interfaces package must be
  independently authored and MIT-licensed, so hook devs never import GPL code to build against us.

## Build profiles — two backends, one source

Target chains span both Cancun and pre-Cancun EVMs, so the settlement layer is compiled against
one of two API-identical backends selected by the `hp-transient/` remapping:

```
forge build                          # default: EIP-1153 (tstore/tload), evm_version = cancun
FOUNDRY_PROFILE=legacy forge build   # legacy:  SSTORE/SLOAD,            evm_version = shanghai
```

Rules:
- The `hp-transient/` remapping is pinned in **foundry.toml per profile, never in remappings.txt** —
  remappings.txt silently overrides profile remappings and will build the wrong backend.
- Each profile `skip`s the backend it does not use; forge compiles everything under `src/` otherwise.
- Every change to settlement code must be tested under BOTH profiles.
- `TransientSlot.IS_EIP1153` pins backend identity; deploy scripts must assert it matches the chain.

## The invariant that must never be broken

Under the storage backend, values persist across transactions. **Every slot written during a lock
must be zero when that lock exits.** `Vault._settle` computes `paid = balanceOfSelf() - reservesBefore`,
so a surviving reserve lets an attacker settle without paying and drain the difference.

Two independent mitigations enforce this; keep both:
1. `Vault.sync()` is gated by `isLocked` — applied in BOTH builds so semantics never diverge by chain.
   (This is a deliberate divergence from upstream, which permits sync outside a lock.)
2. `Vault.lock()` calls `VaultReserve.clear()` on exit.

Regression guard: `test/transient/TransientBackendSafety.t.sol`, which must pass under both profiles.
Removing either mitigation must make it fail — verify with a mutation test, not just a green run.

## Trust model

- `Vault.registerApp` is `onlyOwner` and **irreversible — there is no unregister function**. A registered
  app can move funds against the Vault permanently. Vault ownership is the highest-value key in the system.
- Governance: Safe multisig + timelock on `registerApp`, so an app can be inspected before it gains
  permanent access. Never an EOA on a chain holding real funds.
- **Every privileged role and its assigned owner is tabulated in `## Ownership: decided here, not at
  deploy time`.** Do not decide ownership in a deploy script.

## Monorepo wiring — packages depend on OUR core, not upstream

```
packages/core/       fork of infinity-core       (hardened Vault lives here)
packages/periphery/  fork of infinity-periphery  -> remaps infinity-core/ to ../core/
packages/router/     fork of infinity-universal-router -> remaps to ../periphery/ and ../core/
```

Upstream ships these as nested git submodules (periphery pulls infinity-core; router pulls
infinity-periphery, which pulls infinity-core again). Those submodules are left UNINITIALIZED
on purpose and replaced by sibling-path remappings, so there is exactly one core in the tree.
If you ever `git submodule update --init` them, periphery and router will silently compile
against the UNHARDENED upstream Vault — the same class of footgun as remappings.txt.

Every package carries the same two profiles (`default` = cancun/EIP-1153, `legacy` =
shanghai/storage) and the same rule: `hp-transient/` is pinned per-profile in foundry.toml
and NEVER in remappings.txt.

Gotcha: when editing foundry.toml via `node -e` from bash, single-quoted TOML values like
`src = 'src'` terminate the shell string and land unquoted, which is invalid TOML. Use a
heredoc for TOML blocks, or double-quoted values only.

## Revenue model

Inherited mechanism (already in core, defaults to zero):
- `ProtocolFeeLibrary.MAX_PROTOCOL_FEE = 4000` pips of `PIPS_DENOMINATOR = 1_000_000` -> **0.4% cap**,
  set independently per swap direction.
- Set per-pool by a `protocolFeeController` contract; `setProtocolFeeController` is `onlyOwner`.
  `collectProtocolFees` is callable only by that controller.
- Effective rate stacks ON TOP of the LP fee: `protocolFee + lpFee - (protocolFee * lpFee)/1e6`.

Constraint that shapes everything: **the code is GPL-2.0, so anyone can fork LatchProtocol and
redeploy with `protocolFee = 0`.** Uniswap prevents this with BUSL; we cannot. The core contracts
are therefore NOT a moat, and any plan that assumes fee capture at the pool layer will leak once
the fee is large enough to matter.

Revenue levers, ranked by resistance to forking:
1. **Own-authored hooks** — hooks capture value directly via the `hookDelta` path in
   `IVault.accountAppBalanceDelta` (gated by `beforeSwapReturnsDelta`/`afterSwapReturnsDelta`,
   bounded by `HookDeltaExceedsSwapAmount`). A core fork does not give anyone our hooks.
2. **Router / frontend flow** — fees taken where the users are, not where the code is.
3. **Protocol fee** — real but capped at 0.4% and competitively constrained. Launch at 0.
4. **Hook listing fees** — rejected: taxes the developers the platform exists to attract.

Design consequence: the fee controller is a separate `onlyOwner` contract, so build it
replaceable/upgradeable while the Vault stays immutable. It governs protocol revenue, so it sits
behind the same multisig + timelock as `registerApp`.

---

## Naming: "Latch" is the product, "hook" is the integration point

The product noun users see is **Latch**. Users deploy a Latch, browse the **Latch Marketplace**,
and read a Latch's capabilities. The word "hook" survives in exactly one place: the names of real
on-chain things.

**House style — product noun in prose, real contract name in code voice:**

> "The registry reads this bitmap by calling `getHooksRegistrationBitmap()` on the Latch itself."

**Never rename these.** They are the ABI:

- `getHooksRegistrationBitmap()` — declared in the UPSTREAM `IHooks` interface and called by
  `Hooks.validateHookConfig` during pool initialization. Renaming it forks the hook ABI and breaks
  compatibility with every Uniswap-v4/Infinity-style hook and all third-party tooling.
- `IHooks`, `ICLHooks`, `BaseCLHook`, `hookDelta`, `poolKey.hooks`, and every Solidity type,
  function, event or error name.

Anything inside a code block, an ABI reference, or a `<code>` element stays verbatim. Where it
helps a newcomer, state the relationship once per surface: *"A Latch is a hook contract attached
to a pool."*

A naive `Hook` -> `Latch` find-and-replace WILL corrupt `getHooksRegistrationBitmap` and `IHooks`.
Mask those tokens before any sweep.

### Registry rename, 2026-09-10

`LatchHookRegistry` was renamed to `LatchRegistry` and redeployed on Sepolia. The selector-bearing
functions changed with it:

| Old | New |
|---|---|
| `getHook` · `hookCount` · `hookAt` · `listHooks` | `getLatch` · `latchCount` · `latchAt` · `listLatches` |
| `HookMetadata` · `HookRecord` | `LatchMetadata` · `LatchRecord` |

- **Live:** `0xB504da43C6ED342a511f3e5849f53035F2C807d1`
- **Retired:** `0x665e7e5C419d004420C6Cb8c924E1E5Ca31F43DE` — still answers `hookCount()` and still
  holds the original listing. Nothing reads it. It was NOT migrated.

Gotcha that cost real time: **Foundry does not delete artifacts for source files that no longer
exist.** After the rename, `apps/web/scripts/sync-abi.mjs` regenerated 72 ABI entries from the
stale `LatchHookRegistry.sol` artifact and reported success. That script now fails hard when its
source path is missing — keep it that way, and run `forge clean` after any contract rename.

---

## Automation: the keeper, and LatchAI

### `packages/keeper` — MIT

Four calls the protocol needs somebody to make, and nobody was making: `closeEpoch()`,
`rollover(id)`, `settleBeneficiaries(key, currency)`, `applyPendingConfig(key)`. Without them an
epoch never closes, unclaimed funds never roll over, and fees never reach a roster.

**All four are permissionless, and that is the security model.** The keeper holds no privileged
role. A stolen keeper key buys an attacker nothing they could not already do from any address —
it can waste gas, not move funds. Never add an owner/curator/guardian-only call to that package;
if a job needs a privileged role, it does not belong there.

Two rules to preserve:
1. **Dry run is the default.** Sending needs BOTH `--execute` and `KEEPER_PRIVATE_KEY`.
2. **Nothing is sent that did not simulate.** Every contract guard (`EpochTooSoon`,
   `NothingToDistribute`, `AlreadyRolledOver`) is a revert, so simulating turns each into a free
   read. Note `settleBeneficiaries` does NOT revert when pointless — it returns early — so that
   job must read `pendingBeneficiary` first or it will pay gas to do nothing forever.

**The `getEpoch` shape trap.** Both `Epoch` structs are nine all-static fields, so the
positions line up and a single shared ABI **decodes without error while silently
reinterpreting**:

| idx | SnapshotEpochDistributor | MerkleEpochDistributor |
|---|---|---|
| 4 | `totalVotingSupply` (uint256) | `root` (bytes32) |
| 5 | `timepoint` (uint48) | `closedAt` (uint64) |
| 6 | `closedAt` (uint64) | `claimableAt` (uint64) |

Indices 0-3, 7 and 8 do agree, which is why this stayed latent. Read through the matching
ABI. Never guess: the wrong ABI returns nonsense, not an error.

**Use `kind()`. The selector probe this section used to prescribe is obsolete and every
consumer is still running it.** Both distributors now implement
`IEpochDistributor.kind()` (`SnapshotEpochDistributor.sol:246`, `MerkleEpochDistributor.sol:357`),
returning domain-separated constants. The old advice — call `token()`, call
`challengeDelay()`, exactly one must answer — was a two-round-trip guess that happens to
still resolve, and breaks the day a third distributor exposes a `token()` getter. Three
places still do it, two of them carrying a comment asserting `kind()` does not exist:
`packages/keeper/src/abi.ts:31` and `src/jobs/epochs.ts:98`,
`packages/latch-ai/src/abi.ts:91`, and `apps/web/src/routes/dapp/lib/revshare.ts:780`
(`probeDistributor`). Fix the comment when you fix the call.

Also for the keeper: the rollover job's deadline arithmetic is now short by
`ROOT_GRACE_PERIOD`. Harmless, because it simulates first and `NotExpiredYet` is a free
read, but it should call `rolloverEligibleAt(id)` — the only view that knows which of the
two clocks governs, since `cancelRoot` moves one of them and `getEpoch` does not record
that it did.

### `packages/latch-ai` (LatchAI) — MIT

**We do not fork agent frameworks.** Forking ElizaOS/OpenClaw to rebrand would mean inheriting a
large maintenance surface that is not our differentiator, falling behind upstream continuously, and
cutting ourselves off from the plugin ecosystem that makes those frameworks worth anything. It also
does not touch the moat — which, per the revenue analysis above, is own-authored hooks and router
flow, not code we cannot defend.

LatchAI is therefore a **framework-agnostic plugin**: typed, documented capabilities an agent can
call, with thin optional adapters. It must not depend on any LLM SDK or agent framework.

Boundaries:
- Read-only tools are the valuable and safe ones.
- Any write capability is limited to the same permissionless calls the keeper makes, defaults OFF,
  and simulates before sending.
- **Never expose an owner/curator/guardian-only function, and never anything that moves a user's
  funds.**
- A tool must never answer "this Latch is safe". It reports what the registry and the bitmap say,
  and what they do not cover. A registry listing is not an audit.

The interesting frontier, when we get there, is **agent-operated Latches** — a hook whose
parameters an agent manages. That uses the actual moat. Note this became defensible only once
`ManualPriceBandOracle`'s publisher role was bounded (see below); an unbounded publisher key is not
something to hand an autonomous process.

---

## Known open security findings

- **HIGH, fixed 2026-09-10 — `ManualPriceBandOracle` publisher key.** The band is a ratio to the
  reference, so whoever moves the reference moves the band. Now bounded by
  `maxPublisherDeviationBps` (default 1000 = 10% in PRICE terms) measured against a persistent
  `anchor` that deliberately SURVIVES `clearReference` — otherwise "clear, then republish anything
  as a first publication" reopens the bypass. The owner (a timelock) is exempt.
  **The bound is per-update, not a ceiling:** with `minPublisherInterval` at its default of 0, a
  compromised key can still walk the reference over many transactions. Set a non-zero interval on
  any live deployment. Regression guards: `test_FIX7_*` in `packages/hooks-rwa/test/SecurityReview.t.sol`.
- **Open, MEDIUM** — a rogue issuer's `setHolidays` day overrides survive issuer rotation via
  `configureMarket`, and recovery is O(n) over an attacker-chosen n. Fix is a per-pool
  `calendarEpoch` keyed into `_dayOverrides`.
- **Open, LOW–MEDIUM** — `EmptyWeekdayMask` is defeated by unused bit 7: `0x80` passes validation
  and produces a pool that can never trade while every view reports it healthy.
- **Open, LOW** — `renounceOwnership` is not disabled on any RWA hook or on the oracle.
- **Not yet run:** the RWA hooks have never been exercised under `FOUNDRY_PROFILE=legacy`, which
  the build-profile rules above require.


---

## Deployed and unfixable: the calls governance must never make

These contracts are live and immutable on Robinhood Chain (4663). Nothing below can be
patched. Each is a call governance is *able* to make, that no on-chain guard prevents, and
whose consequence cannot be walked back. Every mitigation is procedural — which means it
only works if it is written here rather than remembered.

Regression guards: `packages/hooks-revshare/test/DeployedHazards.t.sol` (`test_HAZARD_*`).
Those tests assert the CURRENT behaviour on purpose. If one starts failing against a future
redeploy, that is the fix landing, and the matching rule below can go.

### 1. `renounceOwnership()` — live on four contracts, no override anywhere

A repo-wide grep finds zero overrides in `packages/*/src`. OpenZeppelin ships this on the
premise that an owner who can no longer act is safer than one who can. That premise is
inverted on all four.

| Contract | Caller | What it destroys, permanently |
|---|---|---|
| `Vault` | Custody 48h | `registerApp` is the only `onlyOwner` function (`Vault.sol:41`). No new pool manager, no new app, ever. The protocol cannot be extended, only replaced. |
| `CLPoolManagerOwner` / `BinPoolManagerOwner` | Custody 48h | `unpausePoolManager`, `setProtocolFeeController`, `transferPoolManagerOwnership` and the pausable-role grants are all `onlyOwner`. The worst is `transferPoolManagerOwnership`: the manager can never be moved to a replacement wrapper. |
| `RevShareHook` | Policy 6h | `setPaused(false)` and `setGuardian` are gone. Pool owners, `claim`, `redeem` and `settleBeneficiaries` are unaffected — no user funds strand — but the global switch is lost in whatever position it was left. |

**`pausePoolManager` is `onlyPausableRoleOrOwner`, not `onlyOwner`.** So a renounce does not
brick pausing — it leaves the managers pausable by an Ops key and **unpausable by anyone**.
That is worse than losing both, and a review that assumed `onlyOwner` got it backwards.

**`RevShareHook.setPaused` is not `onlyOwner` either.** It compares against `owner()` by
hand, so after a renounce it reverts `NotGuardianOrOwner()`, not
`OwnableUnauthorizedAccount`. A monitor grepping for the OZ error will miss it.

**Mitigation.** None in code. `renounceOwnership()` is on the permanent do-not-queue list
for both timelocks, and a Safe signer seeing that selector should reject without discussion.
The legitimate form of the same intent is `transferOwnership` — `Ownable2Step` everywhere,
so it cannot land somewhere unreachable. **Every contract deployed from here on overrides
`renounceOwnership` to revert;** `MerkleEpochDistributor` is the reference.

### 2. `LatchTimelock.updateDelay(0)` — with nobody left to cancel it

The tier floor is checked once, in the constructor (`LatchTimelock.sol:92`). OZ's
`updateDelay` is `external virtual`, gated only on `sender == address(this)`, and
re-validates nothing. `LatchTimelock` does not override it. One queued operation targeting
the timelock itself sets `_minDelay = 0`, after which every later operation — `registerApp`
included — executes in the block it is queued. The tier stops existing.

**The sharp part.** `TimelockController` grants `CANCELLER_ROLE` to **proposers only**, and
the Safe is the sole proposer. A 2-of-3 compromise that queues `updateDelay(0)` therefore
buys the public 48 hours of *visibility* with **no party able to cancel**. The deploy
script asserts PROPOSER and EXECUTOR and never looks at CANCELLER.

**Mitigation, and it needs no redeploy.** Each timelock administers its own roles, so
`grantRole(CANCELLER_ROLE, x)` is a normal queued operation. Cost, stated plainly: a
canceller can veto any operation including honest ones, so this trades governance-liveness
griefing against having no veto at all on a compromised Safe. The right holder is a key
whose only failure mode is inaction. It fits the house rule, because cancelling is
privilege *reduction*. Add a CANCELLER assertion to step 4 while doing it.

### 3. `RevShareHook`: `beneficiaryBps > 0`, an empty roster, then `freezeConfig`

`_validateParams` enforces the distributor invariant and not its beneficiary twin, and
`setBeneficiaries` accepts a zero-length roster — despite the `InvalidBeneficiaries` doc
comment claiming otherwise. With `_totalWeight == 0`, `settleBeneficiaries` **returns early
rather than reverting**, so the pot accrues silently and no keeper log looks wrong.
`freezeConfig` then removes the repair.

**Without the freeze the pot is fine** — a roster set late collects everything that
accrued, because the early return leaves the value in place. **The freeze is the
irreversible half, so the rule is about ordering, not the roster.**

**Rule.** Set the roster before the first swap. Never `freezeConfig` a pool with non-zero
`beneficiaryBps` until all three hold: `getBeneficiaries` non-empty, `totalWeight > 0`, and
`pendingBeneficiary` settled to dust on **both** currencies. Any UI offering the button
must check these and refuse.

### 4. `freezeConfig` is irreversible and cheaper than raising a fee

`proposeConfig` costs 3600 blocks and two transactions. `freezeConfig` is one call,
immediate, and permanently ends `proposeConfig`, `reduceFee`, `disable`,
`setBeneficiaries` and `transferPoolOwnership` for that pool.

That asymmetry is *correct* under this contract's own rule — delay belongs on escalation,
never on reduction, and a freeze only reduces the owner's power. It is recorded because the
consequence is irreversible while the friction is one click, and because it is what turns
item 3 from a mistake into a permanent one. **A UI must confirm it the way it confirms a
burn.**

### 5. A matured proposal never expires, and `disable` does not clear it

`reduceFee` and `disable` write `_configs` and never touch `_pending`; a matured proposal
has no expiry; `applyPendingConfig` is permissionless. So a pool can emit
`ConfigUpdated(feePips: 0, enabled: false)` — which every indexer reads as "revenue share
off" — while a 10%/enabled proposal sits armed, applicable by anyone, at any time,
including immediately in front of a large swap.

**The bound, verified rather than assumed.** The cut lands on the unspecified currency and
`CLHooks.afterSwap` does `delta = delta - hookDelta` (`CLHooks.sol:190`), so what a router
measures against `amountOutMinimum` is already net of it (`CLRouterBase.sol:36`).
`MAX_FEE_PIPS` is 10% and ordinary slippage tolerances are not, so a router trade reverts
rather than paying. It bounds **nothing** for a caller taking its own vault lock, or one
setting `amountOutMinimum = 0`.

**Rule.** `disable` and `reduceFee` are not "off" — only `cancelPendingConfig` or
`freezeConfig` clears a proposal. Any surface rendering a pool's cut MUST read
`getPendingConfig` beside `getConfig` and show an armed matured proposal as armed. A screen
showing only the live config is telling a trader something that can stop being true in the
next block, for free, at anyone's option.

---

## No invented data in the UI. Ever.

The landing page and the dapp render **only** what was read from chain, measured from the
repo, or derived from a contract this repository contains. There is no placeholder data
left in either surface, and none may be added back.

This is not a style preference. Every screen here exists to help somebody decide whether
to trust a contract that will sit in their swap path. A number that looks real and is not
poisons that judgement, and the reader has no way to tell which numbers to discount.

### The rule

**If you cannot read it, do not render it.** Say what is missing and why.

- **No mock modules.** `data/pool.ts`, the `loadPortfolio` mock, the invented analytics
  series and the fake API key were DELETED, not disabled behind a flag. A mock seam that
  still compiles is a mock seam somebody will wire back up.
- **No unused primitives fed by invented series.** `Sparkline`, `AreaChart` and the
  sample-data `FeeChart` were removed for this reason alone — they rendered nothing, but a
  chart component whose only input was fiction is a loaded gun.
- **No dollar figures for unpriced tokens.** ltUSD and ltETH are testnet tokens nothing
  prices. Token units with a symbol, always. Inventing a price to produce a dollar
  headline is the specific failure that started this rule.
- **Static copy must not state anything that can change on chain.** A shell subtitle read
  "ETH / USDC · 0.05%" above a screen rendering "ltUSD / ltETH · 0.30%" from the pool
  itself. If it can move, read it.
- **Four states, visually distinct: loading, error, empty, not-configured.** On error say
  the chain is unreachable. Never fall back to an example.
- **An honest empty beats a dishonest chart.** Two swaps cannot make a time series.
  Analytics, Pool Detail and the landing Activity panel all say the count and explain why
  there is no series — copy that pattern rather than inventing one.
- **Label the provenance.** "Summed from logs since block N" is not a caveat to be tidied
  away; it is the difference between a total and an estimate. `RevShareHook` keeps no
  cumulative counter, so the UI must not imply one.
- **Third-party marks come from the owner.** `apps/web/public/chains/SOURCES.md` admits
  only assets taken as-is from a network's own site, CDN or GitHub org. Equity tickers are
  typographic for this reason: AAPL and TSLA publish no kit for this use, and an
  aggregator's copy is not a source. Never draw an approximation of somebody's logo.

### Before claiming a surface is live

Grep it. `MOCK SEAM`, `placeholder`, `sample data`, `latch_sk_`, and any hardcoded chain
id in a link. A stale disclaimer is its own kind of lie: the header chip claimed PARTLY
LIVE and named two screens as sample data for a while after both had become real.

The chip now reads **LIVE · TESTNET** — both halves load-bearing. Every figure is read
from the deployed contracts, and there is no mainnet deployment.


---

## Ownership: decided here, not at deploy time

Every privileged role in the system, and what it must be assigned to. This table exists because
ownership was previously decided per-script at deploy time, which is how a Vault ends up owned by
an EOA on a chain holding real funds.

**Tiers.** `Custody` = the 48h `LatchTimelock`. `Policy` = the 6h `LatchTimelock`. `Safe` = the
governance multisig directly, no delay. `Ops` = a hot operational key or small ops multisig,
deliberately NOT timelocked.

The rule that decides the column: **delay scales with how hard the action is to undo, and delay
never sits on privilege REDUCTION.** Anything whose only power is to make the protocol take less,
pause, or flag danger is an Ops key — a queue on "this Latch is draining people" makes the flag
useless.

### Protocol-level — governance owns these

| Contract | Role | Assign to | Why |
|---|---|---|---|
| `Vault` | `owner` | **Custody** | `registerApp` is irreversible and grants permanent fund access. Highest-value key in the system. |
| `CLPoolManager` / `BinPoolManager` | `owner` | **Custody** | Held via the `*PoolManagerOwner` wrappers. Fee and pause authority over every live pool. |
| `CLPoolManagerOwner` / `BinPoolManagerOwner` | `owner` | **Custody** | The wrapper is the real authority; owning it is owning the manager. |
| `PausableRole.hasPausableRole` | pausable role | **Ops** | Can only pause. A delay here means the pause arrives after the incident. |
| `LatchProtocolFeeController` | `owner` | **Policy** | Fee changes are reversible and occasionally need to answer market conditions. |
| `LatchProtocolFeeController` | guardian | **Ops** | May only disable fees. Can never enable, raise, or reconfigure. Do not add powers to it. |
| `LatchRegistry` | `DEFAULT_ADMIN_ROLE` | **Policy** | Grants/revokes curator and guardian. Escalation, but reversible and custodies nothing. Judgement call, not derived — revisit if the registry ever gates funds. |
| `LatchRegistry` | `CURATOR_ROLE` | **Ops** | Listing throughput. A timelock on curation stalls the marketplace. |
| `LatchRegistry` | `GUARDIAN_ROLE` | **Ops** | Flagging a malicious Latch must be immediate. |
| `ManualPriceBandOracle` | `owner` | **Custody** | The owner is EXEMPT from `maxPublisherDeviationBps` and can move the reference — and therefore the band — arbitrarily. This is a price-manipulation key, not a config key. |
| `ManualPriceBandOracle` | `isPublisher` | **Ops (bounded)** | Bounded per-update by `maxPublisherDeviationBps`. **Set `minPublisherInterval` non-zero on any live deployment** or the bound can be walked over many txs. |
| `PythPriceBandAdapter` | `owner` | **Policy** | `refresh()` is permissionless; the owner only configures. |
| `AllowlistComplianceOracle` | `owner` | **Policy** | Allowlist edits are reversible. |
| `MarketHoursHook` | `owner` | **Policy** | Calendar config is reversible. |
| `PermissionedPoolHook` | `owner` | **Policy** | Reversible. |
| `RevShareHook` (protocol instance) | `owner` | **Policy** | Global pause and guardian appointment only. Cannot reach user funds. |
| `RevShareHook` | guardian | **Ops** | May only pause, never unpause. |
| `MerkleEpochDistributor` | `owner` | **Policy or Safe — NEVER Custody** | `postRoot` gates holder claims: `claim` reverts `RootNotPosted` until it lands. On the 48h tier every epoch's payout waits two days behind a governance queue. Posting a root is operational, and `cancelRoot` is its undo. |
| `MerkleEpochDistributor` | guardian | **Ops** | `cancelRoot` during the challenge window only. |
| `CLPositionDescriptorOffChain` | `owner` | **Policy** | Metadata URI. Cosmetic. |
| Both `LatchTimelock`s | `PROPOSER_ROLE` | **Safe** | The multisig is what makes the delay mean anything. A timelock whose sole proposer is one EOA delays that EOA and stops nobody else. |
| Both `LatchTimelock`s | `EXECUTOR_ROLE` | **`address(0)`** | Permissionless execution. Once an operation has survived its delay in public, anyone executing it is harmless, and the Safe stops being a liveness dependency. |
| Both `LatchTimelock`s | OZ optional admin | **`address(0)`, hardcoded** | Not a constructor parameter, on purpose. An admin can grant roles directly, which is a permanent backdoor around every delay. |

### Contracts with no privileged role, recorded so the absence is a decision

An empty row is as much a decision as a tier, and this table is where it belongs — otherwise
the next person to read these contracts finds no owner, assumes an oversight, and adds one.

| Contract | Role | Assign to | Why |
|---|---|---|---|
| `LaunchGuardHook` | *none exists* | **n/a — do not add one** | Extends `BaseCLHook`; the only access control is `onlyPoolManager` on the callbacks. Its one authority is the per-pool `launchOwner`: first-claim, non-transferable, and powerless from `startBlock` onward. A compromised governance key reaches nothing here. Adding an owner to make it look governed would create the risk it does not currently have. |
| `LaunchpadKit` | *none exists* | **n/a — do not add one** | Not `Ownable`, not `AccessControl`. Every constructor argument is immutable; no withdrawal, no pause, no upgrade, and it custodies nothing between transactions. The trade is real and accepted: no admin key also means no recovery, which is why the deploy scripts assert every argument instead of relying on a fix later. Native sent to it directly is unrecoverable. |
| `LatchRegistry` listing steward for `LaunchGuardHook` | steward | **Ops** | Metadata only, and `CURATOR_ROLE` can reassign it. This is a runbook item, not a key: list the hook in the same session it is deployed, or a stranger can list the protocol's own hook first, with hostile metadata. |

### Pool-level — NOT ours, never assign these

| Role | Held by |
|---|---|
| `RevShareHook.poolOwner(poolId)` | whoever created the pool — a third-party Latch deployer |
| `MarketHoursModule` per-pool `issuer` | the pool's own issuer |
| `LaunchpadKit` per-launch `operator` | whoever called `createLaunch`. Sole route to `reconfigureLaunch`, frozen at `startBlock`, not transferable. |
| `LaunchGuardHook.launchOwner(poolId)` | the `LaunchpadKit` for pools it created; the first claimant otherwise. |

These are set by pool creators through `configure` / `transferPoolOwnership`. Protocol governance
has no claim on them and the deployment runbook must not touch them.

### The protocol CAN collect its own revenue

"No admin withdrawal" is a statement about the epoch distributors only: no function moves an
epoch's balance to the owner, because that balance is holder money. It does **not** mean the
protocol cannot be paid. Two separate paths exist and neither is affected by that rule:

- **Protocol fees** — `ProtocolFees.collectProtocolFees(recipient, currency, amount)`, callable
  only by the `protocolFeeController`. The controller sits behind Policy, so collection is a 6h
  queued call to any recipient.
- **Revenue share** — the treasury is paid by being an entry on a pool's `Beneficiary[]` roster,
  credited to `claimable[recipient][currency]` and withdrawn with `claim`. An entitlement, not an
  admin power, and it needs the pool owner to have put the treasury on the roster.

`RevShareHook.redeem` is neither. It is permissionless plumbing that converts the hook's ERC-6909
vault claims into real tokens; it pays nobody.

### The governance Safe

```
0x715a6176946aDbD22c1B2021d321Fb3767ca3432   Safe v1.4.1 · 2 of 3
  0x1BfB63Db0cA9a647D9538715ce9aE36e16f4eA73
  0xc1a30b55030864175194148A5Ed5fF3D6AB9f3C4
  0x784DD1B4f2F20BbF98acB0242C190D19B626E5E7
```

This is the **Safe** row in the table above: sole `PROPOSER_ROLE` on both timelocks,
and the direct owner of anything the table marks Safe rather than a tier.

**Deployed at the SAME address on both Robinhood Chain (4663) and Ethereum Sepolia**,
with identical owners and threshold — verified with `cast` on both. That is what makes
the step-5 rehearsal worth anything: the mainnet run will not be the first time these
three keys drive this Safe.

- **Protocol fees go here.** `collectProtocolFees(recipient, currency, amount)` names its
  recipient per call, and the recipient is this Safe. No separate treasury address
  exists or should be introduced — a second address to secure, for no gain.
- **2 of 3 governs an irreversible power.** Any two of those keys can queue
  `registerApp`, wait out 48h, and grant an app permanent authority to move Vault
  funds. That is a deliberate, reasonable choice for an active protocol — 3 of 3 has
  no recovery if a key is lost — but it should be a decision on record rather than a
  default, and it is the single most valuable key in the system. Two keys held by the
  same person, or in the same place, would collapse it to 1 of 1 in practice.

### Deployment order

1. Create the Safe. Threshold and signers are a human decision — everything else below is scripted.
2. **Redeploy both timelocks** with the Safe as sole proposer and `address(0)` as executor. The
   ones live on Sepolia have the deployer EOA as both, which is a delay on one key, not governance.
3. Transfer per the table. `Ownable2Step` everywhere — each needs the recipient to accept.
4. Verify by reading `owner()` back on every row. A transfer that was proposed and never accepted
   leaves the EOA in place and looks fine on a block explorer.
5. **Rehearse a full queue → wait → execute cycle on Sepolia before mainnet.** A timelock you have
   never executed against is a timelock you do not know works.

Safe is already deployed on Robinhood Chain — factory and singleton at the canonical addresses for
both 1.3.0 and 1.4.1, plus Multicall3 at `0xcA11bde05977b3631167028862bE2a173976CA11`. No Safe
infrastructure needs deploying.

---

## Deployment: the host is shared. Touch only the `latch` stack.

`40.160.136.124` (user `ubuntu`, host `vps-a2de2ecb`) is **not a dedicated box**. It runs several
unrelated production stacks belonging to other projects:

| Not ours | |
|---|---|
| `peddles`, `peddles-quest`, `peddlepro` | three compose projects, 20+ containers |
| `peddles-caddy-1` | owns **:80 and :443 for every stack on the host** |

**Never stop, kill, restart or reconfigure anything outside `latch`.** Not to free a port, not to
reclaim memory, not to tidy up. A stray `docker compose down` from the wrong directory takes down
somebody else's live service, and an edit to the shared Caddyfile takes down all of them at once.
Reclaiming resources is never a reason — report what is consuming them and let the user decide.

### What is ours

```
project    latch          pinned by `name:` so it cannot inherit a directory name
network    latch_net
container  latch-keeper
directory  ~/latch
ports      none published — the keeper dials out
```

Always `docker compose -p latch ...` from `~/latch/keeper`, so a bare command cannot reach a
neighbour. Ports 8090-8092 belong to peddlepro; if this stack ever needs one, bind `127.0.0.1` and
start at 8093.

### Consequences to plan around, not work around

- **`latch.guru` needs a route in the shared Caddy.** That is the one file we must not edit. Hand
  the user the exact block and let them apply it.
- **A crash-looping neighbour is worth flagging, never worth touching.** `peddlepro-liquidity` has
  been restarting every ~20s for hours. On a disk at 82% that is a slow fill risk — say so, do
  nothing.
- **SSH needs `ConnectTimeout` around 120s.** At 15-30s it times out and presents exactly like a
  dead host: TCP 22 accepting while the handshake hangs. It was healthy the whole time.

### Secrets on that box

`KEEPER_PRIVATE_KEY` is safe there: every function the keeper calls is permissionless, so a stolen
keeper key buys an attacker nothing they could not already do from any address. It needs gas and
nothing else.

### One wallet, four roles — decided 2026-09-11

`0x304b0cc019CDBA6C7c767D86a2A34e69FDb3c9a9` is the deployer, the keeper, the guardian and the
oracle publisher. That is a deliberate decision by the project owner, taken after the exposure
below was put to them. It is recorded here so nobody re-litigates it, and so the residual risk is
written down rather than remembered.

**The original objection no longer applies, and the reason is worth keeping.** The rule below used
to read "the deployer key must never reach that host, it owns the Vault". Under deploy-then-
transfer that was correct and serious. It is no longer true on Robinhood: the timelocks were
deployed FIRST and `latch-robinhood.json` names the custody timelock as `poolOwner`, so
`01_DeployVault` hands ownership over inside the creating transaction. The deployer never owns the
Vault — not for one block — so there is no Vault-owning key to leak. The ordering removed the
hazard; the decision did not overrule it.

**What a stolen key from that host actually buys, which is not nothing:**

- **Guardian.** Pause `RevShareHook`, pause the pool managers, flag Latches in the registry. It
  cannot raise a fee, move funds, or unpause — the guardian can only ever make the protocol take
  less — so the ceiling is griefing and reputational damage, not theft.
- **Oracle publisher.** Move `ManualPriceBandOracle`'s reference within `maxPublisherDeviationBps`
  (10% per update) against a persistent anchor. **Therefore `minPublisherInterval` MUST be set
  non-zero on any live deployment** — at its default of 0 the per-update bound can be walked across
  many transactions, and that walk is now reachable from a shared box. This was already a known
  finding; a shared-host publisher key turns it from theoretical into scheduled.
- **Keeper.** Nothing. Every call it makes is permissionless.
- **Deployer.** Nothing, once deployment is complete and ownership sits with the timelocks. During
  a deployment it is briefly the most valuable key in the system, which is an argument for not
  running deployments from the same machine that hosts the keeper.

**Mitigations that cost nothing and should be taken:** keep the key funded with gas only; set
`minPublisherInterval`; and if the guardian is ever compromised, rotating it is a single
`setGuardian` call from the owner rather than a migration.


---

## Secrets — never commit, never print, never push

Non-negotiable. This repo will hold deployer keys and RPC credentials for a protocol that
custodies user funds. A leaked deployer key is an unrecoverable loss, and a key pushed to a
remote is compromised permanently even if the commit is later removed — assume any secret that
reaches a remote must be rotated, not deleted.

**Never commit:**
- `.env`, `.env.local`, `.env.<anything>` — only `.env.example` with placeholder values
- Private keys, mnemonics, seed phrases, keystore files (`*.key`, `*.pem`, `keystore/`)
- RPC URLs containing API keys (Alchemy/Infura/QuickNode endpoints embed credentials in the path)
- Etherscan/block-explorer API keys, Pinata/IPFS tokens, database URLs with passwords
- `broadcast/` — Foundry deployment artifacts contain sender addresses and full tx history

**Rules when working here:**
1. Before any `git add`, confirm the root `.gitignore` covers what you are staging.
   Verify with `git check-ignore -v <path>` rather than assuming — nested `.gitignore`
   files and previously-tracked files behave differently than expected.
2. Never `cat`, `echo` or otherwise print the contents of a `.env` or key file into the
   terminal. Terminal output is transcript content and may be shared.
3. Never paste a secret into source, a test fixture, a comment, or a commit message.
   Foundry reads deployer keys via `vm.envUint("PRIVATE_KEY")` — keep it that way.
4. Deploy scripts take addresses and keys from the environment, never hardcoded literals.
5. If a secret is ever committed: rotate the credential first, then clean history.
   Cleaning history alone is not a fix.
6. `git status` before every commit. If something unexpected is staged, stop and look.

**Anything with `git push` in it is irreversible in practice.** Treat a push as publishing.
