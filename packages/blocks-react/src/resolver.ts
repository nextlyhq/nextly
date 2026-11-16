import {
  getBlock,
  type AnyBlockDefinition,
  type BlockRegistryReader,
  type MigrationSource,
} from "@nextlyhq/blocks-engine";

/**
 * How the renderer finds the definition for a stored node's `type`.
 *
 * An interface rather than a direct call into the engine's registry: each
 * site holds its own registry, so a renderer wired straight to one could only
 * ever render one set of blocks. Through a seam, a test renders fixtures
 * without registering anything, a canvas renders a document against the
 * editor's set, and two sites in one process can disagree about what
 * `core/hero` means.
 *
 * `PageRenderer` defaults to this bundle's registry, the one a browser bundle
 * such as the admin's editor fills. The Next.js routes default to the blocks
 * of the site they serve instead (`SITE_BLOCKS_SERVICE`).
 */
export interface BlockResolver {
  get(type: string): AnyBlockDefinition | undefined;
}

/**
 * This bundle's own registry: what the engine's module functions
 * (`registerBlocks`, `getBlock`) fill and read. In a browser bundle such as
 * the admin's editor, that is the one site's blocks. A server holds a
 * registry per site and fills none here, so a server render takes its site's
 * blocks instead.
 *
 * Deliberately a function, not a captured value: the registry is cleared and
 * rebuilt on a dev-server hot reload, so a resolver holding a snapshot would
 * keep serving definitions the boot has already replaced.
 */
export function registeredBlocks(): BlockResolver {
  return { get: getBlock };
}

/**
 * Where a Nextly instance offers its site's blocks: the page builder plugin's
 * read-only service holding the registry its boot filled. A route given no
 * `blocks` reads this from the process's instance on each render, so a site
 * draws its own registered blocks with nothing passed. One name, read by the
 * routes here and offered by the page builder, so the two cannot drift.
 *
 * @experimental Settles with the per-site block registry.
 */
export const SITE_BLOCKS_SERVICE = {
  plugin: "@nextlyhq/plugin-page-builder",
  service: "site-blocks",
} as const;

/**
 * The site's blocks as an instance offers them (its `plugins`), or
 * `undefined` when it offers none. The one reading of
 * {@link SITE_BLOCKS_SERVICE}, for the routes and the site style alike.
 */
export function offeredSiteBlocks(
  plugins: Readonly<Record<string, Readonly<Record<string, unknown>>>>
): BlockRegistryReader | undefined {
  const offered: unknown =
    plugins[SITE_BLOCKS_SERVICE.plugin]?.[SITE_BLOCKS_SERVICE.service];
  if (
    typeof offered === "object" &&
    offered !== null &&
    typeof (offered as { get?: unknown }).get === "function" &&
    typeof (offered as { all?: unknown }).all === "function"
  ) {
    return offered as BlockRegistryReader;
  }
  return undefined;
}

/**
 * A resolver over an explicit list, for tests and standalone rendering.
 *
 * A later definition with the same name replaces an earlier one rather than
 * being silently dropped, so composing a base set with an override reads the
 * way spreading an object does.
 */
export function createBlockResolver(
  definitions: readonly AnyBlockDefinition[]
): BlockResolver {
  const byName = new Map<string, AnyBlockDefinition>();
  for (const definition of definitions) byName.set(definition.name, definition);
  return { get: name => byName.get(name) };
}

/**
 * The migration view of a resolver.
 *
 * Derived from the resolver rather than taken from the engine's registry
 * helper, because the two must agree: migrating a document against the global
 * registry while rendering it against a fixture set would upgrade nodes to
 * versions the definitions doing the rendering have never heard of, and the
 * mismatch would surface as wrong props rather than as an error.
 */
export function migrationSourceFor(resolver: BlockResolver): MigrationSource {
  return {
    get: type => {
      const definition = resolver.get(type);
      if (!definition) return undefined;
      return definition.migrate === undefined
        ? { version: definition.version }
        : { version: definition.version, migrate: definition.migrate };
    },
  };
}
