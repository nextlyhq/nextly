/**
 * A template's Entry content block in the editor, against the
 * `entry-articles` fixture, whose articles have two blocks fields of their
 * own, Body and Members only.
 *
 * 1. Placed on the template, it draws the previewed article's Body,
 *    read-only, and the article it draws changes with the article previewed.
 * 2. Its Field menu offers both of the collection's blocks fields.
 * 3. With one placed, the Add panel's tile is refused, saying why.
 *
 * The fixture's one template is given its design here, under its lock, and
 * only these specs write the collection, so the newest article is this
 * file's own.
 *
 * @module tests/builder-entry-content.spec
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { canvasBlock, canvasFrame } from "./support/canvas-frame";
import {
  article,
  articlesTemplate,
  documentOf,
  textBlock,
} from "./support/entry-articles";
import { LOCK } from "./support/locks";
import { fileAccount, test } from "./support/test";

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ lock: [LOCK.entryArticlesTemplate] });

/** The template's one heading, which the Entry content goes after. */
const HEADING = "00000000-0000-4000-8000-0000001002a1";

/** The template's design before Entry content is placed: one heading. */
const DESIGN = documentOf("template", [
  {
    id: HEADING,
    type: "core/heading",
    version: 1,
    props: { text: "Article title", level: "h1" },
    bindings: { text: { $bind: "title" } },
  },
]);

async function openTemplate(page: Page, id: string): Promise<void> {
  await gotoAdmin(page, `/collections/templates/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
}

/** The strip's chip, by the accessible name it carries. */
function chip(page: Page) {
  return page.locator(".nx-preview-strip__chip");
}

/** Open the Add panel from the rail, unless it is open already. */
async function openAdd(page: Page): Promise<void> {
  const add = page
    .getByRole("navigation", { name: "Editor panels" })
    .getByRole("button", { name: "Add", exact: true });
  if ((await add.getAttribute("aria-pressed")) !== "true") await add.click();
  await expect(
    page.getByRole("combobox", { name: "Insert a block" })
  ).toBeVisible();
}

test.describe("Entry content on a template", () => {
  test.describe.configure({ timeout: 240_000 });

  let templateId: string;

  test.beforeAll(async ({ playwright }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
    const admin = await playwright.request.newContext({
      baseURL,
      storageState: await fileAccount(baseURL, testInfo),
    });
    try {
      templateId = await articlesTemplate(admin, DESIGN);
    } finally {
      await admin.dispose();
    }
  });

  test("draws the previewed article's Body, follows the article previewed, and offers both blocks fields", async ({
    page,
  }) => {
    await gotoAdmin(page, "/");
    const mark = `EC${Date.now().toString(36)}`;
    const older = `${mark} Older article`;
    const newer = `${mark} Newer article`;
    await article(page.request, {
      title: older,
      slug: `${mark.toLowerCase()}-older`,
      body: documentOf("page", [textBlock("o", `${older} body`)]),
    });
    // More than a second later, so it is the most recently updated: SQLite
    // keeps `updatedAt` to the second.
    await page.waitForTimeout(1_100);
    await article(page.request, {
      title: newer,
      slug: `${mark.toLowerCase()}-newer`,
      body: documentOf("page", [textBlock("n", `${newer} body`)]),
    });
    await openTemplate(page, templateId);
    await expect(chip(page)).toHaveAccessibleName(
      `Previewing ${newer}, published`,
      { timeout: 30_000 }
    );

    // 1. Placed from the Add panel, under Entry, after the heading.
    await canvasBlock(page, HEADING).click();
    await openAdd(page);
    await expect(page.getByText("Entry", { exact: true })).toBeVisible();
    await page
      .getByRole("option", { name: "Entry content", exact: true })
      .click();

    // It draws the previewed article's Body, read-only.
    const frame = canvasFrame(page);
    await expect(frame.getByText(`${newer} body`)).toBeVisible({
      timeout: 30_000,
    });
    // Clicking inside selects the block itself, never the article's blocks:
    // the pointer passes through them to the block, so the press is made
    // where the words are, whatever receives it.
    await frame.getByText(`${newer} body`).click({ force: true });
    await expect(
      page.locator(".nx-block-card__title").filter({ hasText: "Entry content" })
    ).toBeVisible();

    // 2. Field offers both of the articles' blocks fields, Body chosen.
    const field = page.getByRole("combobox", { name: "Field" });
    await expect(field).toContainText("Body");
    await field.click();
    await expect(page.getByRole("option")).toHaveText(["Body", "Members only"]);
    await page.keyboard.press("Escape");
    await expect(
      page.getByText(
        "This is the article’s own content, edited on the article."
      )
    ).toBeVisible();

    // Previewing the other article draws its Body instead.
    await chip(page).click();
    await page.getByPlaceholder("Search articles").fill(mark);
    await page.getByRole("option").filter({ hasText: older }).click();
    await expect(frame.getByText(`${older} body`)).toBeVisible({
      timeout: 30_000,
    });
    await expect(frame.getByText(`${newer} body`)).toHaveCount(0);

    // 3. With one placed, a second is refused, saying why.
    await openAdd(page);
    const tile = page.getByRole("option", {
      name: "Entry content",
      exact: true,
    });
    await expect(tile).toHaveAttribute("data-refused", "true");
    await tile.hover();
    await expect(page.locator(".nx-insert-popover")).toContainText(
      "A template holds one Entry content block."
    );
  });
});
