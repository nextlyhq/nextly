/**
 * The Singles a plugin is allowed to see.
 *
 * The counterpart to `ctx.services.collections` for the other kind of content:
 * what Singles are declared, and what fields they have.
 *
 * Both are needed because Singles are reached through a different service with
 * a different shape, so a capability that cuts across content has to handle
 * them SEPARATELY. One written against collections alone covers half the app
 * and reports success — a document sweep finds no reference in a Single, and
 * cannot tell that from there being none.
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
import { typeHasNestedFields } from "../collections/fields/guards";
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
   * Optional, because a nested field's name is.
   *
   * Presentational field types carry no name, so a consumer keying anything on
   * it — a lookup, a path, a dedup — has to handle its absence.
   */
  name?: string;
  type: string;
  /**
   * Nested fields, present only for the CONTAINER types.
   *
   * A contributed field type carries an index signature, so it may hold a
   * `fields` option of any shape as its own private configuration — a record, a
   * string, anything its plugin reads. Passing that through under this name
   * would promise an array a caller can `.map()` and hand it something else.
   *
   * The projection therefore keeps `fields` only where the type is one the
   * engine treats as a container AND the value really is an array, which is the
   * same rule `fields-payload.ts` applies before walking nested fields.
   */
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
   * Returns what {@link PluginSingleRecord} declares — identity, label,
   * description, field definitions and origin. It does NOT return any Single's
   * content, and it creates nothing; see the module note.
   *
   * ## A row can outlive its declaration
   *
   * Removing a code-first Single from config leaves its registry row readable
   * until someone runs the destructive cleanup — `reload-config.ts` says so
   * where it prunes the defaults, describing "a removed single's registry row
   * (which stays readable)". Such a row is returned here, carrying
   * `source: "code"`.
   *
   * It is NOT filtered out at this layer, and that is deliberate rather than an
   * omission. Filtering after `listSingles` returns would happen after the
   * registry has already applied `limit` and `offset`, so a page holding an
   * orphan would come back short while live Singles waited on later pages, and
   * a total computed from what survived would describe one page rather than the
   * result. Filtering correctly means excluding the row before pagination,
   * which only the registry can do — it holds both the rows and the live
   * code-first snapshot that says which slugs are still declared.
   *
   * A caller that must exclude them can: `source` is on every record, and a
   * plugin holds `ctx.config.singles`. Doing it here would also make this
   * surface answer differently from every other reader of the same registry.
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
/**
 * One field, reduced to what this surface can promise about it.
 *
 * Recursive, because a container's children are fields too and inherit the same
 * uncertainty about their own `fields` option.
 */
function toSerializedField(
  field: SerializedFieldConfig
): SerializedFieldConfig {
  // BUILT from the declared members rather than spread and trimmed. A spread
  // publishes every enumerable property and removes the named one, so the
  // shape a caller receives is whatever the registry happened to store —
  // including `pluginOptions`, which belongs to the field's own plugin and has
  // no business reaching a different one. Constructing means a property is
  // published because it appears here, not because nobody excluded it.
  const serialized: SerializedFieldConfig = { type: field.type };
  // Assigned conditionally so an absent name stays absent. Writing `undefined`
  // would put the key in `Object.keys` and in a `in` check while the type says
  // the member is optional.
  if (field.name !== undefined) serialized.name = field.name;
  const nested = field.fields;
  if (typeHasNestedFields(field.type) && Array.isArray(nested)) {
    serialized.fields = nested.map(toSerializedField);
  }
  return serialized;
}

function toPluginRecord(record: DynamicSingleRecord): PluginSingleRecord {
  return {
    id: record.id,
    slug: record.slug,
    label: record.label,
    description: record.description ?? undefined,
    // Assignable without an assertion: `SerializedFieldConfig` declares only
    // members every `FieldConfig` arm already satisfies. Each field is then
    // reduced to what this surface can promise about it.
    fields: record.fields.map(toSerializedField),
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
