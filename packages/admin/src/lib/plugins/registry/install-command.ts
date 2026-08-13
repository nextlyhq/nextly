/**
 * The three lines that add a catalogue plugin to a project: the shell command
 * that installs it, and the two edits to nextly.config.ts.
 *
 * All derived from the entry rather than stored beside it, so a package rename
 * cannot leave the install command fetching the old name while the detail page
 * joins installed state on the new one, and an entry cannot name a binding its
 * import does not bring in.
 *
 * @module lib/plugins/registry/install-command
 */
import type { RegistryPlugin } from "./types";

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

/**
 * The import that brings the plugin's binding into nextly.config.ts.
 *
 * Installing the package does not introduce the identifier, so the entry below
 * references nothing without this line. It is the reader's first edit, and
 * omitting it hands them a recipe that does not compile.
 */
export function importStatement(plugin: RegistryPlugin): string {
  return `import { ${plugin.config.exportName} } from "${plugin.id}";`;
}

/**
 * The entry to add inside `plugins: [...]`.
 *
 * `callArgs` decides whether the binding is called at all: `null` means the
 * package exports a ready-made plugin value, which is how
 * `@nextlyhq/plugin-form-builder` ships one — its factory returns a result
 * object whose definition sits at `.plugin`, so calling it here would be
 * wrong rather than merely verbose.
 */
export function pluginsArrayEntry(plugin: RegistryPlugin): string {
  const { exportName, callArgs } = plugin.config;
  const value = callArgs === null ? exportName : `${exportName}(${callArgs})`;
  return `plugins: [${value}]`;
}
