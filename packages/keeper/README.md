# @latchprotocol/keeper

The protocol has four maintenance calls that **somebody** has to make. Nobody currently does.

| Call | What happens if nobody makes it |
|---|---|
| `closeEpoch()` | Revenue accrues in the distributor and no epoch ever closes. Nobody can claim anything. |
| `rollover(epochId)` | An expired epoch's unclaimed funds sit stranded instead of returning to the next epoch. |
| `settleBeneficiaries(key, currency)` | Fees accrue against the pool but never reach the beneficiary roster. |
| `applyPendingConfig(key)` | A config change waits out its delay and then never takes effect. |

All four are **permissionless** — any address may call them. That is a deliberate design property: it means the protocol cannot be stalled by an owner who proposed something and walked away. It also means this keeper needs no privileged role at all.

## What a stolen keeper key buys an attacker

**Nothing they could not already do from any address.**

Every function in `src/abi.ts` is permissionless on chain. There is no owner-only, curator-only or guardian-only call in this process, and none should ever be added — if a future job needs a privileged role, it does not belong in this package. The keeper key should be a dedicated address holding only gas.

Concretely: an attacker with the key can close an epoch slightly earlier than you would have, or waste your gas. They cannot move funds to themselves, change a fee, alter a roster, or touch a listing.

## Running it

```bash
npm install && npm run build

# Report only. Safe anywhere, needs no key.
node dist/index.js --config keeper.config.json --once

# Actually send. Requires BOTH the flag and the key.
KEEPER_PRIVATE_KEY=0x... node dist/index.js --config keeper.config.json --execute
```

Two independent conditions gate sending: `--execute` **and** `KEEPER_PRIVATE_KEY`. Either alone produces a dry run. This is belt-and-braces on purpose — the likeliest operational mistake is running the wrong command in the wrong place.

Flags: `--config <path>` (default `keeper.config.json`), `--once`, `--execute`, `--interval <seconds>` (default 300, minimum 15).

## Configuration

Copy `keeper.config.example.json` to `keeper.config.json` and fill in real addresses. The example ships with zero addresses deliberately so a copy-paste run fails loudly instead of pointing at something unintended.

The config is validated strictly at startup — a malformed address stops the process with a clear message rather than surfacing hours later as a transaction sent somewhere unexpected.

`keeper.config.json` is gitignored; only the example is tracked.

## Why it simulates before every send

Each job calls `simulateContract` first and only broadcasts if that succeeds.

Every contract-side guard — `EpochTooSoon`, `NothingToDistribute`, `AlreadyRolledOver`, `ClaimWindowClosed` — is a revert. A keeper firing on a timer would pay gas to discover each of them. Simulating turns all of them into free reads, and a revert is read as *"not due"*, which is the normal state most of the time.

One job needs extra care: **`settleBeneficiaries` does not revert when it is pointless.** It returns early on a zero pot or an empty roster. So the job reads `pendingBeneficiary` first and only simulates when there is genuinely something to settle — a simulation that "succeeds" by doing nothing is not a reason to send a transaction.

## Design notes

- **Jobs are idempotent.** Every pass re-reads chain state. A missed tick costs nothing; a repeated one is a no-op. That is why the loop is a plain interval rather than a backoff state machine.
- **A transient RPC failure never exits the process.** That is precisely when a keeper most needs to still be running.
- **The key is never logged**, never included in an error message, and never written to disk. `readPrivateKey()` will not echo it even as a prefix when rejecting a malformed value.
- **The ABI is deliberately narrow.** If a function is not in `src/abi.ts`, this process cannot call it, whatever a bug or a bad config asks for.

## What this is not

It is not an AI agent, and it does not need to be. Every decision here is a comparison against on-chain state with an exact answer. See `LatchAI` for the agent-facing surface; a keeper is the boring, reliable half and should stay that way.
