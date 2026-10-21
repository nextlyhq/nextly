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
import { expect } from "@playwright/test";

import { test } from "./support/test";
import { gotoAdmin } from "./support/admin";
import {
  createEntry,
  createRuntimeCollection,
  pageWithHeading,
  removeMigrationsOf,
} from "./support/runtime-collection";

const OPEN_BUILDER_ACTION = /^(?:Build this page|Open Page Builder)$/;

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
    await createRuntimeCollection(api, slug, [
      { name: "layout", type: "blocks", label: "Layout" },
    ]);
    const id = await createEntry(api, slug, {
      title: "Built at runtime",
      layout: pageWithHeading("runtime-heading", "Made after boot"),
    });

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
