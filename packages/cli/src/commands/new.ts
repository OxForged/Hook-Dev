/**
 * `create-latch-hook <name>` / `latch new <name>`.
 *
 * Generates a Foundry project containing a hook, a test harness that stands the
 * whole settlement stack up in memory, and a deploy script - with the
 * registration bitmap and the pool key `parameters` word generated from one
 * permission set so they cannot disagree.
 */

import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import {
  getBoolean,
  getString,
  parseArgs,
  renderFlags,
  type FlagSpecs,
  type ParsedArgs,
} from "../util/args.js";
import { info, ok, step, style, table, UserError, warn } from "../util/log.js";
import { isEmptyDir, posixRelative, remappingPath, writeFileEnsuringDir } from "../util/fsx.js";
import { askChoice, askConfirm, askMultiSelect, askText, isInteractive } from "../util/prompt.js";
import { requireHooks, resolveWorkspace } from "../util/workspace.js";
import { resolveCommand, runOrThrow } from "../util/exec.js";
import {
  ALL_PERMISSIONS,
  parsePermissionList,
  PERMISSION_HELP,
  poolParametersFor,
  resolvePermissions,
  type PermissionName,
} from "../permissions.js";
import { DEFAULT_TEMPLATE_ID, findTemplate, TEMPLATES, templateIds } from "../templates/index.js";
import {
  renderDeployScript,
  renderFoundryToml,
  renderGitignore,
  renderHook,
  renderLatchConfig,
  renderReadme,
  renderTest,
  type ProjectContext,
} from "../codegen/project.js";

const FLAGS: FlagSpecs = {
  template: {
    kind: "string",
    short: "t",
    placeholder: "<id>",
    describe: `starting point: ${templateIds().join(" | ")}`,
    defaultLabel: DEFAULT_TEMPLATE_ID,
  },
  permissions: {
    kind: "string",
    short: "p",
    placeholder: "<list>",
    describe: "comma-separated callbacks, or 'all' / 'none'",
    defaultLabel: "the template's own set",
  },
  "tick-spacing": {
    kind: "string",
    placeholder: "<n>",
    describe: "tick spacing baked into the pool key parameters",
    defaultLabel: "60",
  },
  fee: {
    kind: "string",
    placeholder: "<n|dynamic>",
    describe: "static LP fee in hundredths of a bip, or 'dynamic'",
    defaultLabel: "the template's own choice",
  },
  contract: {
    kind: "string",
    placeholder: "<Name>",
    describe: "Solidity contract name",
    defaultLabel: "derived from <name>",
  },
  dir: {
    kind: "string",
    short: "d",
    placeholder: "<path>",
    describe: "where to write the project",
    defaultLabel: "./<name>",
  },
  core: {
    kind: "string",
    placeholder: "<path>",
    describe: "path to packages/core; also read from LATCH_CORE_PATH",
    defaultLabel: "auto-detected",
  },
  yes: { kind: "boolean", short: "y", describe: "accept every default; never prompt" },
  force: { kind: "boolean", describe: "write into a non-empty directory" },
  build: { kind: "boolean", describe: "run `forge build` on the generated project" },
  help: { kind: "boolean", short: "h", describe: "show this message" },
};

const USAGE = (invokedAs: string): string => `${style.bold("create-latch-hook")} - scaffold a Latch Protocol hook

${style.bold("USAGE")}
  ${invokedAs} <name> [options]

${style.bold("EXAMPLES")}
  ${invokedAs} my-hook
  ${invokedAs} fee-hook --template dynamic-fee --yes
  ${invokedAs} counter --permissions beforeSwap,afterSwap,afterSwapReturnsDelta --yes

${style.bold("OPTIONS")}
${renderFlags(FLAGS)}

${style.bold("PERMISSIONS")}
${ALL_PERMISSIONS.map((name) => `  ${name.padEnd(34)}${PERMISSION_HELP[name]}`).join("\n")}

  A *ReturnsDelta permission requires its base callback; the missing one is added
  for you rather than generating a project that reverts at pool initialization.

${style.bold("TEMPLATES")}
${TEMPLATES.map((t) => `  ${t.id.padEnd(14)}${t.description}`).join("\n")}
`;

const RESERVED_SOLIDITY = new Set([
  "contract",
  "interface",
  "library",
  "abstract",
  "function",
  "address",
  "bool",
  "string",
  "bytes",
  "type",
  "test",
]);

function toContractName(raw: string): string {
  const parts = raw
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1));
  const joined = parts.join("");
  return /^[0-9]/.test(joined) ? `Hook${joined}` : joined;
}

function assertValidContractName(name: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new UserError(
      `"${name}" is not a valid Solidity contract name`,
      "use letters, digits and underscores, starting with a letter",
    );
  }
  if (RESERVED_SOLIDITY.has(name.toLowerCase())) {
    throw new UserError(`"${name}" is a reserved word in Solidity`, "pass --contract <Name> with something else");
  }
}

function parseTickSpacing(raw: string | undefined): number {
  if (raw === undefined) return 60;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1 || value > 32767) {
    throw new UserError(
      `--tick-spacing must be an integer between 1 and 32767, got "${raw}"`,
      "CLPoolManager enforces MIN_TICK_SPACING = 1 and MAX_TICK_SPACING = type(int16).max",
    );
  }
  return value;
}

function parseFee(raw: string | undefined, templateWantsDynamic: boolean): number | undefined {
  if (raw === undefined) return templateWantsDynamic ? undefined : 3000;
  if (raw.trim().toLowerCase() === "dynamic") return undefined;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 0 || value > 1_000_000) {
    throw new UserError(
      `--fee must be 'dynamic' or an integer between 0 and 1000000, got "${raw}"`,
      "the fee is in hundredths of a bip: 3000 is 0.30%",
    );
  }
  return value;
}

export async function runNew(argv: readonly string[], invokedAs: string, cliVersion: string): Promise<number> {
  const args = parseArgs(argv, FLAGS);

  if (getBoolean(args, "help") || (args.positionals.length === 0 && !isInteractive())) {
    info(USAGE(invokedAs));
    return getBoolean(args, "help") ? 0 : 1;
  }

  const nonInteractive = getBoolean(args, "yes") || !isInteractive();

  // --- name -----------------------------------------------------------------
  let projectName = args.positionals[0];
  if (projectName === undefined) {
    projectName = await askText("Project name?", "my-latch-hook");
  }
  projectName = projectName.trim();
  if (projectName.length === 0) throw new UserError("project name cannot be empty");
  if (/[\\/:*?"<>|]/.test(projectName)) {
    throw new UserError(
      `"${projectName}" contains characters that are not valid in a directory name`,
      "use letters, digits and dashes; pass --dir to control the output path separately",
    );
  }

  // --- template -------------------------------------------------------------
  const templateFlag = getString(args, "template");
  let templateId = templateFlag ?? DEFAULT_TEMPLATE_ID;
  if (templateFlag === undefined && !nonInteractive) {
    templateId = await askChoice(
      "\nWhich template?",
      TEMPLATES.map((t) => ({ value: t.id, label: t.label, description: t.description })),
      0,
    );
  }
  const template = findTemplate(templateId);
  if (template === undefined) {
    throw new UserError(`unknown template "${templateId}"`, `available templates: ${templateIds().join(", ")}`);
  }

  // --- permissions ----------------------------------------------------------
  const permissionsFlag = getString(args, "permissions");
  let requested: PermissionName[] =
    permissionsFlag === undefined ? [...template.defaultPermissions] : parsePermissionList(permissionsFlag);

  if (permissionsFlag === undefined && !nonInteractive) {
    const preselected = new Set(
      ALL_PERMISSIONS.map((name, index) => (template.defaultPermissions.includes(name) ? index : -1)).filter(
        (index) => index >= 0,
      ),
    );
    info("");
    info(
      style.dim(
        "Permissions live in the pool key, not the hook address - pick freely, there is no salt to mine.",
      ),
    );
    requested = await askMultiSelect(
      "Which callbacks should this hook register?",
      ALL_PERMISSIONS.map((name) => ({
        value: name,
        label: name,
        description: PERMISSION_HELP[name],
      })),
      preselected,
    );
  }

  const permissions = resolvePermissions(requested);
  if (permissions.addedDependencies.length > 0) {
    warn(
      `added ${permissions.addedDependencies.join(", ")}: a *ReturnsDelta permission cannot be registered without its base callback`,
    );
  }

  const templateApplies = template.requires.every((name) => permissions.names.includes(name));
  if (!templateApplies) {
    const missing = template.requires.filter((name) => !permissions.names.includes(name));
    warn(
      `the "${template.id}" template implements ${missing.join(", ")}, which you did not select; ` +
        "its bodies were replaced with pass-throughs",
    );
  }

  // --- pool shape -----------------------------------------------------------
  const tickSpacing = parseTickSpacing(getString(args, "tick-spacing"));
  const lpFee = parseFee(getString(args, "fee"), templateApplies && template.dynamicFee);
  const parameters = poolParametersFor(permissions.bitmap, tickSpacing);

  // --- contract name --------------------------------------------------------
  const contractName = getString(args, "contract") ?? toContractName(projectName);
  assertValidContractName(contractName);

  // --- destination ----------------------------------------------------------
  const dirFlag = getString(args, "dir");
  const targetDir = dirFlag === undefined
    ? resolve(process.cwd(), projectName)
    : isAbsolute(dirFlag)
      ? dirFlag
      : resolve(process.cwd(), dirFlag);

  if (!(await isEmptyDir(targetDir)) && !getBoolean(args, "force")) {
    if (nonInteractive) {
      throw new UserError(`${targetDir} is not empty`, "pass --force to write into it anyway");
    }
    const proceed = await askConfirm(`\n${targetDir} is not empty. Write into it anyway?`, false);
    if (!proceed) {
      info("nothing written");
      return 1;
    }
  }

  // --- workspace ------------------------------------------------------------
  const workspaceOptions = { near: targetDir, ...(getString(args, "core") === undefined ? {} : { explicit: getString(args, "core") }) };
  const workspace = resolveWorkspace(workspaceOptions);
  const hooksPath = requireHooks(workspace);

  const ctx: ProjectContext = {
    projectName,
    contractName,
    template,
    permissions,
    tickSpacing,
    lpFee,
    parameters,
    templateApplies,
    cliVersion,
    paths: {
      core: remappingPath(targetDir, workspace.core),
      hooks: remappingPath(targetDir, hooksPath),
    },
  };

  // --- write ----------------------------------------------------------------
  const files: ReadonlyArray<readonly [string, string]> = [
    [join(targetDir, "foundry.toml"), renderFoundryToml(ctx)],
    [join(targetDir, ".gitignore"), renderGitignore()],
    [join(targetDir, "latch.json"), renderLatchConfig(ctx)],
    [join(targetDir, "README.md"), renderReadme(ctx)],
    [join(targetDir, "src", `${contractName}.sol`), renderHook(ctx)],
    [join(targetDir, "test", `${contractName}.t.sol`), renderTest(ctx)],
    [join(targetDir, "script", `Deploy${contractName}.s.sol`), renderDeployScript(ctx)],
  ];

  step(`creating ${style.bold(projectName)} in ${targetDir}`);
  for (const [path, contents] of files) {
    await writeFileEnsuringDir(path, contents);
    info(`  ${style.dim(posixRelative(targetDir, path))}`);
  }

  info("");
  info(
    table([
      ["template", template.id],
      ["contract", `${contractName}.sol`],
      ["callbacks", permissions.names.length === 0 ? "(none)" : permissions.names.join(", ")],
      ["registration bitmap", permissions.bitmapHex],
      ["pool key parameters", parameters],
      ["tick spacing", String(tickSpacing)],
      ["pool fee", lpFee === undefined ? "dynamic (0x800000)" : `${lpFee} (${(lpFee / 10_000).toFixed(2)}%)`],
      ["core contracts", workspace.core],
    ]),
  );
  info("");
  info(
    style.dim(
      "  The bitmap and the parameters word were generated together. CLPoolManager.initialize\n" +
        "  compares them; a mismatch is HookConfigValidationError, and the generated test fails\n" +
        "  the build if they ever stop agreeing.",
    ),
  );

  // --- optional verification build -----------------------------------------
  if (getBoolean(args, "build")) {
    if (resolveCommand("forge") === undefined) {
      warn("skipping --build: forge is not on PATH");
    } else {
      info("");
      step("forge build");
      await runOrThrow("forge", ["build"], {
        cwd: targetDir,
        inherit: true,
        failureHint: "the generated project failed to compile; please report this as a create-latch-hook bug",
      });
      ok("generated project compiles");
    }
  }

  info("");
  ok("done");
  info("");
  info(`  cd ${projectName}`);
  info("  forge test -vv");
  info("");
  if (!existsSync(join(workspace.core, "lib", "forge-std", "src", "Test.sol"))) {
    warn(
      `${join(workspace.core, "lib", "forge-std")} is missing - run "forge install" (or "git submodule update --init") in packages/core first`,
    );
  }

  return 0;
}

export function newHelp(invokedAs: string): string {
  return USAGE(invokedAs);
}

/** Exposed for the `latch` multiplexer so it can forward its own argv. */
export type { ParsedArgs };
