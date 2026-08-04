import {
  getBlock,
  type AnyBlockDefinition,
  type MigrationSource,
} from "@nextlyhq/blocks-engine";

/**
 * How the renderer finds the definition for a stored node's `type`.
 *
 * An interface rather than a direct call into the engine's registry, for the
 * same reason the engine states about its own `MigrationSource`: the registry
 * is `globalThis`-pinned process state, and a renderer wired straight to it can
 * only ever render one set of blocks. Through a seam, a test renders fixtures
 * without registering anything globally, a canvas renders a document against an
 * editor-side set, and two documents in one process can disagree about what
 * `core/hero` means.
 *
 * The default is still the global registry, so the CMS path stays zero-config.
 */
export interface BlockResolver {
  get(type: string): AnyBlockDefinition | undefined;
}

/**
 * The process-wide registry, which is what a Nextly app boots.
 *
 * Deliberately a function, not a captured value: the registry is cleared and
 * rebuilt on a dev-server hot reload, so a resolver holding a snapshot would
 * keep serving definitions the boot has already replaced.
 */
export function registeredBlocks(): BlockResolver {
  return { get: getBlock };
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
