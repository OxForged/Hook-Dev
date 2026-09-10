/**
 * `latch bitmap` - turn permissions into the two values a pool needs, and back.
 *
 * Useful on its own (checking a deployed hook against a pool key) and as the
 * answer to "why does initialize revert?", which is almost always a bitmap that
 * does not match the hook.
 */

import {
  decodeCLPoolParameters,
  getHooksRegistrationBitmap,
  validateHookRegistrationBitmap,
} from "@latchprotocol/sdk";
import { getBoolean, getString, parseArgs, renderFlags, type FlagSpecs } from "../util/args.js";
import { info, style, table, UserError } from "../util/log.js";
import {
  ALL_PERMISSIONS,
  namesForBitmap,
  parsePermissionList,
  PERMISSION_HELP,
  PERMISSION_OFFSETS,
  poolParametersFor,
  resolvePermissions,
  SOLIDITY_CONSTANTS,
  toBitmapHex,
} from "../permissions.js";

const FLAGS: FlagSpecs = {
  decode: { kind: "string", placeholder: "<0xNNNN>", describe: "explain a registration bitmap" },
  parameters: { kind: "string", placeholder: "<0x...>", describe: "explain a pool key parameters word" },
  "tick-spacing": {
    kind: "string",
    placeholder: "<n>",
    describe: "tick spacing to encode alongside the bitmap",
    defaultLabel: "60",
  },
  list: { kind: "boolean", short: "l", describe: "list every permission and its bit" },
  help: { kind: "boolean", short: "h", describe: "show this message" },
};

const USAGE = `${style.bold("latch bitmap")} - hook permission bitmaps and pool key parameters

${style.bold("USAGE")}
  latch bitmap <permissions>        encode a comma-separated permission list
  latch bitmap --decode 0x0040      explain a bitmap
  latch bitmap --parameters 0x...   explain a pool key parameters word
  latch bitmap --list               list every permission

${style.bold("OPTIONS")}
${renderFlags(FLAGS)}
`;

function parseHex(raw: string, what: string): number {
  const value = Number.parseInt(raw.trim(), raw.trim().startsWith("0x") ? 16 : 10);
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new UserError(`${what} must be a uint16, got "${raw}"`);
  }
  return value;
}

function describeBitmap(bitmap: number): void {
  const names = namesForBitmap(bitmap);
  const validation = validateHookRegistrationBitmap("CL", bitmap);

  info("");
  info(
    table([
      ["bitmap", toBitmapHex(bitmap)],
      ["decimal", String(bitmap)],
      ["binary", bitmap.toString(2).padStart(16, "0")],
      ["callbacks", names.length === 0 ? "(none)" : names.join(", ")],
    ]),
  );

  if (!validation.valid) {
    info("");
    for (const issue of validation.issues) {
      info(`  ${style.red("invalid")} ${issue.message}`);
    }
  }
}

export function runBitmap(argv: readonly string[]): number {
  const args = parseArgs(argv, FLAGS);

  if (getBoolean(args, "help")) {
    info(USAGE);
    return 0;
  }

  if (getBoolean(args, "list")) {
    info("");
    info(
      table(
        ALL_PERMISSIONS.map(
          (name) =>
            [
              `bit ${String(PERMISSION_OFFSETS[name]).padStart(2)}  ${name}`,
              `${toBitmapHex(1 << PERMISSION_OFFSETS[name])}  ${PERMISSION_HELP[name]}`,
            ] as const,
        ),
      ),
    );
    info("");
    return 0;
  }

  const parametersFlag = getString(args, "parameters");
  if (parametersFlag !== undefined) {
    if (!/^0x[0-9a-fA-F]{1,64}$/.test(parametersFlag)) {
      throw new UserError(`--parameters must be 0x-prefixed hex, got "${parametersFlag}"`);
    }
    const padded = `0x${parametersFlag.slice(2).padStart(64, "0")}` as `0x${string}`;
    const decoded = decodeCLPoolParameters(padded);
    info("");
    info(
      table([
        ["parameters", padded],
        ["tick spacing", String(decoded.tickSpacing)],
      ]),
    );
    describeBitmap(getHooksRegistrationBitmap(padded));
    info("");
    return 0;
  }

  const decodeFlag = getString(args, "decode");
  if (decodeFlag !== undefined) {
    describeBitmap(parseHex(decodeFlag, "--decode"));
    info("");
    return 0;
  }

  const list = args.positionals.join(",");
  if (list.trim().length === 0) {
    info(USAGE);
    return 1;
  }

  const tickSpacingRaw = getString(args, "tick-spacing") ?? "60";
  const tickSpacing = Number.parseInt(tickSpacingRaw, 10);
  if (!Number.isInteger(tickSpacing) || tickSpacing < 1 || tickSpacing > 32767) {
    throw new UserError(`--tick-spacing must be an integer between 1 and 32767, got "${tickSpacingRaw}"`);
  }

  const permissions = resolvePermissions(parsePermissionList(list));
  const parameters = poolParametersFor(permissions.bitmap, tickSpacing);

  if (permissions.addedDependencies.length > 0) {
    info("");
    info(
      `  ${style.yellow("added")} ${permissions.addedDependencies.join(", ")} - a *ReturnsDelta permission cannot stand alone`,
    );
  }

  describeBitmap(permissions.bitmap);
  info("");
  info(
    table([
      ["tick spacing", String(tickSpacing)],
      ["pool key parameters", parameters],
    ]),
  );
  info("");
  info(style.dim("  In the hook:"));
  info("");
  info("    function getHooksRegistrationBitmap() public pure override returns (uint16) {");
  info(`        return ${permissions.solidityExpression};`);
  info("    }");
  info("");
  info(style.dim("  In the pool key:"));
  info("");
  info(`    parameters: ${parameters}`);
  info("");
  info(
    style.dim(
      `  (that is ${permissions.names.map((n) => SOLIDITY_CONSTANTS[n]).join(" | ") || "0"} packed into the low 16 bits, with tickSpacing at bit 16)`,
    ),
  );
  info("");
  return 0;
}
