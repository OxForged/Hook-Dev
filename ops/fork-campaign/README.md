# Latch fork campaign

Exercises every state-changing function of every deployed Latch contract on Robinhood Chain (4663)
on a local anvil fork. Privileged functions run through impersonated role holders (the Safe,
both timelocks, the canceller, the ops key, pool owners, and the real stock-token holder). Most
functions run three times with different inputs, and privileged functions also get an
unauthorized attempt. Each transaction records its fork tx hash, status, decoded error, gas used,
events and asserted state changes.

**Nothing is broadcast to any real network.** Every JSON-RPC request goes through
`src/guard.mjs`, which refuses to send anything unless four checks pass, in order:

1. The URL host is loopback. This is checked before any network I/O.
2. `web3_clientVersion` reports anvil.
3. `anvil_nodeInfo` reports a fork.
4. `eth_chainId` is 4663.

The only private keys in the code are anvil's public dev keys, and they are only used to sign
EIP-712 permits that are verified on the fork.

## Commands

```sh
cd ops/fork-campaign
npm install                     # viem only
npm test                        # guard tests (no network)

# terminal 1 - the fork (binds 127.0.0.1:8547, cancun hardfork, archive fork source)
node scripts/start-fork.mjs --block 62540000

# terminal 2 - the campaign
node src/run.mjs                              # every phase, ~30 min (mines 432,000 blocks once)
FORK_CAMPAIGN_FAST=1 node src/run.mjs         # skips the 432k-block mine (uses a documented storage rewrite)
node src/run.mjs --only timelock,revshare     # re-run selected phases; setup is reused from its snapshot
node src/merge.mjs                            # rebuild results/results.json from results/phases/*.json
```

Optional helpers:

- `node scripts/explore-state.mjs` does a read-only dump of live owners, roles and pool state as the fork sees them.
- `node scripts/find-stock-roles.mjs` looks for NVDA pause-role holders. Log scans through anvil are slow; see "NVDA pause" below.
- `node scripts/extract-artifacts.mjs <manifest>` re-snapshots artifacts. The snapshots in `artifacts/` are what the campaign uses.
- `forge build` rebuilds the test doubles in `contracts/`.

## Layout

| Path | What |
|---|---|
| `src/guard.mjs`, `test/guard.test.mjs` | The hard localhost/anvil/fork/4663 guard and its tests |
| `src/chain.mjs` | Guarded viem client and anvil cheats: impersonate, fund, snapshot, mine, warp, EVM clock |
| `src/recorder.mjs` | `send()` simulates, mines the tx on the fork (even when it reverts), decodes the outcome and checks it against the expectation |
| `src/phases/*.mjs` | One file per phase; see the table below |
| `src/summary.mjs`, `src/merge.mjs` | Coverage roll-up against each artifact's full write surface |
| `artifacts/` | ABI and bytecode snapshots, each proven byte-exact against on-chain runtime code (immutables masked) by phase `verify` |
| `contracts/CampaignHelpers.sol` | MIT test doubles: throwaway ERC-20, VaultActor (a generic lock holder), MockLaunchpad, BitmapHook, CampaignSubscriber |
| `results/phases/<phase>.json` | Per-phase results, written as each phase finishes (resumable) |
| `results/results.json` | Merged results and coverage summary |

| Phase | Covers |
|---|---|
| `verify` | Runtime code of all 23 contracts vs artifacts |
| `clock` | What block.number and timestamp do on the fork |
| `setup` | Tokens, actors, approvals, base CL and Bin pools |
| `vault` | Vault: lock-gated functions, ERC-6909, apps, ownership |
| `managers` | CL/Bin pool managers and both owner wrappers |
| `periphery` | New CL pool lifecycle, both position managers, quoters, UniversalRouter, Permit2 |
| `ltt` | Swaps on the live LTT1/LTT2 pool |
| `feecontrollers` | V2 collect/sweep and every setter; both upstream ProtocolFeeControllers |
| `revshare` | RevShareHook 0x23CE and 0xfC00: propose/apply/expiry, §3, §5, settle/claim/redeem/pull |
| `launch` | LaunchpadKit presets and §3b windows; LaunchGuardHook |
| `registry`, `launchregistry` | LatchRegistry list/flag/unflag and roles; LatchLaunchRegistry |
| `timelock` | Executes the three queued custody `acceptOwnership` ops; schedule/execute/cancel; §2 |
| `stock` | NVDA-quoted pool and launch; NVDA pause (only if a real pauser is proven) |
| `renounce` | §1 on every contract where renounceOwnership is live |
| `create3` | Create3Factory and CLPositionDescriptorOffChain |
| `views` | One call per view function |

## Fork caveats you must read before trusting a number

- **Clock.** Anvil does not emulate Nitro. On the fork `block.number` is the L2 header number
  (~62.5M) and advances one per mined block. On the real chain it is Ethereum L1's number (~12.1 s).
  Block-denominated windows are therefore reached by mining the exact block count, and real
  durations are reported as blocks × 12.1 s. Timestamp-based contracts (the timelocks) are warped,
  and each class is shown not to respond to the other clock.
- **Hardfork.** The fork runs `--hardfork cancun`. Under anvil's default every mined block writes the
  EIP-2935 history contract through a remote fetch (~8,900 blocks in 9 minutes), which makes the
  432,000-block windows untestable.
- **Fork source.** `rpc.mainnet.chain.robinhood.com` keeps state for only ~5k-20k L2 blocks. A
  fork of it dies mid-run with "metadata is not found". The default source is the archive endpoint
  `rpc.ordofi.network` (also in the SDK's probed list).
- **Dev accounts.** All ten anvil dev accounts carry EIP-7702 delegation code on Robinhood mainnet
  (delegate `0x8a5b10eb…`). The harness clears that code on the fork (`chain.neutralizeDevAccounts`)
  and records what it found. Otherwise every "EOA" would be a smart account.
- **Gas.** Gas is L2 execution gas as anvil measures it. It excludes Arbitrum's L1 data fee.
- **Storage rewrites.** The 0xfC00 proposal TTL (2,592,000 blocks) is not mined. Expiry is tested by
  rewriting the stored `(effectiveBlock, expiryBlock)`, and the stored values are first asserted to
  equal the `ConfigProposed` event. Every rewrite is labelled in the call notes.
- **Isolation.** Each phase starts from the post-setup snapshot, so phases are independent. The tx
  hashes recorded were real on the fork session that produced them and are rolled back afterwards.

## NVDA pause

`Stock.pause()` checks `ACCESS_CONTROLLED_REGISTRY.hasRole(0xe95e22ec…30a2, msg.sender)`, found with
`debug_traceCall` on the fork. The registry is not enumerable, so holders can only come from logs.
The `stock` phase pauses only when `results/stock-roles.json` names an account whose `pause()`
simulation succeeds. Otherwise it records the pause test as not exercised.
