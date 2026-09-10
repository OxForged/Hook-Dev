// SPDX-License-Identifier: MIT
/**
 * A fake `PublicClient` good enough for the reads these tools make.
 *
 * Deliberately not a mock of viem: it dispatches on `functionName` and returns
 * whatever the test told it to. That keeps the tests about our behaviour - the
 * not-registered-versus-empty distinction, the error classification - rather
 * than about viem's decoding, which viem already tests.
 */

import type { PublicClient } from "viem";
import type { RawLatchRecord } from "@latchprotocol/sdk";

export const ZERO = "0x0000000000000000000000000000000000000000" as const;
export const ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

export interface FakeChain {
  readonly blockNumber?: bigint;
  readonly registered?: boolean;
  readonly record?: RawLatchRecord;
  readonly code?: string;
  readonly hookBitmap?: number;
  readonly latchCount?: bigint;
  readonly listLatches?: readonly string[];
  /** Reads that should blow up, by function name, to exercise error paths. */
  readonly throwOn?: Readonly<Record<string, Error>>;
}

export function fakeClient(chain: FakeChain): PublicClient {
  const boom = (fn: string): void => {
    const e = chain.throwOn?.[fn];
    if (e) throw e;
  };

  const client = {
    async getBlockNumber() {
      boom("getBlockNumber");
      return chain.blockNumber ?? 1_000n;
    },
    async getCode() {
      boom("getCode");
      return chain.code ?? "0x";
    },
    async getLogs() {
      boom("getLogs");
      return [];
    },
    async readContract(args: { functionName: string }) {
      boom(args.functionName);
      switch (args.functionName) {
        case "isRegistered":
          return chain.registered ?? false;
        case "getLatch":
          if (!chain.record) throw new Error("LatchNotRegistered()");
          return chain.record;
        case "getHooksRegistrationBitmap":
          if (chain.hookBitmap === undefined) throw new Error("execution reverted");
          return chain.hookBitmap;
        case "latchCount":
          return chain.latchCount ?? 0n;
        case "listLatches":
          return chain.listLatches ?? [];
        default:
          throw new Error(`fakeClient: unexpected read ${args.functionName}`);
      }
    },
  };

  return client as unknown as PublicClient;
}

/**
 * A registry record with every optional field at its zero value.
 *
 * This is the shape the tests use to prove the point the registry contract
 * makes by reverting: an empty record and a missing record must never look the
 * same, because an empty one decodes to "Unverified, Active, no permissions" -
 * the most reassuring possible description of a contract nobody looked at.
 */
export function emptyRawRecord(overrides: Partial<RawLatchRecord> = {}): RawLatchRecord {
  return {
    submitter: ZERO,
    submittedAt: 0n,
    permissions: 0,
    verification: 0,
    listing: 0,
    steward: ZERO,
    updatedAt: 0n,
    permissionsValid: true,
    permissionsReadable: true,
    codehash: ZERO_HASH,
    metadata: { name: "", description: "", sourceURI: "", auditURI: "", chainIds: [] },
    ...overrides,
  };
}
