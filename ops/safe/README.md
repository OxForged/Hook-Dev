# Safe batches

Import these into the Safe **Transaction Builder** — one signed transaction per
file, rather than one per call. Batching matters here beyond convenience: the
three accepts either all land or none do, so there is no half-migrated state
where the Vault answers to the Safe and the fee controllers still do not.

Safe (2 of 3), Robinhood Chain 4663:

    https://app.safe.global/home?safe=robinhood:0x715a6176946aDbD22c1B2021d321Fb3767ca3432

## robinhood-accept-ownership.json

Three `acceptOwnership()` calls — Vault, CLProtocolFeeController,
BinProtocolFeeController.

**Why this exists.** Every ownable in this protocol is `Ownable2Step`, so the
deploy script's `transferOwnership` only NOMINATES. Until the nominee accepts,
the deployer EOA is still the owner — and on the Vault that means one hot key
can call `registerApp`, which is irreversible. This batch is what actually
transfers control.

Simulated from the Safe before publishing: all three succeed, and
`pendingOwner()` is the Safe on all three.

### Steps

1. Open the Safe URL above → **Apps** → **Transaction Builder**
2. Drag the JSON in (or "Load from file")
3. Confirm it shows **3 transactions**, all with data `0x79ba5097` and value 0
4. Create → sign with two of the three owners → execute

### Afterwards

Check it landed, rather than trusting the UI:

    cast call 0x78e8359c6D34Df797b8A793dE8c7c6bffA97fB6c "owner()(address)" \
      --rpc-url https://rpc.mainnet.chain.robinhood.com

Expect `0x715a6176946aDbD22c1B2021d321Fb3767ca3432`. Do the same for
`0xb1cC5BDBADD19a2430131EaE332afD72fF6be64B` and
`0x320feB54e940741AeB037E3944F2C95afAEE84af`.

### This is not the destination

The Safe owning these is an INTERIM step. The end state is the timelocks:

    CUSTODY (48h)  0x63F08A697Cc003d5eA61787712C34438559a7428   Vault, pool managers
    POLICY  (6h)   0x1Da3AD33AB8151Af9EE91b90fA23fFdDFf9C0C3A   fee controllers

Those transfers are two-step as well, and a timelock can only accept through a
queued proposal — which is exactly why the Safe goes first: it accepts in
minutes, where a timelock would have left the Vault on a single hot key for 48
hours.

Still outstanding after this batch: the pool managers have no `pendingOwner` at
all (`09_TransferPoolManagerOwner` has not been run).
