# latch-lint

Static analysis for AMM hooks.

A hook is a small contract that runs inside somebody else's swap, and the ways it goes wrong are
not the ways ordinary contracts go wrong. Slither will not tell you that your permission bitmap
disagrees with your code, that the fee you return from `beforeSwap` is being silently discarded,
or that the `sender` your per-wallet cap is keyed on is the router rather than the buyer. Every
rule here came from auditing real hooks, not from a generic checklist.

It works on Uniswap v4 hooks too. The rules read the solc AST, and a v4 `Hooks.Permissions` struct
maps onto the same bit offsets as a Latch registration bitmap.

```bash
npx latch-lint src/
npx latch-lint src/MyHook.sol --json          # for CI
npx latch-lint . --fail-on high               # exit 1 only on high and above
npx latch-lint --explain                      # what each rule analyses, and why
```

Exit codes: `0` clean, `1` findings at or above `--fail-on` (default `medium`), `2` the run itself
failed.

## What it catches

| Rule | Severity | What it finds |
| --- | --- | --- |
| LATCH-001 | critical | A callback with no pool-manager guard. Anyone can forge a swap and corrupt the hook's accounting. |
| LATCH-002 | high / medium | `getHooksRegistrationBitmap()` declares a callback the code does not implement, or implements one it never registers. |
| LATCH-003 | high | A `*ReturnsDelta` permission without its base callback (10→6, 11→7, 12→3, 13→5), or a reserved bit 14–15. The pool cannot be initialized. |
| LATCH-004 | high / medium | A fee returned from `beforeSwap` with nothing asserting the pool is dynamic-fee — core discards it silently. Also flags testing the marker with a bitmask instead of exact equality. |
| LATCH-005 | high | Per-wallet caps, allowlists or accounting keyed on `sender`, which is the Vault locker, not the trader. |
| LATCH-006 | medium | A revert on the swap path whose cause is outside the hook's control: unconditional, gated on another contract, or on `tx.origin`. |
| LATCH-007 | medium | A loop in a callback bounded by growable storage or by an argument. The gas is charged to whoever is trading. |
| LATCH-008 | high / medium | A callback returning the wrong selector, or none. Core reverts with `InvalidHookResponse`. |
| LATCH-009 | high | State the callbacks read, writable by any caller from outside the lock. |
| LATCH-010 | high | A callback re-entering the pool manager, or making a low-level call, while the lock is held. |
| LATCH-011 | high | **Bin only.** A hook that prices swaps through `beforeSwap` but omits `beforeMint`. Minting lopsidedly into the active bin is an implicit swap priced from the *stored* LP fee — zero on a dynamic-fee pool — so mint+burn is a free route around the hook's own protection, usable even while `beforeSwap` reverts. This is what a line-for-line port of a CL hook to bin looks like. |
| LATCH-012 | high | **Bin only.** An LP fee above `TEN_PERCENT_FEE` (100 000). Core's bin ceiling is 10%, not the CL 100%, and reverts with `LPFeeTooLarge`. |

## How it analyses

Two inputs are available, and each rule uses the one that can actually answer its question.

**The solc AST** carries structure, control flow and name resolution, and is what almost every rule
reads. Access control is "which modifier really runs here after inheritance and overriding, and what
does its body compare `msg.sender` to" — a name scan would accept `onlyOwner` on `beforeSwap`. The
dynamic-fee assertion is "does a revert-backed check exist on the initialize path" — a control-flow
property. Loop bounds distinguish `i < 8` from `i < holders.length`, a distinction the bytecode has
already lost.

**The compiled ABI** is used in exactly one place, and only in the direction where it is decisive:
a callback declared in the bitmap but absent from the ABI is certainly missing. The converse proves
nothing, because a base hook contributes all ten entry points whether or not the subclass implements
any of them.

The permission bit offsets and the dependency rules are imported from `@latchprotocol/sdk`, not
re-derived here.

### Base-hook delegation

Both `BaseCLHook` and Uniswap's `BaseHook` use the same shape: the external callback the pool manager
calls forwards to an internal `_callback` that subclasses override, and the base's default reverts so
an unimplemented permission fails loudly. Read naively, every subclass "implements" all ten callbacks
and every bitmap looks wrong. The linter resolves the delegation, and resolves it virtually
(most-derived first), which is what lets the bitmap and selector rules run without drowning a real
hook in false positives.

### Getting an AST

Foundry only writes ASTs when asked. If the project was built with `forge build --ast`, latch-lint
reads what is on disk; otherwise it compiles the project itself into a scratch directory under the
OS temp dir, with `--out`, `--build-info-path` and `--cache-path` all pointing there. **A lint run
never writes anything inside your project.** `--no-build` makes the run strictly read-only.

If an incremental build leaves a build-info that covers only some of the files you asked about, the
linter forces one whole-project compilation rather than analysing a subset and calling the rest
clean. Mixing two compilations is not an option: solc node ids are only meaningful within one.

## Trusting the results

A linter that only demonstrates true positives is not credible. This one is tested both ways.

- **True positives.** One deliberately-broken fixture per rule, in `test/fixtures/src/bad/`. Each
  test asserts the fixture's own rule fires *and that no other rule does*.
- **No false positives.** The suite runs the full rule set against this repo's production hooks —
  `BaseCLHook`, `BaseBinHook`, `LaunchGuardHook`, `BinLaunchGuardHook` — and asserts zero findings.
  Those four exercise the shapes most likely to trip a rule: base-class delegation, a fee override,
  a launch gate that deliberately reverts on the swap path, owner-guarded configuration that
  callbacks read, and both pool types. Three correct fixtures (CL, bin and v4) are held to the same
  standard.

```bash
npm run fixtures   # compile the fixture project (needs Foundry)
npm test
```

## Known limits

- **LATCH-006 trades recall for silence.** A revert on the swap path is a launch gate in one hook and
  a denial-of-service bug in the next, and nothing in the code distinguishes them. The rule fires only
  where the reason trading would stop is outside the hook's control. A hook that bricks itself on its
  own state is not reported.
- **LATCH-007 skips loop bounds it cannot classify.** Only infinite, storage-bounded and
  argument-bounded loops are reported; an unresolvable bound is left alone rather than guessed at.
- **No cross-contract analysis.** A hook that delegates its logic to a separately deployed contract
  is analysed only as far as its own source.
- **`--fail-on` thresholds, not confidence.** Every finding carries a confidence level, but the exit
  code is driven by severity alone. Use `--exclude` to drop a rule you have judged inapplicable.
- **Uniswap v4 coverage is partial.** The permission struct and the callback set are understood, and
  the rules that are not Latch-specific run. Latch's bitmap-versus-pool-key check has no v4 analogue,
  since v4 encodes permissions in the hook's address.

## Licence

MIT.
