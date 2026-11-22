/**
 * A Single whose main field is the page builder opens in the builder, as a
 * page does: the playground's Homepage (a title and a page layout) from the
 * sidebar, its search and the Content screen's row. In the builder, the ⋯ menu's "Open as form" reaches the Homepage's
 * form, with its side panel, whose bar and card both lead back. The back
 * arrow reads "Back to content", asks while work is unsaved and opens the
 * Content screen; there is no "Exit editor". Contact details, whose first
 * field is not the builder, opens as a form, and a reader who may only read
 * the Homepage gets its form, read-only.
 *
 * @module tests/single-opens-in-builder.spec
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { STORAGE_STATE } from "../global-setup";

import { block, clickBlock, pressSave } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { signInAsLimitedUser } from "./support/limited-user";
import { LOCK } from "./support/locks";
import { waitForShellAnswers } from "./support/shell-geometry";
import { test } from "./support/test";

// The Homepage's layout and its edit lock are shared with other specs.
test.describe.configure({ lock: [LOCK.homepage], timeout: 180_000 });

const HOMEPAGE_API = "/admin/api/singles/homepage";
const BUILDER_URL = /\/admin\/singles\/homepage\/builder\?field=layout$/;
const FORM_URL = /\/admin\/singles\/homepage$/;
const CONTENT_URL = /\/admin\/content$/;

const FIRST = "00000000-0000-4000-8000-00000000f601";
const SECOND = "00000000-0000-4000-8000-00000000f602";

function heading(id: string, text: string) {
  return { id, type: "core/heading", version: 1, props: { text, level: "h2" } };
}

/** The Homepage's layout, two headings, so one can go and the page keeps one. */
async function seed(page: Page): Promise<void> {
  const stored = await page.request.patch(HOMEPAGE_API, {
    data: {
      layout: {
        formatVersion: 1,
        kind: "page",
        nodes: [heading(FIRST, "First"), heading(SECOND, "Second")],
      },
      _overwrite: true,
    },
  });
  expect(stored.ok(), `seeding the homepage layout: ${stored.status()}`).toBe(
    true
  );
}

/** The sidebar's Content list, where its Singles are. */
function contentList(page: Page): Locator {
  return page
    .getByTestId("sub-sidebar")
    .getByRole("navigation", { name: "Content" });
}

/** The Content screen, by the rail's own entry, with the panel beside it. */
async function openContent(page: Page): Promise<void> {
  await gotoAdmin(page, "/");
  await waitForShellAnswers(page);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Content", exact: true })
    .click();
  await page.waitForURL(CONTENT_URL);
}

const canvas = (page: Page) => page.getByRole("region", { name: "Canvas" });

async function builderOpen(page: Page): Promise<void> {
  await expect(canvas(page)).toBeVisible({ timeout: 60_000 });
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

test.describe("where a Single opens", () => {
  test("the sidebar's Homepage opens the builder; Open as form reaches its form and panel, and Open in builder comes back", async ({
    page,
  }) => {
    await seed(page);
    await openContent(page);
    const link = contentList(page).getByRole("link", {
      name: "Homepage",
      exact: true,
    });
    await expect(link).toHaveAttribute("href", BUILDER_URL);
    await link.click();
    await expect(page).toHaveURL(BUILDER_URL);
    await builderOpen(page);

    await moreMenu(page);
    await page.getByRole("menuitem", { name: "Open as form" }).click();
    await expect(page).toHaveURL(FORM_URL);
    await expect(page.getByRole("textbox", { name: "Title" })).toBeVisible({
      timeout: 60_000,
    });
    const toggle = page.getByRole("button", { name: "Show document panel" });
    if (await toggle.isVisible()) await toggle.click();
    for (const section of [
      "What this is",
      "Last changed",
      "Shown on (from the builder)",
      "For developers",
    ]) {
      await expect(page.getByRole("region", { name: section })).toBeVisible();
    }

    // The form leads back by its bar, beside History, and by the card.
    await expect(
      page
        .getByTestId("document-bar")
        .getByRole("link", { name: "Open in builder", exact: true })
    ).toHaveAttribute("href", BUILDER_URL);
    await page
      .locator('[data-slot="page-builder-card"]')
      .getByRole("link", { name: "Open in builder", exact: true })
      .click();
    await expect(page).toHaveURL(BUILDER_URL);
    await builderOpen(page);
  });

  test("the sidebar's search and the Content screen's row open it there too", async ({
    page,
  }) => {
    await openContent(page);
    await page
      .getByTestId("sub-sidebar")
      .getByRole("textbox", { name: "Search content" })
      .fill("Homepage");
    await expect(
      contentList(page).getByRole("link", { name: "Homepage", exact: true })
    ).toHaveAttribute("href", BUILDER_URL);

    const row = page
      .getByRole("table", { name: "Singles" })
      .getByRole("link", { name: "Homepage", exact: true });
    await expect(row).toHaveAttribute("href", BUILDER_URL);
    await row.click();
    await expect(page).toHaveURL(BUILDER_URL);
    await builderOpen(page);
  });

  test("Contact details, whose first field is not the builder, opens as a form", async ({
    page,
  }) => {
    await openContent(page);
    const link = contentList(page).getByRole("link", {
      name: "Contact details",
      exact: true,
    });
    await expect(link).toHaveAttribute(
      "href",
      /\/admin\/singles\/contact-details$/
    );
    await link.click();
    await expect(page).toHaveURL(/\/admin\/singles\/contact-details$/);
    await expect(canvas(page)).toHaveCount(0);
  });
});

test.describe("the back arrow on a Single", () => {
  test("is Back to content: it asks while work is unsaved, and opens the Content screen once saved", async ({
    page,
  }) => {
    await seed(page);
    await gotoAdmin(page, "/singles/homepage/builder?field=layout");
    await builderOpen(page);
    await expect(
      page.getByRole("button", { name: "Exit editor", exact: true })
    ).toHaveCount(0);
    const back = page.getByRole("button", {
      name: "Back to content",
      exact: true,
    });

    const second = await block(page, SECOND);
    await clickBlock(page, SECOND);
    await page.keyboard.press("Delete");
    await expect(second).toHaveCount(0);
    await back.click();
    await expect(leaveQuestion(page)).toBeVisible();
    await leaveQuestion(page)
      .getByRole("button", { name: "Keep Editing" })
      .click();
    await expect(page).toHaveURL(BUILDER_URL);

    const stored = page.waitForResponse(
      response =>
        ["PATCH", "PUT", "POST"].includes(response.request().method()) &&
        response.url().includes("/singles/homepage")
    );
    await pressSave(page);
    expect((await stored).ok()).toBe(true);
    await expect(
      page.locator('[data-topbar="end"]').getByText("Unsaved changes")
    ).toHaveCount(0);
    await back.click();
    await expect(page).toHaveURL(CONTENT_URL);
    await expect(leaveQuestion(page)).toHaveCount(0);
    await expect(
      page.getByRole("heading", { level: 1, name: "Content" })
    ).toBeVisible();
  });
});

test("a reader who may only read the Homepage opens its form, read-only", async ({
  browser,
  playwright,
}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
  const admin = await playwright.request.newContext({
    baseURL,
    storageState: STORAGE_STATE,
  });
  let reader;
  try {
    reader = await signInAsLimitedUser(browser, admin, baseURL, [
      "read-homepage",
    ]);
  } finally {
    await admin.dispose();
  }
  try {
    const page = await reader.context.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    // A reader of Singles alone is sent to the Singles table, beside the
    // same Content panel.
    await gotoAdmin(page, "/singles");
    await waitForShellAnswers(page);
    const link = contentList(page).getByRole("link", {
      name: "Homepage",
      exact: true,
    });
    await expect(link).toHaveAttribute("href", FORM_URL);
    await link.click();
    await expect(page).toHaveURL(FORM_URL);
    await expect(page.getByTestId("document-lock-banner")).toHaveText(
      "Your access lets you view this, but not change it. If you need to change it, ask an admin."
    );
  } finally {
    await reader.context.close();
  }
});
