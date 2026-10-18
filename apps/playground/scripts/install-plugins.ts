/**
 * Installs every plugin the playground's config lists, on the database the
 * environment names: `nextly plugins install <name>` for each, in config order.
 *
 * A production boot refuses a configured plugin that no install has recorded,
 * so anything that builds a fresh database and then starts the production
 * server — the production browser suite, the Lighthouse run — has to install
 * the plugins in between, exactly as a deployment would. Development only
 * warns, which is why `pnpm dev:app` never needed this.
 *
 * The names are read from the config rather than listed beside it, so a
 * plugin added to the config is installed without anyone remembering to add
 * it here; and in the same environment the server boots in, because which
 * plugins are configured depends on it. Config order, because a dependent's
 * install reads its dependency as installed.
 *
 * Runs the real command, so the install is the one an operator gets: its
 * migrations, its `onInstall`, and the record the boot reads.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isCliEntry } from "../../../scripts/cli-entry.mjs";

const PLAYGROUND_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

/** What installing a list of plugins came to. */
export type InstallResult =
  | { ok: true; installed: readonly string[] }
  | { ok: false; installed: readonly string[]; failed: string; status: number };

/**
 * Installs each plugin in turn and stops at the first that fails: a later one
 * may depend on it, and the command has already said why. `install` runs one
 * install and answers its exit status.
 */
export function installPlugins(
  names: readonly string[],
  install: (name: string) => number
): InstallResult {
  const installed: string[] = [];
  for (const name of names) {
    const status = install(name);
    if (status !== 0) return { ok: false, installed, failed: name, status };
    installed.push(name);
  }
  return { ok: true, installed };
}

/** One real `nextly plugins install`, run in the playground. */
function runInstall(name: string): number {
  const result = spawnSync(
    "pnpm",
    ["exec", "nextly", "plugins", "install", name],
    {
      cwd: PLAYGROUND_DIR,
      stdio: "inherit",
      // pnpm is a `.cmd` shim on Windows, which only a shell can run.
      shell: process.platform === "win32",
    }
  );
  // No status means the process never ran or was killed: a failure either way.
  return result.status ?? 1;
}

async function main(): Promise<void> {
  // Loaded here rather than at the top, so importing this module for its
  // exports does not build the whole playground config.
  const { default: config } = await import("../nextly.config");
  const names = (config.plugins ?? []).map(plugin => plugin.name);
  const result = installPlugins(names, runInstall);
  if (!result.ok) {
    console.error(`[nextly] installing ${result.failed} failed`);
    process.exit(result.status);
  }
  console.log(
    `[nextly] installed ${result.installed.length} configured plugin(s): ${result.installed.join(", ")}`
  );
}

// Wrapped rather than awaited at the top level: tsx compiles this to CJS.
if (isCliEntry(import.meta.url)) {
  void main();
}
