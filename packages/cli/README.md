# create-latch-hook

Developer tooling for [Latch Protocol](../../README.md): scaffold a hook project
that builds and passes tests on the first try, and run a local node with the
whole protocol already deployed.

Two binaries ship from this package:

| command | what it does |
| ------- | ------------ |
| `npx create-latch-hook <name>` | generate a hook project |
| `latch new \| devnet \| bitmap` | the same scaffolder, plus a devnet and a bitmap tool |

## Why this exists

On Uniswap v4 a hook's permissions are encoded in the *address* of the hook
contract, so shipping one means grinding a CREATE2 salt until the deployed
address happens to carry the right low bits - and changing your mind about a
callback means grinding again.

Latch keeps permissions in the pool key instead: the low 16 bits of
`poolKey.parameters` hold a registration bitmap, and `CLPoolManager.initialize`
cross-checks it against the hook's own `getHooksRegistrationBitmap()`. **A hook
works from any address. There is no salt to mine.**

What replaces salt mining as the first hurdle is keeping those two values in
step. They live in different files, in different languages, and when they drift
`initialize` reverts with `HookConfigValidationError` - the single most common
way a first hook fails. This CLI generates both from one permission set, so
there is no second source for them to drift from, and the generated test fails
the build if they ever stop agreeing.

## Quickstart

You need [Foundry](https://getfoundry.sh) (`forge`, `anvil`) and Node 20+.

```bash
# 1. install the CLI (from a checkout, until it is published)
cd packages/cli
npm install
npm run build
npm link            # puts `latch` and `create-latch-hook` on PATH
```

```bash
# 2. scaffold a hook
create-latch-hook my-hook
cd my-hook
forge test -vv
```

That is the loop. The first `forge test` compiles the protocol and takes about a
minute; after that it is seconds.

```bash
# 3. run a local node with the protocol on it, in another terminal
latch devnet
```

```bash
# 4. deploy the hook you just generated onto it
#    (bash/zsh - the devnet prints the PowerShell form too)
# NOTE: this is anvil's well-known deterministic account #0. It is public, holds no
#       real funds, and exists only for local development. NEVER export a real
#       private key this way - shell history and terminal transcripts persist it.
export PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
export CL_POOL_MANAGER=<address printed by latch devnet>
forge script script/DeployMyHook.s.sol:DeployMyHook --rpc-url http://127.0.0.1:8545 --broadcast
```

The deploy script reads the bitmap back off the deployed contract and prints the
exact `parameters` word your pool key needs, so the value you copy can never be
stale.

### Without installing

```bash
node packages/cli/dist/bin/create-latch-hook.js my-hook
node packages/cli/dist/bin/latch.js devnet
```

### Finding the contracts

Until Latch is published, generated projects and the devnet compile against a
checkout on disk. It is resolved in this order:

1. `--core <path-to-packages/core>`
2. `LATCH_CORE_PATH` in the environment
3. a walk up from the output directory (and then the current directory) looking
   for `packages/core`

Generated `foundry.toml` files get a **relative** path when the project sits near
the checkout, so the project can be committed and moved with it, and an absolute
one only when no sensible relative path exists.

## `create-latch-hook` / `latch new`

```
create-latch-hook <name> [options]
```

Interactive by default; `--yes` makes it non-interactive, and every prompt has a
flag, so it runs in CI unattended.

| flag | meaning |
| ---- | ------- |
| `-t, --template <id>` | `noop`, `dynamic-fee`, `swap-counter` |
| `-p, --permissions <list>` | comma-separated callbacks, or `all` / `none` |
| `--tick-spacing <n>` | tick spacing packed into `parameters` (default 60) |
| `--fee <n\|dynamic>` | static LP fee in hundredths of a bip, or a dynamic-fee pool |
| `--contract <Name>` | Solidity contract name (default: derived from `<name>`) |
| `-d, --dir <path>` | output directory (default `./<name>`) |
| `--core <path>` | where `packages/core` lives |
| `-y, --yes` | accept defaults, never prompt |
| `--force` | write into a non-empty directory |
| `--build` | run `forge build` on the result before reporting success |

### Templates

| id | what you get |
| -- | ------------ |
| `noop` | the smallest hook that builds, deploys and backs a live pool - one `beforeSwap` that does nothing |
| `dynamic-fee` | `beforeSwap` returns a per-swap LP fee, higher above a size threshold, on a dynamic-fee pool |
| `swap-counter` | `afterSwap` keeps an on-chain swap count per `PoolId` |

Templates are starting points, not permission sets. Pick any callbacks you like
with `--permissions`: the generator emits an override for each one, using the
template's body where it has one and a pass-through otherwise. Registering a
callback you have not implemented is not a silent no-op on Latch -
`BaseCLHook`'s default override points `revert HookNotImplemented()` - so the
generator never emits a bitmap wider than the code behind it.

A `*ReturnsDelta` permission cannot stand alone; the base callback it needs is
added for you, with a warning, rather than generating a project that reverts at
pool initialization.

### What gets generated

```
my-hook/
  src/MyHook.sol                 extends BaseCLHook; getHooksRegistrationBitmap() is generated
  test/MyHook.t.sol              Vault + CLPoolManager + router + two mock ERC20s, end to end
  script/DeployMyHook.s.sol      deploys, then prints the parameters word for your pool key
  foundry.toml                   remappings and both build profiles
  latch.json                     machine-readable record of the permission set
  README.md                      quickstart, the invariant, and a security checklist
  .gitignore
```

The generated test suite covers, for every template:

- `test_registrationBitmapMatchesPoolKey` - the hook's bitmap, the pool key's
  bitmap and the generated constant are one number.
- `test_mismatchedBitmapRevertsAtInitialize` - deliberately reproduces
  `HookConfigValidationError`, so the error you are most likely to hit is one you
  have already seen pass by.
- `test_hookWorksFromAnArbitraryAddress` - `vm.etch`es the hook at `0xDEAD`,
  initializes a pool with it and swaps. This is the part v4 cannot do.
- liquidity and swaps in both directions, plus whatever the template adds.

## `latch devnet`

```
latch devnet [options] [-- <extra anvil args>]
```

Starts anvil and deploys:

- **Vault** and **CLPoolManager** / **BinPoolManager**, both registered as Vault apps
- **LatchProtocolFeeController** from `packages/fees`, wired into both managers
- a **Create3Factory**, so addresses are deterministic across restarts
- two freely mintable mock ERC20s (`mint` is public - fund yourself)
- **CLPoolManagerRouter**, the core test router, so pools are usable without
  writing a lock callback by hand
- one initialized, seeded, hookless CL pool

Addresses are printed as a table and also written to
`<workdir>/deployments/devnet.json`.

| flag | meaning |
| ---- | ------- |
| `-p, --port <n>` | anvil port (default 8545) |
| `--host <addr>` | bind address (default 127.0.0.1) |
| `-f, --fork <rpc-url>` | fork a live chain (anvil's `--fork-url`) |
| `--fork-block-number <n>` | pin the fork height |
| `--rpc-url <url>` | deploy to a node that is already running instead of starting anvil |
| `--deployer-key <hex>` | deploying key (default: anvil account 0) |
| `--workdir <path>` | where the devnet project and its build cache live (default `~/.latch/devnet`) |
| `-q, --quiet` | do not stream anvil's log |
| `--json` | deploy, print the addresses as JSON, shut down |

Anything after `--` goes to anvil untouched: `latch devnet -- --block-time 2`.

The deployment is a Foundry script that reuses `packages/core/script`'s CREATE3
and `BackendGuard` machinery rather than a second, divergent deployment path. The
first run compiles the protocol with `via_ir` and takes a couple of minutes; the
build cache lives in the working directory, so later runs start in seconds.

anvil runs a Cancun-capable EVM whatever it forks, so the devnet always uses the
**default** (EIP-1153 / transient storage) build. The `legacy` SSTORE backend is
for pre-Cancun chains only.

## `latch bitmap`

The permission maths on its own - useful when a pool refuses to initialize.

```bash
$ latch bitmap beforeSwap,beforeSwapReturnsDelta

  bitmap     0x0440
  decimal    1088
  binary     0000010001000000
  callbacks  beforeSwap, beforeSwapReturnsDelta

  tick spacing         60
  pool key parameters  0x00000000000000000000000000000000000000000000000000000000003c0440

  In the hook:

    function getHooksRegistrationBitmap() public pure override returns (uint16) {
        return BEFORE_SWAP | BEFORE_SWAP_RETURNS_DELTA;
    }
```

```bash
latch bitmap --decode 0x0080                  # which callbacks is that?
latch bitmap --parameters 0x...003c0080       # unpack a whole parameters word
latch bitmap --list                           # every permission and its bit
```

## Build profiles

Every generated project carries the same two profiles as the rest of the
monorepo, differing only in which transient-storage backend the settlement layer
compiles against:

```bash
forge test                          # default: EIP-1153 (tstore/tload), evm_version = cancun
FOUNDRY_PROFILE=legacy forge test   # legacy:  SSTORE/SLOAD,            evm_version = shanghai
```

The `hp-transient/` remapping is pinned **per profile in `foundry.toml`**, and
generated projects deliberately have no `remappings.txt`: that file silently
overrides per-profile remappings and would build the wrong backend under
`--profile legacy`.

## How this package stays honest

The permission tables here are a copy of numbers that really live in Solidity.
`test/parity.test.ts` reads the Solidity and fails if they drift:

- bit offsets against `packages/core/src/pool-cl/interfaces/ICLHooks.sol`
- constant names and shifts against `packages/hooks/src/base/BaseCLHook.sol`
- bitmap and tick-spacing offsets against `ParametersHelper.sol` and
  `CLPoolParametersHelper.sol`

Encoding, decoding and validation themselves are reused from
[`@latchprotocol/sdk`](../sdk) rather than re-derived.

```bash
npm run typecheck    # tsc --noEmit, strict
npm test             # vitest
npm run build        # tsc + copy the Foundry assets into dist/
```

## Known limitations

- Templates target concentrated-liquidity (`BaseCLHook`) pools. Bin-pool
  scaffolding is not generated yet, though `latch devnet` does deploy
  `BinPoolManager`.
- Latch is not on npm yet, so generated projects reference a checkout on disk
  rather than a `forge install` dependency.
- `latch devnet` assumes anvil's deterministic accounts. If you pass a custom
  `--mnemonic` through `--`, pass the matching `--deployer-key` too.

## Licence

MIT. Generated hooks are yours; they import `BaseCLHook` (GPL-2.0-or-later) from
`packages/hooks`, and building against the MIT-licensed SDK carries no obligation
from the core contracts.
