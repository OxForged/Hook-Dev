// SPDX-License-Identifier: MIT
// Vault 0x78e8: every write function x3, lock-gated ones through VaultActor, plus unauthorized calls.
import { encodeFunctionData } from "viem";
import { ADDR } from "../addresses.mjs";
import { ABI, ACTORS, actorCall, ZERO, balanceOf, maxUint256 } from "../lib.mjs";
import { ERC20_ABI } from "../abis.mjs";

export async function run(ctx) {
  const { chain, rec, state } = ctx;
  const { alice, bob, carol, dave, mallory } = ACTORS;
  const { safe, vault } = ADDR;
  const V = ABI.Vault;
  const ACT = ABI["helpers/VaultActor"];
  const TK = ABI["helpers/CampaignToken"];
  const { TKA, TKB, TKC } = state.tokens;
  const actor = state.actor;
  const actor2 = state.actor2;
  const c = (fn, args, value = 0n) => actorCall(vault, V, fn, args, value);
  const tok = (t, fn, args) => actorCall(t, TK, fn, args);
  const runLock = (from, a, calls, o = {}) => rec.send({ from, to: a, abi: ACT, fn: "run", args: [calls], value: o.value ?? 0n, contract: "Vault", sig: o.label, note: o.note, expect: o.expect, expectError: o.expectError, role: o.role });
  const vbal = (who, cur) => chain.read(vault, V, "balanceOf", [who, cur]);

  // fund the actors with throwaway tokens
  for (const t of [TKA, TKB, TKC]) for (const a of [actor, actor2]) await rec.send({ from: alice, to: t, abi: TK, fn: "mint", args: [a, 10n ** 24n], role: "setup", contract: "CampaignToken" });

  rec.scenario("vault-lock-gated", "sync / settle / mint / burn / take / clear / settleFor inside lock via VaultActor, x3 each with different currencies and amounts");
  const amounts = [1_000n * 10n ** 18n, 7n * 10n ** 18n, 123_456_789n];
  const toks = [TKA, TKB, TKC];
  // sync + settle + mint (credit ERC-6909 to different recipients)
  for (let i = 0; i < 3; i++) {
    const [t, amt, to] = [toks[i], amounts[i], [alice, bob, actor][i]];
    const before = await vbal(to, t);
    await runLock(alice, actor, [c("sync", [t]), tok(t, "transfer", [vault, amt]), c("settle", []), c("mint", [to, t, amt])], { label: "mint", note: `lock{sync ${i}; transfer; settle; mint(${to})}` });
    rec.assert(`mint #${i + 1}: ERC-6909 balance +${amt}`, (await vbal(to, t)) - before, amt);
    rec.assert(`mint #${i + 1}: reserve cleared on lock exit`, (await chain.read(vault, V, "getVaultReserve"))[1], 0n);
  }
  // record sync/settle as their own entries x3 (same lock pattern, labelled by the function under test)
  for (let i = 0; i < 3; i++) await runLock(bob, actor, [c("sync", [toks[i]]), tok(toks[i], "transfer", [vault, amounts[i]]), c("settle", []), c("mint", [actor, toks[i], amounts[i]])], { label: "sync", note: "sync then settle" });
  for (let i = 0; i < 3; i++) await runLock(bob, actor, [c("sync", [toks[i]]), tok(toks[i], "transfer", [vault, amounts[i] / 2n]), c("settle", []), c("mint", [actor, toks[i], amounts[i] / 2n])], { label: "settle", note: "settle pays exactly the transferred amount" });
  // settleFor x3 (two ERC-20, one native)
  for (let i = 0; i < 2; i++) await runLock(alice, actor, [c("sync", [toks[i]]), tok(toks[i], "transfer", [vault, 5n * 10n ** 17n]), c("settleFor", [actor]), c("mint", [carol, toks[i], 5n * 10n ** 17n])], { label: "settleFor" });
  const nb = await vbal(dave, ZERO);
  await runLock(alice, actor, [c("settleFor", [actor], 10n ** 17n), c("mint", [dave, ZERO, 10n ** 17n])], { label: "settleFor", value: 10n ** 17n, note: "native settleFor with msg.value" });
  rec.assert("native settleFor + mint credited dave 0.1 native as ERC-6909", (await vbal(dave, ZERO)) - nb, 10n ** 17n);
  // burn + take x3: redeem actor's claims to different recipients
  for (let i = 0; i < 3; i++) {
    const [t, amt, to] = [toks[i], amounts[i] / 3n, [dave, carol, actor][i]];
    const b0 = await balanceOf(chain, t, to);
    await runLock(alice, actor, [c("burn", [actor, t, amt]), c("take", [t, to, amt])], { label: "burn", note: "burn own claims" });
    rec.assert(`burn+take #${i + 1}: ${to} received ${amt}`, (await balanceOf(chain, t, to)) - b0, amt);
  }
  for (let i = 0; i < 3; i++) await runLock(alice, actor, [c("burn", [actor, toks[i], 1000n + BigInt(i)]), c("take", [toks[i], bob, 1000n + BigInt(i)])], { label: "take" });
  // clear x3: forfeit a positive delta
  for (let i = 0; i < 3; i++) {
    const amt = [1n, 999n, 10n ** 18n][i];
    const vb = await balanceOf(chain, toks[i], vault);
    await runLock(alice, actor, [c("sync", [toks[i]]), tok(toks[i], "transfer", [vault, amt]), c("settle", []), c("clear", [toks[i], amt])], { label: "clear", note: "donates the settled amount to the vault" });
    rec.assert(`clear #${i + 1}: vault token balance +${amt} with no claim minted`, (await balanceOf(chain, toks[i], vault)) - vb, amt);
  }
  // lock x3 (empty, read-only, and a nested actor call sequence)
  await runLock(alice, actor, [], { label: "lock", note: "empty lock" });
  await runLock(bob, actor2, [c("sync", [TKA])], { label: "lock", note: "lock with only a sync; reserve must be zero after" });
  rec.assert("reserve zero after a sync-only lock (VaultReserve.clear on exit)", (await chain.read(vault, V, "getVaultReserve"))[1], 0n);
  await runLock(carol, actor, [c("sync", [TKB]), tok(TKB, "transfer", [vault, 10n]), c("settle", []), c("clear", [TKB, 10n])], { label: "lock", note: "lock by a third EOA through the actor" });

  rec.scenario("vault-lock-gated-unauthorized", "Every lock-gated function called outside a lock reverts NoLocker; failures inside a lock");
  for (const [fn, args, value] of [["sync", [TKA]], ["settle", [], 0n], ["settleFor", [alice], 0n], ["take", [TKA, mallory, 1n]], ["mint", [mallory, TKA, 1n]], ["burn", [mallory, TKA, 0n]], ["clear", [TKA, 0n]]]) {
    await rec.send({ from: mallory, to: vault, abi: V, fn, args, value: value ?? 0n, contract: "Vault", role: "unauthorized", expect: "revert", expectError: "NoLocker", note: "outside any lock" });
  }
  await runLock(mallory, actor2, [c("take", [TKA, mallory, 10n ** 18n])], { label: "take", role: "unauthorized", expect: "revert", expectError: "CurrencyNotSettled", note: "take without paying: lock refuses to close" });
  await runLock(mallory, actor2, [c("burn", [alice, TKA, 1n]), c("take", [TKA, mallory, 1n])], { label: "burn", role: "unauthorized", expect: "revert", expectError: "Panic", note: "burning someone else's claims without allowance underflows" });
  await runLock(mallory, actor2, [c("sync", [TKA]), c("clear", [TKA, 1n])], { label: "clear", role: "unauthorized", expect: "revert", expectError: "MustClearExactPositiveDelta" });
  await rec.send({ from: mallory, to: vault, abi: V, fn: "lock", args: ["0x"], contract: "Vault", role: "unauthorized", expect: "revert", note: "an EOA cannot take the lock (no lockAcquired callback)" });
  await rec.send({ from: mallory, to: actor, abi: ACT, fn: "lockAcquired", args: ["0x"], contract: "VaultActor", role: "unauthorized", expect: "revert", expectError: "NotVault" });

  rec.scenario("vault-erc6909", "transfer / approve / transferFrom / setOperator x3 on claims minted above");
  for (let i = 0; i < 3; i++) await rec.send({ from: alice, to: vault, abi: V, fn: "transfer", args: [[bob, carol, dave][i], TKA, BigInt(i + 1) * 10n ** 18n], contract: "Vault" });
  rec.assert("carol holds 2e18 TKA claims after transfer #2", await vbal(carol, TKA) >= 2n * 10n ** 18n, true);
  for (let i = 0; i < 3; i++) await rec.send({ from: alice, to: vault, abi: V, fn: "approve", args: [[carol, dave, bob][i], TKA, [5n * 10n ** 18n, maxUint256, 0n][i]], contract: "Vault" });
  rec.assert("allowance(alice, dave, TKA) == max", await chain.read(vault, V, "allowance", [alice, dave, TKA]), maxUint256);
  for (let i = 0; i < 3; i++) await rec.send({ from: [carol, dave, dave][i], to: vault, abi: V, fn: "transferFrom", args: [alice, [dave, carol, bob][i], TKA, 10n ** 17n], contract: "Vault" });
  rec.assert("allowance(alice, carol) decreased to 4.9e18", await chain.read(vault, V, "allowance", [alice, carol, TKA]), 49n * 10n ** 17n);
  for (let i = 0; i < 3; i++) await rec.send({ from: [bob, bob, carol][i], to: vault, abi: V, fn: "setOperator", args: [[carol, dave, alice][i], i !== 1], contract: "Vault" });
  await rec.send({ from: carol, to: vault, abi: V, fn: "transferFrom", args: [bob, carol, TKA, 10n ** 16n], contract: "Vault", note: "operator transfer without allowance" });
  await rec.send({ from: mallory, to: vault, abi: V, fn: "transferFrom", args: [alice, mallory, TKA, 1n], contract: "Vault", role: "unauthorized", expect: "revert", expectError: "Panic", note: "no allowance, no operator: underflow" });
  await rec.send({ from: mallory, to: vault, abi: V, fn: "transfer", args: [mallory, TKB, 10n ** 30n], contract: "Vault", role: "unauthorized", expect: "revert", expectError: "Panic", note: "insufficient claims" });
  rec.notExercised("Vault", "approve", "no access control to violate: approving your own claims is always permitted");
  rec.notExercised("Vault", "setOperator", "no access control to violate");

  rec.scenario("vault-apps", "registerApp x3 (Safe, current owner), then the three accountAppBalanceDelta overloads and collectFee by a registered app");
  const snapApps = await chain.snapshot();
  for (const app of [actor, actor2, dave]) await rec.send({ from: safe, to: vault, abi: V, fn: "registerApp", args: [app], contract: "Vault", note: "irreversible on mainnet; fork only" });
  await rec.send({ from: mallory, to: vault, abi: V, fn: "registerApp", args: [mallory], contract: "Vault", role: "unauthorized", expect: "revert", expectError: "OwnableUnauthorizedAccount" });
  rec.assert("isAppRegistered(actor)", await chain.read(vault, V, "isAppRegistered", [actor]), true);
  const pack = (a0, a1) => (BigInt.asUintN(128, a0) << 128n) | BigInt.asUintN(128, a1);
  const bd = (a0, a1) => BigInt.asIntN(256, pack(a0, a1));
  const X = 10n ** 20n;
  // overload (currency, int128, settler): app books a deposit, trader pays it
  for (let i = 0; i < 3; i++) {
    const t = toks[i];
    const r0 = await chain.read(vault, V, "reservesOfApp", [actor, t]);
    await runLock(alice, actor, [
      { target: vault, value: 0n, data: encodeFunctionData({ abi: V, functionName: "accountAppBalanceDelta", args: [t, -X, actor] }) },
      c("sync", [t]), tok(t, "transfer", [vault, X]), c("settle", []),
    ], { label: "accountAppBalanceDelta(address,int128,address)", note: "registered app books +reserve; settler pays" });
    rec.assert(`app reserve +${X} (overload 1, #${i + 1})`, (await chain.read(vault, V, "reservesOfApp", [actor, t])) - r0, X);
  }
  // overload (c0, c1, BalanceDelta, settler)
  const [c0, c1] = BigInt(TKA) < BigInt(TKB) ? [TKA, TKB] : [TKB, TKA];
  for (let i = 0; i < 3; i++) {
    const d0 = [X / 2n, X / 4n, 0n][i]; // total 3X/4 < the X reserve booked above: no deficit
    const d1 = [0n, X / 4n, X / 8n][i];
    const calls = [{ target: vault, value: 0n, data: encodeFunctionData({ abi: V, functionName: "accountAppBalanceDelta", args: [c0, c1, bd(d0, d1), actor] }) }];
    if (d0) calls.push(c("take", [c0, actor, d0]));
    if (d1) calls.push(c("take", [c1, actor, d1]));
    await runLock(alice, actor, calls, { label: "accountAppBalanceDelta(address,address,int256,address)", note: "app pays out of its reserve (positive delta), trader takes" });
  }
  // overload with hookDelta: settler and hook both the actor, net zero
  for (let i = 0; i < 3; i++) {
    const d = BigInt(i + 1) * 10n ** 18n;
    await runLock(alice, actor, [
      { target: vault, value: 0n, data: encodeFunctionData({ abi: V, functionName: "accountAppBalanceDelta", args: [c0, c1, bd(d, 0n), actor, bd(-d, 0n), actor] }) },
    ], { label: "accountAppBalanceDelta(address,address,int256,address,int256,address)", note: "delta and hookDelta cancel for the same address" });
  }
  await rec.send({ from: mallory, to: vault, abi: V, fn: "accountAppBalanceDelta", args: [TKA, -1n, mallory], contract: "Vault", sig: "accountAppBalanceDelta(address,int128,address)", role: "unauthorized", expect: "revert", expectError: "NoLocker" });
  await chain.revert(snapApps);
  const snap2 = await chain.snapshot();
  await rec.send({ from: safe, to: vault, abi: V, fn: "registerApp", args: [actor], contract: "Vault", role: "setup" });
  await runLock(mallory, actor2, [{ target: vault, value: 0n, data: encodeFunctionData({ abi: V, functionName: "accountAppBalanceDelta", args: [TKA, -1n, actor2] }) }], { label: "accountAppBalanceDelta(address,int128,address)", role: "unauthorized", expect: "revert", expectError: "AppUnregistered", note: "unregistered caller inside a lock" });
  await runLock(mallory, actor2, [{ target: vault, value: 0n, data: encodeFunctionData({ abi: V, functionName: "accountAppBalanceDelta", args: [c0, c1, 0n, actor2] }) }], { label: "accountAppBalanceDelta(address,address,int256,address)", role: "unauthorized", expect: "revert", expectError: "AppUnregistered" });
  await runLock(mallory, actor2, [{ target: vault, value: 0n, data: encodeFunctionData({ abi: V, functionName: "accountAppBalanceDelta", args: [c0, c1, 0n, actor2, 0n, actor2] }) }], { label: "accountAppBalanceDelta(address,address,int256,address,int256,address)", role: "unauthorized", expect: "revert", expectError: "AppUnregistered" });
  // collectFee x3: a registered app withdraws from its own reserve (no lock needed)
  await runLock(alice, actor, [
    { target: vault, value: 0n, data: encodeFunctionData({ abi: V, functionName: "accountAppBalanceDelta", args: [TKC, -X, actor] }) },
    c("sync", [TKC]), tok(TKC, "transfer", [vault, X]), c("settle", []),
  ], { label: "accountAppBalanceDelta(address,int128,address)", note: "seed reserve for collectFee" });
  for (let i = 0; i < 3; i++) {
    const to = [alice, bob, carol][i];
    const b0 = await balanceOf(chain, TKC, to);
    await rec.send({ from: alice, to: actor, abi: ACT, fn: "exec", args: [[c("collectFee", [TKC, BigInt(i + 1) * 10n ** 18n, to])]], contract: "Vault", sig: "collectFee", note: "registered app pulls from its reservesOfApp" });
    rec.assert(`collectFee #${i + 1}: ${to} +${i + 1}e18`, (await balanceOf(chain, TKC, to)) - b0, BigInt(i + 1) * 10n ** 18n);
  }
  await rec.send({ from: mallory, to: actor2, abi: ACT, fn: "exec", args: [[c("collectFee", [TKC, 1n, mallory])]], contract: "Vault", sig: "collectFee", role: "unauthorized", expect: "revert", expectError: "AppUnregistered" });
  await rec.send({ from: alice, to: actor, abi: ACT, fn: "exec", args: [[c("collectFee", [TKC, 10n ** 30n, mallory])]], contract: "Vault", sig: "collectFee", role: "unauthorized", expect: "revert", expectError: "Panic", note: "registered app cannot collect beyond its reserve" });
  rec.note("A registered app can move Vault funds only up to reservesOfApp[app] (collectFee) and via end-of-lock-settled deltas; a malicious registered app that books its own reserves still has to be paid first. The real risk of registerApp is a pool manager-class app that books OTHER users' deposits as its reserves.");
  await chain.revert(snap2);

  rec.scenario("vault-ownership", "transferOwnership x3 / acceptOwnership x3 (Ownable2Step), unauthorized both");
  for (let i = 0; i < 3; i++) {
    const s = await chain.snapshot();
    const nominee = [alice, bob, ADDR.timelockCustody][i];
    await rec.send({ from: safe, to: vault, abi: V, fn: "transferOwnership", args: [nominee], contract: "Vault" });
    await rec.send({ from: mallory, to: vault, abi: V, fn: "acceptOwnership", contract: "Vault", role: "unauthorized", expect: "revert", expectError: "OwnableUnauthorizedAccount" });
    await rec.send({ from: nominee, to: vault, abi: V, fn: "acceptOwnership", contract: "Vault", note: i === 2 ? "the timelock accepting directly (impersonated) - same end state as the queued op" : undefined });
    rec.assert(`Vault owner == nominee #${i + 1}`, await chain.read(vault, V, "owner"), nominee);
    await chain.revert(s);
  }
  await rec.send({ from: mallory, to: vault, abi: V, fn: "transferOwnership", args: [mallory], contract: "Vault", role: "unauthorized", expect: "revert", expectError: "OwnableUnauthorizedAccount" });
}
