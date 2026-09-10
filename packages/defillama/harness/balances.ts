/**
 * A minimal stand-in for `@defillama/sdk`'s `Balances`.
 *
 * Local harness only - upstream supplies the real one via
 * `FetchOptions.createBalances()`. This implements the subset the Latch adapter
 * uses, with the same semantics as the SDK class (read from
 * `@defillama/sdk@5.x/build/Balances.d.ts` on 2026-09-09):
 *
 *   add(token | Balances, amount?, label?)   accumulate, optionally labelled
 *   clone(ratio = 1, label?)                 scaled copy, optionally relabelled
 *   subtract(Balances)                       in-place subtraction
 *
 * Deliberate differences, both in the direction of catching bugs rather than
 * hiding them:
 *   - amounts are kept as bigint, never coerced to Number, so a test can assert
 *     exact wei;
 *   - there is no USD pricing. This harness can prove the arithmetic and the
 *     token attribution; it cannot prove a dollar figure, and does not pretend to.
 */

export type BalancesEntry = { token: string; amount: bigint; label?: string };

const key = (token: string, label?: string) => `${token.toLowerCase()}|${label ?? ""}`;

const toBigInt = (v: unknown): bigint => {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`Balances: non-finite amount ${v}`);
    return BigInt(Math.trunc(v));
  }
  if (typeof v === "string") return BigInt(v);
  throw new Error(`Balances: unsupported amount type ${typeof v}`);
};

export class Balances {
  readonly chain: string;
  readonly timestamp: number | undefined;
  private readonly entries = new Map<string, BalancesEntry>();

  constructor({ chain, timestamp }: { chain: string; timestamp?: number }) {
    this.chain = chain;
    this.timestamp = timestamp;
  }

  /**
   * Matches the SDK's overloaded `add`, which is easy to get wrong:
   *
   *   add(token, amount, label)     -> _add(token, amount, { label })
   *   add(otherBalances, label)     -> addBalances(other, label)   <- label is 2nd
   *
   * (`Balances.add` in @defillama/sdk@5.x forwards to `addBalances(balances,
   * optionsOrLabel, options)` when the first argument is a Balances, and throws if
   * the THIRD argument is a string.) Getting this wrong silently drops the
   * breakdown label, which the upstream validator then rejects.
   */
  add(token: string | Balances, amountOrLabel?: unknown, label?: string): void {
    if (token instanceof Balances) {
      if (typeof label === "string")
        throw new Error(
          "When adding a Balances instance, the label is the second argument, not the third",
        );
      const inherited = typeof amountOrLabel === "string" ? amountOrLabel : undefined;
      for (const e of token.entries.values()) this.#bump(e.token, e.amount, inherited ?? e.label);
      return;
    }
    this.#bump(token, toBigInt(amountOrLabel ?? 0n), label);
  }

  addToken(token: string, amount: unknown, label?: string): void {
    this.add(token, amount, label);
  }

  subtract(other: Balances): void {
    for (const e of other.entries.values()) this.#bump(e.token, -e.amount, undefined, true);
  }

  clone(ratio = 1, label?: string): Balances {
    const out = new Balances({ chain: this.chain, timestamp: this.timestamp });
    for (const e of this.entries.values()) {
      const scaled = ratio === 1 ? e.amount : scale(e.amount, ratio);
      out.#bump(e.token, scaled, label ?? e.label);
    }
    return out;
  }

  /** Every entry, sorted, for assertions and printing. */
  list(): BalancesEntry[] {
    return [...this.entries.values()].sort(
      (a, b) => a.token.localeCompare(b.token) || (a.label ?? "").localeCompare(b.label ?? ""),
    );
  }

  /** Total per token, labels merged. */
  totals(): Record<string, bigint> {
    const out: Record<string, bigint> = {};
    for (const e of this.entries.values())
      out[e.token] = (out[e.token] ?? 0n) + e.amount;
    return out;
  }

  isEmpty(): boolean {
    return [...this.entries.values()].every((e) => e.amount === 0n);
  }

  /**
   * `subtract` matches by token but ignores labels, because the two operands
   * carry different labels by construction (working totals vs exported metric).
   */
  #bump(token: string, amount: bigint, label?: string, matchTokenOnly = false): void {
    if (matchTokenOnly) {
      for (const e of this.entries.values()) {
        if (e.token === token.toLowerCase()) {
          e.amount += amount;
          return;
        }
      }
    }
    const k = key(token, label);
    const existing = this.entries.get(k);
    if (existing) existing.amount += amount;
    else this.entries.set(k, { token: token.toLowerCase(), amount, label });
  }
}

/** Scale a bigint by a decimal ratio without going through Number. */
function scale(value: bigint, ratio: number): bigint {
  const DEN = 1_000_000n;
  return (value * BigInt(Math.round(ratio * Number(DEN)))) / DEN;
}
