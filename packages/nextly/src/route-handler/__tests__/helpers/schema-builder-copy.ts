/**
 * Another server copy of a site, as its own process: starts on the database
 * the URL names, which another copy is serving, saves a collection's fields
 * through the handler the Schema Builder's "apply" calls, and exits.
 *
 * Run by `schema-change-reaches-other-copy.integration.test.ts` through
 * `tsx`, so the copy runs this source, not a build. Arguments: the dialect,
 * the database URL, the app's folder (the copies are one app, so they share
 * its migrations), the collection's slug, the collection's schema version
 * the save is made against, and the fields to save, as JSON. Prints `saved`
 * once the save has committed.
 */
import { createAdapter } from "../../../database/factory";
import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { createTestNextly } from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";

const [dialect, url, basePath, slug, version, fields] = process.argv.slice(2);
if (!dialect || !url || !basePath || !slug || !version || !fields) {
  throw new Error(
    "usage: <dialect> <url> <app folder> <slug> <schema version> <fields>"
  );
}

const adapter = await createAdapter({ type: dialect, url } as Parameters<
  typeof createAdapter
>[0]);
const copy = await createTestNextly({ adapter: adapter as never, basePath });
await dispatchCollections(
  {} as ServiceContainer,
  "applySchemaChanges",
  { collectionName: slug },
  {
    fields: JSON.parse(fields) as unknown[],
    confirmed: true,
    schemaVersion: Number(version),
  }
);
await copy.destroy();
process.stdout.write("saved\n");
