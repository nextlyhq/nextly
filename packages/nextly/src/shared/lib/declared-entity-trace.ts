/**
 * Where each of the app's entities was declared, carried by the copy a plugin's `setup` is handed
 * into whatever it returns.
 *
 * A setup may change an app entity in any way, its slug included, and the configuration a command
 * uses is the one the setups returned. Judging that configuration means finding, for each entity
 * the app declared, the one a setup left in its place, and a slug cannot say which it is once a
 * setup has renamed it. So each copy is stamped with its place before any setup runs: under a
 * registered symbol, so a second copy of this module reads it; enumerable, so the object spread a
 * setup writes (`{ ...entity, slug }`) keeps it. Symbol keys are outside `Object.keys`, JSON and
 * every listing of an entity's settings, so nothing that reads the entity sees it.
 *
 * @module shared/lib/declared-entity-trace
 */

const DECLARED_AT = Symbol.for("nextly.config.declaredAt");

/**
 * The system fields (`title`, `slug`) a `define*` function added, by identity: what tells
 * them apart from a field of the same name a plugin's setup adds. Held on `globalThis` under a
 * registered symbol, so the configuration's bundle and the runtime, each with its own copy of
 * this module, share one; weak, so it holds no field past its configuration.
 */
const SYSTEM_FIELDS_KEY = Symbol.for("nextly.config.systemFields");

function systemFields(): WeakSet<object> {
  const holder = globalThis as unknown as Record<
    symbol,
    WeakSet<object> | undefined
  >;
  holder[SYSTEM_FIELDS_KEY] ??= new WeakSet<object>();
  return holder[SYSTEM_FIELDS_KEY];
}

/** Record `field` as a system field its entity's `define*` function added. */
export function markSystemField<T extends object>(field: T): T {
  systemFields().add(field);
  return field;
}

/** Whether `field` is one `markSystemField` recorded, or the setups' copy of one. */
export function isSystemField(field: unknown): boolean {
  return (
    typeof field === "object" && field !== null && systemFields().has(field)
  );
}

/** The entity kinds of a configuration, as its keys name them. */
const KINDS = ["collections", "singles", "fieldGroups"] as const;

/**
 * Stamp each collection, Single and field group in `copy` with its place, as `collections[0]`,
 * and record each copy of a system field `source` holds as one too. Called on the copy the
 * setups are handed (`copy`, made from `source` in the same order), never on the app's own
 * objects.
 */
export function traceDeclaredEntities(copy: object, source: object): void {
  for (const kind of KINDS) {
    const entities = (copy as Partial<Record<string, unknown>>)[kind];
    if (!Array.isArray(entities)) continue;
    const originals = (source as Partial<Record<string, unknown>>)[kind];
    entities.forEach((entity: unknown, index) => {
      carrySystemFields(
        entity,
        Array.isArray(originals) ? originals[index] : undefined
      );
      if (
        typeof entity === "object" &&
        entity !== null &&
        Object.isExtensible(entity)
      ) {
        Object.defineProperty(entity, DECLARED_AT, {
          value: `${kind}[${index}]`,
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
    });
  }
}

/** Record each of `copy`'s top-level fields whose original in `source` is a system field. */
function carrySystemFields(copy: unknown, source: unknown): void {
  const copied = (copy as { fields?: unknown } | null)?.fields;
  const original = (source as { fields?: unknown } | null)?.fields;
  if (!Array.isArray(copied) || !Array.isArray(original)) return;
  copied.forEach((field: unknown, index) => {
    if (
      isSystemField(original[index]) &&
      typeof field === "object" &&
      field !== null
    ) {
      markSystemField(field);
    }
  });
}

/** The place `traceDeclaredEntities` stamped on `entity`, or undefined where it carries none. */
export function declaredPlaceOf(entity: unknown): string | undefined {
  if (typeof entity !== "object" || entity === null) return undefined;
  const place = (entity as Record<symbol, unknown>)[DECLARED_AT];
  return typeof place === "string" ? place : undefined;
}
