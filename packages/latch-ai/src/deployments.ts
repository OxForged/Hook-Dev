// SPDX-License-Identifier: MIT
/**
 * Where Latch Protocol actually is.
 *
 * One chain today. Adding a chain is a new entry here and nothing else - no
 * tool in this package branches on chain id.
 *
 * Every address below is a deployed, verified contract. If a chain is not in
 * this table the tools return `unsupported_chain` rather than guessing, because
 * an agent told "no deployment on chain 8453" can act on that, while an agent
 * handed a plausible-looking wrong address cannot.
 */

import type { Address } from "viem";

export const SEPOLIA_CHAIN_ID = 11155111;

export interface LatchDeployment {
  readonly chainId: number;
  readonly chainName: string;
  readonly explorer: string;
  readonly vault: Address;
  readonly clPoolManager: Address;
  readonly binPoolManager: Address;
  readonly feeController: Address;
  /**
   * `LatchRegistry`, redeployed 2026-09-10 under its current name. Its API is
   * `getLatch` / `latchCount` / `latchAt` / `listLatches`.
   *
   * The predecessor at 0x665e7e5C419d004420C6Cb8c924E1E5Ca31F43DE answers the
   * old `hookCount()` API and still holds one listing. It is RETIRED, not
   * migrated, and is deliberately absent from this table: a tool that silently
   * fell back to it would report a listing that the live registry has never
   * heard of.
   */
  readonly registry: Address;
  /** 48h tier. Owns the Vault, because `registerApp` is irreversible. */
  readonly timelockCustody: Address;
  /** 6h tier. Owns fee policy, which is reversible. */
  readonly timelockPolicy: Address;
  readonly universalRouter: Address;
  readonly clPositionManager: Address;
  readonly clQuoter: Address;
  /** Log scans start here, not at genesis. */
  readonly deployedAtBlock: bigint;
}

export const DEPLOYMENTS: Readonly<Record<number, LatchDeployment>> = {
  [SEPOLIA_CHAIN_ID]: {
    chainId: SEPOLIA_CHAIN_ID,
    chainName: "Ethereum Sepolia",
    explorer: "https://sepolia.etherscan.io",
    vault: "0xCe3d133eb486b448A53437A5073619FbE424d01B",
    clPoolManager: "0xb7C8a11E0B359616eD06256783aF57114841F738",
    binPoolManager: "0xdBA93F91BA5B8535AE2b38be6a3A6CdcfDE6f6f3",
    feeController: "0xc1b7A4e61A4B6ceBA3e308425dc2390c2CE57ea9",
    registry: "0xB504da43C6ED342a511f3e5849f53035F2C807d1",
    timelockCustody: "0x35D72DbEeD5F2CE95a4DFb3917D2CD3c43e544CA",
    timelockPolicy: "0x30897C9e7c1c336cDF68C7494f930C75A355d42F",
    universalRouter: "0xB647CEbd5b8d6bE38C198634828187F482f4874B",
    clPositionManager: "0xb3505d48A84651c104a02D41B2b9D8CB84dFEC33",
    clQuoter: "0x4471e61fE697204908CA97CdF4810EeAf406e9C1",
    deployedAtBlock: 11672600n,
  },
};

export const SUPPORTED_CHAIN_IDS: readonly number[] = Object.values(DEPLOYMENTS).map(
  (d) => d.chainId,
);

/** The only chain with a deployment today; used as the default everywhere. */
export const DEFAULT_CHAIN_ID = SEPOLIA_CHAIN_ID;

export function deploymentFor(chainId: number): LatchDeployment | undefined {
  return DEPLOYMENTS[chainId];
}

export function explorerAddressUrl(d: LatchDeployment, address: string): string {
  return `${d.explorer}/address/${address}`;
}
