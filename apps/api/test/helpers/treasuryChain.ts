import { CL_QUOTER_ABI, CONTRACT_CLOCK_PROBE_CALLDATA, LATCH_DEPLOYMENTS, poolKeyToId, UNIVERSAL_ROUTER_ABI } from "@latchprotocol/sdk";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decodeFunctionData, encodeAbiParameters, encodeFunctionResult, getAddress, keccak256, parseAbi, toHex, type Abi, type Address, type Hex } from "viem";
import { decodeMultiSend, ERC20_APPROVE_ABI, PERMIT2_APPROVE_ABI } from "../../src/admin/treasury/batch.js";
import { safeDelegatecallStub, type TreasuryClient } from "../../src/admin/treasury/chain.js";

/**
 * TEST FIXTURE ONLY. An in-memory chain answering exactly the reads treasury
 * conversion makes, keyed by the SDK's 4663 addresses. Every number below is a
 * LAYOUT value chosen to exercise a rule, not a chain read.
 */

const d = LATCH_DEPLOYMENTS[4663];
export const SAFE = d.governanceSafe;
export const NATIVE: Address = "0x0000000000000000000000000000000000000000";
export const USDG = getAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
export const NVDA = getAddress("0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC");
export const WETH = d.weth;
export const RETIRED_REVSHARE = getAddress("0x23CE34E8199927DD270dddd8579c947542bDE446");
export const THIRD_PARTY_HOOK = getAddress("0x4444444444444444444444444444444444444444");
export const MSC = getAddress("0x9641d764fc13c8B624c04430C7356C1C7C8102e2");
/** Runtime code read from 4663 with cast code on 2026-09-14 (a fixture, so tests need no chain). */
export const MSC_CODE = readFileSync(fileURLToPath(new URL("../fixtures/multisend-call-only-1.4.1.robinhood.hex", import.meta.url)), "utf8").trim() as Hex;
const PARAMS_TS60 = "0x00000000000000000000000000000000000000000000000000000000003c0000" as Hex;

export interface FakePool {
  currency0: Address;
  currency1: Address;
  hooks: Address;
  fee: number;
  sqrtPriceX96: bigint;
  protocolFee?: number;
  lpFee?: number;
}

export function poolRow(p: FakePool) {
  const key = { currency0: p.currency0, currency1: p.currency1, hooks: p.hooks, poolManager: d.clPoolManager, fee: p.fee, parameters: PARAMS_TS60 };
  const poolId = poolKeyToId(key);
  return { id: `4663-${poolId}`, chainId: 4663, poolId, poolType: "CL", poolManager: d.clPoolManager.toLowerCase(), currency0: p.currency0.toLowerCase(), currency1: p.currency1.toLowerCase(), hooks: p.hooks.toLowerCase(), fee: p.fee, parameters: PARAMS_TS60, hookBitmap: 0, tickSpacing: 60 };
}

export interface FakeState {
  nowSeconds: bigint;
  blockNumber: bigint;
  contractBlockNumber: bigint;
  pools: FakePool[];
  balances: Record<string, bigint>;
  decimals: Record<string, number>;
  symbols: Record<string, string>;
  /** amountOut for a path of pool ids and amountIn (midOut: the path at mid price, no fees), or "revert". */
  quote: (poolIds: Hex[], amountIn: bigint, midOut: bigint) => bigint | "revert";
  registry: Record<string, { registered: boolean; listing: number }>;
  /** raw getPendingConfig return per `${hook}:${poolId}` (lowercase). Missing = revert. */
  pending: Record<string, Hex>;
  multiSendCodeHashOk: boolean;
  simulation: "success" | "revert" | "override-unsupported";
  nativeBalance: bigint;
  guard: Address | null;
  calls: { to: string | undefined; selector: string; override: boolean }[];
}

const revert = (data?: Hex) => Object.assign(new Error(data ? "execution reverted" : "execution reverted for an unknown reason"), data ? { data } : {});

export function sqrtPriceFor(token1PerToken0Raw: { num: bigint; den: bigint }): bigint {
  // sqrt(num/den) * 2^96, integer.
  const target = (token1PerToken0Raw.num << 192n) / token1PerToken0Raw.den;
  let x = 1n << 128n;
  for (let i = 0; i < 200; i++) {
    const nx = (x + target / x) >> 1n;
    if (nx === x || nx === x + 1n) break;
    x = nx;
  }
  return x;
}

/** 1 ETH = 4000 USDG (WETH pool 4010); 1 NVDA = 180 USDG. LAYOUT values. */
export function baseState(over: Partial<FakeState> = {}): FakeState {
  const ethUsdg = sqrtPriceFor({ num: 4000n * 10n ** 6n, den: 10n ** 18n }); // token1 USDG per token0 native (raw)
  const wethUsdg = sqrtPriceFor({ num: 4010n * 10n ** 6n, den: 10n ** 18n }); // WETH < USDG: token0 WETH; slightly worse, so native is the best route
  const usdgNvda = sqrtPriceFor({ num: 10n ** 18n, den: 180n * 10n ** 6n }); // USDG < NVDA: token0 USDG, token1 NVDA
  return {
    nowSeconds: BigInt(Math.floor(Date.now() / 1000)),
    blockNumber: 62_700_000n,
    contractBlockNumber: 25_975_000n,
    pools: [
      { currency0: NATIVE, currency1: USDG, hooks: NATIVE, fee: 3000, sqrtPriceX96: ethUsdg, lpFee: 3000 },
      { currency0: WETH, currency1: USDG, hooks: NATIVE, fee: 3000, sqrtPriceX96: wethUsdg, lpFee: 3000 },
      { currency0: USDG, currency1: NVDA, hooks: RETIRED_REVSHARE, fee: 3000, sqrtPriceX96: usdgNvda, lpFee: 3000 },
    ],
    balances: { [`${USDG}:${SAFE}`.toLowerCase()]: 2_000n * 10n ** 6n, [`${NVDA}:${SAFE}`.toLowerCase()]: 10n * 10n ** 18n },
    decimals: { [USDG.toLowerCase()]: 6, [NVDA.toLowerCase()]: 18, [WETH.toLowerCase()]: 18 },
    symbols: { [USDG.toLowerCase()]: "USDG", [NVDA.toLowerCase()]: "NVDA", [WETH.toLowerCase()]: "WETH" },
    // 0.3% fee plus 0.1% curve per hop: out = mid * 0.996^hops.
    quote: (ids, _amountIn, mid) => ids.reduce((x) => (x * 996n) / 1000n, mid),
    registry: {},
    pending: {},
    multiSendCodeHashOk: true,
    simulation: "success",
    nativeBalance: 5n * 10n ** 17n,
    guard: null,
    calls: [],
    ...over,
  };
}

const ERC20 = parseAbi(["function symbol() view returns (string)", "function decimals() view returns (uint8)", "function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)"]);
const SLOT0 = parseAbi(["function getSlot0(bytes32 id) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)"]);
const REGISTRY = parseAbi(["function isRegistered(address hook) view returns (bool)", "function statusOf(address hook) view returns (uint8 verification, uint8 listing)"]);
const SAFE_ABI = parseAbi(["function VERSION() view returns (string)"]);

export function fakeTreasuryClient(s: FakeState): TreasuryClient {
  const pools = s.pools.map((p) => ({ ...p, row: poolRow(p) }));
  const byId = new Map(pools.map((p) => [p.row.poolId.toLowerCase(), p]));
  const idOfKey = (k: { currency0: string; currency1: string; hooks: string; poolManager: string; fee: number; parameters: string }) => poolKeyToId({ currency0: getAddress(k.currency0), currency1: getAddress(k.currency1), hooks: getAddress(k.hooks), poolManager: getAddress(k.poolManager), fee: k.fee, parameters: k.parameters as Hex }).toLowerCase() as Hex;

  const client: TreasuryClient = {
    async getBlock() {
      return { number: s.blockNumber, timestamp: s.nowSeconds };
    },
    async getBlockNumber() {
      return s.blockNumber;
    },
    async getBalance() {
      return s.nativeBalance;
    },
    async getCode({ address }) {
      if (address.toLowerCase() !== MSC.toLowerCase()) return undefined;
      // Only the hash is compared; the fake answers bytes whose hash the test controls through a lookup.
      return s.multiSendCodeHashOk ? MSC_CODE : (`${MSC_CODE}00` as Hex);
    },
    async getStorageAt() {
      return s.guard ? (`0x${s.guard.slice(2).padStart(64, "0")}` as Hex) : (`0x${"0".repeat(64)}` as Hex);
    },
    async call({ to, data, stateOverride }) {
      s.calls.push({ to, selector: data.slice(0, 10), override: !!stateOverride });
      if (!to && data === CONTRACT_CLOCK_PROBE_CALLDATA) return { data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [s.contractBlockNumber, s.nowSeconds]) };
      const t = (to ?? "").toLowerCase();

      if (stateOverride) {
        if (s.simulation === "override-unsupported") throw new Error("invalid params: state override is not supported");
        if (t !== SAFE.toLowerCase() || stateOverride[0]?.code !== safeDelegatecallStub(MSC)) throw new Error("fake: unexpected override");
        const inner = decodeMultiSend(data);
        if (s.simulation === "revert" && inner.length === 3) throw revert();
        return { data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [s.nativeBalance, s.nativeBalance + lastQuote]) };
      }

      if (t === d.clQuoter.toLowerCase()) {
        const dec = decodeFunctionData({ abi: CL_QUOTER_ABI as unknown as Abi, data });
        let ids: Hex[];
        let amountIn: bigint;
        const dirs: boolean[] = [];
        if (dec.functionName === "quoteExactInputSingle") {
          const a = (dec.args as unknown as [{ poolKey: never; exactAmount: bigint }])[0];
          ids = [idOfKey(a.poolKey)];
          dirs.push((a as unknown as { zeroForOne: boolean }).zeroForOne);
          amountIn = a.exactAmount;
        } else {
          const a = (dec.args as unknown as [{ exactCurrency: Address; path: { intermediateCurrency: Address; fee: number; hooks: Address; poolManager: Address; parameters: Hex }[]; exactAmount: bigint }])[0];
          let cur = a.exactCurrency.toLowerCase();
          ids = a.path.map((pk) => {
            const other = pk.intermediateCurrency.toLowerCase();
            const [c0, c1] = BigInt(cur) < BigInt(other) ? [cur, other] : [other, cur];
            dirs.push(cur === c0);
            cur = other;
            return idOfKey({ currency0: c0, currency1: c1, hooks: pk.hooks, poolManager: pk.poolManager, fee: pk.fee, parameters: pk.parameters });
          });
          amountIn = a.exactAmount;
        }
        let mid = amountIn;
        ids.forEach((id, i) => {
          const p = byId.get(id);
          if (!p) return;
          const p2 = p.sqrtPriceX96 * p.sqrtPriceX96;
          mid = dirs[i] ? (mid * p2) >> 192n : (mid << 192n) / p2;
        });
        const out = s.quote(ids, amountIn, mid);
        if (out === "revert") throw revert(`0x8b063d73${ids[0]!.slice(2)}` as Hex); // NotEnoughLiquidity(bytes32)
        lastQuote = out;
        return { data: encodeFunctionResult({ abi: CL_QUOTER_ABI as unknown as Abi, functionName: dec.functionName, result: [out, 150_000n] } as never) };
      }
      if (t === d.clPoolManager.toLowerCase()) {
        const dec = decodeFunctionData({ abi: SLOT0, data });
        const p = byId.get(String(dec.args[0]).toLowerCase());
        if (!p) return { data: encodeFunctionResult({ abi: SLOT0, functionName: "getSlot0", result: [0n, 0, 0, 0] }) };
        return { data: encodeFunctionResult({ abi: SLOT0, functionName: "getSlot0", result: [p.sqrtPriceX96, 0, p.protocolFee ?? 0, p.lpFee ?? p.fee] }) };
      }
      if (t === d.registry.toLowerCase()) {
        const dec = decodeFunctionData({ abi: REGISTRY, data });
        const r = s.registry[String(dec.args[0]).toLowerCase()];
        if (dec.functionName === "isRegistered") return { data: encodeFunctionResult({ abi: REGISTRY, functionName: "isRegistered", result: r?.registered ?? false }) };
        if (!r?.registered) throw revert("0x12345678");
        return { data: encodeFunctionResult({ abi: REGISTRY, functionName: "statusOf", result: [1, r.listing] }) };
      }
      if (t === SAFE.toLowerCase()) return { data: encodeFunctionResult({ abi: SAFE_ABI, functionName: "VERSION", result: "1.4.1" }) };
      if (t === d.permit2.toLowerCase()) return { data: "0x" };
      if (s.decimals[t] !== undefined && data.startsWith("0x095ea7b3")) return { data: encodeAbiParameters([{ type: "bool" }], [true]) };
      if (s.decimals[t] !== undefined) {
        const dec = decodeFunctionData({ abi: ERC20, data });
        if (dec.functionName === "symbol") return { data: encodeFunctionResult({ abi: ERC20, functionName: "symbol", result: s.symbols[t] ?? "?" }) };
        if (dec.functionName === "decimals") return { data: encodeFunctionResult({ abi: ERC20, functionName: "decimals", result: s.decimals[t]! }) };
        if (dec.functionName === "allowance") return { data: encodeFunctionResult({ abi: ERC20, functionName: "allowance", result: 0n }) };
        const holder = String(dec.args[0]).toLowerCase();
        return { data: encodeFunctionResult({ abi: ERC20, functionName: "balanceOf", result: s.balances[`${t}:${holder}`] ?? 0n }) };
      }
      // Hooks: getPendingConfig / CLOCK_MODE.
      if (data.startsWith("0x")) {
        const poolId = `0x${data.slice(10, 74)}`;
        const raw = s.pending[`${t}:${poolId}`];
        if (raw && data.length === 74) return { data: raw };
        throw revert();
      }
      throw new Error(`fake chain: no answer for ${to} ${data.slice(0, 10)}`);
    },
  };
  let lastQuote = 0n;
  return client;
}

/** 7-word block-no-expiry getPendingConfig return (the retired 0x23CE shape). */
export function legacyPending(effectiveBlock: bigint, feePips = 100_000): Hex {
  return encodeAbiParameters(
    [{ type: "tuple", components: [{ type: "uint48" }, { type: "tuple", components: [{ type: "uint24" }, { type: "uint16" }, { type: "uint16" }, { type: "uint16" }, { type: "address" }, { type: "bool" }] }] }],
    [[Number(effectiveBlock), [feePips, 0, 8000, 0, NATIVE, true]]] as never,
  );
}

export { ERC20_APPROVE_ABI, PERMIT2_APPROVE_ABI, UNIVERSAL_ROUTER_ABI, keccak256, toHex };
