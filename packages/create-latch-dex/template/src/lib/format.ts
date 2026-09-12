// SPDX-License-Identifier: MIT
/**
 * Formatting.
 *
 * One rule runs through all of it: **never render a currency figure.** The
 * tokens on these chains are not priced by anything this app can read, and a
 * dollar headline derived from a made-up price is indistinguishable, to a
 * reader, from one derived from a real feed. Token units with a symbol, always.
 */

/** Fixed-point rendering of a raw token amount. No rounding to a "nice" number. */
export function formatUnits(value: bigint, decimals: number, places = 6): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = ((abs % base) * 10n ** BigInt(places)) / base;
  const fracText = frac.toString().padStart(places, "0").replace(/0+$/, "");
  const body = fracText.length === 0 ? whole.toString() : `${whole}.${fracText}`;
  return negative ? `-${body}` : body;
}

/** A token amount with its symbol. The symbol is not optional — see the header. */
export function formatAmount(value: bigint, decimals: number, symbol: string): string {
  return `${formatUnits(value, decimals)} ${symbol}`;
}

/** Pips (millionths) as a percentage, e.g. 3000 -> "0.3%". */
export function formatPips(pips: number): string {
  const percent = pips / 10_000;
  return `${trimNumber(percent)}%`;
}

/** Basis points as a percentage, e.g. 25 -> "0.25%". */
export function formatBps(bps: number): string {
  return `${trimNumber(bps / 100)}%`;
}

function trimNumber(value: number): string {
  if (Number.isInteger(value)) return value.toString();
  return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

export function shortAddress(address: string, lead = 6, tail = 4): string {
  if (address.length <= lead + tail + 2) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}

/**
 * The composed fee a swap actually pays, in pips.
 *
 * The protocol fee comes off the input first and the LP fee applies to the
 * remainder, so they do not simply add:
 *
 *     total = protocol + lp - (protocol * lp / 1e6)
 *
 * This is the number to show a trader. Showing the two separately and letting
 * them add the parts overstates the cost.
 */
export function composeFeePips(protocolPips: number, lpPips: number): number {
  return protocolPips + lpPips - Math.floor((protocolPips * lpPips) / 1_000_000);
}

/** Plural helper that does not invent an "(s)". */
export function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}
