/**
 * A blocks field inside a named group opens in the Page Builder, addressed by
 * its path from the document's root, and a save lands at that path only.
 *
 * The document also has a top-level blocks field with the same name as the
 * grouped one, so a builder that bound by the field's own name rather than its
 * path would open, and save into, the wrong page.
 *
 * @module tests/builder-nested-field
 */
import { expect, type Page } from "@playwright/test";

import { test } from "./support/test";
import { gotoAdmin } from "./support/admin";
import {
  createEntry,
  createRuntimeCollection,
  pageWithHeading,
  removeMigrationsOf,
  removeRuntimeCollection,
} from "./support/runtime-collection";
import { LOCK } from "./support/locks";
import { CANVAS_FRAME, canvasFrame } from "./support/canvas-frame";

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ lock: [LOCK.dashboard, LOCK.schema] });

const OPEN_BUILDER_ACTION = /^(?:Build this page|Open Page Builder)$/;

function heading(page: Page, id: string) {
  return canvasFrame(page).locator(`.nx-canvas [data-nx-node="${id}"]`).first();
}

test("opens a blocks field inside a named group by its path, and saves it there", async ({
  page,
}) => {
  // A collection name is lowercase letters, digits and underscores.
  const slug = `grouped_pages_${Date.now()}`;
  const api = page.request;
  try {
    await makeAndEdit();
  } finally {
    await removeRuntimeCollection(api, slug);
    await removeMigrationsOf(slug);
  }

  // The steps, in a function so the cleanup above runs whatever they do.
  async function makeAndEdit(): Promise<void> {
    await createRuntimeCollection(api, slug, [
      {
        name: "hero",
        type: "group",
        label: "Hero",
        fields: [{ name: "body", type: "blocks", label: "Hero body" }],
      },
      { name: "body", type: "blocks", label: "Body" },
    ]);
    const id = await createEntry(api, slug, {
      title: "Grouped",
      hero: { body: pageWithHeading("hero-heading", "Inside the group") },
      body: pageWithHeading("body-heading", "At the top level"),
    });
    const form = `/admin/collections/${slug}/${id}`;

    // The grouped field's own card opens the builder at its path.
    await gotoAdmin(page, `/collections/${slug}/${id}`);
    await page
      .getByRole("link", { name: OPEN_BUILDER_ACTION })
      .and(page.locator('[href$="field=hero.body"]'))
      .click();
    await expect(page).toHaveURL(
      new RegExp(`${form}/builder\\?field=hero\\.body$`)
    );
    await expect(heading(page, "hero-heading")).toBeVisible({
      timeout: 30_000,
    });
    await expect(heading(page, "body-heading")).toHaveCount(0);

    // One edit, saved with the form's own shortcut.
    await heading(page, "hero-heading").click();
    await page.keyboard.press("Delete");
    await expect(heading(page, "hero-heading")).toHaveCount(0);
    const saved = page.waitForResponse(
      response =>
        response.request().method() === "PATCH" &&
        new URL(response.url()).pathname ===
          `/admin/api/collections/${slug}/entries/${id}`
    );
    await page.keyboard.press("Control+s");
    expect((await saved).ok()).toBe(true);

    // The group's page holds the edit; the top-level page of the same name is
    // as it was.
    const read = await api.get(`/admin/api/collections/${slug}/entries/${id}`);
    expect(read.ok()).toBe(true);
    const stored = (await read.json()) as {
      hero?: { body?: unknown };
      body?: unknown;
    };
    expect(stored.hero?.body).toMatchObject({ nodes: [] });
    expect(stored.body).toMatchObject({ nodes: [{ id: "body-heading" }] });

    // An address naming a field the group does not have opens nothing on its
    // own: the document has two fields the builder edits, so it asks which.
    await page.goto(`${form}/builder?field=hero.nope`);
    await expect(
      page.getByRole("heading", { name: "Which field do you want to edit?" })
    ).toBeVisible({ timeout: 30_000 });
    // No canvas frame at all: a query for the canvas inside one would pass on
    // an empty page.
    await expect(page.locator(CANVAS_FRAME)).toHaveCount(0);
  }
});
