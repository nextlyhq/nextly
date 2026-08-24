/**
 * The Singles a plugin is allowed to see.
 *
 * `ctx.services.collections` has answered "what collections exist and what is
 * in them" since plugins existed. There was no counterpart for Singles, so a
 * plugin asking the same question about them had no way to ask it.
 *
 * That gap is not cosmetic and it has cost real work twice. Singles are reached
 * through a different service with a different shape, so every capability that
 * cuts across content has to be taught about them SEPARATELY — and each one is
 * taught late, after the capability has already shipped believing it was
 * complete. Preview was one. Enumerating documents to find references is
 * another.
 *
 * ## Deliberately read-only, and deliberately narrow
 *
 * This exposes the REGISTRY — what Singles are declared and what fields they
 * have — and nothing that reads or writes a Single's content. A plugin that
 * needs a Single's document goes through the ordinary content path, where
 * access rules apply.
 *
 * Narrow because the surface is public API: a method added here cannot be
 * withdrawn without breaking an installed plugin, while one omitted can be
 * added the day somebody needs it.
 *
 * ## Why "does not create anything" is stated rather than assumed
 *
 * A read-shaped call on the Single path is NOT automatically free of side
 * effects. The readable half of `assertSinglePreviewable` CREATES the Single's
 * row when it is absent, which is correct there and would be a disaster here: a
 * plugin walking every Single to build an index would bring every Single in the
 * app into existence as a side effect of looking, silently, and the walk would
 * look like it was working.
 *
 * The listing below reads `dynamic_singles`, the REGISTRY table, through
 * `listRecords` — a query, with no insert on any path. It is structurally
 * incapable of materialising a content row because it never touches one. That
 * is the property to preserve if this is ever re-pointed at another service.
 *
 * @module plugins/plugin-singles
 */
import type {
  ListSinglesOptions,
  ListSinglesResult,
  SingleRegistryService,
} from "../domains/singles/services/single-registry-service";

/**
 * @public Read-only registry access to the app's Singles.
 *
 * Addressed by SLUG. A Single's row may not exist until something writes to it,
 * so its row id is not a name you can hold — the slug is the stable one, and it
 * is what preview tokens are scoped on for the same reason. A consumer keying
 * anything on a Single's id will work until it meets a Single nobody has edited.
 */
export interface PluginSinglesService {
  /**
   * List the declared Singles, with their field definitions.
   *
   * Returns registry records: `slug`, `label`, `fields`, `source` and the
   * migration bookkeeping. It does NOT return any Single's content, and it
   * creates nothing — see the module note.
   *
   * A returned entry says a Single is DECLARED, never that it has been written
   * to. `fields` is the declaration, so a consumer looking for a particular
   * field type finds it here whether or not anybody has filled it in.
   */
  list(options?: ListSinglesOptions): Promise<ListSinglesResult>;
}

/**
 * Wrap the registry service in the narrow read-only surface plugins get.
 *
 * A wrapper rather than handing over the service itself, because the registry
 * can register, lock, and rewrite migration status. Passing it directly would
 * publish all of that as plugin API by accident, and the omission would be
 * invisible — nothing about `services.singles = singleRegistry` looks like it
 * grants a plugin the ability to unregister a Single.
 */
export function wrapSinglesForPlugin(
  registry: SingleRegistryService
): PluginSinglesService {
  return {
    list: options => registry.listSingles(options),
  };
}
