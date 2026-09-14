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

A hooks platform built on the PancakeSwap Infinity architecture, extending what it does.

## Infinity-only, on every chain — decided by the owner, 2026-09-13

> "stay Infinity-only on all chains. we have nothing to do with pancakeswap or uniswap we are
> just enhancing what they have done."

**What this means, concretely:**
- **Latch runs only on its own Infinity-architecture core** — its own Vault, CL and Bin pool
  managers — on every chain, including chains where Uniswap v4 or PancakeSwap are deployed.
- **No integration with third-party AMM deployments.** No hooks, kits, routers, lockers or SDK
  paths targeting Uniswap v4's or PancakeSwap's live PoolManagers, and no routing user trades
  into their pools. A feature that would only work by plugging into their contracts is out of
  scope, however much liquidity sits there.
- **No affiliation, and nothing implying one.** Latch is not a PancakeSwap or Uniswap product,
  partner or deployment. Do not use their names, logos or marks to describe Latch in UI, docs or
  marketing beyond a factual technical lineage statement. On-chain references to their code
  (`IHooks`, `hookDelta`) are ABI names and stay as they are — see the Naming section.

**What this does NOT change — licence and lineage are facts, not affiliation:**
- `packages/core` is a GPL-2.0-or-later derivative of `pancakeswap/infinity-core`, and periphery
  and router derive from theirs. Copyright notices, the GPL licence and attribution in those
  packages MUST stay. "Nothing to do with them" is about deployments and integrations, never a
  reason to strip a header or relicense.
- Uniswap v4-core stays a non-dependency (BUSL-1.1). Never vendor it.

**The old premise is gone.** This project used to be described as "targeting chains where
Uniswap v4 is not deployed". On Robinhood Chain that is false: a Uniswap v4 PoolManager is live
at `0x8366a39C…0951` (Sourcify: `v4-core/src/PoolManager.sol`) and third-party v4 hooks run on it.
Latch competes there on product — plug-and-play DEX and launchpad kits, stock-aware hooks,
immutable and timelocked admin, bounded oracles, no fee-on-transfer tokens — not on being the
only hook-capable AMM on the chain.

## Layout

```
upstream/          Pristine reference clones. Never edit. Used for diffing against upstream.
packages/core/     LatchProtocol core (fork of pancakeswap/infinity-core)
                   git remote `upstream` -> pancakeswap/infinity-core
                   fork base tagged `hookprotocol-fork-base` @ d0e8793
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

## A chain's RPC block number and the EVM's `block.number` can be different clocks

On Arbitrum Nitro/Orbit chains (Robinhood 4663 among them) `block.number` inside the EVM is the
parent chain's block number; `eth_blockNumber` and header `number` are the L2 block. Block
explorers, `cast block-number` and header timestamps measure the WRONG clock for any contract
parameter.

Before writing any block-denominated parameter, or any off-chain comparison against a
contract-stored block number, measure `NUMBER` via `eth_call`:
`cast call --create 0x436000524260205260406000f3 --rpc-url $RPC` returns (NUMBER, TIMESTAMP).
Measure cadence over at least 2 minutes of chain time. Deploy scripts do this themselves
(`ContractClockProbe`) and must keep doing it. Prefer `block.timestamp` for durations in new contracts.

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

**Reality check, 2026-09-13: `packages/periphery/lib/infinity-core` IS initialized in the local
tree** (upstream `891259f`). It is currently harmless — `infinity-core/` still maps to `../core/`,
no periphery source imports `lib/infinity-core`, and the compiler cache holds zero sources from
it — but forge auto-detects remappings from it (`forge-gas-snapshot/`, `erc4626-tests/`, and a
`pancake-create3-factory/` that periphery's deploy scripts only resolve THROUGH it). Two more
traps: a bare `forge build` inside a fork runs `git submodule update --init --recursive` on its
own, and periphery's scripts do not compile from a clean checkout. The fix for the scripts is
`pancake-create3-factory/=lib/pancake-create3-factory/` in periphery's foundry.toml. Verify with
`forge remappings` and the `lib/infinity-core` count in `cache/solidity-files-cache.json`, never
by reading this paragraph.

**CI.** Until 2026-09-13 the Solidity job was `if: false` — nothing ran under either profile. It
is now a 10-package × {default, legacy} matrix that proves the backend three ways per cell
(no `hp-transient` in remappings.txt; effective remappings and `evm_version` match; a generated
test asserting `TransientSlot.IS_EIP1153`) and sets `submodule.<nested>.update none` so forge
cannot pull upstream core. Every cell is green as of periphery `32dcaaa`.

**What turning CI on found — keep the lesson.** `periphery · legacy` failed 53 tests. 41 were gas
ceilings SSTORE exceeds (now per-backend via `test/helpers/BackendGas.sol`; the EIP-1153 ceiling
stays the upstream literal). The other 12 were a REAL divergence the code comments had called
"the stricter/safer direction": `MixedQuoterRecorder` swept per quote call on the storage
backend, so every quote in a `multicall` batch priced against a fresh pool and split routes
reusing a pool were OVER-quoted. `MixedQuoter.multicall` now opens a recorder scope and sweeps
once when the outermost batch returns; default-profile bytecode is byte-identical. Residual,
documented, unfixable without an end-of-transaction hook: two SEPARATE top-level quoter calls in
one transaction share context on Cancun and not on legacy. **A failing legacy test is a claim
about the storage backend until proven otherwise — read it before rewriting it.**

`packages/periphery` (and core, router) are NESTED git repos; CI checks them out from
`origin/fork/<name>` pinned by SHA. A periphery commit reaches CI only after
`git -C packages/periphery push backup main:fork/periphery` AND a `PERIPHERY_REF` bump in
ci.yml. Its tracked `foundry-out-legacy/` (609 build artifacts) churns on every legacy build and
should be untracked — an owner decision, not yet made.

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

## Kit fees: decided by the owner, 2026-09-13

**The principle.** Revenue is enforced by the CONTRACTS Latch deploys on the shared core, never by
SDK code. The SDK is MIT and free; it is the easy path to contracts that charge. A fee written
into the SDK is one deleted line away from zero. A full fork that deploys its own contracts pays
nothing — the GPL permits it — so every fee must stay cheaper than the work of forking.

**Launch shapes: both CL and Bin.** Single-sided CL ranges (the constant-product "bonding curve")
and shaped Bin distributions (linear, exponential, stepped — shapes a V2-style launchpad cannot
express). Tradable on the real pool from the first block: no separate curve contract, no
graduation migration. "Graduation" is a milestone computed from the position, with optional
keeper-run unlocks. No V2 pools, no V3 fork, no fee-on-transfer tax tokens — tax is a hook fee.

**Split model: range + integrator slot.** Every revenue split has three parties — creator,
protocol, integrator (the tenant launchpad's fee wallet). Hard caps are immutable in the
contract; per-launch values are fixed forever at creation; tenants choose anything inside the
bounds, and nobody can go below the protocol floor.

| Fee layer | Enforced by | Latch default | Tenant control |
|---|---|---|---|
| Launch fee | `LaunchpadKit` v2 `createLaunch` | flat, ≈ $1–2 in native, set in wei by the Safe | may add their own launch fee on top |
| Locked-LP fees | `LatchLPLocker` | **min 20%** of LP fees to protocol, forever per lock | creator/integrator split of the rest; may raise protocol share |
| Launch tax (buy/sell hook fee) | Creator Economy hook | **min 10% of the tax** to protocol | rates, expiry, buckets, integrator share |
| Core swap protocol fee | pool manager via fee controller | **0 on kit-created locked pools** (no double-dip); normal DEX pools keep the core fee | none |

Integrator share cap: up to 20% where a split exists. Protocol share cap: 50% (immutable).

**Changing Latch's numbers.** Only inside the immutable caps. The Safe sets current values;
increases take effect after a public notice delay (≈7 days); decreases are immediate (delay never
sits on privilege reduction); nothing is retroactive — a launch's split and tax are frozen at
creation. A USD-denominated launch fee needs an oracle and is out of scope: the Safe sets wei and
re-prices by hand.

**Kit v2 decisions, owner, 2026-09-14 ("yes to all"):**
1. `LaunchpadKit` v2 gains an owner = **Safe**, whose ONLY power is the flat launch fee inside an
   immutable cap (increases behind a public notice delay, decreases immediate, never retroactive).
   v1 had no owner; this is a deliberate change, recorded in the Ownership table.
2. Core protocol fee on kit launch pools: **zeroed per pool by a Safe transaction** on
   `LatchProtocolFeeControllerV2` (`setPoolFee` before a pool exists, `setPoolProtocolFee` after) until a
   V3 controller that asks the kit "is this a locked launch?" is built and installed — a 48 h Custody
   operation. Every kit pool is born dynamic-fee and pays 999 pips unless someone acts: the runbook
   must zero it in the launch session.
3. **CL launches ship locked first** (`LatchLPLocker`, CL only). Bin shaped launches follow once a Bin
   locker exists (Bin shares have no receiver callback; Bin fees compound into reserves) — design in
   `packages/launchpad/docs/kit-v2-integration.md`.
4. The redeployed `LaunchGuardHook` **reserves pool ids for the registered kit**, closing the grief
   where a front-runner claims a predictable launch pool first.
5. `LatchLPLocker.skim` surplus (tokens sent to the locker by mistake) credits the **protocol**.

**Treasury conversion, owner decision 2026-09-14.** Protocol revenue arrives as a basket of pool
tokens; only the kit launch fee is native. It is converted to **native ETH**, and ONLY for tokens on
an owner-approved **allowlist** — launch-token and memecoin revenue is held, never sold, because
selling into thin launch pools moves their price and reads badly for the projects building on
Latch. Conversions route through **Latch pools only** (Infinity-only), so a token with no Latch
route to ETH is simply not convertible yet. Nothing executes automatically: the admin panel builds
a quoted, slippage-bounded, simulated Safe batch that the Safe owners sign. No key anywhere.

**Second revenue line: a hosted API tier.** Indexer, charts, quotes and DexScreener-format token
metadata served from Latch infrastructure, with a rate-limited free tier and paid API keys. Code
can be forked; a maintained, indexed data service cannot be copied in an afternoon.


---

## The product: Latch is infrastructure other people ship on

Stated by the project owner, 2026-09-12, and it governs the architecture from here:

> Developers should be able to launch a DEX and a launchpad from our code with simple
> integration. There should also be a separate DEX and launchpad TEMPLATE they can take to
> market in roughly one click — set the fee wallet, restyle the UI if they want, ship.

This is a white-label play, not a destination app. Everything below follows from it.

### It inverts the fork threat, and the revenue section above is now half wrong

That section says the GPL means "anyone can fork LatchProtocol and redeploy with
`protocolFee = 0`", and treats that as the constraint to design around. Under a white-label
product, **forking is not the threat — forking IS the product.** The question stops being
"how do we stop people redeploying our code" and becomes "how do we stay in the path of the
people we are actively inviting to redeploy it".

Those have different answers, and only one of them is enforceable.

### Two deployment models. Default to the first, and it is not close.

**SHARED CORE (default).** The developer does NOT deploy core. They deploy their own hook,
their own launchpad kit and their own UI, pointed at the `Vault` and pool managers Latch
already has deployed and verified on that chain. Their pools live in our Vault.

- Cheaper and faster for them: no 19-contract deployment, no verification, no audit
  question — they inherit contracts that are already live and already exercised.
- **The protocol fee becomes enforceable.** `protocolFeeController` on a shared pool manager
  is set by Latch governance and a tenant cannot change it. It is capped at
  `MAX_PROTOCOL_FEE = 4000` pips (0.4%) by core, so it cannot become predatory either. This
  is the only revenue lever in the system a tenant cannot simply edit out.
- Liquidity and the registry compound: every tenant's pools are visible in one marketplace.

**FULL FORK.** They deploy everything, owe nothing, and we have no path to revenue. The GPL
permits it and we should say so plainly rather than pretend otherwise. Make it possible and
make it the harder road: it is a legitimate choice for someone who wants sovereignty, and
the people who want it were never going to pay.

### What is actually defensible, ranked honestly

The contracts are GPL and copyable. What is not copyable in an afternoon:

1. **Deployed, verified core on N chains.** Nobody wants to redeploy and re-verify nineteen
   contracts across fifteen chains. This is the moat, and it is made of operational work
   rather than of code.
2. **The registry and marketplace network effect.** A Latch listed in our registry is seen
   by every tenant's UI. A fork starts with an empty registry.
3. **The SDK, the docs and the default config.** Most people ship the default. Uniswap forks
   overwhelmingly keep the original fee switch.
4. **Being the venue.** Latch earns by being where launches happen, not by owning the only
   code that could host one.

A tenant CAN strip the Latch treasury out of a `RevShareHook` roster — it is their pool's
config. Treat roster revenue as a default that most tenants keep, never as an enforced
one, and never build a forecast that assumes otherwise.

### Licensing, which decides what the template can even be

The contracts are GPL-2.0-or-later and derivative contract work stays GPL. That is settled
and not negotiable. But a tenant wanting to go to market needs to know exactly what they
must open-source, and the answer differs by layer:

| Layer | Licence | Why |
|---|---|---|
| Forked core / periphery / router | **GPL-2.0-or-later** | derivative of `infinity-core`. Non-negotiable. |
| Our own hooks | GPL (they import core) | |
| `packages/sdk`, types, interfaces | **MIT, independently authored** | already the rule above: a tenant must never have to import GPL code to build against us. |
| **The UI template** | **MIT** | a frontend talks to contracts through an ABI. That is not linking and does not create a derivative work, so the template can be MIT and a tenant can close-source their fork of it. |

If the UI template ever imports GPL Solidity or generated code derived from it, that
analysis breaks. Keep the template's dependency on the protocol to the MIT SDK and ABIs.

### What the template has to be, concretely

One repository a developer clones or scaffolds, containing: the MIT UI, a single config
file (chain, fee wallet, branding, which features are on), a deploy script that stands up
their hook and launchpad against the shared core, and nothing else. If setting the fee
wallet requires editing Solidity, the product has failed its own brief.

**Design rule that follows: every tenant-configurable value is a constructor argument or a
config entry, never a constant.** A tenant who has to fork a contract to change a fee
address is a tenant who now maintains a Solidity fork, which is the opposite of one click.

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

Five calls the protocol needs somebody to make, and nobody was making: `closeEpoch()`,
`rollover(id)`, `settleBeneficiaries(key, currency)`, `applyPendingConfig(key)`, and
`LatchProtocolFeeControllerV2.sweep(poolManager, currency)` (`src/jobs/fees.ts`). Without them an
epoch never closes, unclaimed funds never roll over, and fees never reach a roster or treasury.

**All five are permissionless, and that is the security model.** The keeper holds no privileged
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

**Use `kind()`, and never fall back.** Both distributors implement `IEpochDistributor.kind()`
(`SnapshotEpochDistributor.sol:246`, `MerkleEpochDistributor.sol:390`), returning
domain-separated constants:

```
snapshot  keccak256("latch.revshare.distributor.snapshot.v1") = 0x6c8c753e…a7c1
merkle    keccak256("latch.revshare.distributor.merkle.v1")   = 0xa4c52bdd…a516
```

All three consumers read it (keeper `jobs/epochs.ts:48`, LatchAI `tools/maintenance.ts`
`readDistributorKind`, web `dapp/lib/revshare.ts` `probeDistributor`). A revert or an
unrecognised value is `unknown` — never a guess, and never the old `token()` /
`challengeDelay()` probe, which is removed everywhere. That probe was also wrong in a way
nobody noticed: a transport timeout on one selector while the other answered read as
`snapshot`. In the web app a TRANSPORT failure now throws (error state) and only a
contract-level revert means `unknown`.

**Consequence to know:** a distributor deployed before `kind()` existed reads `unknown`
everywhere. The only one on chain today — Sepolia `0x5A908Ad96Bd4770B65c8E83a9ede093C1Cb7966c`
— is one of those. It needs a redeployed distributor to be serviceable. There is no
distributor on Robinhood.

**Rollover eligibility:** call `rolloverEligibleAt(id)` for merkle epochs — the only view that
knows which of the two clocks governs, since `cancelRoot` moves one and `getEpoch` does not
record it. `expiresAt` is 0 for a merkle epoch with no root. The keeper and LatchAI both do
this now.

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
  Design assessed 2026-09-13, not implemented: a `_calendarEpoch` counter keyed into the override
  mapping plus an owner-only `resetCalendar(poolId)`, deliberately NOT wiped by `configureMarket`
  (auto-wipe on rotation silently deletes legitimate holidays). ~2.1k gas on the swap path for
  session-enabled pools only. Not patchable in place — a hook address is part of pool identity.
  No RWA hook is deployed on any chain, so no live pool is affected.
- **Slither 0.11.6, all 10 packages at `bce2172` (2026-09-13): no true positives.** Every
  medium/high/critical hit triaged false positive with a concrete reason; Latch's own fork changes
  (Vault hardening, both transient backends, MixedQuoterRecorder) produced none. Slither cannot see
  raw-slot storage, so the lock-exit invariant stays guarded only by `TransientBackendSafety.t.sol`.
  Reports: session scratchpad `slither/`. Three real issues were found by reading code instead:
- **Open, MEDIUM — snapshot dividends can be claimed into unrecoverable addresses.** `LatchVotes`
  auto-delegates to every first receiver, contracts included (the Vault, `RevShareHook` after
  `redeem`, the distributor itself), and `SnapshotEpochDistributor.claim(epochId, account)` is
  callable by anyone for any `account`. `claim(e, Vault)` strands that share forever instead of
  rolling it to real holders; repeatable every epoch for gas. Fix: reject `address(this)`, the
  hook and its Vault as `account`, or require `msg.sender == account`. Not deployed on Robinhood.
- **Open, LOW — a distributor repoint hands the new address the old distributor's uncollected
  pot.** `_writeConfig` overwrites `_distributors[poolId]` and `pullDistributorShare` pays whoever
  is current; unlike `setBeneficiaries`, nothing settles first. A pool owner can propose their
  own address and, after the delay, pull everything accrued since the last close. In BOTH live
  hooks (`0x23CE`, `0xfC00`) but no pool uses a distributor (LTT1/LTT2: `distributorBps = 0`).
  Fix in the timestamp redeploy: refuse while `pendingDistributor` is non-zero, or escrow it.
  Procedural on the live hooks: treat any `ConfigProposed` changing a distributor as an incident.
- **Open, LOW — `CreatorReserve` harvests a rung that is not fully filled** when the launch token
  is currency1: `currentTick <= tickLower` treats the in-range boundary as cleared (`CLPool.sol:117`),
  and `withdraw` pays only quote, so the unsold dust strands. Mirror off-by-one in the constructor
  check. Fix: strict comparisons. Not deployed.
- **Open, LOW — `LatchLaunchRegistry.clearLaunchAttribution` leaves the pool in the launchpad's
  index** (fork campaign 2026-09-14). `launchpadLaunchCount` and `launchesOfLaunchpad` keep
  reporting the cleared launch. On the fork, `setLaunchpadVerification` then verified a launchpad
  whose only attribution a curator had cleared. Fix: remove the pool from the index in the clear
  (swap-and-pop with a position map). Until then, curators must not verify a launchpad on its
  launch count alone.
- **Informational — LTT1/LTT2 is one narrow range.** An exact-in router swap of 100 LTT1 filled
  30.5 without reverting. Once the range is exhausted, the `0x23CE` hook skips its LP-donation leg
  (`LpDonationSkipped`). Any UI must set `amountOutMinimum` from a quote.
- **Environment — all ten anvil dev accounts carry EIP-7702 delegation code on 4663 mainnet**
  (likely a sweeper). Never fund them on a real chain. On a fork, clear their code, or signature
  and ERC-721 receiver tests silently test a smart account.
- **Informational, triaged by design 2026-09-13 — a holiday does not close the previous
  day's overnight tail.** An override on day D governs the session that OPENS on D (the
  module's stated attribution), so on a wrapping schedule D-1's tail still trades into D.
  Comments corrected. Issuer rule: to close all of UTC day D, set the holiday on D AND a
  special session on D-1 ending at 86399; a next-trade-date overnight session's holiday goes
  on the day before. Calendar UIs must render a holiday as "the session opening on D", not
  the calendar day. Guards: `test_DESIGN3_*` in `packages/hooks-rwa/test/SecurityReview.t.sol`.
- **LOW, fixed 2026-09-13 — a pool could be born outside its own price band.** `initialize`
  is permissionless once a key is configured, the birth price was unchecked, and the
  arbitrage that drains the first LP deposit is a converging swap the band permits (measured:
  ~53% of a deposit at a 4x birth). `beforeInitialize` on `MarketHoursHook` and
  `StockPairHook` now requires the birth price strictly inside the band, failing closed
  without a fresh reference, so **publish the reference before initializing**. Residual: a
  front-runner can still choose a birth price anywhere inside the band; seed liquidity with
  price-aware slippage, never slot0-derived bounds via a multicall that swallows the init.
  Guards: `test_FIX4_*` in `packages/hooks-rwa/test/SecurityReview.t.sol`.
- **FIXED 2026-09-13, LOW–MEDIUM** — weekday mask bit 7. `0x80` used to pass validation and produce
  a pool that could never trade while every view reported it healthy. Both mask entry points now
  reject any bit outside `0x7F` with `InvalidWeekdayMask(uint8)`; `0` keeps `EmptyWeekdayMask`.
  Guards: `test_FIX1_*` and a fuzz over every mask.
- **FIXED 2026-09-13, LOW** — `renounceOwnership` now reverts `RenounceDisabled()` on
  `MarketHoursHook`, `PermissionedPoolHook` (and `StockPairHook` through it),
  `ManualPriceBandOracle`, `PythPriceBandAdapter` and `AllowlistComplianceOracle`, matching
  `ChainlinkPriceBandAdapter`. Same selector everywhere. Guards: `test/RenounceDisabled.t.sol`.
- **FIXED 2026-09-13, LOW** — `PythPriceBandAdapter` could not price any pool ratio ≥ 2⁶⁴ (e.g. a
  0-decimal security token above ~18.45 against an 18-decimal stable) and reverted with OZ's
  anonymous `MathOverflowedMulDiv`; core represents up to ~2¹²⁸. Now scale-switched exactly like
  the Chainlink adapter, `RatioUnrepresentable(num, den)` at ≥ 2¹³⁰. The two Sepolia exercise
  instances (`0x6283…8915`, `0xe0aa…00b9`) keep the bug; nothing on Robinhood.
- hooks-rwa passes under BOTH profiles (212/212 each, 2026-09-13), all storage layouts unchanged.


---

## Deployed and unfixable: the calls governance must never make

These contracts are live and immutable on Robinhood Chain (4663). Nothing below can be
patched. Each is a call governance is *able* to make, that no on-chain guard prevents, and
whose consequence cannot be walked back. Every mitigation is procedural — which means it
only works if it is written here rather than remembered.

**Two RevShareHooks are live, and the hazards below split between them** (audited on chain
2026-09-13):

| Address | Record | State |
|---|---|---|
| `0x23CE34E8199927DD270dddd8579c947542bDE446` | retired in `packages/sdk/src/deployments/index.ts:373` | **Still hosts the only pool with liquidity** — LTT1/LTT2, `beneficiaryBps = 8000`, one roster entry, NOT frozen, `poolOwner = 0x304b…c9a9` (the shared-VPS key). Items 3, 4 and 5 apply; its 3,600-block delay is ~12 h and correct (§3b). |
| `0xfC00485AFB2f9C73Bd7F9f5e72d14709233E2aD2` | current, `index.ts:395`; what the dapp reads | Runtime bytecode matches current `src/RevShareHook.sol` byte for byte. Items 3 and 5 are fixed in logic, BUT its delay (~60 days) and proposal TTL (~360 days) were sized for the wrong clock (§3b) - redeploy pending; item 4 is unchanged by design; renounce reverts `RenounceDisabled`. No pools yet. |

Retiring a hook in the address book does not retire its pools. The hazards on `0x23CE` last
as long as LTT1/LTT2 does. The cheapest mitigation is moving that pool's ownership off
`0x304b` (`MovePoolOwnershipToSafe.s.sol` exists; `pendingPoolOwner` read 0 on 2026-09-13).

Regression guards: `packages/hooks-revshare/test/DeployedHazards.t.sol` deploys a fresh hook
from CURRENT source, not either live address. `test_FIXED_*` assert the fixes that shipped in
`0xfC00`; `test_HAZARD_B4_*` asserts item 4. **Nothing in the suite exercises `0x23CE`** — its
hazards rest on the source at git `3c6edc8` and on-chain reads.

### 1. `renounceOwnership()` — live on four contracts with no override

These four have none. (Newer contracts do override it — `LatchProtocolFeeControllerV2:497`,
`MerkleEpochDistributor:365`, `RevShareHook:575` in current source, `ChainlinkPriceBandAdapter:460`.)
OpenZeppelin ships this on the
premise that an owner who can no longer act is safer than one who can. That premise is
inverted on all four.

| Contract | Caller | What it destroys, permanently |
|---|---|---|
| `Vault` | Custody 48h | `registerApp` is the only `onlyOwner` function (`Vault.sol:41`). No new pool manager, no new app, ever. The protocol cannot be extended, only replaced. |
| `CLPoolManagerOwner` / `BinPoolManagerOwner` | Custody 48h | `unpausePoolManager`, `setProtocolFeeController`, `transferPoolManagerOwnership` and the pausable-role grants are all `onlyOwner`. The worst is `transferPoolManagerOwnership`: the manager can never be moved to a replacement wrapper. |
| `RevShareHook` `0x23CE…E446` (retired, hosts LTT1/LTT2) | Safe | Renounce still live there (eth_call from the Safe succeeds); `0xfC00…` reverts `RenounceDisabled`. `setPaused(false)` and `setGuardian` are gone. Pool owners, `claim`, `redeem` and `settleBeneficiaries` are unaffected — no user funds strand — but the global switch is lost in whatever position it was left. |

**Also live, confirmed by the 2026-09-14 fork campaign (`ops/fork-campaign`):**
- `UniversalRouter`, owned by the Safe. Renouncing it while it is paused leaves the router
  unusable forever. This was reproduced on the fork.
- Both upstream `ProtocolFeeController`s.
- `CLPositionDescriptorOffChain`. It uses single-step `Ownable`, so `transferOwnership`
  takes effect immediately with no accept step.
- `Create3Factory`, owned by `0x304b`.

All four are on the same do-not-queue list.

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

**Corrected 2026-09-14 by the fork campaign: this hazard is live on the POLICY timelock
`0x1Da3…0C3A` only.** On the deployed custody timelock `0x3aE3…e119`, `updateDelay(0)` reverts
`DelayBelowTierFloor(0, 0, 172800)` and the delay stays at 48 h. That build overrides it. On
policy, the fork reproduced the whole chain: `updateDelay(0)` executes, a delay-0 operation then
executes in the same block, and only the Safe can cancel it. The paragraphs below describe the
older build that policy still runs.

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

### 3. `RevShareHook` `0x23CE…E446`: `beneficiaryBps > 0`, an empty roster, then `freezeConfig`

**Applies to `0x23CE` only.** Fixed in `0xfC00`: `_validateParams` rejects a beneficiary share
with zero weight (`RevShareHook.sol:881`), `setBeneficiaries` rejects an empty roster under a
live share (`:816`), and `freezeConfig` refuses that state (`:769`). `settleBeneficiaries`
still returns early on zero weight (`:1131`), reachable only once the share is zero.

**Exposed today:** on 2026-09-13 an eth_call of `setBeneficiaries(LTT1/LTT2 key, [])` from the
pool owner `0x304b` succeeded. A stolen shared-VPS key empties the roster and freezes in two
transactions, and every later beneficiary cut on that pool accrues to nobody, forever.

On `0x23CE`, `_validateParams` enforces the distributor invariant and not its beneficiary twin, and
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

### 3b. Robinhood's contract clock is Ethereum's: every block-denominated value was sized for the wrong clock

Robinhood Chain (4663) is Arbitrum Nitro. Inside the EVM, `block.number` is the **Ethereum L1
block number** (~12 s per block), not the L2 block the RPC reports (~0.102 s). Proven against
mined state 2026-09-13: ERC20Votes `0x1eae…8888` checkpointed tx `0x2db9…51c7` (L2 block
62,356,430, header `l1BlockNumber` 25,971,883) at key 25,971,883, and `getPastVotes` at the L2
number reverts `ERC5805FutureLookup`. Arbitrum documents the same behaviour. 3,428 s of headers
advanced `NUMBER` by 283: 12.11 s per contract block.

Consequences, read on chain 2026-09-13 (nothing uses these contracts yet):

| Contract | Value | Meant | Really |
|---|---|---|---|
| `0x23CE` RevShareHook (retired) | `CONFIG_DELAY_BLOCKS` 3,600 | 12 h | **12 h — correct.** The old "six minutes" claim was false. No expiry (item 5 still applies). |
| `0xfC00` RevShareHook | `CONFIG_DELAY_BLOCKS` 432,000 at `blockTimeCentis` 10 | 12 h | **60 days** |
| `0xfC00` | `CONFIG_PROPOSAL_TTL_BLOCKS` 2,592,000 | 3 days | **360 days**: a matured proposal stays armed ~a year |
| `0x8b4F` LaunchGuardHook | `MAX_DECAY_BLOCKS` = `MAX_START_DELAY` = 26,000,000 at 10 | 30 days | **~9.9 years**: the 180-day "no permanent tax" ceiling is void |
| `0x2a4C` LaunchpadKit | `blockTimeCentis` 10 | presets 5 m / 30 m / 2 m | **10 h / 60 h / 4 h**; start delays 120× as typed |

All three have zero pools, launches, proposals and registry listings, so a redeploy migrates
nothing. Until then the UI states the real durations (PresetCurve, ProtocolPool, PoolOwnerActions).

**Rule:** never compare a contract-stored block number (`effectiveBlock`, `expiryBlock`,
`startBlock`, `registeredAtBlock`, votes timepoints) with `eth_blockNumber`. Use
`readContractBlockNumber` from `@latchprotocol/sdk` (keeper: `src/clock.ts`). `eth_getLogs`
ranges and `deployedAtBlock` stay on the L2 number. Against the L2 head, queued proposals read
expired or armed, launches read settled, and the keeper never applied a proposal.

**DECIDED by the owner, 2026-09-13: Option B.** Every duration in Latch contracts moves to
`block.timestamp` — `LaunchGuardHook`, `LaunchpadKit`, `RevShareHook`, and any new contract (the
LP locker and Kit v2 included). No `blockTimeCentis` argument survives, so no chain can be
configured with the wrong clock. The three affected deployments are redeployed from the
timestamp source; off-chain readers keep supporting the retired block-based `0x23CE` for as long
as LTT1/LTT2 lives there. Short windows carry a documented minimum, because the Nitro sequencer
sets timestamps within bounds and could compress a very short window.

**Deploy rule (until the timestamp redeploy):** the three deploy scripts measure `NUMBER` against `TIMESTAMP` on the live chain
(`packages/hooks/script/ContractClock.sol`, ~3 minutes of real waiting) and refuse to broadcast a
`blockTimeCentis` outside 75–105% of the measurement. Robinhood's value is **1200**. The
preferred redesign moves all durations to `block.timestamp` (sequencer-bounded at −24 h/+1 h on
Nitro; `block.number` is equally sequencer-reported and varies by chain), so no block-time
argument exists to get wrong.

### 4. `freezeConfig` is irreversible and cheaper than raising a fee

Applies to both hooks. `proposeConfig` costs `CONFIG_DELAY_BLOCKS` (3600 blocks ≈ 12 h on
`0x23CE`; 432,000 blocks ≈ **60 days** on `0xfC00`, mis-sized for 0.1 s blocks — see §3b) and two transactions. `freezeConfig` is one call,
immediate, and permanently ends `proposeConfig`, `reduceFee`, `disable`,
`setBeneficiaries` and `transferPoolOwnership` for that pool.

That asymmetry is *correct* under this contract's own rule — delay belongs on escalation,
never on reduction, and a freeze only reduces the owner's power. It is recorded because the
consequence is irreversible while the friction is one click, and because on `0x23CE` it is
what turns item 3 from a mistake into a permanent one (`0xfC00`'s freeze refuses that state). **A UI must confirm it the way it confirms a
burn.**

### 5. On `0x23CE…E446` a matured proposal never expires, and `disable` does not clear it

**Applies to `0x23CE` only.** Fixed in `0xfC00`: `reduceFee` and `disable` call `_clearPending`
(`RevShareHook.sol:725,744`), and a proposal applies only inside `[effectiveBlock, expiryBlock]`
(`:685`; `CONFIG_PROPOSAL_TTL_BLOCKS` = 2,592,000 ≈ **360 days** on Robinhood's real ~12 s contract clock, intended 3 days — see §3b). Its `PendingConfig` is 8 words,
the retired one 7 — decode by length. Verified on an anvil fork: `disable` on `0x23CE` left
the proposal armed. (The "stranger applies it days later" replay did not complete — RPC 429.)

On `0x23CE`, `reduceFee` and `disable` write `_configs` and never touch `_pending`; a matured proposal
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
`freezeConfig` clears a proposal. Any surface rendering a `0x23CE` pool's cut MUST read
`getPendingConfig` beside `getConfig` and show an armed matured proposal as armed. On `0xfC00`,
render `expiryBlock` beside `effectiveBlock`. A screen
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

**Tiers, revised 2026-09-12.** `Custody` = the 48h `LatchTimelock`. `Safe` = the governance
multisig directly, no delay. `Ops` = a hot operational key or small ops multisig, deliberately
NOT timelocked.

**There is no longer a Policy tier.** The 6h timelock is not being redeployed, and everything
this table previously assigned to it now sits with the Safe. Two reasons. Reality had already
drifted there — `hasRole(DEFAULT_ADMIN_ROLE, Safe)` reads true on the live registry while the
policy timelock holds nothing at all. And the team is one person: a delay on reversible actions
that custody nothing buys almost no safety and costs real agility. Delay is kept exactly where
an action cannot be undone.

The `POLICY_MIN_DELAY` floor stays in `LatchTimelock` so the tier can return when there is a
team to check. It is a deployment decision, not a code change.

The rule that decides the column: **delay scales with how hard the action is to undo, and delay
never sits on privilege REDUCTION.** Anything whose only power is to make the protocol take less,
pause, or flag danger is an Ops key — a queue on "this Latch is draining people" makes the flag
useless.

### ⚠ VERIFIED LIVE STATE, 2026-09-13 — the custody tier is NOT in force yet

Read on chain (4663), not assumed:

| Contract | Table says | `owner()` on chain | `pendingOwner()` |
|---|---|---|---|
| `Vault` `0x78e8…fB6c` | Custody 48h | **Safe `0x715a…3432` directly** | custody timelock `0x3aE3…e119` |
| `CLPoolManagerOwner` `0x5D71…9a67` | Custody 48h | **Safe directly** | custody timelock |
| `BinPoolManagerOwner` `0x9892…2665` | Custody 48h | **Safe directly** | custody timelock |
| `CLPositionDescriptorOffChain` `0x0af0…44eb` | Safe | policy timelock `0x1Da3…0C3A` | — |

The transfer to the custody timelock was PROPOSED and never ACCEPTED (`Ownable2Step`). So today
`registerApp` — irreversible, permanent fund access — and pause/fee authority over every pool need
only 2-of-3 Safe signatures with **no 48-hour public delay**. This is the exact failure step 4 of
the deployment order warns about: "A transfer that was proposed and never accepted leaves the EOA
in place and looks fine on a block explorer." (Here it left the Safe, not an EOA.)

**The fix is ALREADY QUEUED — do not schedule it again.** Three separate operations, one per
contract, each `acceptOwnership()` (`0x79ba5097`), were scheduled on the custody timelock at
block 61,325,176 with delay 172,800 s, predecessor `0x0`. None is cancelled. **Executable from
2026-09-14 18:40 UTC (unix 1789411243).** The executor is `address(0)`, so once ready ANYONE calls
`execute(target, 0, 0x79ba5097, 0x0, salt)` on `0x3aE3…e119`:

| Target | Operation id | Salt |
|---|---|---|
| Vault `0x78e8…fB6c` | `0xb04e05ca…f33d` | `0xe17bfec589d6a2594c2d59f7a1455e637425f2d5a4cbbcdf9062e39fad16e555` |
| CLPoolManagerOwner `0x5D71…9a67` | `0xab9c8f8e…bf00` | `0xb0ecc7113374d7c91a718f0d7a67a59bbf2efaaaf0f6c3a209b541cb4e3de097` |
| BinPoolManagerOwner `0x9892…2665` | `0x700f7b00…4f6e` | `0x4787d44da9b61fa3107ab9bd0ef45f807be8debdaa46b66a2ae96ceb458a62c1` |

Ids were recomputed with `hashOperation` and match the scheduled ones. Simulated beforehand:
`acceptOwnership()` from the timelock succeeds on all three and reverts
`OwnableUnauthorizedAccount` for anyone else. **After executing, re-read `owner()` on every row —
that read, not the queued operation, is the proof.** (A batch proposed earlier in this file, salt
`0xfdd6…ae74`, was never sent and would now DUPLICATE these — discard it.)

The policy timelock holds only the descriptor and has **no CANCELLER_ROLE** for the canceller
(the custody timelock does). Low impact — the descriptor is cosmetic — but either move the
descriptor to the Safe per the table or grant the role.

**⚠ Grant the Ops pausable role in the same session as executing these.** The fork campaign
executed all three on an anvil fork. They work: `owner()` becomes the custody timelock, and
`registerApp` then needs a full 172,800 s queue. But no `PausableRole` is granted on either
wrapper, so after execution the Safe's direct pause path is gone, `0x304b`'s
`pausePoolManager` reverts `NoPausableRole`, and **pausing either pool manager needs a 48 h
queued operation**. That is a pause that arrives after the incident. The grant is a custody
`onlyOwner` call, so it has to be queued on the timelock. The alternative is for the Safe to
grant it BEFORE anyone executes the three accepts, while the Safe is still the owner. That is
the better order.

**Also found 2026-09-13 (dapp governance audit, confirmed with `cast`):**

- **The policy timelock has one READY operation**: `transferOwnership` (`0xf2fde38b`) targeting
  `CLPositionDescriptorOffChain`. Executor is `address(0)`, so anyone can execute it. Before it
  runs, decode the new owner from its calldata and check it is the Safe. If it names anything
  else, have the proposer cancel it. The policy timelock has no canceller key.
- **`Create3Factory` is owned by the shared-VPS EOA `0x304b…c9a9`**, and it is not in the tables
  below. That makes it a decision nobody took. If that owner can gate or front-run deterministic
  deploys, move it to the Safe. Otherwise, add a row saying why an EOA is acceptable.
- **Dapp reads still start at nodeflare (1 request per 10 s).** Log scans now use their own
  endpoint ordering (`LOG_RANGE_ENDPOINTS` in `packages/sdk/src/chains/endpoints.ts`), but point
  reads do not. Moving the canonical Robinhood RPC first for reads is a pending decision.

### Protocol-level — governance owns these

| Contract | Role | Assign to | Why |
|---|---|---|---|
| `Vault` | `owner` | **Custody** | `registerApp` is irreversible and grants permanent fund access. Highest-value key in the system. |
| `CLPoolManager` / `BinPoolManager` | `owner` | **Custody** | Held via the `*PoolManagerOwner` wrappers. Fee and pause authority over every live pool. |
| `CLPoolManagerOwner` / `BinPoolManagerOwner` | `owner` | **Custody** | The wrapper is the real authority; owning it is owning the manager. |
| `PausableRole.hasPausableRole` | pausable role | **Ops** | Can only pause. A delay here means the pause arrives after the incident. |
| `LatchProtocolFeeController` | `owner` | **Safe** | Fee changes are reversible and occasionally need to answer market conditions. |
| `LatchProtocolFeeController` | guardian | **Ops** | May only disable fees. Can never enable, raise, or reconfigure. Do not add powers to it. |
| `LatchRegistry` | `DEFAULT_ADMIN_ROLE` | **Safe** | Grants/revokes curator and guardian. Escalation, but reversible and custodies nothing. Judgement call, not derived — revisit if the registry ever gates funds. |
| `LatchRegistry` | `CURATOR_ROLE` | **Ops** | Listing throughput. A timelock on curation stalls the marketplace. |
| `LatchRegistry` | `GUARDIAN_ROLE` | **Ops** | Flagging a malicious Latch must be immediate. |
| `ManualPriceBandOracle` | `owner` | **Custody** | The owner is EXEMPT from `maxPublisherDeviationBps` and can move the reference — and therefore the band — arbitrarily. This is a price-manipulation key, not a config key. |
| `ManualPriceBandOracle` | `isPublisher` | **Ops (bounded)** | Bounded per-update by `maxPublisherDeviationBps`. **Set `minPublisherInterval` non-zero on any live deployment** or the bound can be walked over many txs. |
| `PythPriceBandAdapter` | `owner` | **Safe** | `refresh()` is permissionless; the owner only configures. |
| `AllowlistComplianceOracle` | `owner` | **Safe** | Allowlist edits are reversible. |
| `MarketHoursHook` | `owner` | **Safe** | Calendar config is reversible. |
| `PermissionedPoolHook` | `owner` | **Safe** | Reversible. |
| `RevShareHook` (protocol instance) | `owner` | **Safe** | Global pause and guardian appointment only. Cannot reach user funds. |
| `RevShareHook` | guardian | **Ops** | May only pause, never unpause. |
| `MerkleEpochDistributor` | `owner` | **Safe — NEVER Custody** | `postRoot` gates holder claims: `claim` reverts `RootNotPosted` until it lands. On the 48h tier every epoch's payout waits two days behind a governance queue. Posting a root is operational, and `cancelRoot` is its undo. |
| `MerkleEpochDistributor` | guardian | **Ops** | `cancelRoot` during the challenge window only. |
| `CLPositionDescriptorOffChain` | `owner` | **Safe** | Metadata URI. Cosmetic. |
| The `LatchTimelock` | `PROPOSER_ROLE` | **Safe** | The multisig is what makes the delay mean anything. A timelock whose sole proposer is one EOA delays that EOA and stops nobody else. |
| The `LatchTimelock` | `EXECUTOR_ROLE` | **`address(0)`** | Permissionless execution. Once an operation has survived its delay in public, anyone executing it is harmless, and the Safe stops being a liveness dependency. |
| The `LatchTimelock` | `CANCELLER_ROLE` | **A separate cancel-only key** | OpenZeppelin grants CANCELLER to proposers ONLY, so with the Safe as sole proposer a compromised Safe queueing `updateDelay(0)` bought 48h of public visibility with nobody able to cancel — an announcement, not a defence. A dedicated canceller is the ideal key for a solo operator because its only power is refusal: losing it costs nothing and stealing it achieves nothing beyond griefing. Constructor argument, rejects `address(0)`, and asserted after deploy — the original script checked PROPOSER and EXECUTOR and never looked at CANCELLER, which is how the gap survived the first deployment. |
| The `LatchTimelock` | OZ optional admin | **`address(0)`, hardcoded** | Not a constructor parameter, on purpose. An admin can grant roles directly, which is a permanent backdoor around every delay. |

### Contracts with no privileged role, recorded so the absence is a decision

An empty row is as much a decision as a tier, and this table is where it belongs — otherwise
the next person to read these contracts finds no owner, assumes an oversight, and adds one.

| Contract | Role | Assign to | Why |
|---|---|---|---|
| `LaunchGuardHook` | *none exists* | **n/a — do not add one** | Extends `BaseCLHook`; the only access control is `onlyPoolManager` on the callbacks. Its one authority is the per-pool `launchOwner`: first-claim, non-transferable, and powerless from `startBlock` onward. A compromised governance key reaches nothing here. Adding an owner to make it look governed would create the risk it does not currently have. |
| `LaunchpadKit` v2 | `owner` | **Safe** | Launch fee ONLY, inside an immutable cap; increases behind notice, decreases immediate. Owner decision 2026-09-14. v1 (`0x2a4C`) has none. |
| `LaunchLegs` (library linked into `LaunchpadKitV2`) | *none exists* | **n/a — do not add one** | Stateless library that the kit reaches by `DELEGATECALL`. The split exists only because the kit alone was 42.9 KB. Its address is fixed at link time, so deploy and verify it with the kit. The kit trusts it completely. |
| `LaunchpadKitV2` tenant configs | tenant (self-service) | **n/a — not ours** | Any tenant sets its own `setTenantConfig` / `setTenantQuote`. A launch must restate the tenant config exactly, so a tenant cannot re-price a pending launch. Tenant fees are bypassable by a launcher who passes `tenant = 0`. Only the protocol launch fee, the lockers' 20% floor and the zero core fee are enforced. |
| `LatchLPLocker` | *none exists* | **n/a — do not add one** | Immutable split bounds and `protocolRecipient`; no owner, pause or upgrade by design. |
| `LatchBinLPLocker` | *none exists* | **n/a — do not add one** | Same immutable split bounds and `protocolRecipient` as the CL locker. Principal is tracked per bin in bin value (L = P·x + y·2^128) and only growth above it is ever burned as fees; sale proceeds of a bought-through launch bin are principal. No owner, pause or upgrade by design. |
| `LaunchpadKit` v1 (`0x2a4C`) | *none exists* | **n/a — do not add one** | Not `Ownable`, not `AccessControl`. Every constructor argument is immutable; no withdrawal, no pause, no upgrade, and it custodies nothing between transactions. The trade is real and accepted: no admin key also means no recovery, which is why the deploy scripts assert every argument instead of relying on a fix later. Native sent to it directly is unrecoverable. |
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

- **Protocol fees** — `ProtocolFees.collectProtocolFees` is callable only by the installed
  `protocolFeeController`, `LatchProtocolFeeControllerV2` `0x9c2c09EF…54aB` on both managers.
  Two routes: `collect(poolManager, currency, amount, recipient)` is `onlyOwner` (the Safe,
  directly, no delay — there is no Policy tier), and `sweep(poolManager, currency)` is
  PERMISSIONLESS and pays only the stored `treasury` (currently the Safe; `setTreasury` is
  owner-only). The keeper calls `sweep` every 12h.
- **Revenue share** — the treasury is paid by being an entry on a pool's `Beneficiary[]` roster,
  credited to `claimable[recipient][currency]` and withdrawn with `claim`. An entitlement, not an
  admin power, and it needs the pool owner to have put the treasury on the roster.

`RevShareHook.redeem` is neither. It is permissionless plumbing that converts the hook's ERC-6909
vault claims into real tokens; it pays nobody.

### The canceller

```
0xe65F304e40b61d7417154cb3e725C0Ee16701142   EOA · sole CANCELLER_ROLE
```

Verified distinct from the Safe, from all three of its owners, and from the ops key. That
separation is the whole value: a canceller that dies with the Safe cancels nothing.

**Its only power is refusal.** It cannot schedule, cannot execute, cannot move a token. Lose
it and you lose a veto you hope never to use; steal it and you can annoy governance by
cancelling its operations, which moves no funds and makes nothing permanent. That asymmetry
is why it is safe to keep somewhere merely DIFFERENT rather than somewhere maximally secure
— and why it must not live on the shared VPS beside `0x304b…c9a9`, or one box compromise
takes the attack and the defence together.

**Both preconditions were met on 2026-09-12 and verified on chain:** the key holds gas
(~0.0011 native) and its nonce is 1 — it signed a self-transfer, which is the cheapest
possible proof of control and moves nothing. That second one is not ceremony. An address
written down correctly and a key somebody can actually reach are different claims, and only
the second matters at 3am with a compromised Safe forty-eight hours from executing
`updateDelay(0)`.

**⚠ Re-read 2026-09-13: the canceller holds 1,183,834,050,000 wei (≈0.0000012 native), not the
~0.0011 recorded above** — at the observed 78,334,000 wei gas price that buys ~15,000 gas, less
than one `cancel` call plus its L1 data fee. **It cannot cancel anything today.** Fund it.

Keep gas in it. A canceller that cannot pay for a transaction cannot cancel one, and the
moment it is needed is the worst moment to discover an empty balance.

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
neighbour.

**Hosted API + admin, deployed 2026-09-14** in the SAME project `latch`, from a second compose
file: `~/latch/repo` is a sparse checkout (`apps/api`, `apps/admin`, `packages/sdk`) pinned at
`1821e39`; containers `latch-api`, `latch-indexer`, `latch-api-postgres`, `latch-api-redis`;
`latch-api` published on **127.0.0.1:8093 only**. Secrets live in `~/latch/repo/apps/api/.env`
(0600, generated on the host, never printed). Commands: `cd ~/latch/repo/apps/api &&
COMPOSE_IGNORE_ORPHANS=1 docker compose -p latch -f docker-compose.yml <cmd> <service>`. **Never**
`--remove-orphans` and never a bare `down` from either directory — the keeper and the API share the
project from different files, so either would stop the other. Admin is enabled for loopback only
(`ADMIN_ORIGINS=http://localhost:8093`): reach it with `ssh -L 8093:127.0.0.1:8093` and open
`http://localhost:8093/admin`. Public exposure needs a domain and the owner's Caddy change.

Ports 8090-8092 belong to peddlepro; if this stack ever needs one, bind `127.0.0.1` and
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
