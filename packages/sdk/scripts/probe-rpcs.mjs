// Probes candidate public RPC endpoints for every Latch target chain.
// Records only endpoints that actually answer AND report the right chainId,
// plus whether each supports EIP-1153 (TSTORE) so the backend choice stays verified.
import { writeFileSync } from 'node:fs'

const TSTORE = '0x600060005D60006000F3' // PUSH1 0, PUSH1 0, TSTORE, PUSH1 0, PUSH1 0, RETURN
const SSTORE = '0x600060005560006000F3' // same with SSTORE — valid on every EVM, the control

const CHAINS = {
  ethereum: {
    id: 1,
    candidates: [
      'https://eth.drpc.org',
      'https://ethereum-rpc.publicnode.com',
      'https://rpc.flashbots.net',
      'https://eth.merkle.io',
      'https://1rpc.io/eth',
      'https://cloudflare-eth.com',
      'https://eth.llamarpc.com',
      'https://rpc.mevblocker.io',
    ],
  },
  base: {
    id: 8453,
    candidates: [
      'https://mainnet.base.org',
      'https://base.drpc.org',
      'https://base-rpc.publicnode.com',
      'https://base.llamarpc.com',
      'https://1rpc.io/base',
      'https://base.meowrpc.com',
      'https://base.gateway.tenderly.co',
    ],
  },
  bsc: {
    id: 56,
    candidates: [
      'https://bsc-dataseed.bnbchain.org',
      'https://bsc-dataseed1.defibit.io',
      'https://bsc-rpc.publicnode.com',
      'https://bsc.drpc.org',
      'https://1rpc.io/bnb',
      'https://binance.llamarpc.com',
      'https://bsc-dataseed2.bnbchain.org',
    ],
  },
  sepolia: {
    id: 11155111,
    candidates: [
      'https://ethereum-sepolia-rpc.publicnode.com',
      'https://sepolia.drpc.org',
      'https://rpc.sepolia.org',
      'https://1rpc.io/sepolia',
      'https://eth-sepolia.public.blastapi.io',
      'https://sepolia.gateway.tenderly.co',
    ],
  },
  hyperevm: {
    id: 999,
    candidates: [
      'https://rpc.hyperliquid.xyz/evm',
      'https://rpc.hypurrscan.io',
      'https://hyperliquid.drpc.org',
      'https://rpc.hyperlend.finance',
      'https://hyperliquid-json-rpc.stakely.io',
    ],
  },
  plasma: {
    id: 9745,
    candidates: [
      'https://rpc.plasma.to',
      'https://plasma.drpc.org',
      'https://plasma-rpc.publicnode.com',
      'https://rpc.plasma.blockpi.network/v1/rpc/public',
    ],
  },
  stable: {
    id: 988,
    candidates: ['https://rpc.stable.xyz'],
  },
  stableTestnet: {
    id: 2201,
    candidates: ['https://rpc.testnet.stable.xyz'],
  },
  arcTestnet: {
    id: 5042002,
    candidates: ['https://rpc.testnet.arc.io'],
  },
}

async function rpc(url, method, params, timeoutMs = 12000) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: ac.signal,
    })
    if (!r.ok) return { err: `HTTP ${r.status}` }
    const j = await r.json()
    if (j.error) return { err: j.error.message ?? 'rpc error' }
    return { ok: j.result }
  } catch (e) {
    return { err: e.name === 'AbortError' ? 'timeout' : String(e.message ?? e) }
  } finally {
    clearTimeout(t)
  }
}

const out = {}
for (const [name, { id, candidates }] of Object.entries(CHAINS)) {
  const working = []
  for (const url of candidates) {
    const cid = await rpc(url, 'eth_chainId', [])
    if (cid.err) { console.log(`  ${name.padEnd(14)} ${url} -> ${cid.err}`); continue }
    const got = Number(cid.ok)
    if (got !== id) { console.log(`  ${name.padEnd(14)} ${url} -> WRONG CHAIN ${got}`); continue }

    // latency
    const t0 = Date.now()
    const blk = await rpc(url, 'eth_blockNumber', [])
    const ms = Date.now() - t0
    if (blk.err) { console.log(`  ${name.padEnd(14)} ${url} -> no blockNumber`); continue }

    // EIP-1153, with the control so a blocked call shape is not read as a missing opcode
    const ctl = await rpc(url, 'eth_call', [{ data: SSTORE }, 'latest'])
    const tst = await rpc(url, 'eth_call', [{ data: TSTORE }, 'latest'])
    const eip1153 = ctl.err ? null : !tst.err

    working.push({ url, latencyMs: ms, block: Number(blk.ok), eip1153 })
    console.log(`  ${name.padEnd(14)} ${url} -> OK ${ms}ms block ${Number(blk.ok)} eip1153=${eip1153 ?? 'unprobeable'}`)
  }
  working.sort((a, b) => a.latencyMs - b.latencyMs)
  out[name] = { chainId: id, endpoints: working }
}

writeFileSync('rpc-probe-results.json', JSON.stringify(out, null, 2))
console.log('\n=== SUMMARY ===')
for (const [n, v] of Object.entries(out)) {
  const votes = v.endpoints.map((e) => e.eip1153).filter((x) => x !== null)
  const verdict = votes.length === 0 ? 'UNPROBEABLE' : votes.every(Boolean) ? 'yes' : votes.some(Boolean) ? 'MIXED' : 'no'
  console.log(`  ${n.padEnd(14)} ${String(v.endpoints.length).padStart(2)} working   eip1153=${verdict}`)
}
