/**
 * How each package manager spells "run this script" and "run this binary".
 *
 * One answer to a question asked in several places: the next-steps screen printed after a
 * scaffold, and the agent guide written into the project. Hardcoding npm is not merely untidy —
 * under Yarn's default PnP linker there is no `node_modules/.bin`, so `npm run dev` cannot
 * resolve `next` and the command fails outright.
 *
 * @module utils/package-manager-commands
 */
import type { PackageManager } from "../types";

/**
 * The prefix that runs a package.json script.
 *
 * npm requires the explicit `run`; the others accept the bare form, and `bun` keeps `run` to
 * avoid colliding with its own subcommands.
 */
export function scriptRunner(packageManager: PackageManager): string {
  switch (packageManager) {
    case "npm":
      return "npm run";
    case "bun":
      return "bun run";
    default:
      return packageManager;
  }
}

/**
 * The prefix that executes a dependency's binary directly, for commands a project has no script
 * for. Each manager resolves binaries through its OWN installation layout, which is why this
 * cannot be `npx` everywhere: under Yarn PnP there is no `.bin` directory for npx to look in.
 */
export function binaryRunner(packageManager: PackageManager): string {
  switch (packageManager) {
    case "npm":
      return "npx";
    case "yarn":
      return "yarn";
    case "pnpm":
      return "pnpm exec";
    case "bun":
      return "bunx";
  }
}
