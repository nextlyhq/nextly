/**
 * The New page dialog, in a browser: from the Pages list to the builder on a
 * saved draft with Add open, which the live site doesn't show; typing a title
 * and clicking away makes nothing; the whole dialog by keyboard; from the
 * builder with unsaved changes, each of Save, Discard and Keep editing; from
 * the builder's two ways in, the page menu's "+ New page…" and the Pages
 * panel's "New page", with and without unsaved work, and clicking away from
 * either makes nothing; and its size at 1280 × 720 and at a phone's width,
 * light and dark.
 *
 * @module tests/builder-new-page-dialog.spec
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { block, clickBlock } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { answeredNotFound } from "./support/not-found";
import { test } from "./support/test";

const ENTRIES = "/admin/api/collections/pages/entries";

const FIRST = "00000000-0000-4000-8000-00000000e001";
const SECOND = "00000000-0000-4000-8000-00000000e002";

/** A page with two headings, so one can be deleted as an unsaved edit. */
async function createPage(
  request: APIRequestContext,
  title: string
): Promise<string> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await request.post(ENTRIES, {
    data: {
      title,
      slug: `np-${stamp}`,
      status: "draft",
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [FIRST, SECOND].map((id, at) => ({
          id,
          type: "core/heading",
          version: 1,
          props: { text: `Heading ${at + 1}`, level: "h2" },
        })),
      },
    },
  });
  expect(created.ok(), `creating a page: ${created.status()}`).toBe(true);
  return ((await created.json()) as { item: { id: string } }).item.id;
}

/** The stored pages titled `title`, every status. */
async function storedTitled(
  request: APIRequestContext,
  title: string
): Promise<Record<string, unknown>[]> {
  const response = await request.get(
    `${ENTRIES}?status=all&limit=5&where[title][equals]=${encodeURIComponent(title)}`
  );
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { items: Record<string, unknown>[] })
    .items;
}

/** One stored page by id, every status. */
async function storedById(
  request: APIRequestContext,
  id: string
): Promise<Record<string, unknown>> {
  const response = await request.get(`${ENTRIES}/${id}?status=all`);
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as Record<string, unknown> & {
    item?: Record<string, unknown>;
  };
  return body.item ?? body;
}

const dialog = (page: Page) => page.getByRole("dialog", { name: "New page" });

async function openFromList(page: Page, theme: "light" | "dark" = "light") {
  await gotoAdmin(page, "/collections/pages", theme);
  await page.getByRole("button", { name: /^New / }).click();
  await expect(dialog(page)).toBeVisible();
}

const builderOf = (id: string) =>
  new RegExp(`/collections/pages/${id}/builder\\?field=content$`);

async function openBuilder(page: Page, id: string): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
}

/** Opens the Pages panel from the rail, unless it is open already. */
async function openPagesPanel(page: Page): Promise<void> {
  const item = page
    .getByRole("navigation", { name: "Editor panels" })
    .getByRole("button", { name: "Pages" });
  if ((await item.getAttribute("aria-pressed")) !== "true") await item.click();
  await expect(
    page.getByRole("region", { name: "Pages" }).first()
  ).toBeVisible();
}

/** An edit not yet saved: the second heading deleted on the canvas. */
async function unsavedEdit(page: Page): Promise<void> {
  const second = await block(page, SECOND);
  await expect(second).toBeVisible({ timeout: 30_000 });
  // Again until it takes: the first click on a canvas still settling can
  // land before the block is selectable.
  await expect(async () => {
    await clickBlock(page, SECOND);
    await page.keyboard.press("Delete");
    await expect(second).toHaveCount(0, { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  // Held as an edit, so the page on screen has unsaved work.
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
}

/** The builder's two ways in to the dialog. */
const WAYS_IN = {
  "the page menu": async (page: Page, title: string) => {
    await page.getByRole("button", { name: `${title}: switch page` }).click();
    const menu = page.getByRole("menu");
    // First in the menu, then the page on screen.
    const items = menu.getByRole("menuitem");
    await expect(items.first()).toHaveText("+ New page…");
    await expect(items.nth(1)).toHaveText(title);
    await expect(items.last()).toHaveText("All pages…");
    await items.first().click();
  },
  "the Pages panel": async (page: Page) => {
    await openPagesPanel(page);
    await page
      .getByRole("region", { name: "Pages" })
      .first()
      .getByRole("button", { name: "New page" })
      .click();
  },
} as const;

test.describe("the New page dialog", () => {
  test("from the Pages list: a draft, opened in the builder with Add open, that the live site doesn't show", async ({
    page,
    playwright,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const title = `Fresh ${Date.now()}`;
    await openFromList(page);
    const form = dialog(page);
    await expect(form.getByRole("textbox", { name: "Title" })).toBeFocused();
    await form.getByRole("textbox", { name: "Title" }).fill(title);
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    await expect(
      form.locator("[data-slot=new-page-address-text]")
    ).toContainText(`/${slug}`);
    await expect(
      form.getByText("Made from the title. Change it any time.")
    ).toBeVisible();
    await expect(
      form.getByText("Header & footer", { exact: true })
    ).toBeVisible();
    await expect(form.getByText("Saved as a draft.")).toBeVisible();
    await expect(form.getByText("Start from")).toHaveCount(0);

    await form.getByRole("button", { name: "Create and open builder" }).click();
    await expect(page).toHaveURL(
      /\/collections\/pages\/[^/]+\/builder\?field=content$/,
      {
        timeout: 60_000,
      }
    );
    await expect(
      page
        .getByRole("navigation", { name: "Editor panels" })
        .getByRole("button", { name: "Add" })
    ).toHaveAttribute("aria-pressed", "true", { timeout: 60_000 });

    const [stored] = await storedTitled(page.request, title);
    expect(stored).toMatchObject({
      title,
      slug,
      status: "draft",
      noHeaderFooter: false,
    });
    expect(stored?.layout ?? null).toBeNull();
    // A visitor: a request context of its own, with no session.
    const site = await playwright.request.newContext({
      baseURL: new URL(page.url()).origin,
    });
    const visitor = await site.get(`/${slug}`, { maxRedirects: 0 });
    const html = await visitor.text();
    expect(answeredNotFound({ status: visitor.status(), html })).toBe(true);
    await site.dispose();
  });

  test("typing a title and clicking away makes no page", async ({ page }) => {
    const title = `Away ${Date.now()}`;
    await openFromList(page);
    await dialog(page).getByRole("textbox", { name: "Title" }).fill(title);
    // Outside the dialog: it closes, as Escape and Cancel do, and makes nothing.
    await page.mouse.click(5, 5);
    await expect(dialog(page)).toBeHidden();
    expect(await storedTitled(page.request, title)).toHaveLength(0);
  });

  test("works by keyboard alone, and gives focus back to + New", async ({
    page,
  }) => {
    const title = `Keys ${Date.now()}`;
    await gotoAdmin(page, "/collections/pages");
    const opener = page.getByRole("button", { name: /^New / });
    await opener.focus();
    await page.keyboard.press("Enter");
    const form = dialog(page);
    await expect(form.getByRole("textbox", { name: "Title" })).toBeFocused();
    // The Header & footer menu takes focus once its choices have arrived.
    await expect(
      form.getByRole("combobox", { name: "Header & footer" })
    ).toBeEnabled();
    await page.keyboard.type(title);
    await page.keyboard.press("Tab");
    await expect(
      form.getByRole("button", { name: "Change the address" })
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      form.getByRole("combobox", { name: "Header & footer" })
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(form.getByRole("button", { name: "Cancel" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      form.getByRole("button", { name: "Create and open builder" })
    ).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(form).toBeHidden();
    await expect(opener).toBeFocused();
    expect(await storedTitled(page.request, title)).toHaveLength(0);

    await page.keyboard.press("Enter");
    await expect(form.getByRole("textbox", { name: "Title" })).toBeFocused();
    await page.keyboard.type(title);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/builder\?field=content$/, {
      timeout: 60_000,
    });
    expect(await storedTitled(page.request, title)).toHaveLength(1);
  });

  for (const [answer, made] of [
    ["Keep editing", false],
    ["Discard", true],
    ["Save", true],
  ] as const) {
    test(`from the builder with unsaved changes, ${answer} ${made ? "opens the new page" : "makes no page"}`, async ({
      page,
    }) => {
      const stamp = `${answer} ${Date.now()}`;
      const here = `${stamp} here`;
      const id = await createPage(page.request, here);
      await openBuilder(page, id);
      await unsavedEdit(page);
      await openPagesPanel(page);
      await page
        .getByRole("region", { name: "Pages" })
        .first()
        .getByRole("button", { name: "New page" })
        .click();
      const form = dialog(page);
      await form.getByRole("textbox", { name: "Title" }).fill(`${stamp} new`);
      await form
        .getByRole("button", { name: "Create and open builder" })
        .click();
      const question = page.getByRole("alertdialog", {
        name: `Save changes to ${here} first?`,
      });
      await expect(question).toBeVisible();
      await question.getByRole("button", { name: answer }).click();

      if (!made) {
        await expect(question).toBeHidden();
        await expect(form).toBeVisible();
        await expect(page).toHaveURL(builderOf(id));
        expect(await storedTitled(page.request, `${stamp} new`)).toHaveLength(
          0
        );
        return;
      }
      await expect(page).not.toHaveURL(builderOf(id), { timeout: 60_000 });
      await expect(page).toHaveURL(/\/builder\?field=content$/);
      expect(await storedTitled(page.request, `${stamp} new`)).toHaveLength(1);
      // Saved: the deleted heading stays deleted; discarded: it is back.
      const nodes = (
        (await storedById(page.request, id)).content as { nodes: unknown[] }
      ).nodes;
      expect(nodes).toHaveLength(answer === "Save" ? 1 : 2);
    });
  }

  for (const [way, openDialog] of Object.entries(WAYS_IN)) {
    test(`from ${way} with nothing unsaved, opens the new draft in the builder`, async ({
      page,
    }) => {
      const stamp = `Way ${Date.now()}`;
      const here = `${stamp} here`;
      const id = await createPage(page.request, here);
      await openBuilder(page, id);
      await openDialog(page, here);
      const form = dialog(page);
      await expect(form.getByRole("textbox", { name: "Title" })).toBeFocused();
      await form.getByRole("textbox", { name: "Title" }).fill(`${stamp} new`);
      await form
        .getByRole("button", { name: "Create and open builder" })
        .click();
      // Nothing to save, so no question before leaving.
      await expect(page).not.toHaveURL(builderOf(id), { timeout: 60_000 });
      await expect(page).toHaveURL(/\/builder\?field=content$/);
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      const [made] = await storedTitled(page.request, `${stamp} new`);
      expect(made).toMatchObject({ status: "draft" });
    });

    test(`from ${way} with unsaved work, asks first, then opens the new draft`, async ({
      page,
    }) => {
      const stamp = `Way unsaved ${Date.now()}`;
      const here = `${stamp} here`;
      const id = await createPage(page.request, here);
      await openBuilder(page, id);
      await unsavedEdit(page);
      await openDialog(page, here);
      const form = dialog(page);
      await form.getByRole("textbox", { name: "Title" }).fill(`${stamp} new`);
      await form
        .getByRole("button", { name: "Create and open builder" })
        .click();
      const question = page.getByRole("alertdialog", {
        name: `Save changes to ${here} first?`,
      });
      await expect(question).toBeVisible();
      // Nothing is made while the question is open.
      expect(await storedTitled(page.request, `${stamp} new`)).toHaveLength(0);
      await question.getByRole("button", { name: "Discard" }).click();
      await expect(page).not.toHaveURL(builderOf(id), { timeout: 60_000 });
      await expect(page).toHaveURL(/\/builder\?field=content$/);
      const [made] = await storedTitled(page.request, `${stamp} new`);
      expect(made).toMatchObject({ status: "draft" });
    });

    test(`from ${way}, typing a title and clicking away makes no page`, async ({
      page,
    }) => {
      const stamp = `Way away ${Date.now()}`;
      const here = `${stamp} here`;
      const id = await createPage(page.request, here);
      await openBuilder(page, id);
      await openDialog(page, here);
      await dialog(page)
        .getByRole("textbox", { name: "Title" })
        .fill(`${stamp} new`);
      await page.mouse.click(5, 5);
      await expect(dialog(page)).toBeHidden();
      await expect(page).toHaveURL(builderOf(id));
      expect(await storedTitled(page.request, `${stamp} new`)).toHaveLength(0);
    });
  }

  for (const theme of ["light", "dark"] as const) {
    test(`fits a 1280 × 720 window without scrolling, and is a full-height sheet at a phone's width (${theme})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 720 });
      await openFromList(page, theme);
      // The dialog's own frame, not any other dialog on the screen.
      const frame = page.locator(
        "[data-slot=dialog-content]:has([data-slot=new-page-form])"
      );
      await expect(frame).toBeVisible();
      // Measured once every row is drawn, with a title typed.
      await expect(frame.getByText("Saved as a draft.")).toBeVisible();
      await frame.getByRole("textbox", { name: "Title" }).fill("Pricing");
      const fits = await frame.evaluate(
        element =>
          element.scrollHeight <= element.clientHeight &&
          element.getBoundingClientRect().bottom <= window.innerHeight &&
          element.getBoundingClientRect().top >= 0
      );
      expect(fits).toBe(true);
      await page.screenshot({
        path: test.info().outputPath(`new-page-1280-${theme}.png`),
        animations: "disabled",
      });

      await page.setViewportSize({ width: 390, height: 844 });
      await expect
        .poll(async () => {
          const box = await frame.boundingBox();
          return box === null
            ? null
            : [box.x, box.y, box.width, box.height].map(Math.round);
        })
        .toEqual([0, 0, 390, 844]);
      // No row wider than the sheet.
      expect(
        await frame.evaluate(
          element => element.scrollWidth <= element.clientWidth
        )
      ).toBe(true);
      await page.screenshot({
        path: test.info().outputPath(`new-page-390-${theme}.png`),
        animations: "disabled",
      });
    });
  }
});
