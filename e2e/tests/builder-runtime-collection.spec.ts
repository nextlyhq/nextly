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
import { expect, test, type APIResponse } from "@playwright/test";

import { gotoAdmin } from "./support/admin";

const OPEN_BUILDER_ACTION = /^(?:Build this page|Open Page Builder)$/;

async function expectOk(response: APIResponse, step: string): Promise<void> {
  expect(
    response.ok(),
    `${step}: ${response.status()} ${await response.text()}`
  ).toBe(true);
}

test("opens for a collection the Schema Builder made after boot", async ({
  page,
}) => {
  const slug = `runtime-pages-${Date.now()}`;
  const api = page.request;

  await expectOk(
    await api.post("/admin/api/collections", {
      data: { name: slug, labels: { singular: "Runtime page" } },
    }),
    "creating the collection"
  );
  const schema = await api.get(`/admin/api/collections/schema/${slug}`);
  await expectOk(schema, "reading its schema");
  const { schemaVersion } = (await schema.json()) as { schemaVersion: number };
  await expectOk(
    await api.post(`/admin/api/collections/schema/${slug}/apply`, {
      data: {
        fields: [
          { name: "title", type: "text", label: "Title" },
          { name: "layout", type: "blocks", label: "Layout" },
        ],
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
});
