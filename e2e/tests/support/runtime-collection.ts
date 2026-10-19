/**
 * A collection made at runtime, through the same calls the Schema Builder
 * makes, and the cleanup of what making it writes.
 *
 * @module tests/support/runtime-collection
 */
import { readdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  expect,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";

// Where the playground writes the SQL migration of a collection made at
// runtime: `db.migrationsDir` in its config.
const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../apps/playground/src/db/migrations"
);

/**
 * Remove the migrations this run caused. Making a collection at runtime writes
 * its SQL into the playground's migrations folder, which the suite's fresh
 * database never needs again; left there, they would pile up with every run and
 * wait for the next migrate against the dev database. Matched by the run's own
 * unique slug, so nothing another run or person wrote is touched.
 */
export async function removeMigrationsOf(slug: string): Promise<void> {
  const table = slug.replace(/-/g, "_");
  for (const dir of [MIGRATIONS_DIR, join(MIGRATIONS_DIR, "dynamic")]) {
    const names = await readdir(dir).catch(() => [] as string[]);
    for (const name of names.filter(file => file.endsWith(".sql"))) {
      const path = join(dir, name);
      const sql = await readFile(path, "utf8").catch(() => "");
      if (name.includes(table) || sql.includes(table)) await rm(path);
    }
  }
}

export async function expectOk(
  response: APIResponse,
  step: string
): Promise<void> {
  expect(
    response.ok(),
    `${step}: ${response.status()} ${await response.text()}`
  ).toBe(true);
}

/**
 * Create the collection and give it these fields, as the Schema Builder does:
 * the collection first, with none of its own, then an apply of its fields.
 */
export async function createRuntimeCollection(
  api: APIRequestContext,
  slug: string,
  fields: readonly Record<string, unknown>[]
): Promise<void> {
  await expectOk(
    await api.post("/admin/api/collections", {
      data: {
        name: slug,
        labels: { singular: "Runtime page", plural: "Runtime pages" },
        fields: [],
      },
    }),
    "creating the collection"
  );
  const schema = await api.get(`/admin/api/collections/schema/${slug}`);
  await expectOk(schema, "reading its schema");
  const { schemaVersion } = (await schema.json()) as {
    schemaVersion: number;
  };
  await expectOk(
    await api.post(`/admin/api/collections/schema/${slug}/apply`, {
      data: {
        // Only the collection's own fields: `title` is a system column the
        // server adds, and the Schema Builder leaves it out of an apply too.
        fields,
        // The Schema Builder's confirmation, which an apply requires.
        confirmed: true,
        schemaVersion,
      },
    }),
    "adding its fields"
  );
}

/** A one-heading page, by the node id a test looks for on the canvas. */
export function pageWithHeading(id: string, text: string) {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id,
        type: "core/heading",
        version: 1,
        props: { text, level: "h2" },
      },
    ],
  };
}

/** Create an entry and answer its id. */
export async function createEntry(
  api: APIRequestContext,
  slug: string,
  data: Record<string, unknown>
): Promise<string> {
  const created = await api.post(`/admin/api/collections/${slug}/entries`, {
    data,
  });
  await expectOk(created, "creating an entry");
  return String(((await created.json()) as { item: { id: string } }).item.id);
}
