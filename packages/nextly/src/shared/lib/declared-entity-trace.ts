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

/** The entity kinds of a configuration, as its keys name them. */
const KINDS = ["collections", "singles", "fieldGroups"] as const;

/**
 * Stamp each collection, Single and field group in `config` with its place, as
 * `collections[0]`. Called on the copy the setups are handed, never on the app's own objects.
 */
export function traceDeclaredEntities(config: object): void {
  for (const kind of KINDS) {
    const entities = (config as Partial<Record<string, unknown>>)[kind];
    if (!Array.isArray(entities)) continue;
    entities.forEach((entity: unknown, index) => {
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

/** The place `traceDeclaredEntities` stamped on `entity`, or undefined where it carries none. */
export function declaredPlaceOf(entity: unknown): string | undefined {
  if (typeof entity !== "object" || entity === null) return undefined;
  const place = (entity as Record<symbol, unknown>)[DECLARED_AT];
  return typeof place === "string" ? place : undefined;
}
