/**
 * Add Command
 *
 * `nextly plugins add <package>`, also run as `nextly add <package>`: one
 * command that adds a plugin to a site. It
 *
 * 1. installs the package with the project's package manager;
 * 2. reads how the package is registered (its `nextly.plugin` declaration, or
 *    the one plugin definition its entry exports) and settles the options the
 *    install asks for, from `--option <name>=<value>` or a prompt;
 * 3. makes the plugin from that, so a wrong declaration or refused options
 *    stop the run before any file changes;
 * 4. registers it in `nextly.config.ts`;
 * 5. adds its `nextly plugins install` step to the build script, which a
 *    production boot needs before it starts;
 * 6. runs `nextly generate:types`, which writes the types and the admin
 *    component map the plugin's screens are drawn from;
 * 7. applies its schema with `nextly plugins install`, or, on a database
 *    `nextly migrate` has not prepared yet, leaves that to the build.
 *
 * A step with nothing to do (a plugin already listed, a build that installs
 * it already) is skipped, so running the command again changes nothing.
 * `--dry-run` names each change and makes none.
 *
 * @module cli/commands/add
 *
 * @example
 * ```bash
 * nextly plugins add @nextlyhq/plugin-form-builder
 * nextly plugins add @acme/seo --option siteUrl=https://example.com
 * nextly plugins add @acme/seo --skip-install   # already installed
 * nextly plugins add @acme/seo --dry-run        # name every change; make none
 * ```
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import * as clack from "@clack/prompts";
import type { Command } from "commander";
import pc from "picocolors";

import { canPrompt } from "../../domains/schema/migrate/can-prompt";
import { reportDryRun, projectPath, type DryRunChange } from "../dry-run";
import { exitWithError } from "../errors";
import { packageInstallFailed } from "../errors/areas/commands";
import {
  pluginConfigNotEditable,
  pluginDeclarationInvalid,
  pluginPackageNotInstalled,
} from "../errors/areas/plugins";
import { CliError } from "../errors/cli-error";
import {
  createContext,
  type CommandContext,
  type GlobalOptions,
} from "../program";
import { clearConfigCache, findNextlyConfig } from "../utils/config-loader";
import { answered } from "../utils/prompt-cancelled";

import { buildScriptEdit } from "./plugins-add/build-script";
import { pluginRegistrationEdit } from "./plugins-add/config-registration";
import {
  findInstalledPackage,
  importEntry,
  packageNameOf,
} from "./plugins-add/installed-package";
import {
  entryText,
  optionProblem,
  pluginFrom,
  readDeclaration,
  registrationFromExports,
  settleOptions,
  type AskOption,
  type PluginShape,
  type Registration,
} from "./plugins-add/registration";

export type PackageManager = "pnpm" | "yarn" | "npm";

export interface AddCommandOptions {
  /** Install as a dev dependency. @default false */
  dev?: boolean;
  /** Skip the package-manager install: the package is installed already. @default false */
  skipInstall?: boolean;
  /** Name every change the run would make; make none. @default false */
  dryRun?: boolean;
  /** The options the plugin asks for, each as `<name>=<value>`. */
  option?: string[];
}

interface ResolvedAddOptions extends AddCommandOptions {
  cwd?: string;
  config?: string;
  verbose?: boolean;
  quiet?: boolean;
}

/** Detect the project's package manager from its lockfile (defaults to npm). */
export function detectPackageManager(cwd: string): PackageManager {
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(cwd, "yarn.lock"))) return "yarn";
  return "npm";
}

/** Build the install argv for the given package manager (pure — unit-tested). */
export function buildInstallArgs(
  pm: PackageManager,
  pkg: string,
  dev: boolean
): string[] {
  const devFlag = dev ? ["-D"] : [];
  switch (pm) {
    case "pnpm":
      return ["add", ...devFlag, pkg];
    case "yarn":
      return ["add", ...devFlag, pkg];
    case "npm":
      return ["install", ...devFlag, pkg];
  }
}

/**
 * What to install for `pkg`: as typed, except a Nextly package named without a
 * version, which is installed at the version of the nextly the site has. The
 * packages are released together, and a package manager left to choose can
 * pick another release (pnpm's minimum release age passes over one published
 * today), leaving the plugin a release apart from the core it runs on.
 */
async function installSpec(cwd: string, pkg: string): Promise<string> {
  if (!pkg.startsWith("@nextlyhq/") || packageNameOf(pkg) !== pkg) return pkg;
  const core = await findInstalledPackage(cwd, "nextly");
  const version = core?.manifest.version;
  return typeof version === "string" ? `${pkg}@${version}` : pkg;
}

/** The install the command makes in `cwd`: the package manager and its arguments. */
async function installFor(
  cwd: string,
  pkg: string,
  dev: boolean
): Promise<{ pm: PackageManager; args: string[] }> {
  const pm = detectPackageManager(cwd);
  return { pm, args: buildInstallArgs(pm, await installSpec(cwd, pkg), dev) };
}

function runInstall(
  pm: PackageManager,
  args: string[],
  cwd: string
): Promise<number> {
  return new Promise(resolve => {
    const child = spawn(pm, args, {
      cwd,
      stdio: "inherit",
      // Windows resolves package-manager shims via the shell.
      shell: process.platform === "win32",
    });
    child.on("error", () => resolve(1));
    child.on("close", code => resolve(code ?? 1));
  });
}

/** Asks for an option the plugin needs at the terminal, checking it as it is typed. */
const askInTerminal: AskOption = async (name, option) =>
  answered(
    await clack.text({
      message: `${option.description} (${name})`,
      validate: value => optionProblem(name, option, value ?? ""),
    })
  );

/** What the run learned from the package: how it is registered, with what, and the plugin that makes. */
interface Planned {
  registration: Registration;
  values: Record<string, string>;
  plugin: PluginShape;
}

/**
 * How the installed package is registered, the options it asks for, and the
 * plugin those make: read and checked before any file is touched.
 */
async function planRegistration(
  name: string,
  cwd: string,
  options: ResolvedAddOptions
): Promise<Planned | undefined> {
  const found = await findInstalledPackage(cwd, name);
  if (found === undefined) return undefined;
  const declared = readDeclaration(found.manifest);
  if (declared.kind === "invalid") {
    throw pluginDeclarationInvalid(name, declared.problem);
  }
  const exports = await importEntry(found.dir, found.manifest);
  const registration =
    declared.kind === "declared"
      ? declared.registration
      : registrationFromExports(name, exports);
  // A dry run asks nothing: an option it was not given is the refusal the
  // real run would meet with no one at the terminal.
  const ask =
    options.dryRun !== true && canPrompt() ? askInTerminal : undefined;
  const values = await settleOptions(
    name,
    registration.options,
    options.option ?? [],
    ask
  );
  const plugin = await pluginFrom(name, exports, registration, values);
  return { registration, values, plugin };
}

/** The config file to register the plugin in: the one `--config` names, or the one the project has. */
function configFileOf(cwd: string, options: ResolvedAddOptions) {
  return options.config === undefined
    ? findNextlyConfig(cwd)
    : resolve(cwd, options.config);
}

/** Registers the plugin in the config, or names that edit under a dry run. */
async function register(
  name: string,
  planned: Planned,
  cwd: string,
  options: ResolvedAddOptions,
  context: CommandContext,
  changes: DryRunChange[]
): Promise<void> {
  const { registration, values, plugin } = planned;
  const entry = (local: string) => entryText(registration, local, values);
  const file = configFileOf(cwd, options);
  const text =
    file === undefined
      ? undefined
      : await readFile(file, "utf8").catch(() => undefined);
  if (file === undefined || text === undefined) {
    throw pluginConfigNotEditable(
      "No nextly.config.ts was found in the project",
      [
        `import { ${registration.localName} } from "${name}";`,
        `plugins: [${entry(registration.localName)}]`,
      ],
      plugin.name
    );
  }
  const { parse } = await import("@babel/parser");
  const answer = pluginRegistrationEdit({
    file: projectPath(cwd, file),
    text,
    parser: parse,
    packageName: name,
    exportName: registration.exportName,
    localName: registration.localName,
    entry,
  });
  if (answer.kind === "manual") {
    throw pluginConfigNotEditable(answer.reason, answer.lines, plugin.name);
  }
  if (answer.kind === "listed") {
    context.logger.info(
      `${projectPath(cwd, file)} already lists ${answer.local}; it was left as it was.`
    );
    return;
  }
  if (options.dryRun) {
    changes.push({ action: "edit", target: projectPath(cwd, file) });
    return;
  }
  await writeFile(file, answer.after);
  // The loader keeps the config it read last; the next step must read this one.
  clearConfigCache();
  context.logger.success(
    `Registered ${plugin.name} in ${projectPath(cwd, file)}`
  );
}

/** Adds the plugin's install step to the build script, or names that edit under a dry run. */
async function addBuildStep(
  pluginName: string,
  cwd: string,
  options: ResolvedAddOptions,
  context: CommandContext,
  changes: DryRunChange[]
): Promise<void> {
  const file = join(cwd, "package.json");
  const text = await readFile(file, "utf8").catch(() => "");
  const answer = buildScriptEdit(text, pluginName);
  if (answer.kind === "installed") return;
  if (answer.kind === "manual") {
    // Not a refusal: the plugin works in development without it, and a
    // build that migrates some other way is the site's to finish.
    context.logger.warn(
      `${answer.reason}, so the build was not changed. Run "${answer.step}" where your build runs "nextly migrate", before the app is built: a production start refuses a plugin that was never installed.`
    );
    return;
  }
  if (options.dryRun) {
    changes.push({ action: "edit", target: "package.json" });
    return;
  }
  await writeFile(file, answer.after);
  context.logger.success(`The build now installs ${pluginName}`);
}

/**
 * Applies the plugin's schema. A database `nextly migrate` has not prepared
 * yet is not a failure: the build migrates and installs it, as the step just
 * added says.
 */
async function applySchema(
  pluginName: string,
  options: ResolvedAddOptions,
  context: CommandContext
): Promise<void> {
  const { isDatabaseNotMigrated, runPluginInstall } = await import(
    "./plugin-lifecycle-runner"
  );
  try {
    await runPluginInstall(
      pluginName,
      { config: options.config, cwd: options.cwd },
      context
    );
  } catch (error) {
    if (!isDatabaseNotMigrated(error)) throw error;
    context.logger.warn(
      `This database has not been migrated yet, so the schema of ${pluginName} was not applied. Your build applies it; to apply it now, run "nextly migrate", then "nextly plugins install ${pluginName}".`
    );
  }
}

/**
 * Installs the package, or names the install under a dry run. Returns whether
 * the run installs it, which a dry run's plan depends on.
 */
async function installStep(
  pkg: string,
  cwd: string,
  options: ResolvedAddOptions,
  context: CommandContext,
  changes: DryRunChange[]
): Promise<boolean> {
  if (options.skipInstall) return false;
  const { logger } = context;
  // The one install the run makes: a dry run names this same command line,
  // and the real run runs it.
  const { pm, args } = await installFor(cwd, pkg, options.dev ?? false);
  if (options.dryRun) {
    changes.push({ action: "run", target: [pm, ...args].join(" ") });
    return true;
  }
  logger.info(
    `Installing ${pc.cyan(args.at(-1) ?? pkg)} with ${pc.yellow(pm)}…`
  );
  const code = await runInstall(pm, args, cwd);
  if (code !== 0) {
    // A failed install is a failed run, so it ends with the shared 1; the
    // package manager's own code is named in the message instead.
    exitWithError(logger, packageInstallFailed(pm, pkg, code));
  }
  logger.success(`Installed ${pkg}`);
  return true;
}

/**
 * The registration plan, or nothing when a dry run has reported its end: the
 * refusal the real run would meet working it out, in its words, or, for a
 * package a dry run has not installed yet, that the rest follows the install.
 */
async function planOrReport(
  name: string,
  cwd: string,
  installs: boolean,
  options: ResolvedAddOptions,
  context: CommandContext,
  changes: DryRunChange[]
): Promise<Planned | undefined> {
  let planned: Planned | undefined;
  try {
    planned = await planRegistration(name, cwd, options);
  } catch (error) {
    if (!(options.dryRun && error instanceof CliError)) throw error;
    reportDryRun(context.logger, { changes, refusals: [error.what] });
    return undefined;
  }
  if (planned !== undefined) return planned;
  if (!(options.dryRun && installs)) throw pluginPackageNotInstalled(name);
  reportDryRun(context.logger, {
    changes,
    notes: [
      `How ${name} is registered is read from the package once it is installed; run again with --skip-install --dry-run after installing it to see the rest.`,
    ],
  });
  return undefined;
}

/** Generates the types and applies the schema, or names both under a dry run. */
async function finish(
  pluginName: string,
  options: ResolvedAddOptions,
  context: CommandContext,
  changes: DryRunChange[]
): Promise<void> {
  const { logger } = context;
  if (options.dryRun) {
    changes.push(
      { action: "run", target: "nextly generate:types" },
      { action: "run", target: `nextly plugins install ${pluginName}` }
    );
    reportDryRun(logger, { changes });
    return;
  }
  const { runGenerateTypes } = await import("./generate-types");
  await runGenerateTypes(
    { cwd: options.cwd, config: options.config, quiet: options.quiet },
    context
  );
  await applySchema(pluginName, options, context);
  logger.newline();
  logger.success(`Added ${pluginName}.`);
  logger.info(
    `Start your dev server (${pc.yellow("next dev")}) or run your build to see it.`
  );
}

export async function runAdd(
  pkg: string,
  options: ResolvedAddOptions,
  context: CommandContext
): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const name = packageNameOf(pkg);
  const changes: DryRunChange[] = [];

  context.logger.header("Add a plugin");
  const installs = await installStep(pkg, cwd, options, context, changes);
  const planned = await planOrReport(
    name,
    cwd,
    installs,
    options,
    context,
    changes
  );
  if (planned === undefined) return;
  const pluginName = planned.plugin.name;
  await register(name, planned, cwd, options, context, changes);
  await addBuildStep(pluginName, cwd, options, context, changes);
  await finish(pluginName, options, context, changes);
}

/** The action of `nextly plugins add` and `nextly add`, loaded when it runs. */
export async function addAction(
  pkg: string,
  cmdOptions: AddCommandOptions,
  cmd: Command
) {
  const globalOpts: GlobalOptions = cmd.optsWithGlobals();
  const context = createContext(globalOpts);
  const resolved: ResolvedAddOptions = {
    ...cmdOptions,
    cwd: globalOpts.cwd,
    config: globalOpts.config,
    verbose: globalOpts.verbose,
    quiet: globalOpts.quiet,
  };
  try {
    await runAdd(pkg, resolved, context);
  } catch (error) {
    exitWithError(context.logger, error);
  }
}
