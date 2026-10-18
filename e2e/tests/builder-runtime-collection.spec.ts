/**
 * A collection created at runtime in the Schema Builder, with a top-level
 * blocks field, opens the Page Builder with no restart.
 *
 * The builder is offered on the blocks field TYPE rather than on a list of
 * collections, so a collection nobody had created when the server booted gets
 * it as soon as it exists. Created here through the same two calls the Schema
 * Builder makes: the collection, then its fields.
 *
 * @module tests/builder-runtime-collection
 */
import { readdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type APIResponse } from "@playwright/test";

import { gotoAdmin } from "./support/admin";

const OPEN_BUILDER_ACTION = /^(?:Build this page|Open Page Builder)$/;

// Where the playground writes the SQL migration of a collection made at
// runtime: `db.migrationsDir` in its config.
const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../apps/playground/src/db/migrations"
);

/**
 * Remove the migrations this run caused. Making a collection at runtime writes
 * its SQL into the playground's migrations folder, which the suite's fresh
 * database never needs again; left there, they would pile up with every run and
 * wait for the next migrate against the dev database. Matched by the run's own
 * unique slug, so nothing another run or person wrote is touched.
 */
async function removeMigrationsOf(slug: string): Promise<void> {
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

async function expectOk(response: APIResponse, step: string): Promise<void> {
  expect(
    response.ok(),
    `${step}: ${response.status()} ${await response.text()}`
  ).toBe(true);
}

test("opens for a collection the Schema Builder made after boot", async ({
  page,
}) => {
  // A collection name is lowercase letters, digits and underscores.
  const slug = `runtime_pages_${Date.now()}`;
  const api = page.request;
  try {
    await makeAndOpen();
  } finally {
    await removeMigrationsOf(slug);
  }

  // The steps, in a function so the cleanup above runs whatever they do.
  async function makeAndOpen(): Promise<void> {
    await expectOk(
      await api.post("/admin/api/collections", {
        // The body the Schema Builder sends: a new collection starts with no
        // fields of its own.
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
          // Only the collection's own field: `title` is a system column the
          // server adds, and the Schema Builder leaves it out of an apply too.
          fields: [{ name: "layout", type: "blocks", label: "Layout" }],
          // The Schema Builder's confirmation, which an apply requires.
          confirmed: true,
          schemaVersion,
        },
      }),
      "adding a top-level blocks field"
    );

    const created = await api.post(`/admin/api/collections/${slug}/entries`, {
      data: {
        title: "Built at runtime",
        layout: {
          formatVersion: 1,
          kind: "page",
          nodes: [
            {
              id: "runtime-heading",
              type: "core/heading",
              version: 1,
              props: { text: "Made after boot", level: "h2" },
            },
          ],
        },
      },
    });
    await expectOk(created, "creating an entry");
    const id = String(
      ((await created.json()) as { item: { id: string } }).item.id
    );

    await gotoAdmin(page, `/collections/${slug}/${id}`);
    await page.getByRole("link", { name: OPEN_BUILDER_ACTION }).click();

    await expect(page).toHaveURL(
      new RegExp(`/admin/collections/${slug}/${id}/builder\\?field=layout$`)
    );
    await expect(
      page.locator('.nx-canvas [data-nx-node="runtime-heading"]').first()
    ).toBeVisible({ timeout: 30_000 });
  }
});
