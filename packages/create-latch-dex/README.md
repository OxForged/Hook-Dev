# create-latch-dex

Scaffold a DEX and launchpad front end on LatchProtocol's **shared core**.

```bash
npx create-latch-dex my-dex \
  --chain robinhood \
  --fee-wallet 0xYourTreasury \
  --fee-bps 25 \
  --features both

cd my-dex
npm install
npm run latch:verify     # read every configured address back off chain
npm run dev
```

Run it with no flags and it prompts. Add `--yes` and it never will: every option
has a flag, and anything with no safe default is an error rather than a guess.

---

## What it produces

A Vite + React app, one config file, and two scripts. **No contracts.**

```
my-dex/
  latch.config.ts        chain · fee wallet · branding · feature flags · tokens
  src/
    config/              the config's shape, Latch's address book, validation
    lib/                 chain reads: pools, tokens, launches, fees
    components/          the shell and the four data states
    routes/              Swap · Pools · Launch · Launch wizard · Fees
    theme.ts             config colours -> CSS custom properties
  scripts/
    latch-verify.mjs     turn every configured address into a fact or a failure
    latch-deploy.mjs     resolve and write addresses. Sends no transaction, ever.
```

Everything a tenant changes to go to market is in `latch.config.ts`. Restyling
is a colour edit there — no stylesheet in the template hardcodes a colour.

---

## Shared core, not a full fork

The tenant does **not** deploy `Vault`, `CLPoolManager` or `BinPoolManager`. Their
pools live in the core Latch already has deployed and verified on the chosen
chain.

That is cheaper and faster for them — no nineteen-contract deployment, no
verification, no audit question — and it is the only model in which Latch's
protocol fee is enforceable, because `protocolFeeController` on a shared pool
manager belongs to Latch governance and is capped at `MAX_PROTOCOL_FEE = 4000`
pips (0.4%) by core.

A full fork is permitted by the GPL, owes nothing, and gets no shared registry.
It is supported here only in the sense that `chain.contracts` lets a tenant point
the front end at their own addresses. The generated README says so plainly rather
than pretending the choice does not exist.

### Nothing to deploy, and that is deliberate

`LaunchpadKit` takes every launch parameter as a call argument and holds no
owner, no treasury and no mutable state, so **one instance serves every tenant**:
launches differ by their arguments, not by their bytecode. `LaunchGuardHook`'s
only authority is a per-pool `launchOwner`, and `RevShareHook` is configured
entirely per pool. So `latch:deploy` resolves and verifies rather than deploying,
and `--own-kit` prints a `forge` command for a tenant who wants their own
instance anyway.

**Known gap:** Latch has no shared `LaunchpadKit` or `LaunchGuardHook` deployed
on any chain yet — the mainnet deploy script has only ever been dry-run. So
`chain.launchpadKit` starts `null` and the launch screens render an explicit
"not configured" state. `LaunchpadKit` in the generated README documents both
honest options.

---

## Licensing — the rule this package exists under

**This package and everything it emits are MIT**, and a tenant may close-source
their fork. That holds for exactly one reason: the emitted app reaches the
protocol through the MIT `@latchprotocol/sdk` and through ABIs, never through GPL
Solidity. An ABI call is not linking and does not create a derivative work.

| Layer | Licence |
|---|---|
| This scaffolder and its template | **MIT** |
| `@latchprotocol/sdk`, `/widgets`, `/connect` | MIT, independently authored |
| Latch core, periphery, router, Latch's hooks | **GPL-2.0-or-later** |

> **Never import GPL Solidity, or anything generated from it, into `template/`.**
> Not sources, not build artifacts, not a hex bytecode string.

`test/scaffold.test.ts` enforces this: it greps every emitted source file for an
import reaching into `packages/core`, `packages/periphery`, `packages/router`, a
GPL hook package, or any `.sol` path, and fails the build if it finds one. The
rule is a test, not a paragraph.

The same rule is why `latch:deploy --own-kit` prints a command instead of running
one. Shipping the kit's bytecode would put GPL code inside an MIT distribution.

---

## The template is a real app

Every file under `template/` typechecks and builds exactly as it sits on disk,
against defaults pointing at a chain Latch is deployed on. Substitution replaces
valid values with other valid values, in two shapes:

```ts
name: '__LATCH_APP_NAME__',              // placeholder inside a string literal
id: 4663 /* __LATCH_CHAIN_ID__ */,       // real literal, tagged by a comment
```

The tagged form is what lets the template compile before substitution — and a
template nobody can build is a template nobody reviews. After substitution the
marker comment is gone, and `scaffold()` fails loudly if any marker survives.

---

## Flags

| Flag | Meaning |
|---|---|
| `--chain <name\|id>` | `robinhood` / `4663`, or `sepolia` / `11155111`. Required. |
| `--fee-wallet <address>` | Where the front end's swap fee is paid. Required when `--fee-bps > 0`. |
| `--fee-bps <n>` | Fee in basis points of the swap **output**, `0..100`. Default `0`. |
| `--features <set>` | `dex`, `launchpad`, `both`, or a comma list of `swap,pools,launchpad`. |
| `--name <string>` | Product name. Defaults from the directory name. |
| `--package-manager <pm>` | `npm` / `pnpm` / `yarn` / `bun`. Only changes the printed next steps. |
| `--yes` | Never prompt. |

The fee ceiling of 100 bps mirrors `MAX_INTEGRATOR_FEE_BPS` in
`@latchprotocol/widgets`, which is what actually builds the calldata. If the two
ever disagree, the widget is authoritative.

---

## No invented data

The template inherits the rule the Latch dapp runs under: every figure is read
from chain, and what cannot be read is named rather than filled in. Four visually
distinct states — loading, error, empty, not-configured — live in
`src/components/States.tsx`, and there is no fifth state where a screen shows an
example.

Two consequences worth knowing before extending the template:

- **`@latchprotocol/widgets` exports a `LaunchWidget` that this template does not
  use.** It is bound to a *proposed* token-sale interface that no deployed Latch
  contract implements. The launch screens here are written against the real
  `LAUNCHPAD_KIT_ABI` instead, and they render a fee schedule rather than a sale
  progress bar, because a Latch launch is a pool with a decaying fee and has no
  cap to progress toward.
- **The pool table discloses capability, never safety.** It says what a hook is
  *able* to do, from its permission bitmap. A registry listing is not an audit
  and a bitmap is not a review.
