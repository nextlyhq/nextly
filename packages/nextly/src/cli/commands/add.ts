/**
 * Add Command
 *
 * `nextly add <package>` — install sugar (D70). Installs a Nextly plugin with
 * the project's package manager, then prints exactly how to register it in
 * `defineConfig({ plugins })`. Low-friction install without the manual
 * "npm install + remember the config wiring" two-step.
 *
 * @module cli/commands/add
 *
 * @example
 * ```bash
 * nextly add @nextlyhq/plugin-form-builder
 * nextly add @acme/nextly-plugin-forms --dev
 * nextly add @acme/plugin --skip-install   # just print the wiring snippet
 * ```
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import type { Command } from "commander";
import pc from "picocolors";

import { describeError } from "../../errors/index";
import {
  createContext,
  type CommandContext,
  type GlobalOptions,
} from "../program";

export type PackageManager = "pnpm" | "yarn" | "npm";

export interface AddCommandOptions {
  /** Install as a dev dependency. @default false */
  dev?: boolean;
  /** Skip the package-manager install; only print the wiring snippet. @default false */
  skipInstall?: boolean;
}

interface ResolvedAddOptions extends AddCommandOptions {
  cwd?: string;
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

/** Best-effort local-name guess for the wiring snippet (e.g. `@acme/plugin-forms` → `forms`). */
function suggestImportName(pkg: string): string {
  const last = pkg.split("/").pop() ?? pkg;
  const camel = last
    .replace(/^nextly-plugin-/, "")
    .replace(/^plugin-/, "")
    .replace(/[-_]+([a-z0-9])/g, (_, c: string) => c.toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, "");
  return /^[a-z]/.test(camel) ? camel : `plugin${camel}`;
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

/** Print how to register the just-installed plugin in nextly.config.ts. */
function showWiring(pkg: string, context: CommandContext): void {
  const { logger } = context;
  const name = suggestImportName(pkg);

  logger.newline();
  logger.info(pc.bold("Register it in nextly.config.ts:"));
  logger.newline();
  logger.info(pc.gray(`  import { defineConfig } from "nextly";`));
  logger.info(pc.gray(`  import ${name} from "${pkg}";`));
  logger.newline();
  logger.info(pc.gray(`  export default defineConfig({`));
  logger.info(pc.gray(`    plugins: [${name}()],`));
  logger.info(pc.gray(`  });`));
  logger.newline();
  logger.info(
    `Then run ${pc.yellow("nextly dev")} (or your dev server) to sync the plugin's schema.`
  );
  logger.info(
    pc.gray("Check the plugin's README for its exact export name and options.")
  );
  logger.newline();
}

export async function runAdd(
  pkg: string,
  options: ResolvedAddOptions,
  context: CommandContext
): Promise<void> {
  const { logger } = context;
  const cwd = options.cwd ?? process.cwd();

  logger.header("Nextly Add");

  if (!options.skipInstall) {
    const pm = detectPackageManager(cwd);
    const args = buildInstallArgs(pm, pkg, options.dev ?? false);
    logger.info(`Installing ${pc.cyan(pkg)} with ${pc.yellow(pm)}…`);
    const code = await runInstall(pm, args, cwd);
    if (code !== 0) {
      logger.error(`Install failed (${pm} exited ${code}).`);
      process.exit(code || 1);
    }
    logger.success(`Installed ${pkg}`);
  }

  showWiring(pkg, context);
}

/** Register the `add` command with the program. */
export function registerAddCommand(program: Command): void {
  program
    .command("add <package>")
    .description("Install a Nextly plugin and show how to register it (D70)")
    .option("-D, --dev", "Install as a dev dependency", false)
    .option(
      "--skip-install",
      "Skip the package-manager install; just print the wiring snippet",
      false
    )
    .action(
      async (pkg: string, cmdOptions: AddCommandOptions, cmd: Command) => {
        const globalOpts: GlobalOptions = cmd.optsWithGlobals();
        const context = createContext(globalOpts);
        const resolved: ResolvedAddOptions = {
          ...cmdOptions,
          cwd: globalOpts.cwd,
          verbose: globalOpts.verbose,
          quiet: globalOpts.quiet,
        };
        try {
          await runAdd(pkg, resolved, context);
        } catch (error) {
          context.logger.error(describeError(error));
          process.exit(1);
        }
      }
    );
}
