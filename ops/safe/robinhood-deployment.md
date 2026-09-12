# Robinhood Chain (4663) — deployed contracts

Every address below was read back from chain after deployment, not copied from a
script's own log. Owners are as of the last verification.

| Contract | Address | Owner |
|---|---|---|
| Create3Factory | `0x6ffdf9a3df7e9dd55bad2e60c7405cd181005633` | deployer (utility, no authority over the protocol) |
| **Vault** | `0x78e8359c6D34Df797b8A793dE8c7c6bffA97fB6c` | **Safe** |
| CLPoolManager | `0xf4A28fA4CFeCAEf349A7D52fA1eB4dF56EB22F66` | CLPoolManagerOwner → **Safe** |
| BinPoolManager | `0x1bB57b3A59b69f128700Ff59cC6EE22835aE6979` | BinPoolManagerOwner → **Safe** |
| CLPoolManagerOwner | `0x5D7111d6c624e9a08aE63d342E4baE5878989a67` | **Safe** |
| BinPoolManagerOwner | `0x98920e33313257Ffd942f94379A7ced216462665` | **Safe** |
| CLProtocolFeeController | `0xb1cC5BDBADD19a2430131EaE332afD72fF6be64B` | **Safe** |
| BinProtocolFeeController | `0x320feB54e940741AeB037E3944F2C95afAEE84af` | **Safe** |
| LatchProtocolFeeController | `0x2a03E6E6900b9cF93CcC27e3A75a5a95FB4a154c` | **Safe** (guardian: ops key) |
| LatchRegistry | `0xE4395085De89365440A6Ee25cE24BE2bAD66AC86` | Safe = admin; ops = curator + guardian |
| CustodyTimelock (48h) | `0x63F08A697Cc003d5eA61787712C34438559a7428` | self-administering; Safe = proposer |
| PolicyTimelock (6h) | `0x1Da3AD33AB8151Af9EE91b90fA23fFdDFf9C0C3A` | self-administering; Safe = proposer |
| CLPositionDescriptor | `0x0af03bee134ce66ee12425ee05a50f32c72644eb` | **Safe** |
| CLPositionManager | `0x957cc13b24a563cc92253213d9d5e6954c8db6a7` | — |
| BinPositionManager | `0x990f395003c35a0ab390e10b003972407f882399` | — |
| CLQuoter | `0xdfd14247f87d1e4fc82f0f441fb43bc8aa466114` | — |
| BinQuoter | `0xbee22c7edf206b3f24fa0e86ccdd2f35738eb28c` | — |
| UniversalRouter | `0x2220dF8ec6CABC7f2074bC1e56DA092B765f736c` | **Safe** |

External, not deployed by us — both confirmed by reading code at the address:

| | |
|---|---|
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| WETH9 | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` (canonical, per docs.robinhood.com/chain/contracts) |

## Two CREATE3 gotchas, recorded so nobody repeats them

**The deployed address is not `contractAddress`.** CREATE3 runs through a CREATE2
proxy which then does a CREATE, so a broadcast artifact's `contractAddress` is
the FACTORY the script called. The real address is the `CREATE` entry under
`additionalContracts`. Reading the wrong field once recorded the factory as the
position descriptor.

**`owner()` on a freshly CREATE3-deployed contract looks wrong,** because the
transfer runs as the factory's after-deployment payload and the ephemeral proxy
is the caller. It is harmless: `acceptOwnership` checks `pendingOwner`, not the
current owner, so the Safe can still take it. Do not chase it.

## Ownership is a two-step everywhere

Every ownable here is `Ownable2Step`. `transferOwnership` only NOMINATES — until
the nominee calls `acceptOwnership()`, the previous owner still has full control.
This is why the deployment is not finished when the scripts stop printing.

The Safe holds these as an INTERIM step. Destination:

- **CUSTODY (48h)** `0x63F08A697Cc003d5eA61787712C34438559a7428` — Vault, pool manager owners
- **POLICY (6h)** `0x1Da3AD33AB8151Af9EE91b90fA23fFdDFf9C0C3A` — fee controllers, descriptor, router

The Safe goes first because a timelock can only accept through a queued proposal,
which would have left the mainnet Vault on a single hot key for 48 hours.

## Every contract is Safe-owned

Both accept batches executed. No contract on Robinhood mainnet answers to a hot
key. Verified by reading `owner()` back per address at Safe nonce 3.

### A Safe queue lesson that cost several rounds

Safe executes strictly in NONCE ORDER, and a failed execution does NOT consume
the nonce — `execTransaction` reverts wholesale with GS013 when the inner call
fails and `safeTxGas` is 0. So one un-executable transaction blocks everything
behind it, permanently, and retrying reproduces the identical failure.

Here the blocker was a DUPLICATE of an already-executed batch: `acceptOwnership`
reverts once there is nothing pending. Worse, TWO transactions can share a
nonce, both fully signed, and the UI will let you execute either — so "Execution
failed" was the correct answer to the wrong transaction.

Clearing it needs an ON-CHAIN REJECTION at that exact nonce: a 0-value call from
the Safe to itself, which is a Safe transaction like any other and therefore
needs the full 2-of-3 threshold before it can execute. A rejection created at
the wrong nonce does nothing.

**The only source of truth is `cast call <safe> "nonce()(uint256)"`.** The UI
showing a signed transaction is not evidence that anything happened; that number
moves only on execution.

## Not done

- Two duplicate batches still sit at nonces 3 and 4 and will revert. Harmless to
  the protocol — everything is already transferred — but each will block the
  next real Safe transaction until rejected, and the timelock handover is next.
## Source verification — done, 18/18, via Sourcify

All eighteen contracts are verified. Confirmed independently by querying
`sourcify.dev/server/v2/contract/4663/<address>` for each, not by trusting
forge's own output.

**The explorer route is a dead end and should not be retried.**
`robinhoodchain.blockscout.com` answers HTTP 403 behind a Cloudflare challenge
for every programmatic request, with or without an API key; the cloud proxy
`api.blockscout.com/4663` serves reads fine but its verification endpoint
returns `{"error":"Internal server error"}`.

Sourcify sidesteps both — it is chain-agnostic, lists Robinhood as supported,
and Blockscout pulls verified sources from it. So:

    forge verify-contract <address> <path>:<Contract>       --verifier sourcify --chain-id 4663 --watch

Two things that will bite on a re-run:

- **`packages/periphery` has two compilation profiles** (`default` and
  `clPosm`), and forge refuses to guess: "Ambiguous compilation profiles found
  in cache". `FOUNDRY_PROFILE` does NOT fix it — pass
  `--compilation-profile default` explicitly.
- **There is no `CLProtocolFeeController` or `BinProtocolFeeController`.** One
  `ProtocolFeeController` is deployed twice, so both addresses verify against
  `src/ProtocolFeeController.sol:ProtocolFeeController`. Guessing the split
  names reports a misleading "compiler version mismatch".
- Handover from the Safe to the two timelocks.

---

## Redeploy, 2026-09-12 — six contracts, all Sourcify-verified

These SUPERSEDE the rows above. The originals are retired, not dead, and the
difference matters: a retired `LatchRegistry` still answers `latchCount()` and
renders as a perfectly healthy empty marketplace. That is exactly how the
2026-09-10 rename went unnoticed. Anything still pointing at an address in the
table above is reading a contract that will answer.

| Contract | Address | What changed |
|---|---|---|
| `LatchRegistry` v2 | `0xb2c8BB7473A09b0906f192D69e30D7362fA988CC` | pool attestation — a hook can no longer show the registry one bitmap and core another |
| `LatchTimelock` custody 48h | `0x3aE354e2cdFB9Cb855ABA41c825F6Ee53f28e119` | `CANCELLER_ROLE` on a separate key; `updateDelay` floor re-applied |
| `LatchLaunchRegistry` | `0x6D10B4CeDb53aD50c5A1D83f27fcE9c5C3b15c94` | new — the shared launch index |
| `RevShareHook` | `0xfC00485AFB2f9C73Bd7F9f5e72d14709233E2aD2` | config delay 6 min -> 12 real hours; proposal expiry; roster invariant |
| `LaunchGuardHook` | `0x8b4F6699F1D2E1b368aDFb802D14adf4e474575c` | first deployment; launch window 28 h -> ~30 days |
| `LaunchpadKit` | `0x2a4CA9809C873f9a7eb132cb073710F26D0bBcA7` | first deployment; its constructor rejected this chain's block time until this week |

Retired: `LatchRegistry 0xE4395085…`, `RevShareHook 0x23CE34E8…`,
`LatchTimelock custody 0x63F08A69…`. **The policy timelock is not redeployed at
all** — the tier is gone and everything it held now sits with the Safe directly.

**The LTT1/LTT2 pool stays bound to the OLD RevShareHook, permanently**, because
`poolKey.hooks` is part of the pool id. There is no migration: it keeps every
hazard in CLAUDE.md's "Deployed and unfixable" section, and those operational
rules stay in force for that pool specifically. A pool on the new hook is a new
pool — new key, new id, no liquidity, no history.

### Ownership after the redeploy — NOT finished, and on a clock

Read 2026-09-12 17:42 UTC. The executed handover batch left seven nominations
pointing at the RETIRED timelocks, all still live (`pendingOwner()` = a retired
timelock on Vault, both pool-manager owners, both `ProtocolFeeController`s,
`LatchProtocolFeeController`, `UniversalRouter`), and `CLPositionDescriptor`
is already OWNED by the retired policy timelock. The retired timelocks' queued
accepts are executable by anyone: the four policy ones now, the three custody
ones from **2026-09-13 12:20:54 UTC**. Two Safe batches fix it —
`robinhood-repoint-custody-to-new-timelock.json` first, then
`robinhood-clear-policy-nominations.json` — and the reasoning, the second-step
`execute` calldata and the deadline are all in `README.md` under "Handover, take
two". The pausable role (`hasPausableRole(ops)` is `false` on both wrappers) and
the fee-controller wiring (`protocolFeeController()` is `0x0` on both managers)
are also outstanding and become 48h operations once the custody accept lands.

### Two things this deployment taught

**Two of the three RPCs cannot deploy a large contract.** `rpc.mainnet.chain.robinhood.com`
and `rpc.ordofi.network` cap the gas estimator and return
`-32000: contract creation code storage out of gas` for anything with a big code
deposit — `LatchLaunchRegistry` is 21,159 bytes, so the deposit alone is 4.23M
gas. **`rpc-robinhood.blockmachine.io` handles them.** This is not a funding
problem and reads nothing like one; the first diagnosis was wrong twice.

**`--compilation-profile default` is required** to verify anything in
`packages/launchpad`, exactly as it already was for periphery. Without it
Sourcify submission fails with "Ambiguous compilation profiles found in cache".
