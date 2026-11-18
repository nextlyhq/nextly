/**
 * Pages open straight in the builder, and the rest of the document stays one
 * step away. A Pages row, a row found by search and a Continue card row open
 * the builder on the page's own field; a middle click opens it in a new tab,
 * and opening the form changes nothing about where the next click lands. A
 * collection made at runtime, as the Schema Builder makes one, whose main
 * field is a blocks field opens the same way with no restart, on its first
 * blocks field, asking nothing. In the builder, the top bar's ⋯ menu holds
 * "Open as form", which carries an unsaved edit to the form and back without
 * asking, as the same words at the bottom of Page settings do, and "Pin to
 * dashboard", the entry page's own pin. The back arrow is
 * "Back to Pages", asking first while work is unsaved; on a post, which opens
 * as a form, it stays "Exit editor" and returns to the form. No list row and
 * no entry header carries a pin of its own.
 *
 * @module tests/builder-opens-first.spec
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { block, clickBlock, pressSave } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import {
  createEntry,
  createRuntimeCollection,
  pageWithHeading,
  removeMigrationsOf,
  removeRuntimeCollection,
} from "./support/runtime-collection";
import { test } from "./support/test";

// The Continue card and the pin read and write the file's own dashboard.
test.describe.configure({ lock: [LOCK.dashboard], timeout: 180_000 });

const RUN = Date.now().toString(36);
const LIST = "/collections/pages";

const FIRST = "00000000-0000-4000-8000-00000000e001";
const SECOND = "00000000-0000-4000-8000-00000000e002";

/** A draft page holding two headings, so one can go and the page keeps one. */
async function savePage(
  api: APIRequestContext,
  title: string
): Promise<string> {
  return createEntry(api, "pages", {
    title,
    slug: `opens-first-${RUN}-${Math.random().toString(36).slice(2, 8)}`,
    status: "draft",
    content: {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: FIRST,
          type: "core/heading",
          version: 1,
          props: { text: "First heading", level: "h2" },
        },
        {
          id: SECOND,
          type: "core/heading",
          version: 1,
          props: { text: "Second heading", level: "h2" },
        },
      ],
    },
  });
}

/** The builder's address for a page, on the page's own field. */
const builderAt = (id: string) =>
  new RegExp(`/admin/collections/pages/${id}/builder\\?field=content$`);
/** The form's address for a page. */
const formAt = (id: string) => new RegExp(`/admin/collections/pages/${id}$`);

/** The link a list row draws for `title`. */
const rowLink = (page: Page, title: string) =>
  page
    .getByRole("table", { name: "Entries table" })
    .getByRole("link", { name: title, exact: true });

const canvas = (page: Page) => page.getByRole("region", { name: "Canvas" });

async function builderOpen(page: Page): Promise<void> {
  await expect(canvas(page)).toBeVisible({ timeout: 60_000 });
}

/** An unsaved edit: the second heading deleted on the canvas. */
async function deleteSecondHeading(page: Page): Promise<void> {
  const second = await block(page, SECOND);
  await clickBlock(page, SECOND);
  await page.keyboard.press("Delete");
  await expect(second).toHaveCount(0);
}

async function moreMenu(page: Page): Promise<void> {
  await page
    .locator('[data-topbar="end"]')
    .getByRole("button", { name: "More actions" })
    .click();
}

const leaveQuestion = (page: Page) =>
  page.getByRole("alertdialog", { name: "Unsaved Changes" });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

test.describe("where a page opens", () => {
  test("a Pages row opens the builder, and opening the form changes nothing about the next click", async ({
    page,
  }) => {
    const title = `Opens in builder ${RUN}`;
    const id = await savePage(page.request, title);

    await gotoAdmin(page, LIST);
    await expect(rowLink(page, title)).toHaveAttribute("href", builderAt(id));
    await rowLink(page, title).click();
    await expect(page).toHaveURL(builderAt(id));
    await builderOpen(page);

    // The form by its own address, as an old link or a bookmark opens it.
    await gotoAdmin(page, `${LIST}/${id}`);
    await expect(page).toHaveURL(formAt(id));
    await expect(page.getByTestId("document-bar")).toBeVisible();
    // Then back to the list: the same click lands in the builder again.
    await gotoAdmin(page, LIST);
    await rowLink(page, title).click();
    await expect(page).toHaveURL(builderAt(id));
  });

  test("a row found by the list's search opens the builder", async ({
    page,
  }) => {
    const title = `Found by search ${RUN}`;
    const id = await savePage(page.request, title);

    await gotoAdmin(page, LIST);
    await page.getByRole("searchbox").first().fill(title);
    await expect(rowLink(page, title)).toHaveCount(1);
    await rowLink(page, title).click();
    await expect(page).toHaveURL(builderAt(id));
  });

  test("a middle click on a Pages row opens the builder in a new tab", async ({
    page,
    context,
  }) => {
    const title = `New tab ${RUN}`;
    const id = await savePage(page.request, title);

    await gotoAdmin(page, LIST);
    const listUrl = page.url();
    const opened = context.waitForEvent("page");
    await rowLink(page, title).click({ button: "middle" });
    const tab = await opened;
    await tab.waitForLoadState();
    await expect(tab).toHaveURL(builderAt(id));
    expect(page.url()).toBe(listUrl);
    await tab.close();
  });

  test("a Continue card row opens the builder", async ({ page }) => {
    const title = `Continue in builder ${RUN}`;
    const id = await savePage(page.request, title);

    await gotoAdmin(page, "");
    const link = page
      .getByTestId("widget-cell-core/continue")
      .getByTestId("entity-row")
      .filter({ hasText: title })
      .getByRole("link", { name: title });
    await expect(link).toHaveAttribute("href", builderAt(id));
    await link.click();
    await expect(page).toHaveURL(builderAt(id));
  });

  test("a runtime collection whose main field is a blocks field opens on it, with two blocks fields and no question", async ({
    page,
  }) => {
    // Made through the Schema Builder's own calls while the site runs: the
    // rule reads the collection as it is now, so no restart is needed.
    const slug = `opens_first_${RUN}`;
    const api = page.request;
    try {
      await createRuntimeCollection(api, slug, [
        { name: "body", type: "blocks", label: "Body" },
        { name: "aside", type: "blocks", label: "Aside" },
      ]);
      const id = await createEntry(api, slug, {
        title: "Two fields",
        body: pageWithHeading("body-heading", "In the body"),
        aside: pageWithHeading("aside-heading", "In the aside"),
      });

      await gotoAdmin(page, `/collections/${slug}`);
      await rowLink(page, "Two fields").click();
      // On the first blocks field, by the address: no field is asked for.
      await expect(page).toHaveURL(
        new RegExp(`/admin/collections/${slug}/${id}/builder\\?field=body$`)
      );
      await builderOpen(page);
      await expect(await block(page, "body-heading")).toBeVisible();
      // Its list is named by the collection's plural label.
      await expect(
        page.getByRole("button", { name: "Back to Runtime pages" })
      ).toBeVisible();
    } finally {
      await removeRuntimeCollection(api, slug);
      await removeMigrationsOf(slug);
    }
  });
});

test.describe("the builder's ⋯ menu", () => {
  test("Open as form carries an unsaved edit to the form and back, asking nothing", async ({
    page,
  }) => {
    const title = `Open as form ${RUN}`;
    const id = await savePage(page.request, title);
    await gotoAdmin(page, `${LIST}/${id}/builder?field=content`);
    await builderOpen(page);
    await deleteSecondHeading(page);

    await moreMenu(page);
    await page.getByRole("menuitem", { name: "Open as form" }).click();
    await expect(page).toHaveURL(formAt(id));
    await expect(leaveQuestion(page)).toHaveCount(0);
    // The form holds the edit, unsaved.
    const bar = page.getByTestId("document-bar");
    await expect(bar.getByText("Unsaved changes")).toBeVisible();

    // And back to the builder by the bar's way in: the edit is still there.
    await bar
      .getByRole("link", { name: "Open in builder", exact: true })
      .click();
    await expect(page).toHaveURL(builderAt(id));
    await expect(leaveQuestion(page)).toHaveCount(0);
    await expect(await block(page, FIRST)).toBeVisible();
    await expect(await block(page, SECOND)).toHaveCount(0);
  });

  test("Open as form at the bottom of Page settings does the same", async ({
    page,
  }) => {
    const title = `Open as form from settings ${RUN}`;
    const id = await savePage(page.request, title);
    await gotoAdmin(page, `${LIST}/${id}/builder?field=content`);
    await builderOpen(page);
    await deleteSecondHeading(page);

    await page
      .getByRole("navigation", { name: "Editor panels" })
      .getByRole("button", { name: "Settings" })
      .click();
    const settings = page.getByRole("dialog", { name: /^Page settings · / });
    await expect(
      settings.getByText("Saved with the page when you Save or Publish.")
    ).toBeVisible();
    await settings.getByRole("button", { name: "Open as form" }).click();
    await expect(page).toHaveURL(formAt(id));
    await expect(leaveQuestion(page)).toHaveCount(0);
    await expect(
      page.getByTestId("document-bar").getByText("Unsaved changes")
    ).toBeVisible();
  });

  test("Pin to dashboard pins the page, with the entry page's toast and Undo, and the dashboard shows it", async ({
    page,
  }) => {
    const title = `Pinned from the builder ${RUN}`;
    const id = await savePage(page.request, title);
    try {
      await gotoAdmin(page, `${LIST}/${id}/builder?field=content`);
      await builderOpen(page);

      await moreMenu(page);
      await page.getByRole("menuitem", { name: "Pin to dashboard" }).click();
      const toast = page
        .locator("[data-sonner-toast]")
        .filter({ hasText: "Pinned to your dashboard." });
      await expect(toast).toBeVisible();
      await expect(toast.getByRole("button", { name: "Undo" })).toBeVisible();

      // The menu now offers the other verb, as the entry page's does.
      await moreMenu(page);
      await expect(
        page.getByRole("menuitem", { name: "Unpin from dashboard" })
      ).toBeVisible();
      await page.keyboard.press("Escape");

      await gotoAdmin(page, "");
      const pinned = page
        .getByTestId("widget-cell-core/continue")
        .getByRole("group", { name: "Pinned" });
      await expect(
        pinned.getByTestId("entity-row").filter({ hasText: title })
      ).toHaveCount(1);
    } finally {
      // Unpinned again whatever happened above, so the file's account keeps
      // no pin of this test's on the dashboard the next spec reads.
      const removed = await page.request.delete("/admin/api/dashboard/pins", {
        data: { targetType: "collection", targetSlug: "pages", entryId: id },
      });
      // Not found is fine: a test that failed before pinning left none.
      expect(
        removed.ok() || removed.status() === 404,
        await removed.text()
      ).toBe(true);
    }
  });
});

test.describe("the back arrow", () => {
  test("on a page it is Back to Pages: it asks while work is unsaved, and goes straight to the list once saved", async ({
    page,
  }) => {
    // Not "Back to Pages": the title's switcher would carry the arrow's words.
    const title = `Leaving for the list ${RUN}`;
    const id = await savePage(page.request, title);
    await gotoAdmin(page, `${LIST}/${id}/builder?field=content`);
    await builderOpen(page);
    await expect(
      page.getByRole("button", { name: "Exit editor", exact: true })
    ).toHaveCount(0);
    const back = page.getByRole("button", {
      name: "Back to Pages",
      exact: true,
    });

    await deleteSecondHeading(page);
    await back.click();
    await expect(leaveQuestion(page)).toBeVisible();
    await leaveQuestion(page)
      .getByRole("button", { name: "Keep Editing" })
      .click();
    await expect(page).toHaveURL(builderAt(id));
    await expect(await block(page, SECOND)).toHaveCount(0);

    const stored = page.waitForResponse(
      response =>
        ["PATCH", "PUT", "POST"].includes(response.request().method()) &&
        response.url().includes(`/collections/pages/entries/${id}`)
    );
    await pressSave(page);
    expect((await stored).ok()).toBe(true);
    // Saved: nothing is left for the question to be about.
    await expect(
      page.locator('[data-topbar="end"]').getByText("Unsaved changes")
    ).toHaveCount(0);
    await back.click();
    await expect(page).toHaveURL(/\/admin\/collections\/pages$/);
    await expect(leaveQuestion(page)).toHaveCount(0);
    await expect(rowLink(page, title)).toBeVisible();
  });

  test("on a post, which opens as a form, it stays Exit editor and returns to the form", async ({
    page,
  }) => {
    const title = `A post in the builder ${RUN}`;
    // A post laid out with the builder: its blocks field shows only then.
    const id = await createEntry(page.request, "posts", {
      title,
      slug: `exit-editor-${RUN}`,
      editorMode: "page-builder",
    });
    await gotoAdmin(page, `/collections/posts/${id}`);
    await page
      .getByTestId("document-bar")
      .getByRole("link", { name: "Open in builder", exact: true })
      .click();
    await builderOpen(page);
    await expect(page.getByRole("button", { name: /^Back to / })).toHaveCount(
      0
    );

    await page
      .getByRole("button", { name: "Exit editor", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/admin/collections/posts/${id}$`));
  });
});

test("no list row and no entry header carries a pin or star of its own", async ({
  page,
}) => {
  // Pinning lives in the ⋯ menus only: the builder's and the entry page's.
  const title = `No stars ${RUN}`;
  const id = await savePage(page.request, title);
  const control = /pin|star|favou?rite/i;

  await gotoAdmin(page, LIST);
  const row = page
    .getByRole("table", { name: "Entries table" })
    .getByRole("row")
    .filter({ hasText: title });
  await expect(row).toHaveCount(1);
  await expect(row.getByRole("button", { name: control })).toHaveCount(0);
  await expect(row.getByRole("checkbox", { name: control })).toHaveCount(0);

  await gotoAdmin(page, `${LIST}/${id}`);
  const bar = page.getByTestId("document-bar");
  await expect(bar).toBeVisible();
  await expect(bar.getByRole("button", { name: control })).toHaveCount(0);
  // The control for the absence: the bar's own ⋯ does hold the pin.
  await bar.getByRole("button", { name: "More actions" }).click();
  await expect(
    page.getByRole("menuitem", { name: "Pin to dashboard" })
  ).toBeVisible();
});
