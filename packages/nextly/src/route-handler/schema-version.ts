/**
 * The schema version the admin reads from the `X-Nextly-Schema-Version`
 * response header, and invalidates its caches when it increases.
 *
 * Bumped by the collection dispatcher after a successful schema apply and
 * read by the route handler for every response. Kept in a module of its own
 * so the dispatcher bumps it without loading the route handler, which reaches
 * the boot entry and nearly all of the package.
 *
 * @module route-handler/schema-version
 */

let globalSchemaVersion = 0;

/** Increase the schema version by one, returning the new version. */
export function bumpSchemaVersion(): number {
  globalSchemaVersion++;
  return globalSchemaVersion;
}

/** The current schema version, as the response header carries it. */
export function getSchemaVersionHeader(): number {
  return globalSchemaVersion;
}
