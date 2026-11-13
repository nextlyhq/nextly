/**
 * A collection made at runtime, through the same calls the Schema Builder
 * makes, and the cleanup of what making it writes.
 *
 * @module tests/support/runtime-collection
 */
import {
  expect,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";

import { oweMigrationsOf } from "../../support/owed-migrations.mjs";

/**
 * Delete a collection a test made at runtime, unless it never got that far.
 * A collection left standing outlives its test: one whose blocks field sits in
 * a repeater or a group, which the usage index cannot count, keeps every later
 * spec from seeing the site counted in full.
 */
export async function removeRuntimeCollection(
  api: APIRequestContext,
  slug: string
): Promise<void> {
  const removed = await api.delete(`/admin/api/collections/${slug}`);
  if (removed.status() === 404) return;
  await expectOk(removed, "removing the collection");
}

/**
 * Remove the migrations this run caused, once the run ends. Not here and now:
 * the running server's migration ledger records each file it applied and
 * refuses the next Schema Builder save while one it recorded is missing, so
 * the slug is owed instead (`support/owed-migrations.mjs`), and the run's
 * teardown removes its files after the last test.
 */
export async function removeMigrationsOf(slug: string): Promise<void> {
  await oweMigrationsOf(slug);
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
