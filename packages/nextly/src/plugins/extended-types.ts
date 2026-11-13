/**
 * Which content types each plugin's `extend` added each of its fields to, as
 * the latest start resolved them.
 *
 * A plugin that extends "every content type except these" (a scope) cannot
 * know from its own declaration which types got its field: Schema Builder
 * types are read only at start, and a type that already had a field of that
 * name is left as it was. This record answers it, for the plugin's own code
 * and for the admin, which offers a contribution only where it applies.
 *
 * Two halves, published by the two passes that add fields: the configuration
 * fold (types in code, the site's and plugins') and the Builder pass (types
 * made in the Schema Builder, read once the database is reachable). Each
 * publish replaces its own half, so a type that loses the field on a reload
 * is no longer listed.
 *
 * Imports nothing, so the fold, which every plugin test loads, publishes it
 * without loading anything else.
 *
 * @module plugins/extended-types
 * @experimental
 */

/** @experimental A content type a plugin's `extend` added a field to. */
export interface ExtendedType {
  kind: "collection" | "single";
  slug: string;
}

/**
 * The fields each plugin added, by type: `kind:slug` to field name to the
 * plugin that added it.
 */
export type AddedFields = ReadonlyMap<string, ReadonlyMap<string, string>>;

interface ExtendedTypesStore {
  configured: AddedFields;
  builder: AddedFields;
}

// On `globalThis`, as the fold's other published answers are: Next.js can
// evaluate this module in more than one server module graph, and the start
// that publishes may run in a different one from the request that reads.
const store = globalThis as unknown as {
  __nextly_extendedTypes?: ExtendedTypesStore;
};

function current(): ExtendedTypesStore {
  return (
    store.__nextly_extendedTypes ?? {
      configured: new Map(),
      builder: new Map(),
    }
  );
}

const keyOf = (kind: ExtendedType["kind"], slug: string): string =>
  `${kind}:${slug}`;

/** Publish what the latest configuration fold added. */
export function publishConfiguredExtensions(added: AddedFields): void {
  store.__nextly_extendedTypes = { ...current(), configured: added };
}

/** Publish what the latest Builder pass added. */
export function publishBuilderExtensions(added: AddedFields): void {
  store.__nextly_extendedTypes = { ...current(), builder: added };
}

/**
 * What the latest configuration fold added, for a reload to put back when the
 * configuration it read is refused and the previous one keeps running.
 */
export function currentConfiguredExtensions(): AddedFields {
  return current().configured;
}

/**
 * The fields each plugin added to the configured `collections` and
 * `singles`, from `bySlug` (slug to field name to plugin): the fold's record
 * of each slug target and scope clause it applied. Slugs that name neither,
 * such as a field group or a Builder type the fold deferred, are left out.
 */
export function configuredExtensionsOf(
  entities: {
    collections?: readonly { slug: string }[];
    singles?: readonly { slug: string }[];
  },
  bySlug: ReadonlyMap<string, ReadonlyMap<string, string>>
): AddedFields {
  const added = new Map<string, ReadonlyMap<string, string>>();
  const record = (kind: ExtendedType["kind"], slug: string) => {
    const fields = bySlug.get(slug);
    if (fields !== undefined && fields.size > 0) {
      added.set(keyOf(kind, slug), new Map(fields));
    }
  };
  for (const { slug } of entities.collections ?? []) {
    record("collection", slug);
  }
  for (const { slug } of entities.singles ?? []) record("single", slug);
  return added;
}

/** A field as the Builder pass leaves it: tagged with the plugin that added it. */
interface TaggedField {
  name?: unknown;
  source?: unknown;
  owner?: unknown;
}

/**
 * The fields each plugin added to Builder types, read from the tags the
 * Builder pass puts on each field it adds (`source: "plugin"` and `owner`).
 */
export function builderExtensionsOf(entities: {
  collections?: readonly { slug: string; fields?: readonly unknown[] }[];
  singles?: readonly { slug: string; fields?: readonly unknown[] }[];
}): AddedFields {
  const added = new Map<string, ReadonlyMap<string, string>>();
  const record = (
    kind: ExtendedType["kind"],
    entity: { slug: string; fields?: readonly unknown[] }
  ) => {
    const fields = new Map<string, string>();
    for (const field of entity.fields ?? []) {
      const { name, source, owner } = (field ?? {}) as TaggedField;
      if (
        source === "plugin" &&
        typeof name === "string" &&
        typeof owner === "string"
      ) {
        fields.set(name, owner);
      }
    }
    if (fields.size > 0) added.set(keyOf(kind, entity.slug), fields);
  };
  for (const entity of entities.collections ?? []) {
    record("collection", entity);
  }
  for (const entity of entities.singles ?? []) record("single", entity);
  return added;
}

/**
 * @experimental The content types `plugin`'s `extend` added `field` to, as
 * the latest start resolved them: types in the configuration first, then
 * those made in the Schema Builder. A type a scope left as it was, because it
 * already had a field of that name, or one the scope excepts, is not listed.
 * A Schema Builder type made since the start gets the field, and is listed,
 * once the site starts again.
 *
 * Read from what the start recorded, with no database read, so it may be
 * asked on every request and from a hook.
 */
export function typesExtendedBy(plugin: string, field: string): ExtendedType[] {
  const { configured, builder } = current();
  const found: ExtendedType[] = [];
  const seen = new Set<string>();
  for (const added of [configured, builder]) {
    for (const [key, fields] of added) {
      if (fields.get(field) !== plugin || seen.has(key)) continue;
      seen.add(key);
      const at = key.indexOf(":");
      found.push({
        kind: key.slice(0, at) as ExtendedType["kind"],
        slug: key.slice(at + 1),
      });
    }
  }
  return found;
}
