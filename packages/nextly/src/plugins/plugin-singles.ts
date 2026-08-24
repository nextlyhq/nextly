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
  SingleRegistryService,
} from "../domains/singles/services/single-registry-service";
import type { DynamicSingleRecord } from "../schemas/dynamic-singles/types";

/**
 * @public Read-only registry access to the app's Singles.
 *
 * Addressed by SLUG. A Single's row may not exist until something writes to it,
 * so its row id is not a name you can hold — the slug is the stable one, and it
 * is what preview tokens are scoped on for the same reason. A consumer keying
 * anything on a Single's id will work until it meets a Single nobody has edited.
 */
/**
 * A field as this listing can return it: JSON, with every function gone.
 *
 * NOT `FieldConfig`. The registry reads `dynamic_singles.fields`, a JSON
 * column, so a code-first field declaring a function-valued option — a
 * `defaultValue` computed at write time, a custom `validate` — arrives here
 * with that option simply absent. `single-mutation-service.ts` says the same
 * thing from the other side: "serialized field defs drop them".
 *
 * Typing this as `FieldConfig` would promise a plugin it may call
 * `field.defaultValue()`, which is a type contract the data cannot honour —
 * and the failure would be a `TypeError` in somebody's plugin rather than a
 * compile error here.
 *
 * Only `name` and `type` are declared, plus `fields` for the container types.
 * Those three survive serialization and are what a consumer looking for a
 * particular field type needs.
 *
 * Deliberately NO index signature. One was tried and removed: it made every
 * remaining option reachable as `unknown`, which reads as generous and is the
 * opposite — a closed interface is not assignable to one carrying an index
 * signature, so the whole listing then needed an `as unknown as` to compile,
 * and a double assertion is exactly the thing that would have let the
 * overstated `FieldConfig` through in the first place. A consumer needing an
 * option beyond these three narrows the value itself, at the point where it
 * knows which field type it is holding and what that option should be.
 */
export interface SerializedFieldConfig {
  /**
   * Optional, because a NESTED field's name is. Presentational field types
   * carry no name — the compiler reported `string | undefined` here when this
   * was declared required, which is the data disagreeing with the type rather
   * than an inconvenience to assert past. A consumer keying anything on the
   * name has to handle its absence, and now has to.
   */
  name?: string;
  type: string;
  /** Nested fields, for the container types that have them. */
  fields?: SerializedFieldConfig[];
}

/**
 * A Single as the registry can describe it.
 *
 * Everything `DynamicSingleRecord` carries, with `fields` narrowed to what
 * survived the round trip through storage.
 */
export type PluginSingleRecord = Omit<DynamicSingleRecord, "fields"> & {
  fields: SerializedFieldConfig[];
};

/** What a plugin gets back from listing Singles. */
export interface PluginSinglesResult {
  data: PluginSingleRecord[];
  total: number;
}

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
  list(options?: ListSinglesOptions): Promise<PluginSinglesResult>;
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
    // The registry types `fields` as `FieldConfig[]`; what it actually holds
    // came back through JSON. Narrowed here rather than left overstated, so the
    // published type says what the data can support.
    list: options => registry.listSingles(options),
  };
}
