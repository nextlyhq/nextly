/**
 * The Singles a plugin is allowed to see.
 *
 * `ctx.services.collections` has answered "what collections exist and what is
 * in them" since plugins existed. There was no counterpart for Singles, so a
 * plugin asking the same question about them had no way to ask it.
 *
 * The gap is structural rather than an omission of naming. Singles are reached
 * through a different service with a different shape, so a capability that
 * cuts across content has to handle them SEPARATELY — and a capability written
 * against collections alone covers half the app while reporting success.
 * Preview had the same shape; so does enumerating documents to find
 * references.
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
import type {
  DynamicSingleRecord,
  SingleSource,
} from "../schemas/dynamic-singles/types";

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
 * Deliberately no index signature. Adding one to keep the remaining options
 * reachable as `unknown` reads as generous and costs more than it gives: a
 * closed interface is not assignable to a type carrying an index signature, so
 * the projection would need a double assertion to compile — and a double
 * assertion is what lets an overstated type through unnoticed. A consumer
 * needing an option beyond these three narrows the value itself, where it knows
 * which field type it holds and what that option should be.
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
 * A Single as this listing can describe it.
 *
 * Declared member by member rather than derived from `DynamicSingleRecord`
 * with the awkward parts subtracted. That distinction is the whole point: an
 * `Omit<..., "fields">` inherits every OTHER member exactly as the registry
 * declares it, including the ones the registry cannot actually return —
 *
 * - `admin.preview.url` is `(document) => string | null`. The registry reads
 *   `admin` back through `JSON.parse`, and JSON has no functions, so a plugin
 *   calling it gets a `TypeError` from a type that promised a callable.
 * - `createdAt` and `updatedAt` are declared `Date` and produced by
 *   `normalizeDbTimestamp`, whose signature is `(value: unknown) => string |
 *   null`. The registry bridges that with `as unknown as Date`, so
 *   `record.createdAt.getTime()` compiles and throws.
 *
 * Subtracting those two as well would fix today's members and leave the same
 * trap armed for tomorrow's: anything added to the registry record arrives
 * here unexamined, with its declared type republished as plugin API. Listing
 * what this surface can honour means a new registry member is absent until
 * somebody decides it belongs, which is the safe direction for a published
 * type.
 *
 * Narrow on purpose. A member omitted can be added when somebody needs it; a
 * member published cannot be withdrawn without breaking an installed plugin.
 */
export interface PluginSingleRecord {
  id: string;
  /** The stable name. A Single's row may not exist; its slug always does. */
  slug: string;
  label: string;
  /**
   * Absent rather than null.
   *
   * `dynamic_singles.description` is nullable in all three dialects and the
   * registry's deserializer preserves that through an unchecked cast to
   * `string | undefined`, so the value really can be `null`. Publishing it as
   * optional and normalizing at the seam means `record.description?.trim()`
   * works, where a caller checking `!== undefined` on a null would have thrown.
   */
  description?: string;
  /** The declaration, whether or not anybody has written to this Single. */
  fields: SerializedFieldConfig[];
  /** Where it came from: declared in code, built in the UI, or built in. */
  source: SingleSource;
}

/*
 * `createdAt` and `updatedAt` are deliberately ABSENT.
 *
 * The registry stores them by passing the driver's value through
 * `normalizeDbTimestamp`, whose own contract says it "assumes every `Date` is
 * naive and always un-offsets" and points at `dbTimestampToInstant` as the
 * dialect-aware alternative that is "safe for SQLite". SQLite's columns are
 * epoch-backed, so its driver already builds the correct instant and
 * un-offsetting it a second time shifts it by the server's timezone.
 *
 * Publishing them here would republish that as plugin API, correct on two
 * dialects of three and silently wrong on the third — and wrong only on a
 * non-UTC server, so it would read as correct wherever it was checked.
 * Recovering the instant needs the dialect, which belongs with the registry
 * that already knows it rather than being plumbed to a caller that does not.
 *
 * Nothing this surface exists for reads them. A member omitted can be added
 * once the registry can answer correctly; one published cannot be withdrawn.
 */

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
/**
 * Project a registry record onto what this surface publishes.
 *
 * A real projection rather than an assertion, because the two shapes genuinely
 * differ: the registry declares `createdAt` as `Date` and holds a string. A
 * cast would have compiled and republished the same untruth one layer out,
 * which is what makes copying members across deliberate work rather than
 * plumbing.
 *
 */
function toPluginRecord(record: DynamicSingleRecord): PluginSingleRecord {
  return {
    id: record.id,
    slug: record.slug,
    label: record.label,
    description: record.description ?? undefined,
    // Assignable without an assertion: `SerializedFieldConfig` declares only
    // members every `FieldConfig` arm already satisfies, which is what made
    // narrowing it honest in the first place.
    fields: record.fields,
    source: record.source,
  };
}

export function wrapSinglesForPlugin(
  registry: SingleRegistryService
): PluginSinglesService {
  return {
    list: async options => {
      const result = await registry.listSingles(options);
      return { data: result.data.map(toPluginRecord), total: result.total };
    },
  };
}
