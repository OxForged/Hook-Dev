#!/usr/bin/env node
/* ============================================================================
   @latchprotocol/keeper — CLI entry.

   Runs the permissionless maintenance calls the protocol needs somebody to
   make. Read `README.md` before pointing this at a wallet with funds; the
   security model is short but it matters.

   Two rules this file enforces and must keep enforcing:

     1. DRY RUN IS THE DEFAULT. Sending requires BOTH `--execute` and a
        `KEEPER_PRIVATE_KEY`. Neither alone does anything.
     2. NOTHING IS SENT THAT DID NOT SIMULATE. Each job simulates against the
        current block first; a revert is read as "not due", which it almost
        always is.
   ============================================================================ */

import { createPublicClient, createWalletClient, fallback, http, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import { loadConfig, readPrivateKey } from './config.js'
import { applyPendingConfigJob, settleBeneficiariesJob } from './jobs/hook.js'
import { closeEpochJob, rolloverJob } from './jobs/epochs.js'
import type { Job, JobContext } from './jobs/types.js'

interface Args {
  readonly config: string
  readonly execute: boolean
  readonly once: boolean
  readonly intervalMs: number
}

function parseArgs(argv: readonly string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const interval = Number(get('--interval') ?? 300)
  if (!Number.isFinite(interval) || interval < 15) {
    throw new Error('--interval must be at least 15 (seconds); a keeper that polls faster than the chain moves is just rate-limiting itself')
  }
  return {
    config: get('--config') ?? 'keeper.config.json',
    execute: argv.includes('--execute'),
    once: argv.includes('--once'),
    intervalMs: interval * 1000,
  }
}

function stamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19)
}

async function tick(jobs: readonly Job[], ctx: JobContext): Promise<{ acted: number; failures: number }> {
  let acted = 0
  let failures = 0
  for (const job of jobs) {
    const verdicts = await job.run(ctx)
    for (const v of verdicts) {
      if (v.error) {
        failures++
        console.error(`  ✗ ${v.reason}`)
      } else if (v.due) {
        acted++
        console.log(`  → ${v.reason}${v.txHash ? `  tx ${v.txHash}` : ''}`)
      } else {
        console.log(`  · ${v.reason}`)
      }
    }
  }
  return { acted, failures }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const cfg = loadConfig(args.config)
  const pk = readPrivateKey()

  const transport = fallback(
    cfg.rpcUrls.map((u) => http(u, { timeout: 15_000, retryCount: 2 })),
    { rank: false },
  )
  const publicClient = createPublicClient({ transport })

  // Both conditions required. `--execute` without a key reports; a key without
  // `--execute` reports. This is deliberate belt-and-braces: the most likely
  // operational mistake is running the wrong one of these in the wrong place.
  const willSend = args.execute && pk !== undefined
  const account = pk ? privateKeyToAccount(pk) : undefined
  const walletClient =
    willSend && account ? createWalletClient({ account, transport }) : undefined

  const allJobs: Job[] = [
    closeEpochJob(cfg.targets),
    rolloverJob(cfg.targets),
    settleBeneficiariesJob(cfg.targets),
    applyPendingConfigJob(cfg.targets),
  ]
  const disabled = new Set(cfg.disabledJobs ?? [])
  const jobs = allJobs.filter((j) => !disabled.has(j.id))

  console.log(`latch-keeper · chain ${cfg.chainId} · ${cfg.targets.length} target(s) · ${jobs.length} job(s)`)
  console.log(
    willSend
      ? `MODE: EXECUTE — transactions WILL be sent from ${account?.address}`
      : `MODE: DRY RUN — nothing will be sent${args.execute && !pk ? ' (--execute given but KEEPER_PRIVATE_KEY is unset)' : ''}`,
  )
  if (disabled.size > 0) console.log(`disabled jobs: ${[...disabled].join(', ')}`)
  console.log('')

  const runOnce = async (): Promise<void> => {
    const block = await publicClient.getBlock()
    const ctx: JobContext = {
      publicClient,
      chainId: cfg.chainId,
      now: block.timestamp,
      blockNumber: block.number,
      ...(walletClient ? { walletClient } : {}),
      ...(account ? { account: account.address as Address } : {}),
    }
    console.log(`[${stamp()}] block ${block.number}`)
    const { acted, failures } = await tick(jobs, ctx)
    console.log(`[${stamp()}] ${acted} due, ${failures} failed\n`)
  }

  await runOnce()
  if (args.once) return

  // Plain interval, not a backoff loop: every job is idempotent and re-checks
  // from chain each pass, so a missed tick costs nothing and a repeated one is
  // a no-op. Complexity here would buy nothing.
  for (;;) {
    await new Promise((r) => setTimeout(r, args.intervalMs))
    try {
      await runOnce()
    } catch (e) {
      // Never exit on a transient RPC failure — that is exactly when a keeper
      // most needs to still be running.
      console.error(`[${stamp()}] tick failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
