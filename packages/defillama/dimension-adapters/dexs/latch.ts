import { BaseAdapter, FetchOptions, SimpleAdapter } from "../adapters/types";
import { CHAIN } from "../helpers/chains";
import { getDefaultDexTokensBlacklisted } from "../helpers/lists";
import { addOneToken } from "../helpers/prices";

/**
 * Latch Protocol - swap volume, swap fees and the LP/protocol split.
 *
 * Latch is a Uniswap-v4-style singleton AMM forked from PancakeSwap Infinity. A
 * single `Vault` custodies every token; two pool managers register against it as
 * "apps" and hold nothing themselves:
 *
 *   CLPoolManager   concentrated liquidity
 *   BinPoolManager  liquidity book / bins
 *
 * Both emit their own `Swap`, and both carry the same two fee numbers, so one
 * code path covers them. See `FEE MODEL` below.
 *
 * Website: https://latch.exchange       (placeholder - fill in before submitting)
 * Twitter: https://x.com/latchprotocol  (placeholder - fill in before submitting)
 *
 * ---------------------------------------------------------------------------
 * TOPIC0 COLLISION - read before touching the log queries
 * ---------------------------------------------------------------------------
 * Vault, CLPoolManager, BinPoolManager and the shared `ProtocolFees` base declare
 * 34 events between them but only 22 distinct signatures. Six signatures are
 * byte-identical across contracts and therefore share a topic0:
 *
 *   OwnershipTransferred(address,address)      Vault, CL, Bin, ProtocolFees
 *   DynamicLPFeeUpdated(bytes32,uint24)        CL, Bin
 *   Paused(address)                            CL, Bin, ProtocolFees
 *   ProtocolFeeControllerUpdated(address)      CL, Bin, ProtocolFees
 *   ProtocolFeeUpdated(bytes32,uint24)         CL, Bin, ProtocolFees
 *   Unpaused(address)                          CL, Bin, ProtocolFees
 *
 * `Swap` and `Initialize` happen not to collide - CL and Bin carry different
 * parameter types - but nothing guarantees that stays true. Every query below is
 * therefore scoped by emitting ADDRESS (`target: <one pool manager>`), never by a
 * bare topic filter, and each target is decoded with its OWN abi. A `noTarget`
 * scan keyed on topic0 alone would silently merge CL and Bin activity, and would
 * pick up a third contract's `ProtocolFeeUpdated` for free.
 *
 * ---------------------------------------------------------------------------
 * FEE MODEL - derived from the contracts, not from docs
 * ---------------------------------------------------------------------------
 * `Swap` carries `fee` (uint24) and `protocolFee` (uint16), both in pips (1e-6):
 *
 *   fee          `SwapState.swapFee` - the TOTAL rate charged on the gross input,
 *                protocol fee included.
 *   protocolFee  the SINGLE-DIRECTION protocol fee, already resolved for this
 *                swap's direction before the swap loop ran.
 *
 * The protocol fee is taken off the input FIRST and the LP fee applies to the
 * remainder, so the two compose rather than add
 * (`ProtocolFeeLibrary.calculateSwapFee`):
 *
 *   fee = protocolFee + lpFee - (protocolFee * lpFee / 1e6)
 *
 * Which means the amounts decompose exactly, with no need to recover `lpFee`:
 *
 *   totalFee    = grossInput * fee              / 1e6
 *   protocolCut = grossInput * protocolFee      / 1e6
 *   lpCut       = grossInput * (fee-protocolFee)/ 1e6
 *
 * `protocolCut` matches `CLPool.swap`, which accrues
 * `(step.amountIn + step.feeAmount) * protocolFee / 1e6` per step, and matches
 * `BinPool.swap`, which reaches the same number the long way round through
 * `PackedUint128Math.getProtocolFeeAmt` (`totalFee * protocolFee / swapFee`).
 *
 * Because the fee is charged on the input leg only, the strictly correct thing is
 * to book it in the input token. We instead apply the same RATE to whichever leg
 * `addOneToken` prices, exactly as the pancakeswap-infinity adapter does: the two
 * legs of a swap differ only by the fee itself and price impact, so the USD value
 * is the same to within that, and pricing off the core asset avoids a thin
 * long-tail token setting the number. All three balances use `addOneToken` with
 * the same (token0, token1), so they always land on the same leg and the identity
 * `Fees = Revenue + SupplySideRevenue` holds per swap.
 */

// ---------------------------------------------------------------------------
// Deployment registry. Adding a chain is one entry here and nothing else.
//
// Latch is NOT deployed on any mainnet yet (2026-09). Every row below is a
// placeholder with empty addresses; `fetch` throws for a chain that has none, and
// the adapter export skips those chains entirely, so an unfinished row cannot
// report a silent zero. Fill in the addresses, `fromBlock` and `start` when a
// chain ships.
//
// The only live deployment is Sepolia, and DefiLlama does not index testnets
// (`helpers/chains.ts` has no `sepolia` member), so it is deliberately absent.
// The local harness in packages/defillama supplies it separately.
// ---------------------------------------------------------------------------
export interface LatchChainConfig {
  /** Singleton custodian of every token. Used by the TVL adapter, not here. */
  vault: string;
  /** Concentrated-liquidity pool manager. */
  clPoolManager: string;
  /** Liquidity-book pool manager. */
  binPoolManager: string;
  /** Block of the first pool-manager deployment - the floor for the Initialize scan. */
  fromBlock: number;
  /** First date that returns data. */
  start: string;
  blacklistTokens?: string[];
}

export const chainConfig: Record<string, LatchChainConfig> = {
  [CHAIN.ETHEREUM]: {
    vault: "",
    clPoolManager: "",
    binPoolManager: "",
    fromBlock: 0,
    start: "",
    blacklistTokens: getDefaultDexTokensBlacklisted(CHAIN.ETHEREUM),
  },
  [CHAIN.BASE]: {
    vault: "",
    clPoolManager: "",
    binPoolManager: "",
    fromBlock: 0,
    start: "",
    blacklistTokens: getDefaultDexTokensBlacklisted(CHAIN.BASE),
  },
  [CHAIN.BSC]: {
    vault: "",
    clPoolManager: "",
    binPoolManager: "",
    fromBlock: 0,
    start: "",
    blacklistTokens: getDefaultDexTokensBlacklisted(CHAIN.BSC),
  },
  // HyperEVM, chain id 999. DefiLlama slugs it "hyperliquid".
  [CHAIN.HYPERLIQUID]: {
    vault: "",
    clPoolManager: "",
    binPoolManager: "",
    fromBlock: 0,
    start: "",
  },
  [CHAIN.MONAD]: {
    vault: "",
    clPoolManager: "",
    binPoolManager: "",
    fromBlock: 0,
    start: "",
  },
  [CHAIN.PLASMA]: {
    vault: "",
    clPoolManager: "",
    binPoolManager: "",
    fromBlock: 0,
    start: "",
  },
  [CHAIN.STABLE]: {
    vault: "",
    clPoolManager: "",
    binPoolManager: "",
    fromBlock: 0,
    start: "",
  },
};

/** A chain is live once it has a vault, at least one pool manager and a start date. */
export const isConfigured = (c?: LatchChainConfig): c is LatchChainConfig =>
  Boolean(c && c.vault && (c.clPoolManager || c.binPoolManager) && c.start);

// ---------------------------------------------------------------------------
// Events. Copied verbatim from the compiled ABIs.
// ---------------------------------------------------------------------------
export const CL_INITIALIZE_EVENT =
  "event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, address hooks, uint24 fee, bytes32 parameters, uint160 sqrtPriceX96, int24 tick)";
export const BIN_INITIALIZE_EVENT =
  "event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, address hooks, uint24 fee, bytes32 parameters, uint24 activeId)";
export const CL_SWAP_EVENT =
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee, uint16 protocolFee)";
export const BIN_SWAP_EVENT =
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint24 activeId, uint24 fee, uint16 protocolFee)";

/** `ProtocolFeeLibrary.PIPS_DENOMINATOR`. */
const PIPS = 1_000_000n;

const METRIC = {
  SWAP_FEES: "Token Swap Fees",
  LP_REVENUE: "Swap Fees To Liquidity Providers",
  PROTOCOL_REVENUE: "Swap Fees To Protocol",
};

const abs = (v: bigint): bigint => (v < 0n ? -v : v);

/**
 * Split one swap's fee.
 *
 * `gross` is the magnitude of the leg being priced. `fee` is the total rate and
 * `protocolFee` the protocol's slice of it, both in pips of the same base, so the
 * two subtract cleanly. Exported for unit testing against the Solidity libraries.
 */
export function splitSwapFee(
  gross: bigint,
  fee: bigint,
  protocolFee: bigint,
): { total: bigint; protocol: bigint; lp: bigint } {
  if (gross <= 0n || fee <= 0n) return { total: 0n, protocol: 0n, lp: 0n };
  // Only the low 12 bits are the single-direction fee (ProtocolFeeLibrary).
  const p = protocolFee & 0xfffn;
  const total = (gross * fee) / PIPS;
  // A protocolFee above the total swap fee is impossible on-chain; guard anyway so
  // a malformed log can never produce a negative supply-side number.
  const protocol = p >= fee ? total : (gross * p) / PIPS;
  return { total, protocol, lp: total - protocol };
}

/**
 * Unpack a `bytes32` written by `PackedUint128Math.encode(x1, x2)`.
 *
 *   encode  z := or(and(x1, MASK_128), shl(128, x2))
 *   decode  x1 := and(z, MASK_128) ; x2 := shr(128, z)
 *
 * so the LOW 128 bits are x1 and the HIGH 128 bits are x2. `BinPoolManager` pins
 * which is which:
 *   protocolFeesAccrued[key.currency0] += feeAmountToProtocol.decodeX();  // low
 *   protocolFeesAccrued[key.currency1] += feeAmountToProtocol.decodeY();  // high
 *
 * Not used by the swap path - bin `Swap` carries plain `int128 amount0/amount1`.
 * It is here because bin `Mint`/`Burn` emit `bytes32[] amounts` in this encoding,
 * and anyone extending this adapter to liquidity flow will need it. Guessing the
 * packing swaps the two tokens of every bin position.
 *
 * @returns `[amount0, amount1]`
 */
export function decodePackedUint128(word: string): [bigint, bigint] {
  const hex = word.replace(/^0[xX]/, "");
  if (!/^[0-9a-fA-F]{1,64}$/.test(hex))
    throw new Error(`decodePackedUint128: not a bytes32 word: ${word}`);
  const z = BigInt("0x" + hex);
  return [z & ((1n << 128n) - 1n), z >> 128n];
}

interface PoolManagerArgs {
  getLogs: FetchOptions["getLogs"];
  chain: string;
  /** Which pool manager. Decoding is keyed on this, never on topic0 alone. */
  target: string;
  fromBlock: number;
  initializeAbi: string;
  swapAbi: string;
  blacklistTokens: Set<string>;
  dailyVolume: ReturnType<FetchOptions["createBalances"]>;
  swapFees: ReturnType<FetchOptions["createBalances"]>;
  protocolRevenue: ReturnType<FetchOptions["createBalances"]>;
}

async function trackPoolManager({
  getLogs,
  chain,
  target,
  fromBlock,
  initializeAbi,
  swapAbi,
  blacklistTokens,
  dailyVolume,
  swapFees,
  protocolRevenue,
}: PoolManagerArgs) {
  // Pool id -> token pair. Scanned from genesis: this is small, slowly-changing
  // config data, which is what cacheInCloud is for. Scoped to ONE pool manager, so
  // a CL pool id can never be resolved with a Bin pool's currencies.
  const initLogs = await getLogs({
    target,
    fromBlock,
    eventAbi: initializeAbi,
    cacheInCloud: true,
  });

  const poolMap: Record<string, { currency0: string; currency1: string }> = {};
  for (const log of initLogs) {
    poolMap[String(log.id).toLowerCase()] = {
      currency0: log.currency0,
      currency1: log.currency1,
    };
  }

  // Window-scoped swaps, same target, that manager's own Swap abi.
  const swapLogs = await getLogs({ target, eventAbi: swapAbi });

  for (const log of swapLogs) {
    const pool = poolMap[String(log.id).toLowerCase()];
    // A Swap for a pool this manager never initialized cannot be attributed to a
    // token pair. Dropping it is the only safe option - it is not a zero.
    if (!pool) continue;

    const { currency0, currency1 } = pool;
    if (
      blacklistTokens.has(currency0.toLowerCase()) ||
      blacklistTokens.has(currency1.toLowerCase())
    )
      continue;

    const amount0 = abs(BigInt(log.amount0));
    const amount1 = abs(BigInt(log.amount1));
    const fee = BigInt(log.fee);
    const protocolFee = BigInt(log.protocolFee);

    const split0 = splitSwapFee(amount0, fee, protocolFee);
    const split1 = splitSwapFee(amount1, fee, protocolFee);

    // One side of the swap only, gross of fees - addOneToken picks the core asset
    // leg and takes the absolute value. The same (token0, token1) is passed every
    // time, so all three balances land on the same leg.
    addOneToken({
      chain,
      balances: dailyVolume,
      token0: currency0,
      amount0,
      token1: currency1,
      amount1,
    });
    // Unlabelled here on purpose: these two are working totals. The labels are
    // attached once, at the clone into each exported dimension, so a label never
    // ends up on two dimensions at different scales.
    addOneToken({
      chain,
      balances: swapFees,
      token0: currency0,
      amount0: split0.total,
      token1: currency1,
      amount1: split1.total,
    });
    addOneToken({
      chain,
      balances: protocolRevenue,
      token0: currency0,
      amount0: split0.protocol,
      token1: currency1,
      amount1: split1.protocol,
    });
  }
}

const fetch = async (options: FetchOptions) => {
  const config = chainConfig[options.chain];
  if (!isConfigured(config))
    throw new Error(`Latch: no deployment configured for chain ${options.chain}`);

  const dailyVolume = options.createBalances();
  const swapFees = options.createBalances();
  const protocolRevenue = options.createBalances();
  const blacklistTokens = new Set(
    (config.blacklistTokens ?? []).map((t) => t.toLowerCase()),
  );

  const managers: Array<[string, string, string]> = [];
  if (config.clPoolManager)
    managers.push([config.clPoolManager, CL_INITIALIZE_EVENT, CL_SWAP_EVENT]);
  if (config.binPoolManager)
    managers.push([config.binPoolManager, BIN_INITIALIZE_EVENT, BIN_SWAP_EVENT]);

  for (const [target, initializeAbi, swapAbi] of managers) {
    await trackPoolManager({
      getLogs: options.getLogs,
      chain: options.chain,
      target,
      fromBlock: config.fromBlock,
      initializeAbi,
      swapAbi,
      blacklistTokens,
      dailyVolume,
      swapFees,
      protocolRevenue,
    });
  }

  // Income statement.
  //
  // dailyFees              every pip the swapper paid. The protocol fee is taken
  //                        off the input first and the LP fee off the remainder, so
  //                        `fee` already covers both and this is the gross figure -
  //                        everything Latch could keep if it set the protocol fee
  //                        to the whole swap fee.
  // dailyUserFees          identical: swappers pay all of it. LPs are not charged,
  //                        and there is no borrow/mint/redeem fee anywhere.
  // dailySupplySideRevenue fee - protocolFee, the part that stays in the pool and
  //                        accrues to LP positions.
  // dailyRevenue           protocolFee, accrued into `protocolFeesAccrued` on the
  //                        pool manager and withdrawable by its owner via
  //                        `Vault.collectFee`. = dailyFees - dailySupplySideRevenue.
  // dailyProtocolRevenue   the same number: it all goes to the treasury.
  // dailyHoldersRevenue    omitted. Latch has no token, so there is no buyback,
  //                        burn or holder distribution to attribute.
  const dailyFees = swapFees.clone(1, METRIC.SWAP_FEES);
  const dailyUserFees = swapFees.clone(1, METRIC.SWAP_FEES);

  const lpRevenue = swapFees.clone(1);
  lpRevenue.subtract(protocolRevenue);
  const dailySupplySideRevenue = options.createBalances();
  dailySupplySideRevenue.add(lpRevenue, METRIC.LP_REVENUE);

  const dailyRevenue = protocolRevenue.clone(1, METRIC.PROTOCOL_REVENUE);
  const dailyProtocolRevenue = protocolRevenue.clone(1, METRIC.PROTOCOL_REVENUE);

  return {
    dailyVolume,
    dailyFees,
    dailyUserFees,
    dailySupplySideRevenue,
    dailyRevenue,
    dailyProtocolRevenue,
  };
};

const adapter: SimpleAdapter = {
  version: 2,
  // Swap logs are window-scoped, so an hourly pull is exact and cheap.
  pullHourly: true,
  fetch,
  adapter: {},
  methodology: {
    Volume: "Gross input of every swap on CLPoolManager and BinPoolManager, one leg per swap.",
    Fees: "Total swap fee paid by traders, read from the `fee` field of each Swap event (hundredths of a bip). The protocol fee is charged on the input before the LP fee, so this single field already covers both.",
    UserFees: "Same as Fees - traders pay the entire swap fee; liquidity providers are not charged.",
    Revenue:
      "The `protocolFee` slice of each swap, accrued to the pool manager and withdrawable to the Latch treasury.",
    ProtocolRevenue:
      "All of Revenue. Latch has no token, so nothing is diverted to holders.",
    SupplySideRevenue: "Swap fee minus the protocol slice - the part that accrues to liquidity providers.",
  },
  breakdownMethodology: {
    Fees: {
      [METRIC.SWAP_FEES]: "Total swap fee paid by traders across both pool managers.",
    },
    UserFees: {
      [METRIC.SWAP_FEES]: "Total swap fee paid by traders across both pool managers.",
    },
    Revenue: {
      [METRIC.PROTOCOL_REVENUE]: "Protocol fee slice of the swap fee, accrued to the treasury.",
    },
    ProtocolRevenue: {
      [METRIC.PROTOCOL_REVENUE]: "Protocol fee slice of the swap fee, accrued to the treasury.",
    },
    SupplySideRevenue: {
      [METRIC.LP_REVENUE]: "Swap fee remaining after the protocol slice, earned by liquidity providers.",
    },
  },
};

// Only chains with a real deployment are exported. An unconfigured chain would
// otherwise report a zero, which DefiLlama would cache as fact.
for (const [chain, config] of Object.entries(chainConfig)) {
  if (isConfigured(config)) (adapter.adapter as BaseAdapter)[chain] = { start: config.start };
}

export default adapter;
