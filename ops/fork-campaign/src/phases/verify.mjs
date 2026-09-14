// SPDX-License-Identifier: MIT
// Phase 0: prove every snapshot artifact IS the deployed code before any function is exercised.
// Immutable slots (from the artifact's immutableReferences) are zeroed on both sides; nothing else
// is masked. All builds use bytecode_hash = "none", so there is no metadata hash to strip - a
// match is byte-for-byte outside immutables.
import { keccak256 } from "viem";
import { artifact } from "../abis.mjs";
import { DEPLOYED } from "../addresses.mjs";

function maskImmutables(hex, refs) {
  const b = hex.slice(2).toLowerCase().split("");
  for (const k of Object.keys(refs ?? {})) for (const { start, length } of refs[k]) for (let i = start * 2; i < (start + length) * 2; i++) b[i] = "0";
  return `0x${b.join("")}`;
}

export async function run(ctx) {
  const { chain, rec } = ctx;
  rec.scenario("verify-bytecode", "Runtime code on the fork vs snapshot artifact, immutables masked");
  let allOk = true;
  for (const [name, address, art] of DEPLOYED) {
    const a = artifact(art);
    const onchain = (await chain.code(address)).toLowerCase();
    const local = a.deployedBytecode.toLowerCase();
    const m1 = maskImmutables(onchain, a.immutableReferences);
    const m2 = maskImmutables(local, a.immutableReferences);
    const match = m1 === m2;
    allOk &&= match;
    const row = {
      contract: name,
      address,
      artifact: art,
      source: a.source,
      compiler: a.compiler,
      onchainBytes: (onchain.length - 2) / 2,
      artifactBytes: (local.length - 2) / 2,
      onchainCodeHash: keccak256(onchain),
      maskedHashOnchain: keccak256(m1),
      maskedHashArtifact: keccak256(m2),
      immutableRanges: Object.values(a.immutableReferences ?? {}).flat().length,
      match,
    };
    rec.results.codeVerification.push(row);
    rec.assert(`bytecode ${name} @ ${address}`, match, true);
  }
  return allOk;
}
