// SPDX-License-Identifier: MIT
/**
 * `protocol_status` - where the protocol is and what state it is in.
 *
 * Every number here is read from chain at a stated block. Nothing is cached,
 * estimated, annualised or converted to a currency. On a testnet the figures
 * are small; they are reported small, because a dashboard whose numbers do not
 * mean anything is worse than no dashboard, and an agent that repeats an
 * invented TVL to a user has done real harm with a cosmetic feature.
 *
 * `poolCount` is `null`, not `0`, when the log query could not be served. A
 * public endpoint capping `eth_getLogs` is routine, and "unknown" is the true
 * answer where "zero" would be a fabrication.
 */

import { toJson } from "../json.js";
import type { LatchContext } from "../context.js";
import { readProtocolStatus } from "../reads.js";
import { ok, type LatchTool } from "../types.js";
import { toToolError } from "./common.js";

const CAVEATS: readonly string[] = [
  "Every figure is a snapshot at the stated block. Nothing here is cached and nothing is projected.",
  "There are no fiat values anywhere in this result. Testnet tokens have no price, and inventing one to make a number look meaningful is the failure this tool is designed to avoid.",
  "`poolCount: null` means the RPC endpoint would not serve the log range - it does NOT mean there are no pools.",
];

export function protocolStatusTool(ctx: LatchContext): LatchTool {
  return {
    name: "protocol_status",
    access: "read",
    returnsUntrustedText: false,
    description:
      "Report the live state of the Latch Protocol deployment on the configured chain: chain id and name, " +
      "current block, the addresses of the Vault, pool managers, registry, fee controller and timelocks, " +
      "whether each pool manager is registered with the Vault, the protocol fee settings and their cap, " +
      "the governance timelock delays, how many hooks are listed in the registry, and how many pools exist. " +
      "Use it to orient before any other call, or to check whether a deployment is live and configured. " +
      "Every value is read from chain at the stated block; no figure is estimated, cached or priced in fiat.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
    async handler() {
      try {
        const s = await readProtocolStatus(ctx);
        const d = ctx.deployment;

        return ok(
          toJson({
            chainId: ctx.chainId,
            chainName: d.chainName,
            blockNumber: s.blockNumber.toString(10),
            explorer: d.explorer,
            contracts: {
              vault: d.vault,
              clPoolManager: d.clPoolManager,
              binPoolManager: d.binPoolManager,
              registry: d.registry,
              protocolFeeController: d.feeController,
              universalRouter: d.universalRouter,
              clPositionManager: d.clPositionManager,
              clQuoter: d.clQuoter,
              timelockCustody: d.timelockCustody,
              timelockPolicy: d.timelockPolicy,
            },
            vault: {
              owner: s.vaultOwner,
              // registerApp is onlyOwner and IRREVERSIBLE - there is no
              // unregister - so this pairing is the highest-consequence fact in
              // the whole status report.
              clPoolManagerRegistered: s.clPoolManagerRegistered,
              binPoolManagerRegistered: s.binPoolManagerRegistered,
              note: "Vault.registerApp is owner-only and irreversible: there is no unregister function. A registered app can move funds against the Vault permanently, so Vault ownership is the highest-value key in the system.",
            },
            protocolFee: {
              defaultPips: s.defaultProtocolFeePips,
              maxPips: s.maxProtocolFeePips,
              maxPercent: s.maxProtocolFeePips / 10_000,
              disabled: s.protocolFeesDisabled,
              guardian: s.feeControllerGuardian,
              controllerOwner: s.feeControllerOwner,
              note: "Pips are parts per million. The protocol fee is set per pool and per direction, stacks on top of the LP fee as protocolFee + lpFee - (protocolFee * lpFee / 1e6), and is capped by the contract.",
            },
            governance: {
              custodyTimelockSeconds: Number(s.custodyTimelockSeconds),
              policyTimelockSeconds: Number(s.policyTimelockSeconds),
              note: "Two tiers: custody guards the irreversible calls (Vault ownership, registerApp), policy guards the reversible ones (fee settings).",
            },
            registry: {
              address: d.registry,
              listedCount: s.latchCount,
            },
            pools: {
              // null, never 0, when the range could not be served.
              count: s.pools?.poolCount ?? null,
              withHook: s.pools?.hookedPoolCount ?? null,
              scannedFromBlock: d.deployedAtBlock.toString(10),
            },
          }),
          CAVEATS,
          { chainId: ctx.chainId, blockNumber: s.blockNumber.toString(10) },
        );
      } catch (e) {
        return toToolError(e);
      }
    },
  };
}
