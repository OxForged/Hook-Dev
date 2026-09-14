// SPDX-License-Identifier: MIT
// CLPositionManager, BinPositionManager, CLQuoter, BinQuoter, UniversalRouter, Permit2 interactions.
// MUST-TEST: a new CL pool - create, add liquidity, collect fees, remove liquidity - on the real stack.
import { encodeAbiParameters, encodeFunctionData, keccak256, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ADDR } from "../addresses.mjs";
import { ABI, ACTORS, A, P, plan, clKey, binKey, poolId, Q96, BIN_ID_ONE, ZERO, ZERO32, MAX128, actorCall, balanceOf, maxUint160, maxUint48, maxUint256, POOL_KEY_COMPONENTS } from "../lib.mjs";
import { ANVIL_KEY_0 } from "../chain.mjs";
import { ERC20_ABI, EXTERNAL_ABI } from "../abis.mjs";
import { binAddParams } from "./setup.mjs";

/** Anvil key #1 (bob). Public; only ever used to produce a WRONG signer for negative tests on the fork. */
const ANVIL_KEY_1 = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const PERMIT_DETAILS = [{ name: "token", type: "address" }, { name: "amount", type: "uint160" }, { name: "expiration", type: "uint48" }, { name: "nonce", type: "uint48" }];

export async function run(ctx) {
  const { chain, rec, state } = ctx;
  const { alice, bob, carol, dave, erin, mallory } = ACTORS;
  const aliceSigner = privateKeyToAccount(ANVIL_KEY_0);
  const bobSigner = privateKeyToAccount(ANVIL_KEY_1);
  const { clPositionManager: POSM, binPositionManager: BPOSM, universalRouter: UR, clQuoter: CLQ, binQuoter: BQ, permit2: PERMIT2, clPoolManager: CLM, binPoolManager: BINM } = ADDR;
  const CPM = ABI.CLPositionManager, BPM = ABI.BinPositionManager, R = ABI.UniversalRouter, CL = ABI.CLPoolManager, BIN = ABI.BinPoolManager, TK = ABI["helpers/CampaignToken"], ACT = ABI["helpers/VaultActor"];
  const { TKA, TKB, TKC, TKD, TKE, TKF } = state.tokens;
  const ts = async () => (await chain.head()).timestamp;
  const dl = async () => (await ts()) + 3600n;
  const modify = async (from, steps, o = {}) => rec.send({ from, to: POSM, abi: CPM, fn: "modifyLiquidities", args: [plan(steps), o.deadline ?? (await dl())], contract: "CLPositionManager", ...o });
  const routerExec = async (from, commands, inputs, o = {}) =>
    o.noDeadline
      ? rec.send({ from, to: UR, abi: R, fn: "execute", args: [commands, inputs], sig: "execute(bytes,bytes[])", contract: "UniversalRouter", value: o.value ?? 0n, ...o })
      : rec.send({ from, to: UR, abi: R, fn: "execute", args: [commands, inputs, o.deadline ?? (await dl())], sig: "execute(bytes,bytes[],uint256)", contract: "UniversalRouter", value: o.value ?? 0n, ...o });
  const chainId = 4663;

  /* ============================ new CL pool lifecycle ============================ */
  rec.scenario("MUST new-cl-pool-lifecycle", "Create a CL pool, add liquidity, generate and collect fees, remove liquidity - CLPositionManager + UniversalRouter on the real Vault/CLPoolManager");
  const P1 = clKey(TKB, TKD, { fee: 3000, tickSpacing: 60 });
  const P1id = poolId(P1);
  await rec.send({ from: alice, to: POSM, abi: CPM, fn: "initializePool", args: [P1, Q96], contract: "CLPositionManager", note: "create" });
  rec.assert("new pool initialized (sqrtPrice == Q96)", (await chain.read(CLM, CL, "getSlot0", [P1id]))[0], Q96);
  const tid1 = await chain.read(POSM, CPM, "nextTokenId");
  const b0 = await balanceOf(chain, P1.currency0, alice);
  await modify(alice, [[A.CL_MINT_POSITION, P.clMint(P1, -1200, 1200, 10n ** 23n, MAX128, MAX128, alice)], [A.SETTLE_PAIR, P.pair(P1.currency0, P1.currency1)]], { note: "add liquidity: mint position" });
  rec.assert("position NFT owned by alice", await chain.read(POSM, CPM, "ownerOf", [tid1]), alice);
  rec.assert("position liquidity == 1e23", await chain.read(POSM, CPM, "getPositionLiquidity", [tid1]), 10n ** 23n);
  rec.assert("alice paid currency0 into the vault", b0 - (await balanceOf(chain, P1.currency0, alice)) > 0n, true);
  // fee-generating router swaps by bob, both directions
  for (const z of [true, false, true]) {
    const cin = z ? P1.currency0 : P1.currency1, cout = z ? P1.currency1 : P1.currency0;
    await routerExec(bob, "0x10", [plan([[A.CL_SWAP_EXACT_IN_SINGLE, P.clSwapExactInSingle(P1, z, 10n ** 21n, 0n)], [A.SETTLE_ALL, P.currencyAmount(cin, maxUint256)], [A.TAKE_ALL, P.currencyAmount(cout, 0n)]])], { note: `fee-generating swap ${z ? "0->1" : "1->0"}` });
  }
  const c0 = await balanceOf(chain, P1.currency0, alice), c1 = await balanceOf(chain, P1.currency1, alice);
  const collect = await modify(alice, [[A.CL_DECREASE_LIQUIDITY, P.clModify(tid1, 0n, 0n, 0n)], [A.TAKE_PAIR, P.pairTo(P1.currency0, P1.currency1, alice)]], { note: "collect fees: decrease 0 + TAKE_PAIR" });
  const f0 = (await balanceOf(chain, P1.currency0, alice)) - c0, f1 = (await balanceOf(chain, P1.currency1, alice)) - c1;
  rec.assert("collected fees in currency0 > 0 (two 0->1 swaps of 1e21 at 0.3% LP fee + protocol fee)", f0 > 0n, true);
  rec.assert("collected fees in currency1 > 0", f1 > 0n, true);
  await modify(alice, [[A.CL_INCREASE_LIQUIDITY, P.clModify(tid1, 5n * 10n ** 22n, MAX128, MAX128)], [A.SETTLE_PAIR, P.pair(P1.currency0, P1.currency1)]], { note: "increase liquidity" });
  await modify(alice, [[A.CL_DECREASE_LIQUIDITY, P.clModify(tid1, 10n ** 23n, 0n, 0n)], [A.TAKE_PAIR, P.pairTo(P1.currency0, P1.currency1, carol)]], { note: "partial remove to a different recipient" });
  rec.assert("liquidity after increase then partial remove == 5e22", await chain.read(POSM, CPM, "getPositionLiquidity", [tid1]), 5n * 10n ** 22n);
  await modify(mallory, [[A.CL_DECREASE_LIQUIDITY, P.clModify(tid1, 1n, 0n, 0n)], [A.TAKE_PAIR, P.pairTo(P1.currency0, P1.currency1, mallory)]], { role: "unauthorized", expect: "revert", expectError: "NotApproved", note: "mallory removes alice's liquidity" });
  await modify(alice, [[A.CL_BURN_POSITION, P.clBurn(tid1, 0n, 0n)], [A.TAKE_PAIR, P.pairTo(P1.currency0, P1.currency1, alice)]], { note: "remove all liquidity and burn the NFT" });
  rec.assert("pool active liquidity back to 0 after burn", await chain.read(CLM, CL, "getLiquidity", [P1id]), 0n);
  rec.results.extra = { newClPool: { poolId: P1id, tokenId: tid1.toString(), feesCollected: { currency0: f0.toString(), currency1: f1.toString() }, collectTx: collect.txHash } };
  await modify(alice, [[A.CL_MINT_POSITION, P.clMint(P1, -600, 600, 10n ** 22n, MAX128, MAX128, alice)], [A.SETTLE_PAIR, P.pair(P1.currency0, P1.currency1)]], { deadline: (await ts()) - 1n, role: "unauthorized", expect: "revert", expectError: "DeadlinePassed", note: "expired deadline" });

  /* ============================ CLPositionManager surface ============================ */
  rec.scenario("cl-position-manager", "initializePool, modifyLiquidities(WithoutLock), multicall, ERC-721 + permits, Permit2 forwarding, subscribe");
  const extraKeys = [clKey(TKB, TKE, { fee: 500, tickSpacing: 10 }), clKey(TKD, TKF, { fee: 100, tickSpacing: 1 }), clKey(TKA, TKF, { fee: 2500, tickSpacing: 50 })];
  for (let i = 0; i < 3; i++) await rec.send({ from: [alice, bob, carol][i], to: POSM, abi: CPM, fn: "initializePool", args: [extraKeys[i], Q96], contract: "CLPositionManager" });
  await rec.send({ from: mallory, to: POSM, abi: CPM, fn: "initializePool", args: [extraKeys[0], Q96], contract: "CLPositionManager", note: "already initialized: periphery SWALLOWS the error and returns int24.max (no revert by design)" });
  rec.notExercised("CLPositionManager", "initializePool", "permissionless; a duplicate initialize is swallowed by design, so there is no unauthorized revert to observe");
  // three positions for alice on base CL pool
  const base = state.baseCL.key;
  const tids = [];
  for (let i = 0; i < 3; i++) {
    tids.push(await chain.read(POSM, CPM, "nextTokenId"));
    await modify(alice, [[A.CL_MINT_POSITION, P.clMint(base, -60 * (i + 1), 60 * (i + 1), 10n ** 21n * BigInt(i + 1), MAX128, MAX128, alice)], [A.SETTLE_PAIR, P.pair(base.currency0, base.currency1)]], { note: `mint position ${i + 1}` });
  }
  // multicall x3
  const mk4 = clKey(TKC, TKE, { fee: 3000, tickSpacing: 60 });
  await rec.send({ from: alice, to: POSM, abi: CPM, fn: "multicall", args: [[
    encodeFunctionData({ abi: CPM, functionName: "initializePool", args: [mk4, Q96] }),
    encodeFunctionData({ abi: CPM, functionName: "modifyLiquidities", args: [plan([[A.CL_MINT_POSITION, P.clMint(mk4, -120, 120, 10n ** 21n, MAX128, MAX128, alice)], [A.SETTLE_PAIR, P.pair(mk4.currency0, mk4.currency1)]]), await dl()] }),
  ]], contract: "CLPositionManager", note: "initialize + mint in one multicall" });
  await rec.send({ from: bob, to: POSM, abi: CPM, fn: "multicall", args: [[encodeFunctionData({ abi: CPM, functionName: "revokeNonce", args: [900n] }), encodeFunctionData({ abi: CPM, functionName: "revokeNonce", args: [901n] })]], contract: "CLPositionManager" });
  await rec.send({ from: alice, to: POSM, abi: CPM, fn: "multicall", args: [[encodeFunctionData({ abi: CPM, functionName: "modifyLiquidities", args: [plan([[A.CL_INCREASE_LIQUIDITY, P.clModify(tids[0], 10n ** 20n, MAX128, MAX128)], [A.SETTLE_PAIR, P.pair(base.currency0, base.currency1)]]), await dl()] })]], contract: "CLPositionManager" });
  await rec.send({ from: mallory, to: POSM, abi: CPM, fn: "multicall", args: [[encodeFunctionData({ abi: CPM, functionName: "modifyLiquidities", args: [plan([[A.CL_BURN_POSITION, P.clBurn(tids[0], 0n, 0n)], [A.TAKE_PAIR, P.pairTo(base.currency0, base.currency1, mallory)]]), await dl()] })]], contract: "CLPositionManager", role: "unauthorized", expect: "revert", expectError: "NotApproved" });
  // modifyLiquiditiesWithoutLock x3 from inside a vault lock held by VaultActor
  const actor = state.actor;
  for (const t of [base.currency0, base.currency1]) {
    await rec.send({ from: alice, to: t, abi: TK, fn: "mint", args: [actor, 10n ** 26n], role: "setup", contract: "CampaignToken" });
    await rec.send({ from: alice, to: actor, abi: ACT, fn: "exec", args: [[actorCall(t, ERC20_ABI, "approve", [PERMIT2, maxUint256]), actorCall(PERMIT2, EXTERNAL_ABI, "approve", [t, POSM, maxUint160, Number(maxUint48)])]], role: "setup", contract: "VaultActor" });
  }
  for (let i = 0; i < 3; i++) {
    const inner = encodeFunctionData({ abi: CPM, functionName: "modifyLiquiditiesWithoutLock", args: [`0x${A.CL_MINT_POSITION.toString(16).padStart(2, "0")}${A.SETTLE_PAIR.toString(16).padStart(2, "0")}`, [P.clMint(base, -180, 180 + 60 * i, 10n ** 20n, MAX128, MAX128, actor), P.pair(base.currency0, base.currency1)]] });
    await rec.send({ from: alice, to: actor, abi: ACT, fn: "run", args: [[{ target: POSM, value: 0n, data: inner }]], contract: "CLPositionManager", sig: "modifyLiquiditiesWithoutLock", note: "called by a contract that already holds the vault lock" });
  }
  await rec.send({ from: mallory, to: POSM, abi: CPM, fn: "modifyLiquiditiesWithoutLock", args: [`0x0${A.CL_MINT_POSITION}0d`, [P.clMint(base, -60, 60, 1n, MAX128, MAX128, mallory), P.pair(base.currency0, base.currency1)]], contract: "CLPositionManager", role: "unauthorized", expect: "revert", note: "no vault lock held" });
  // ERC-721
  for (let i = 0; i < 3; i++) await rec.send({ from: alice, to: POSM, abi: CPM, fn: "approve", args: [[bob, carol, ZERO][i], tids[i]], contract: "CLPositionManager" });
  await rec.send({ from: mallory, to: POSM, abi: CPM, fn: "approve", args: [mallory, tids[2]], contract: "CLPositionManager", role: "unauthorized", expect: "revert", note: "not owner/operator" });
  for (let i = 0; i < 3; i++) await rec.send({ from: [alice, bob, alice][i], to: POSM, abi: CPM, fn: "setApprovalForAll", args: [[dave, erin, dave][i], i !== 2], contract: "CLPositionManager" });
  rec.notExercised("CLPositionManager", "setApprovalForAll", "no access control to violate: sets the caller's own operator");
  await rec.send({ from: bob, to: POSM, abi: CPM, fn: "transferFrom", args: [alice, carol, tids[0]], contract: "CLPositionManager", note: "approved spender" });
  await rec.send({ from: carol, to: POSM, abi: CPM, fn: "transferFrom", args: [carol, alice, tids[0]], contract: "CLPositionManager", note: "owner" });
  await rec.send({ from: alice, to: POSM, abi: CPM, fn: "transferFrom", args: [alice, dave, tids[2]], contract: "CLPositionManager" });
  await rec.send({ from: mallory, to: POSM, abi: CPM, fn: "transferFrom", args: [alice, mallory, tids[1]], contract: "CLPositionManager", role: "unauthorized", expect: "revert", note: "NOT_AUTHORIZED" });
  await rec.send({ from: alice, to: POSM, abi: CPM, fn: "safeTransferFrom", args: [alice, actor, tids[1]], sig: "safeTransferFrom(address,address,uint256)", contract: "CLPositionManager", note: "to a contract receiver" });
  await rec.send({ from: dave, to: POSM, abi: CPM, fn: "safeTransferFrom", args: [dave, alice, tids[2], "0x1234"], sig: "safeTransferFrom(address,address,uint256,bytes)", contract: "CLPositionManager" });
  await rec.send({ from: alice, to: POSM, abi: CPM, fn: "safeTransferFrom", args: [alice, ADDR.timelockCustody, tids[2], "0x"], sig: "safeTransferFrom(address,address,uint256,bytes)", contract: "CLPositionManager", note: "the timelock implements onERC721Received" });
  await rec.send({ from: alice, to: POSM, abi: CPM, fn: "safeTransferFrom", args: [alice, ADDR.vault, tids[0]], sig: "safeTransferFrom(address,address,uint256)", contract: "CLPositionManager", role: "unauthorized", expect: "revert", note: "receiver without onERC721Received (the Vault)" });
  // ERC-721 permit x3 and permitForAll x3 (signed by alice)
  const nftDomain = { name: "Pancakeswap Infinity Positions NFT", chainId, verifyingContract: POSM };
  const mintFor = async () => {
    const id = await chain.read(POSM, CPM, "nextTokenId");
    await modify(alice, [[A.CL_MINT_POSITION, P.clMint(base, -60, 60, 10n ** 19n, MAX128, MAX128, alice)], [A.SETTLE_PAIR, P.pair(base.currency0, base.currency1)]], { role: "setup" });
    return id;
  };
  for (let i = 0; i < 3; i++) {
    const id = await mintFor();
    const deadline = await dl();
    const nonce = BigInt(100 + i);
    const spender = [bob, carol, dave][i];
    const sig = await aliceSigner.signTypedData({ domain: nftDomain, types: { Permit: [{ name: "spender", type: "address" }, { name: "tokenId", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] }, primaryType: "Permit", message: { spender, tokenId: id, nonce, deadline } });
    await rec.send({ from: [erin, carol, bob][i], to: POSM, abi: CPM, fn: "permit", args: [spender, id, deadline, nonce, sig], sig: "permit(address,uint256,uint256,uint256,bytes)", contract: "CLPositionManager", note: "relayed by a third party" });
    rec.assert(`ERC-721 permit ${i + 1}: getApproved == spender`, await chain.read(POSM, CPM, "getApproved", [id]), spender);
    if (i === 0) {
      await rec.send({ from: erin, to: POSM, abi: CPM, fn: "permit", args: [spender, id, deadline, nonce, sig], sig: "permit(address,uint256,uint256,uint256,bytes)", contract: "CLPositionManager", role: "unauthorized", expect: "revert", expectError: "NonceAlreadyUsed", note: "replay" });
      const badSig = await bobSigner.signTypedData({ domain: nftDomain, types: { Permit: [{ name: "spender", type: "address" }, { name: "tokenId", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] }, primaryType: "Permit", message: { spender: mallory, tokenId: id, nonce: 777n, deadline } });
      await rec.send({ from: mallory, to: POSM, abi: CPM, fn: "permit", args: [mallory, id, deadline, 777n, badSig], sig: "permit(address,uint256,uint256,uint256,bytes)", contract: "CLPositionManager", role: "unauthorized", expect: "revert", expectError: "InvalidSigner", note: "signed by a non-owner" });
    }
  }
  for (let i = 0; i < 3; i++) {
    const deadline = await dl();
    const nonce = BigInt(200 + i);
    const operator = [erin, carol, bob][i];
    const approved = i !== 1;
    const sig = await aliceSigner.signTypedData({ domain: nftDomain, types: { PermitForAll: [{ name: "operator", type: "address" }, { name: "approved", type: "bool" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] }, primaryType: "PermitForAll", message: { operator, approved, nonce, deadline } });
    await rec.send({ from: bob, to: POSM, abi: CPM, fn: "permitForAll", args: [alice, operator, approved, deadline, nonce, sig], contract: "CLPositionManager" });
    rec.assert(`permitForAll ${i + 1}: isApprovedForAll == ${approved}`, await chain.read(POSM, CPM, "isApprovedForAll", [alice, operator]), approved);
  }
  await rec.send({ from: mallory, to: POSM, abi: CPM, fn: "permitForAll", args: [alice, mallory, true, await dl(), 999n, "0x" + "11".repeat(65)], contract: "CLPositionManager", role: "unauthorized", expect: "revert", note: "garbage signature" });
  for (let i = 0; i < 3; i++) await rec.send({ from: [alice, bob, carol][i], to: POSM, abi: CPM, fn: "revokeNonce", args: [BigInt(5000 + i)], contract: "CLPositionManager" });
  await rec.send({ from: alice, to: POSM, abi: CPM, fn: "revokeNonce", args: [100n], contract: "CLPositionManager", role: "unauthorized", expect: "revert", expectError: "NonceAlreadyUsed", note: "already-used nonce" });
  // Permit2 forwarding: permit / permitBatch x3 each
  const p2Domain = { name: "Permit2", chainId, verifyingContract: PERMIT2 };
  const permitSingle = async (signer, owner, token, spender, amount) => {
    const [, , nonce] = await chain.read(PERMIT2, EXTERNAL_ABI, "allowance", [owner, token, spender]);
    const msg = { details: { token, amount, expiration: Number((await ts()) + 86400n), nonce: Number(nonce) }, spender, sigDeadline: await dl() };
    const sig = await signer.signTypedData({ domain: p2Domain, types: { PermitSingle: [{ name: "details", type: "PermitDetails" }, { name: "spender", type: "address" }, { name: "sigDeadline", type: "uint256" }], PermitDetails: PERMIT_DETAILS }, primaryType: "PermitSingle", message: msg });
    return { msg, sig };
  };
  for (let i = 0; i < 3; i++) {
    const token = [TKC, TKD, TKE][i];
    const amount = BigInt(i + 1) * 10n ** 20n;
    const { msg, sig } = await permitSingle(aliceSigner, alice, token, POSM, amount);
    await rec.send({ from: [bob, carol, alice][i], to: POSM, abi: CPM, fn: "permit", args: [alice, msg, sig], sig: "permit(address,((address,uint160,uint48,uint48),address,uint256),bytes)", contract: "CLPositionManager" });
    rec.assert(`Permit2 allowance(alice, token ${i + 1}, POSM) == ${amount}`, (await chain.read(PERMIT2, EXTERNAL_ABI, "allowance", [alice, token, POSM]))[0], amount);
  }
  {
    const { msg } = await permitSingle(aliceSigner, alice, TKF, POSM, 42n);
    const { sig: bad } = await permitSingle(bobSigner, alice, TKF, POSM, 42n);
    const before = (await chain.read(PERMIT2, EXTERNAL_ABI, "allowance", [alice, TKF, POSM]))[0];
    await rec.send({ from: mallory, to: POSM, abi: CPM, fn: "permit", args: [alice, msg, bad], sig: "permit(address,((address,uint160,uint48,uint48),address,uint256),bytes)", contract: "CLPositionManager", note: "wrong signer: the forwarder SWALLOWS the Permit2 revert and returns it as bytes (by design, anti-front-run)" });
    rec.assert("wrong-signer Permit2 permit left the allowance unchanged", (await chain.read(PERMIT2, EXTERNAL_ABI, "allowance", [alice, TKF, POSM]))[0], before);
  }
  for (let i = 0; i < 3; i++) {
    const tokens = [[TKA], [TKB, TKC], [TKD, TKE]][i];
    const details = [];
    for (const t of tokens) {
      const [, , nonce] = await chain.read(PERMIT2, EXTERNAL_ABI, "allowance", [alice, t, BPOSM]);
      details.push({ token: t, amount: 10n ** 21n + BigInt(i), expiration: Number((await ts()) + 7200n), nonce: Number(nonce) });
    }
    const msg = { details, spender: BPOSM, sigDeadline: await dl() };
    const sig = await aliceSigner.signTypedData({ domain: p2Domain, types: { PermitBatch: [{ name: "details", type: "PermitDetails[]" }, { name: "spender", type: "address" }, { name: "sigDeadline", type: "uint256" }], PermitDetails: PERMIT_DETAILS }, primaryType: "PermitBatch", message: msg });
    await rec.send({ from: carol, to: POSM, abi: CPM, fn: "permitBatch", args: [alice, msg, sig], contract: "CLPositionManager", note: "batch for spender BinPositionManager, relayed through the CL position manager" });
    rec.assert(`permitBatch ${i + 1}: allowance(alice, ${tokens[0]}, BPOSM)`, (await chain.read(PERMIT2, EXTERNAL_ABI, "allowance", [alice, tokens[0], BPOSM]))[0], 10n ** 21n + BigInt(i));
  }
  rec.notExercised("CLPositionManager", "permit", "Permit2 overload: the forwarder swallows invalid signatures by design, so the negative case is asserted as 'allowance unchanged', not as a revert");
  // restore unlimited Permit2 allowances the permits just overwrote
  for (const t of [TKA, TKB, TKC, TKD, TKE]) for (const s of [POSM, BPOSM]) await rec.send({ from: alice, to: PERMIT2, abi: EXTERNAL_ABI, fn: "approve", args: [t, s, maxUint160, Number(maxUint48)], role: "setup", contract: "Permit2" });
  // subscribe / unsubscribe x3 (EOA subscribers: the notifier call succeeds with no code)
  const subArt = (await import("../abis.mjs")).artifact("helpers/CampaignSubscriber");
  const subs = [];
  for (let i = 0; i < 3; i++) subs.push(await rec.deploy({ from: alice, abi: subArt.abi, bytecode: subArt.bytecode, contract: "CampaignSubscriber" }));
  const subIds = [];
  for (let i = 0; i < 3; i++) subIds.push(await mintFor());
  for (let i = 0; i < 3; i++) {
    await rec.send({ from: alice, to: POSM, abi: CPM, fn: "subscribe", args: [subIds[i], subs[i], "0x"], contract: "CLPositionManager" });
    rec.assert(`subscriber(${i + 1}) set`, await chain.read(POSM, CPM, "subscriber", [subIds[i]]), subs[i]);
  }
  await rec.send({ from: mallory, to: POSM, abi: CPM, fn: "subscribe", args: [subIds[0], mallory, "0x"], contract: "CLPositionManager", role: "unauthorized", expect: "revert", expectError: "NotApproved" });
  await rec.send({ from: mallory, to: POSM, abi: CPM, fn: "unsubscribe", args: [subIds[0]], contract: "CLPositionManager", role: "unauthorized", expect: "revert", expectError: "NotApproved" });
  for (let i = 0; i < 3; i++) await rec.send({ from: alice, to: POSM, abi: CPM, fn: "unsubscribe", args: [subIds[i]], contract: "CLPositionManager" });
  await rec.send({ from: mallory, to: POSM, abi: CPM, fn: "lockAcquired", args: ["0x"], contract: "CLPositionManager", role: "unauthorized", expect: "revert", note: "only the vault may call back" });
  rec.notExercised("CLPositionManager", "lockAcquired", "vault-only callback; exercised implicitly by every modifyLiquidities above (3x+), directly only as the unauthorized call");

  /* ============================ BinPositionManager ============================ */
  rec.scenario("bin-position-manager", "initializePool, add/remove liquidity, WithoutLock, multicall, approveForAll, batchTransferFrom, Permit2 forwarding");
  const bkeys = [binKey(TKB, TKD, { fee: 3000, binStep: 20 }), binKey(TKB, TKE, { fee: 500, binStep: 5 }), binKey(TKC, TKF, { fee: 10000, binStep: 50 })];
  for (let i = 0; i < 3; i++) await rec.send({ from: [alice, bob, carol][i], to: BPOSM, abi: BPM, fn: "initializePool", args: [bkeys[i], BIN_ID_ONE + i], contract: "BinPositionManager" });
  rec.notExercised("BinPositionManager", "initializePool", "permissionless; duplicate initialize is swallowed by design");
  for (let i = 0; i < 3; i++) {
    const k = bkeys[i];
    await rec.send({ from: alice, to: BPOSM, abi: BPM, fn: "modifyLiquidities", args: [plan([[A.BIN_ADD_LIQUIDITY, binAddParams(k, BigInt(i + 1) * 10n ** 21n, alice, BIN_ID_ONE + i)], [A.SETTLE_PAIR, P.pair(k.currency0, k.currency1)]]), await dl()], contract: "BinPositionManager", note: `add over 5 bins, pool ${i + 1}` });
  }
  const bid = (k, bin) => BigInt(keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [poolId(k), BigInt(bin)])));
  for (let i = 0; i < 3; i++) {
    const k = bkeys[i];
    const bins = [BIN_ID_ONE + i - 1, BIN_ID_ONE + i, BIN_ID_ONE + i + 1];
    const amounts = [];
    for (const b of bins) amounts.push((await chain.read(BPOSM, BPM, "balanceOf", [alice, bid(k, b)])) / BigInt(i + 2));
    await rec.send({ from: alice, to: BPOSM, abi: BPM, fn: "modifyLiquidities", args: [plan([[A.BIN_REMOVE_LIQUIDITY, P.binRemove({ poolKey: k, amount0Min: 0n, amount1Min: 0n, ids: bins.map(BigInt), amounts, from: alice, hookData: "0x" })], [A.TAKE_PAIR, P.pairTo(k.currency0, k.currency1, alice)]]), await dl()], contract: "BinPositionManager", note: `remove 1/${i + 2} of 3 bins` });
  }
  await rec.send({ from: mallory, to: BPOSM, abi: BPM, fn: "modifyLiquidities", args: [plan([[A.BIN_REMOVE_LIQUIDITY, P.binRemove({ poolKey: bkeys[0], amount0Min: 0n, amount1Min: 0n, ids: [BigInt(BIN_ID_ONE)], amounts: [1n], from: alice, hookData: "0x" })], [A.TAKE_PAIR, P.pairTo(bkeys[0].currency0, bkeys[0].currency1, mallory)]]), await dl()], contract: "BinPositionManager", role: "unauthorized", expect: "revert", note: "remove someone else's liquidity" });
  for (const t of [bkeys[0].currency0, bkeys[0].currency1]) {
    await rec.send({ from: alice, to: t, abi: TK, fn: "mint", args: [actor, 10n ** 26n], role: "setup", contract: "CampaignToken" });
    await rec.send({ from: alice, to: actor, abi: ACT, fn: "exec", args: [[actorCall(t, ERC20_ABI, "approve", [PERMIT2, maxUint256]), actorCall(PERMIT2, EXTERNAL_ABI, "approve", [t, BPOSM, maxUint160, Number(maxUint48)])]], role: "setup", contract: "VaultActor" });
  }
  for (let i = 0; i < 3; i++) {
    const inner = encodeFunctionData({ abi: BPM, functionName: "modifyLiquiditiesWithoutLock", args: [`0x${A.BIN_ADD_LIQUIDITY.toString(16)}${A.SETTLE_PAIR.toString(16).padStart(2, "0")}`, [binAddParams(bkeys[0], BigInt(i + 1) * 10n ** 19n, actor, BIN_ID_ONE), P.pair(bkeys[0].currency0, bkeys[0].currency1)]] });
    await rec.send({ from: alice, to: actor, abi: ACT, fn: "run", args: [[{ target: BPOSM, value: 0n, data: inner }]], contract: "BinPositionManager", sig: "modifyLiquiditiesWithoutLock" });
  }
  await rec.send({ from: mallory, to: BPOSM, abi: BPM, fn: "modifyLiquiditiesWithoutLock", args: [`0x${A.BIN_ADD_LIQUIDITY.toString(16)}0d`, [binAddParams(bkeys[0], 1n, mallory), P.pair(bkeys[0].currency0, bkeys[0].currency1)]], contract: "BinPositionManager", role: "unauthorized", expect: "revert", note: "no vault lock held" });
  for (let i = 0; i < 3; i++) {
    const k = bkeys[i];
    await rec.send({ from: bob, to: BPOSM, abi: BPM, fn: "multicall", args: [[encodeFunctionData({ abi: BPM, functionName: "modifyLiquidities", args: [plan([[A.BIN_ADD_LIQUIDITY, binAddParams(k, 10n ** 20n, bob, BIN_ID_ONE + i)], [A.SETTLE_PAIR, P.pair(k.currency0, k.currency1)]]), await dl()] })]], contract: "BinPositionManager" });
  }
  for (let i = 0; i < 3; i++) await rec.send({ from: [alice, alice, bob][i], to: BPOSM, abi: BPM, fn: "approveForAll", args: [[carol, dave, carol][i], i !== 1], contract: "BinPositionManager" });
  rec.notExercised("BinPositionManager", "approveForAll", "no access control to violate");
  for (let i = 0; i < 3; i++) {
    const k = bkeys[0];
    const ids = [bid(k, BIN_ID_ONE), bid(k, BIN_ID_ONE + 1)];
    const amts = [];
    for (const id of ids) amts.push((await chain.read(BPOSM, BPM, "balanceOf", [alice, id])) / 10n);
    await rec.send({ from: [carol, alice, carol][i], to: BPOSM, abi: BPM, fn: "batchTransferFrom", args: [alice, [erin, bob, dave][i], ids, amts], contract: "BinPositionManager", note: i === 1 ? "owner" : "approved operator" });
  }
  await rec.send({ from: mallory, to: BPOSM, abi: BPM, fn: "batchTransferFrom", args: [alice, mallory, [bid(bkeys[0], BIN_ID_ONE)], [1n]], contract: "BinPositionManager", role: "unauthorized", expect: "revert" });
  for (let i = 0; i < 3; i++) {
    const token = [TKB, TKD, TKF][i];
    const { msg, sig } = await permitSingle(aliceSigner, alice, token, BPOSM, maxUint160 - BigInt(i));
    await rec.send({ from: bob, to: BPOSM, abi: BPM, fn: "permit", args: [alice, msg, sig], contract: "BinPositionManager" });
    rec.assert(`BinPositionManager.permit ${i + 1} set allowance`, (await chain.read(PERMIT2, EXTERNAL_ABI, "allowance", [alice, token, BPOSM]))[0], maxUint160 - BigInt(i));
  }
  for (let i = 0; i < 3; i++) {
    const tokens = [[TKA], [TKC, TKE], [TKB]][i];
    const details = [];
    for (const t of tokens) {
      const [, , nonce] = await chain.read(PERMIT2, EXTERNAL_ABI, "allowance", [alice, t, UR]);
      details.push({ token: t, amount: maxUint160 - 1000n - BigInt(i), expiration: Number((await ts()) + 7200n), nonce: Number(nonce) });
    }
    const msg = { details, spender: UR, sigDeadline: await dl() };
    const sig = await aliceSigner.signTypedData({ domain: p2Domain, types: { PermitBatch: [{ name: "details", type: "PermitDetails[]" }, { name: "spender", type: "address" }, { name: "sigDeadline", type: "uint256" }], PermitDetails: PERMIT_DETAILS }, primaryType: "PermitBatch", message: msg });
    await rec.send({ from: erin, to: BPOSM, abi: BPM, fn: "permitBatch", args: [alice, msg, sig], contract: "BinPositionManager" });
  }
  rec.notExercised("BinPositionManager", "permit", "forwarder swallows invalid signatures by design");
  rec.notExercised("BinPositionManager", "permitBatch", "forwarder swallows invalid signatures by design");
  await rec.send({ from: mallory, to: BPOSM, abi: BPM, fn: "lockAcquired", args: ["0x"], contract: "BinPositionManager", role: "unauthorized", expect: "revert" });
  rec.notExercised("BinPositionManager", "lockAcquired", "vault-only callback; exercised implicitly by every modifyLiquidities");
  for (const t of [TKA, TKB, TKC, TKD, TKE, TKF]) for (const s of [POSM, BPOSM, UR]) await rec.send({ from: alice, to: PERMIT2, abi: EXTERNAL_ABI, fn: "approve", args: [t, s, maxUint160, Number(maxUint48)], role: "setup", contract: "Permit2" });

  /* ============================ Quoters ============================ */
  rec.scenario("quoters", "Every quote function x3 as a transaction; exact-in quote equals the router's actual output");
  const QS = (k, z, amt) => ({ poolKey: k, zeroForOne: z, exactAmount: amt, hookData: "0x" });
  const bQS = (k, z, amt) => ({ poolKey: k, zeroForOne: z, exactAmount: amt, hookData: "0x" });
  const bk = state.baseBin.key;
  const PK = (inter, k) => ({ intermediateCurrency: inter, fee: k.fee, hooks: k.hooks, poolManager: k.poolManager, hookData: "0x", parameters: k.parameters });
  const amounts3 = [10n ** 18n, 5n * 10n ** 19n, 12345n];
  for (let i = 0; i < 3; i++) {
    const z = i % 2 === 0;
    await rec.send({ from: [alice, bob, mallory][i], to: CLQ, abi: ABI.CLQuoter, fn: "quoteExactInputSingle", args: [QS(base, z, amounts3[i])], contract: "CLQuoter" });
    await rec.send({ from: alice, to: CLQ, abi: ABI.CLQuoter, fn: "quoteExactOutputSingle", args: [QS(base, z, amounts3[i])], contract: "CLQuoter" });
    await rec.send({ from: alice, to: CLQ, abi: ABI.CLQuoter, fn: "quoteExactInput", args: [{ exactCurrency: base.currency0, path: [PK(base.currency1, base)], exactAmount: amounts3[i] }], contract: "CLQuoter" });
    await rec.send({ from: alice, to: CLQ, abi: ABI.CLQuoter, fn: "quoteExactOutput", args: [{ exactCurrency: base.currency1, path: [PK(base.currency0, base)], exactAmount: amounts3[i] }], contract: "CLQuoter" });
    await rec.send({ from: alice, to: CLQ, abi: ABI.CLQuoter, fn: "quoteExactInputSingleList", args: [[QS(base, z, amounts3[i]), QS(base, !z, amounts3[i])]], contract: "CLQuoter" });
    await rec.send({ from: [alice, bob, mallory][i], to: BQ, abi: ABI.BinQuoter, fn: "quoteExactInputSingle", args: [bQS(bk, z, amounts3[i])], contract: "BinQuoter" });
    await rec.send({ from: alice, to: BQ, abi: ABI.BinQuoter, fn: "quoteExactOutputSingle", args: [bQS(bk, z, amounts3[i])], contract: "BinQuoter" });
    await rec.send({ from: alice, to: BQ, abi: ABI.BinQuoter, fn: "quoteExactInput", args: [{ exactCurrency: bk.currency0, path: [PK(bk.currency1, bk)], exactAmount: amounts3[i] }], contract: "BinQuoter" });
    await rec.send({ from: alice, to: BQ, abi: ABI.BinQuoter, fn: "quoteExactOutput", args: [{ exactCurrency: bk.currency1, path: [PK(bk.currency0, bk)], exactAmount: amounts3[i] }], contract: "BinQuoter" });
    await rec.send({ from: alice, to: BQ, abi: ABI.BinQuoter, fn: "quoteExactInputSingleList", args: [[bQS(bk, z, amounts3[i])]], contract: "BinQuoter" });
  }
  for (const [Q, QN, key] of [[CLQ, "CLQuoter", base], [BQ, "BinQuoter", bk]]) {
    for (const fn of ["_quoteExactInputSingle", "_quoteExactOutputSingle"]) await rec.send({ from: mallory, to: Q, abi: ABI[QN], fn, args: [QS(key, true, 1n)], contract: QN, role: "unauthorized", expect: "revert", expectError: "NotSelf" });
    await rec.send({ from: mallory, to: Q, abi: ABI[QN], fn: "_quoteExactInputSingleList", args: [[QS(key, true, 1n)]], contract: QN, role: "unauthorized", expect: "revert", expectError: "NotSelf" });
    for (const fn of ["_quoteExactInput", "_quoteExactOutput"]) await rec.send({ from: mallory, to: Q, abi: ABI[QN], fn, args: [{ exactCurrency: key.currency0, path: [PK(key.currency1, key)], exactAmount: 1n }], contract: QN, role: "unauthorized", expect: "revert", expectError: "NotSelf" });
    await rec.send({ from: mallory, to: Q, abi: ABI[QN], fn: "lockAcquired", args: ["0x"], contract: QN, role: "unauthorized", expect: "revert" });
    for (const fn of ["_quoteExactInputSingle", "_quoteExactOutputSingle", "_quoteExactInputSingleList", "_quoteExactInput", "_quoteExactOutput", "lockAcquired"]) rec.notExercised(QN, fn, "self-only / vault-only internal entrypoint: exercised via the public quote functions above; directly only as the unauthorized call");
  }
  const [quoted] = await chain.read(CLQ, ABI.CLQuoter, "quoteExactInputSingle", [QS(base, true, 3n * 10n ** 18n)]);
  const outBefore = await balanceOf(chain, base.currency1, carol);
  await routerExec(carol, "0x10", [plan([[A.CL_SWAP_EXACT_IN_SINGLE, P.clSwapExactInSingle(base, true, 3n * 10n ** 18n, quoted)], [A.SETTLE_ALL, P.currencyAmount(base.currency0, maxUint256)], [A.TAKE_ALL, P.currencyAmount(base.currency1, quoted)]])], { note: "amountOutMinimum = quoted amount" });
  rec.assert("CLQuoter exact-in quote == router actual output", (await balanceOf(chain, base.currency1, carol)) - outBefore, quoted);

  /* ============================ UniversalRouter ============================ */
  rec.scenario("universal-router", "execute (both overloads) x3+ across CL/Bin swaps, multi-hop, exact-out, pool init and PERMIT2_PERMIT; owner functions by the Safe");
  const swapIn = (k, z, amt, min = 0n) => [[A.CL_SWAP_EXACT_IN_SINGLE, P.clSwapExactInSingle(k, z, amt, min)], [A.SETTLE_ALL, P.currencyAmount(z ? k.currency0 : k.currency1, maxUint256)], [A.TAKE_ALL, P.currencyAmount(z ? k.currency1 : k.currency0, min)]];
  await routerExec(dave, "0x10", [plan(swapIn(base, true, 10n ** 18n))], { note: "CL exact-in single" });
  await routerExec(dave, "0x10", [plan([[A.CL_SWAP_EXACT_OUT_SINGLE, P.clSwapExactOutSingle(base, false, 10n ** 18n, maxUint256 >> 128n)], [A.SETTLE_ALL, P.currencyAmount(base.currency1, maxUint256)], [A.TAKE_ALL, P.currencyAmount(base.currency0, 0n)]])], { note: "CL exact-out single" });
  await routerExec(dave, "0x10", [plan([[A.BIN_SWAP_EXACT_IN_SINGLE, P.binSwapExactInSingle(bk, true, 10n ** 18n, 0n)], [A.SETTLE_ALL, P.currencyAmount(bk.currency0, maxUint256)], [A.TAKE_ALL, P.currencyAmount(bk.currency1, 0n)]])], { note: "Bin exact-in single" });
  // multi-hop TKA -> TKB (base CL) -> TKD (P1 needs liquidity again)
  await modify(alice, [[A.CL_MINT_POSITION, P.clMint(P1, -6000, 6000, 10n ** 23n, MAX128, MAX128, alice)], [A.SETTLE_PAIR, P.pair(P1.currency0, P1.currency1)]], { role: "setup" });
  const hopIn = encodeAbiParameters([{ type: "tuple", components: [{ name: "currencyIn", type: "address" }, { name: "path", type: "tuple[]", components: [{ name: "intermediateCurrency", type: "address" }, { name: "fee", type: "uint24" }, { name: "hooks", type: "address" }, { name: "poolManager", type: "address" }, { name: "hookData", type: "bytes" }, { name: "parameters", type: "bytes32" }] }, { name: "amountIn", type: "uint128" }, { name: "amountOutMinimum", type: "uint128" }] }], [{ currencyIn: TKA, path: [PK(TKB, base), PK(TKD, P1)], amountIn: 10n ** 18n, amountOutMinimum: 0n }]);
  const d0 = await balanceOf(chain, TKD, bob);
  await routerExec(bob, "0x10", [plan([[A.CL_SWAP_EXACT_IN, hopIn], [A.SETTLE_ALL, P.currencyAmount(TKA, maxUint256)], [A.TAKE_ALL, P.currencyAmount(TKD, 0n)]])], { noDeadline: true, note: "2-hop exact-in, no-deadline overload" });
  rec.assert("2-hop TKA->TKB->TKD delivered TKD to bob", (await balanceOf(chain, TKD, bob)) > d0, true);
  const ik = clKey(TKE, TKF, { fee: 3000, tickSpacing: 60 });
  const ibk = binKey(TKE, TKF, { fee: 3000, binStep: 10 });
  await routerExec(carol, "0x1314", [encodeAbiParameters([{ type: "tuple", components: POOL_KEY_COMPONENTS }, { type: "uint160" }], [ik, Q96]), encodeAbiParameters([{ type: "tuple", components: POOL_KEY_COMPONENTS }, { type: "uint24" }], [ibk, BIN_ID_ONE])], { noDeadline: true, note: "INFI_CL_INITIALIZE_POOL + INFI_BIN_INITIALIZE_POOL" });
  rec.assert("router-initialized CL pool exists", (await chain.read(CLM, CL, "getSlot0", [poolId(ik)]))[0], Q96);
  // PERMIT2_PERMIT + swap for a signer with only an ERC-20 approval to Permit2
  await rec.send({ from: alice, to: PERMIT2, abi: EXTERNAL_ABI, fn: "approve", args: [base.currency0, UR, 0n, 0], role: "setup", contract: "Permit2", note: "zero alice's router allowance first" });
  const { msg: rp, sig: rsig } = await permitSingle(aliceSigner, alice, base.currency0, UR, 10n ** 20n);
  const permitInput = encodeAbiParameters([{ type: "tuple", components: [{ name: "details", type: "tuple", components: PERMIT_DETAILS }, { name: "spender", type: "address" }, { name: "sigDeadline", type: "uint256" }] }, { type: "bytes" }], [rp, rsig]);
  await routerExec(alice, "0x0a10", [permitInput, plan(swapIn(base, true, 10n ** 18n))], { noDeadline: true, note: "PERMIT2_PERMIT then INFI_SWAP in one execute" });
  await routerExec(bob, "0x0510", [encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }], [ZERO, carol, 0n]), plan(swapIn(base, false, 10n ** 17n))], { noDeadline: true, note: "TRANSFER(native 0) + swap" });
  // negative
  await routerExec(dave, "0x10", [plan(swapIn(base, true, 10n ** 18n))], { deadline: (await ts()) - 1n, role: "unauthorized", expect: "revert", expectError: "TransactionDeadlinePassed" });
  await routerExec(dave, "0x10", [plan(swapIn(base, true, 10n ** 18n, 10n ** 30n))], { role: "unauthorized", expect: "revert", expectError: "TooLittleReceived", note: "slippage guard" });
  await routerExec(mallory, "0x10", [plan(swapIn(base, true, 10n ** 18n))], { role: "unauthorized", expect: "revert", note: "no Permit2 allowance" });
  // owner functions (Safe owns the router)
  for (let i = 0; i < 3; i++) {
    await rec.send({ from: ADDR.safe, to: UR, abi: R, fn: "pause", contract: "UniversalRouter" });
    if (i === 0) await routerExec(dave, "0x10", [plan(swapIn(base, true, 10n ** 18n))], { role: "unauthorized", expect: "revert", expectError: "EnforcedPause", note: "execute while paused" });
    await rec.send({ from: ADDR.safe, to: UR, abi: R, fn: "unpause", contract: "UniversalRouter" });
  }
  await rec.send({ from: mallory, to: UR, abi: R, fn: "pause", contract: "UniversalRouter", role: "unauthorized", expect: "revert", expectError: "OwnableUnauthorizedAccount" });
  await rec.send({ from: mallory, to: UR, abi: R, fn: "unpause", contract: "UniversalRouter", role: "unauthorized", expect: "revert" });
  for (let i = 0; i < 3; i++) await rec.send({ from: ADDR.safe, to: UR, abi: R, fn: "setStableSwap", args: [[carol, dave, erin][i], [dave, erin, carol][i]], contract: "UniversalRouter", note: "stable swap is not deployed on 4663; arbitrary non-zero addresses" });
  await rec.send({ from: ADDR.safe, to: UR, abi: R, fn: "setStableSwap", args: [ZERO, carol], contract: "UniversalRouter", role: "unauthorized", expect: "revert", note: "zero address rejected" });
  await rec.send({ from: mallory, to: UR, abi: R, fn: "setStableSwap", args: [carol, carol], contract: "UniversalRouter", role: "unauthorized", expect: "revert", expectError: "OwnableUnauthorizedAccount" });
  for (const nominee of [alice, bob, ADDR.timelockPolicy]) {
    const s = await chain.snapshot();
    await rec.send({ from: ADDR.safe, to: UR, abi: R, fn: "transferOwnership", args: [nominee], contract: "UniversalRouter" });
    if (nominee === alice) await rec.send({ from: mallory, to: UR, abi: R, fn: "acceptOwnership", contract: "UniversalRouter", role: "unauthorized", expect: "revert", expectError: "OwnableUnauthorizedAccount" });
    await rec.send({ from: nominee, to: UR, abi: R, fn: "acceptOwnership", contract: "UniversalRouter" });
    await chain.revert(s);
  }
  await rec.send({ from: mallory, to: UR, abi: R, fn: "transferOwnership", args: [mallory], contract: "UniversalRouter", role: "unauthorized", expect: "revert", expectError: "OwnableUnauthorizedAccount" });
  await rec.send({ from: mallory, to: UR, abi: R, fn: "lockAcquired", args: ["0x"], contract: "UniversalRouter", role: "unauthorized", expect: "revert" });
  await rec.send({ from: mallory, to: UR, abi: R, fn: "pancakeV3SwapCallback", args: [1n, 1n, encodeAbiParameters([{ type: "bytes" }, { type: "address" }], ["0x", mallory])], contract: "UniversalRouter", role: "unauthorized", expect: "revert", note: "no V3 factory on this chain" });
  rec.notExercised("UniversalRouter", "lockAcquired", "vault-only callback, exercised by every INFI_SWAP");
  rec.notExercised("UniversalRouter", "pancakeV3SwapCallback", "no PancakeSwap V3 deployment on 4663 (Infinity-only by owner decision); only the unauthorized call is meaningful");
}
