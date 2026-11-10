/**
 * A blocks field inside a repeater's row opens in the Page Builder, addressed
 * by the row's saved id, and stays on that row when the rows are reordered: a
 * save from the builder lands in that row only. An address whose row is gone,
 * or that names a row by its position, opens nothing.
 *
 * Every row holds a blocks field of the same name, so a builder that bound by
 * the row's position rather than its id would open, and save into, the row
 * that took the moved row's place.
 *
 * @module tests/builder-repeater-row
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

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

/** One stored row of the `sections` repeater. */
interface StoredRow {
  id?: string;
  heading?: string;
  body?: { nodes?: { id: string }[] };
}

/** The entry's rows as the API stores them, in their stored order. */
async function storedRows(
  api: APIRequestContext,
  slug: string,
  id: string
): Promise<StoredRow[]> {
  const read = await api.get(`/admin/api/collections/${slug}/entries/${id}`);
  expect(read.ok()).toBe(true);
  return ((await read.json()) as { sections?: StoredRow[] }).sections ?? [];
}

/** A collection whose `sections` rows each hold a heading and a blocks field. */
async function makeCollection(
  api: APIRequestContext,
  slug: string
): Promise<string> {
  await createRuntimeCollection(api, slug, [
    {
      name: "sections",
      type: "repeater",
      label: "Sections",
      labels: { singular: "Section", plural: "Sections" },
      fields: [
        { name: "heading", type: "text", label: "Heading" },
        { name: "body", type: "blocks", label: "Body" },
      ],
    },
  ]);
  return createEntry(api, slug, {
    title: "Rows",
    sections: [
      { heading: "Intro", body: pageWithHeading("intro-heading", "Intro") },
      {
        heading: "Hero banner",
        body: pageWithHeading("hero-heading", "Hero banner"),
      },
      {
        heading: "Closing",
        body: pageWithHeading("closing-heading", "Closing"),
      },
    ],
  });
}

test("opens a repeater row's blocks field by the row's id, and stays on that row after a reorder", async ({
  page,
}) => {
  // A collection name is lowercase letters, digits and underscores.
  const slug = `row_pages_${Date.now()}`;
  const api = page.request;
  try {
    await makeAndEdit();
  } finally {
    await removeRuntimeCollection(api, slug);
    await removeMigrationsOf(slug);
  }

  // The steps, in a function so the cleanup above runs whatever they do.
  async function makeAndEdit(): Promise<void> {
    const id = await makeCollection(api, slug);
    const form = `/admin/collections/${slug}/${id}`;
    // Every row was given a saved id by the write that created it.
    const [intro, hero, closing] = await storedRows(api, slug, id);
    const heroId = hero?.id ?? "";
    expect(heroId).not.toBe("");

    // Row 2's own card opens the builder at the row's id, not its position.
    await gotoAdmin(page, `/collections/${slug}/${id}`);
    await page
      .getByRole("link", { name: OPEN_BUILDER_ACTION })
      .and(page.locator(`[href$="field=sections.${heroId}.body"]`))
      .click();
    const builderUrl = new RegExp(
      `${form}/builder\\?field=sections\\.${heroId}\\.body$`
    );
    await expect(page).toHaveURL(builderUrl);
    await expect(heading(page, "hero-heading")).toBeVisible({
      timeout: 30_000,
    });
    await expect(heading(page, "intro-heading")).toHaveCount(0);
    // Which row this is, by its title, in the top bar and the bottom bar.
    await expect(page.getByTestId("builder-field-location")).toHaveText(
      "Sections · Hero banner · Body"
    );
    await expect(
      page.getByRole("list", { name: "Current location" })
    ).toContainText("Sections · Hero banner · Body");

    // Back to the entry, which returns to the same row's way in.
    await page.getByRole("button", { name: "Exit editor" }).click();
    await expect(page).toHaveURL(new RegExp(`${form}$`));
    const heroWayIn = page
      .getByRole("link", { name: OPEN_BUILDER_ACTION })
      .and(page.locator(`[href$="field=sections.${heroId}.body"]`));
    await expect(heroWayIn).toBeFocused();

    // Row 2 dragged to the top, by its handle and the keyboard.
    const handle = page.getByRole("button", {
      name: /^Drag to reorder .* 2$/,
    });
    await handle.focus();
    // Each key waits for the announcement of the one before: the keyboard
    // sensor listens for a move only once the pick-up has been handled, and a
    // key pressed sooner is lost.
    const announced = (words: string) =>
      page.getByRole("status").filter({ hasText: words });
    await page.keyboard.press("Space");
    await expect(announced("Picked up")).toHaveCount(1);
    await page.waitForTimeout(250);
    await page.keyboard.press("ArrowUp");
    await expect(announced("is over")).toHaveCount(1);
    await page.waitForTimeout(250);
    await page.keyboard.press("Space");
    await expect(announced("moved to position 1")).toHaveCount(1);
    // Its way in now comes first, still naming the same row's id.
    await expect(
      page.getByRole("link", { name: OPEN_BUILDER_ACTION }).first()
    ).toHaveAttribute("href", new RegExp(`field=sections\\.${heroId}\\.body$`));

    // Back returns to the builder's address, which opens the same row at its
    // new place: its own page, not the one now in second place.
    await page.goBack();
    await expect(page).toHaveURL(builderUrl);
    await expect(heading(page, "hero-heading")).toBeVisible({
      timeout: 30_000,
    });
    await expect(heading(page, "intro-heading")).toHaveCount(0);
    await expect(page.getByTestId("builder-field-location")).toHaveText(
      "Sections · Hero banner · Body"
    );

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

    // The moved row holds the edit, at the top; the other rows are as they
    // were, each keeping its id and its page.
    const after = await storedRows(api, slug, id);
    expect(after.map(row => row.id)).toEqual([heroId, intro?.id, closing?.id]);
    expect(after[0]?.body).toMatchObject({ nodes: [] });
    expect(after[1]?.body).toMatchObject({
      nodes: [{ id: "intro-heading" }],
    });
    expect(after[2]?.body).toMatchObject({
      nodes: [{ id: "closing-heading" }],
    });
  }
});

test("refuses an address whose row is gone, and one naming a row by position", async ({
  page,
}) => {
  const slug = `row_refusals_${Date.now()}`;
  const api = page.request;
  try {
    await refuse();
  } finally {
    await removeRuntimeCollection(api, slug);
    await removeMigrationsOf(slug);
  }

  async function refuse(): Promise<void> {
    const id = await makeCollection(api, slug);
    const form = `/admin/collections/${slug}/${id}`;

    for (const field of ["sections.no-such-row.body", "sections.1.body"]) {
      await page.goto(`${form}/builder?field=${field}`);
      await expect(
        page.getByRole("heading", { name: "This row can't be opened" })
      ).toBeVisible({ timeout: 30_000 });
      // No canvas frame at all: no row's page was opened in its place. A
      // query for a heading inside one would pass on an empty page.
      await expect(page.locator(CANVAS_FRAME)).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Back to the document" })
      ).toBeVisible();
    }
  }
});
