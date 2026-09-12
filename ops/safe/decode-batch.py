#!/usr/bin/env python3
"""Decode every transaction in a Safe Transaction Builder batch with `cast 4byte-decode`.

    python ops/safe/decode-batch.py ops/safe/<batch>.json

For each transaction it prints `to`, `value`, the `_comment` the author wrote, and what
the calldata ACTUALLY says according to the 4byte signature database, so a signer can
compare the two before importing the file into the Safe UI. A batch whose comments and
calldata disagree must not be signed.

Needs foundry's `cast` on PATH and network access for the 4byte lookup. For an offline
check, supply the signature yourself:

    cast calldata-decode "schedule(address,uint256,bytes,bytes32,bytes32,uint256)" <data>
"""
import json
import subprocess
import sys

path = sys.argv[1]
batch = json.load(open(path, encoding="utf-8"))
print(batch["meta"]["name"])
print(f"chainId={batch['chainId']}  transactions={len(batch['transactions'])}\n")
for i, t in enumerate(batch["transactions"], 1):
    print(f"[{i:02d}] to={t['to']} value={t['value']}")
    print(f"     comment: {t.get('_comment', '(none)')}")
    r = subprocess.run(["cast", "4byte-decode", t["data"]], capture_output=True, text=True)
    body = (r.stdout or r.stderr).strip().replace("\n", "\n               ")
    print(f"     decodes: {body}\n")
