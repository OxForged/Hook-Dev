# Robinhood Chain (4663) — deployed contracts

Every address below was read back from chain after deployment, not copied from a
script's own log. Owners are as of the last verification.

| Contract | Address | Owner |
|---|---|---|
| Create3Factory | `0x6ffdf9a3df7e9dd55bad2e60c7405cd181005633` | deployer (utility, no authority over the protocol) |
| **Vault** | `0x78e8359c6D34Df797b8A793dE8c7c6bffA97fB6c` | **Safe** |
| CLPoolManager | `0xf4A28fA4CFeCAEf349A7D52fA1eB4dF56EB22F66` | CLPoolManagerOwner |
| BinPoolManager | `0x1bB57b3A59b69f128700Ff59cC6EE22835aE6979` | BinPoolManagerOwner |
| CLPoolManagerOwner | `0x5D7111d6c624e9a08aE63d342E4baE5878989a67` | pending → Safe |
| BinPoolManagerOwner | `0x98920e33313257Ffd942f94379A7ced216462665` | pending → Safe |
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
| UniversalRouter | `0x2220dF8ec6CABC7f2074bC1e56DA092B765f736c` | pending → Safe |

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

## Not done

- `robinhood-accept-ownership-2.json` — three accepts still to execute
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
