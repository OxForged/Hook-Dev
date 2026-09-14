/**
 * RFC 4180 CSV with spreadsheet formula-injection protection.
 *
 * A cell beginning with = + - @ TAB or CR is executed as a formula by Excel,
 * LibreOffice and Sheets. Ledger cells are mostly ours (addresses, integers), but
 * a counterparty or token symbol read from a contract is attacker-chosen, so every
 * such cell is prefixed with a single quote. Negative integers are ours and are
 * left numeric only when they are a plain integer.
 */

const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_INTEGER = /^-?\d+$/;

export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = typeof v === "bigint" ? v.toString() : v instanceof Date ? v.toISOString() : String(v);
  if (FORMULA_START.test(s) && !PLAIN_INTEGER.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(header: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return [header.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\r\n") + "\r\n";
}
