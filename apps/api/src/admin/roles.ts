import { registry as sdkRegistry, requireDeployment } from "@latchprotocol/sdk";
import type { Address, Hex, PublicClient } from "viem";
import { ACCESS_CONTROL_VIEWS_ABI, SAFE_VIEWS_ABI } from "../chain/abis.js";

/**
 * Admin roles, derived from ON-CHAIN state (never from a database flag):
 *
 *   admin    an owner of the governance Safe (`getOwners()`)
 *   curator  holds CURATOR_ROLE on the SDK's LatchRegistry (`hasRole`)
 *   viewer   in ADMIN_VIEWER_ALLOWLIST (env) — the only off-chain role, and the
 *            weakest; it grants read access only
 *
 * `admin` implies `curator` and `viewer` for route checks; `curator` implies
 * `viewer`. Holding a role grants the right to SEE and PREPARE. The API never
 * signs or sends anything: on-chain actions are returned as Safe payloads.
 */

export type AdminRole = "admin" | "curator" | "viewer";

export interface RoleResolver {
  rolesFor(address: Address): Promise<AdminRole[]>;
}

export function impliedRoles(roles: readonly AdminRole[]): Set<AdminRole> {
  const out = new Set<AdminRole>(roles);
  if (out.has("admin")) {
    out.add("curator");
    out.add("viewer");
  }
  if (out.has("curator")) out.add("viewer");
  return out;
}

export function hasRole(roles: readonly string[], needed: AdminRole): boolean {
  return impliedRoles(roles.filter((r): r is AdminRole => r === "admin" || r === "curator" || r === "viewer")).has(needed);
}

/**
 * Why a session holds each role, in words an operator can check against chain
 * state. Derived from the role and the SDK address book; the grant itself came
 * from the read described.
 */
export function roleGrants(roles: readonly string[], chainId: number): { role: AdminRole; reason: string; source: string }[] {
  const d = requireDeployment(chainId);
  const out: { role: AdminRole; reason: string; source: string }[] = [];
  for (const r of roles) {
    if (r === "admin") out.push({ role: "admin", reason: "Safe owner", source: `getOwners() on the governance Safe ${d.governanceSafe} (chain ${chainId})` });
    else if (r === "curator") out.push({ role: "curator", reason: "Registry curator", source: `hasRole(CURATOR_ROLE) on LatchRegistry ${d.registry} (chain ${chainId})` });
    else if (r === "viewer") out.push({ role: "viewer", reason: "Viewer allowlist", source: "ADMIN_VIEWER_ALLOWLIST (off-chain, read-only)" });
  }
  return out;
}

export class OnChainRoleResolver implements RoleResolver {
  constructor(
    private readonly client: Pick<PublicClient, "readContract">,
    private readonly chainId: number,
    private readonly viewerAllowlist: readonly string[],
  ) {}

  async rolesFor(address: Address): Promise<AdminRole[]> {
    const d = requireDeployment(this.chainId);
    const who = address.toLowerCase();
    // Both reads must succeed: a failed read is an error, never "no role" and
    // never "keep the old role".
    const [owners, curator] = await Promise.all([
      this.client.readContract({ address: d.governanceSafe, abi: SAFE_VIEWS_ABI, functionName: "getOwners" }),
      this.client.readContract({
        address: d.registry,
        abi: ACCESS_CONTROL_VIEWS_ABI,
        functionName: "hasRole",
        args: [sdkRegistry.CURATOR_ROLE as Hex, address],
      }),
    ]);
    const roles: AdminRole[] = [];
    if ((owners as readonly string[]).some((o) => o.toLowerCase() === who)) roles.push("admin");
    if (curator) roles.push("curator");
    if (this.viewerAllowlist.some((v) => v.toLowerCase() === who)) roles.push("viewer");
    return roles;
  }
}
