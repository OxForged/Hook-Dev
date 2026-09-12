# Runbook — the keeper on a new host, Robinhood Chain (4663)

The previous host (`40.160.136.124`) is unreachable and is treated as gone. Nothing
on it is needed: the keeper persists no state, and the only secret it held was a
keeper key, which is low-value by construction (below). This document brings the
`latch` stack up from nothing on a fresh box.

## What this stack is, and what it is not

The container makes four **permissionless** calls — `settleBeneficiaries`,
`applyPendingConfig`, `closeEpoch`, `rollover`. Anyone can make them from any
address. Consequently:

- **A stolen keeper key buys an attacker nothing they could not already do.** It
  can waste the key's gas. It cannot move funds, change a fee, alter a roster,
  pause anything or touch a listing. Fund it with gas and nothing else.
- **No privileged role is ever configured into this package.** If a future job
  needs `owner`/`curator`/`guardian`, it does not belong here — see CLAUDE.md
  "Automation". Nothing in this runbook grants a role, and nothing should.
- **Dry run is the default.** Sending requires BOTH `--execute` (only in
  `compose.execute.yml`) AND `KEEPER_PRIVATE_KEY` (only in `.env`). Either
  alone reports and sends nothing.
- **Nothing is sent that did not simulate**, and `settleBeneficiaries` — which
  returns instead of reverting when pointless — is read (`pendingBeneficiary`
  and `totalWeight`) before it is ever simulated.

## Why this is needed on Robinhood specifically

`RevShareHook 0x23CE34E8199927DD270dddd8579c947542bDE446` has held the LTT1/LTT2
pool's beneficiary share since the first swap:

```
pendingBeneficiary(pool, LTT1)  2,395,183,243,137,626 wei
pendingBeneficiary(pool, LTT2)  2,390,416,754,495,767 wei
totalWeight(pool)               1      (roster: the deployer, weight 1)
claimable(deployer, ·)          0 / 0
```

Nobody ever called `settleBeneficiaries` on chain 4663 because the keeper was
never configured for it. `keeper.config.robinhood.json` is that configuration.
A dry run against it today reports both currencies DUE and simulated clean.

## Host requirements

- Linux, Docker Engine with Compose v2 (`docker compose version`).
- Outbound HTTPS to `rpc-robinhood.blockmachine.io`. **No inbound ports.** The
  keeper dials out; nothing needs to reach it.
- Assume the host is shared even if it is not today. Every command below
  carries `-p latch` and is run from `~/latch/keeper`, so it cannot reach a
  neighbour's containers. Never stop, restart or reconfigure anything outside
  the `latch` project — if something else on the box is misbehaving, report it.

## 1. Put the package on the host

```bash
mkdir -p ~/latch && cd ~/latch
git clone <repo> src            # or rsync packages/keeper alone; it is self-contained
ln -s src/packages/keeper keeper
cd ~/latch/keeper
```

Only `packages/keeper` is needed: `Dockerfile`, `docker-compose.yml`,
`compose.execute.yml`, `package.json`, `package-lock.json`, `tsconfig.json`,
`src/`, `keeper.config.robinhood.json`.

## 2. Make a keeper key — a NEW one

```bash
cast wallet new        # prints an address and a private key. Copy the key ONLY into .env (step 3).
```

- Never the deployer key. Never a key that owns or can propose to anything.
- Fund the address with a small amount of ETH on Robinhood Chain for gas. A
  settle is a few tens of thousands of gas; a year of ticks that mostly do
  nothing costs nothing, because a tick that finds nothing due sends nothing.
- Do not paste the key into a terminal, a chat, a commit or a log. If it is
  ever exposed, make a new one; rotating it is editing one line in `.env`.

## 3. `.env` — the only secret on the box

```bash
cp .env.example .env
chmod 600 .env
$EDITOR .env
```

```
KEEPER_PRIVATE_KEY=0x…                          # from step 2
KEEPER_CONFIG=./keeper.config.robinhood.json    # which tracked config to mount
KEEPER_INTERVAL=300                             # seconds between ticks
```

`.env` is gitignored. Verify before anything else: `git check-ignore -v .env`
must print a rule.

## 4. Build and DRY RUN first — always

```bash
docker compose -p latch build
docker compose -p latch run --rm keeper --config /config/keeper.config.json --once
```

No `--execute` is passed, so this reports only, even though the key is in the
environment. Expected, as of the first configuration (block numbers and wei
will differ):

```
latch-keeper · chain 4663 · 1 target(s) across 1 hook(s), 0 with a distributor · 4 job(s)
MODE: DRY RUN — nothing will be sent
maxGas: 2000000
notes: Robinhood Chain mainnet. ONE target: …

[…] block 61299367
  · LTT1/LTT2 revshare (retired hook 0x23CE) closeEpoch: no distributor — config says none and the hook agrees (distributorOf = 0x0)
  · LTT1/LTT2 revshare (retired hook 0x23CE) rollover: no distributor configured for this pool
  → LTT1/LTT2 revshare (retired hook 0x23CE) settle 0x2A21c0… (2395183243137626 wei, roster weight 1): DUE — simulated clean. Dry run, nothing sent.
  → LTT1/LTT2 revshare (retired hook 0x23CE) settle 0xa29927… (2390416754495767 wei, roster weight 1): DUE — simulated clean. Dry run, nothing sent.
  · LTT1/LTT2 revshare (retired hook 0x23CE) applyPendingConfig: no proposal outstanding
[…] 2 due, 0 failed
```

Check three things before going further:

1. The first line says **chain 4663**. The process refuses to start if the RPC
   answers a different chain, so if you see this line the RPC is right.
2. `MODE: DRY RUN`.
3. `0 failed`. A `✗` line is something to read, not something to retry past.

If the RPC answers `rate limit exceeded`, wait a minute and run again. The
keeper batches its reads and backs off 1.5 s between retries, but a burst of
manual `cast` calls beforehand can use up the allowance.

## 5. Go live

```bash
docker compose -p latch -f docker-compose.yml -f compose.execute.yml up -d --build
docker compose -p latch logs -f keeper
```

`compose.execute.yml` is the only file in the package that contains
`--execute`. The first tick should show:

```
MODE: EXECUTE — transactions WILL be sent from 0x<keeper address>
  → … settle 0x2A21c0… (… wei, roster weight 1): sent  tx 0x…
  → … settle 0xa29927… (… wei, roster weight 1): sent  tx 0x…
```

and every later tick should show `nothing pending` for both. **Verify on chain,
not in the log**, with any RPC:

```bash
RPC=https://rpc-robinhood.blockmachine.io
H=0x23CE34E8199927DD270dddd8579c947542bDE446
P=0xcb1fbdafcaa52a0cc8f5ece1752737c2a5eec2b7242953270c15bdd9818a50e8
cast call $H 'pendingBeneficiary(bytes32,address)(uint256)' $P 0x2A21c0826848f2D597B7C87A4B931dE1407958A6 --rpc-url $RPC   # expect 0 (or rounding dust)
cast call $H 'claimable(address,address)(uint256)' 0x304b0cc019CDBA6C7c767D86a2A34e69FDb3c9a9 0x2A21c0826848f2D597B7C87A4B931dE1407958A6 --rpc-url $RPC   # expect ~2.395e15
```

After the settle, the funds are `claimable` by the roster entry (the deployer
address, weight 1). Turning `claimable` into tokens is `claim`, a user action by
the beneficiary — not a keeper job, and not something this package should grow.

## 6. Going back to dry run, stopping, upgrading

```bash
# back to reporting only (drops the override file):
docker compose -p latch up -d

# stop — from ~/latch/keeper, with -p latch, and nothing else:
docker compose -p latch down

# upgrade:
cd ~/latch/src && git pull && cd ~/latch/keeper
docker compose -p latch -f docker-compose.yml -f compose.execute.yml up -d --build
```

## Reading the log

| Line | Meaning | Action |
|---|---|---|
| `· … nothing pending` | Normal. | None. |
| `· … not due — NothingToDistribute()` / `EpochTooSoon(...)` | Normal between epochs. | None. |
| `· … no distributor — config says none and the hook agrees` | Normal on 4663 today. | None. |
| `✗ … config says this pool has NO distributor, but the hook routes it to 0x…` | Somebody configured a distributor on chain. | Add it to the target, redeploy. |
| `✗ … pending but the roster is EMPTY (totalWeight = 0)` | Fees with nobody to pay. The keeper cannot fix this and will not send. | Pool owner must `setBeneficiaries`. |
| `✗ … could not tell which distributor 0x… is` | `kind()` did not answer a recognised constant. | Do not "fix" by guessing. Either the distributor predates `kind()` or it is not one of ours. |
| `✗ … simulated clean but needs N gas, over maxGas` | Something is more expensive than expected. | Read why before raising `maxGas`. |
| `✗ … due, but sending failed` | Simulated, then the SEND failed (nonce, gas, RPC). | Check the key's gas balance and the RPC. |
| `config says chainId 4663 but the RPC answers chain N. Refusing to start.` | Wrong RPC in the config. | Fix the config. |
| `tick failed: …` | RPC unreachable for a whole tick. Process keeps running. | Persistent → try another RPC. |

## Adding targets later

**A pool on the current hook `0xfC00485AFB2f9C73Bd7F9f5e72d14709233E2aD2`.**
Add one target per pool. `poolKey.hooks` and `hook` are the new address;
`parameters` packs the hook's bitmap (`getHooksRegistrationBitmap()`, 2177 on
both hooks) with the tick spacing at bit offset 16 — `0x…003c0881` for spacing
60. The loader refuses to start unless `poolId == keccak256(abi.encode(poolKey))`,
so a wrong key is caught before the first tick rather than settling a pool that
does not exist. The keeper does not discover pools; a new pool means a new
target and a redeploy of the config.

**An epoch distributor, once one is deployed on 4663.** Set `distributor` on
the pool(s) that route to it. The close-epoch job already cross-checks
`distributorOf` on the hook every tick, so a distributor that is configured on
chain and missing here shows up as a `✗` line rather than silently stranding
epochs. It must answer `kind()` with one of the two known constants or the
rollover job will refuse it.

## Robinhood specifics

- RPC: `https://rpc-robinhood.blockmachine.io`. The other public endpoints cap
  the gas estimator and rate-limit to roughly one request per ten seconds; do
  not add them as fallbacks — a fallback that stalls every tick is worse than
  none.
- All public endpoints rate-limit by request count. The keeper folds each
  tick's reads into JSON-RPC batches (`rpcBatch`, default on) and waits 1.5 s
  between retries.
- Block explorer verification lives on Sourcify, not Blockscout; irrelevant to
  the keeper, recorded so nobody goes looking.

## What must stay true

1. Every entry in `src/abi.ts` is permissionless. Adding a privileged call
   changes the security model of the whole box.
2. `--execute` appears only in `compose.execute.yml`; the key appears only in
   `.env`. Both are needed to send.
3. `-p latch`, from `~/latch/keeper`, every time. No published ports.
4. The key holds gas and nothing else.
