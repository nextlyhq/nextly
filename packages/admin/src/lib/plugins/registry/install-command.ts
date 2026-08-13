/**
 * The shell command that installs a catalogue plugin.
 *
 * Derived from the entry's `id` rather than stored beside it, so a package
 * rename cannot leave the install command fetching the old name while the
 * detail page joins installed state on the new one.
 *
 * @module lib/plugins/registry/install-command
 */

/**
 * Package managers a Nextly project can be installed with.
 *
 * Enumerated rather than free-form because the add subcommand differs: npm and
 * bun take `install`, pnpm and yarn take `add`. A caller passing its own string
 * would have to know that, which is the knowledge this module exists to hold.
 */
export const PACKAGE_MANAGERS = ["pnpm", "npm", "yarn", "bun"] as const;

export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

const ADD_SUBCOMMAND: Record<PackageManager, string> = {
  pnpm: "add",
  npm: "install",
  yarn: "add",
  bun: "add",
};

/**
 * `installCommand("@acme/p")` → `"pnpm add @acme/p"`.
 *
 * Defaults to pnpm, which is what Nextly's own docs and scaffolder use, while
 * staying answerable for the other three so a reader on npm is not handed a
 * command their project cannot run.
 */
export function installCommand(
  packageName: string,
  manager: PackageManager = "pnpm"
): string {
  return `${manager} ${ADD_SUBCOMMAND[manager]} ${packageName}`;
}
