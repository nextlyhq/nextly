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
 * `installCommand("@acme/p", "pnpm", "1.2.3")` → `"pnpm add @acme/p@1.2.3"`.
 *
 * Answerable for all four managers, so a reader on npm is not handed a command
 * their project cannot run.
 *
 * Pinned to the running admin's release, and that is not a nicety. Every
 * first-party plugin declares an EXACT `nextly` peer for its own release, so
 * an unpinned install on a project that is not on the newest one resolves a
 * plugin whose peer names a core the project does not have: npm rejects it,
 * and a manager that installs it anyway produces a plugin core refuses to load
 * at startup. Admin's own version is the release the project is on, since the
 * whole train publishes in lockstep and this bundle came from that install.
 *
 * Unpinned when `version` is undefined — a build that did not inject the
 * constant. Naming a version that may not exist would be a worse answer than
 * declining to name one.
 *
 * `version` is required rather than defaulted to `adminVersion()`, so a caller
 * has to answer the question instead of inheriting an answer. A default would
 * also make the unpinned branch unreachable from a test, since passing
 * `undefined` re-triggers the default.
 */
export function installCommand(
  packageName: string,
  manager: PackageManager,
  version: string | undefined
): string {
  const specifier = version ? `${packageName}@${version}` : packageName;
  return `${manager} ${ADD_SUBCOMMAND[manager]} ${specifier}`;
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
 * The single element to append inside an existing `plugins: [...]`.
 *
 * The element alone, not the whole `plugins:` property. A reader who already
 * has plugins configured — the likely one, since the directory is reached from
 * the installed list — cannot use a property: pasting it inside the array is
 * not valid TypeScript, and pasting it over the existing property silently
 * drops every plugin already there.
 *
 * `callArgs` decides whether the binding is called at all: `null` means the
 * package exports a ready-made plugin value, which is how
 * `@nextlyhq/plugin-form-builder` ships one — its factory returns a result
 * object whose definition sits at `.plugin`, so calling it here would be
 * wrong rather than merely verbose.
 */
/**
 * The side-effect import the app's admin route needs, for plugins that ship
 * an `/admin` module — `undefined` for those that do not.
 *
 * Its own line rather than part of the config recipe because it goes in a
 * different file: the admin route page, not `nextly.config.ts`. Undefined
 * rather than an empty string, so a caller has to decide whether to render a
 * step at all instead of rendering a blank one.
 */
export function adminImportStatement(
  plugin: RegistryPlugin
): string | undefined {
  return plugin.config.adminModule ? `import "${plugin.id}/admin";` : undefined;
}

/**
 * The stylesheet import the admin route needs, for plugins that ship one.
 *
 * A separate line from `adminImportStatement`, because the module and the
 * stylesheet are separate imports in the same file and a plugin can ship
 * either without the other. Taking only the module leaves the editor
 * registered and unstyled, which looks like a broken build rather than a
 * missing step.
 */
export function adminStylesImport(plugin: RegistryPlugin): string | undefined {
  const subpath = plugin.config.adminStyles;
  return subpath ? `import "${plugin.id}/${subpath}";` : undefined;
}

export function pluginsArrayEntry(plugin: RegistryPlugin): string {
  const { exportName, callArgs } = plugin.config;
  return callArgs === null ? exportName : `${exportName}(${callArgs})`;
}
