/**
 * The editor's search, in a browser: each kind of result does its action. A
 * block to add lands where its row said, a block on the page is selected, a
 * page found by title opens in the editor, and a command runs. The top bar's
 * button opens the same search as the shortcut.
 *
 * @module tests/builder-search.spec
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { pressSave, selection } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { canvasBlock } from "./support/canvas-frame";
import { storedPageNodes } from "./support/stored-page";
import { test } from "./support/test";

const ENTRIES = "/admin/api/collections/pages/entries";

const HEADING = "00000000-0000-4000-8000-00000000c001";
const SECTION = "00000000-0000-4000-8000-00000000c002";

/** A heading, then an empty section. */
function content(): unknown {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: HEADING,
        type: "core/heading",
        version: 1,
        props: { text: "Search heading", level: "h2" },
      },
      {
        id: SECTION,
        type: "core/section",
        version: 1,
        props: { as: "section", contained: true },
        slots: { children: [] },
      },
    ],
  };
}

async function createPage(
  request: APIRequestContext,
  title: string
): Promise<string> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await request.post(ENTRIES, {
    data: {
      title,
      slug: `search-${stamp}`,
      status: "draft",
      content: content(),
    },
  });
  expect(created.ok(), `creating a page: ${created.status()}`).toBe(true);
  return ((await created.json()) as { item: { id: string } }).item.id;
}

async function storedTypes(
  request: APIRequestContext,
  id: string
): Promise<string[]> {
  const nodes = await storedPageNodes(request, ENTRIES, id);
  return nodes.map(node => String(node.type));
}

async function openBuilder(page: Page, id: string): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
}

async function saveDraft(page: Page): Promise<void> {
  const saved = page.waitForResponse(
    response =>
      response.url().includes("/collections/pages/entries") &&
      ["PATCH", "PUT", "POST"].includes(response.request().method()) &&
      response.ok()
  );
  await pressSave(page);
  await saved;
}

function palette(page: Page) {
  return page.getByRole("dialog", { name: "Command palette" });
}

/** Open the search with the top bar's button and type into it. */
async function search(page: Page, text: string): Promise<void> {
  await page.getByRole("button", { name: "Search and commands" }).click();
  await expect(palette(page)).toBeVisible();
  await palette(page).getByRole("combobox").fill(text);
}

function group(page: Page, heading: string) {
  return palette(page).getByRole("group", { name: heading });
}

test.describe("the editor's search", () => {
  test.describe.configure({ timeout: 180_000 });

  test("adds a block where its row says, after the selected block", async ({
    page,
  }) => {
    const id = await createPage(page.request, `Search add ${Date.now()}`);
    await openBuilder(page, id);
    await canvasBlock(page, HEADING).click();

    await search(page, "divider");
    const row = group(page, "Add").getByRole("option").first();
    await expect(row).toContainText("Divider");
    // Named as Layers names it: a block without a name of its own is its kind.
    await expect(row).toContainText("Adding after Heading");
    await expect(palette(page)).toContainText("Add");
    await page.keyboard.press("Enter");
    await expect(palette(page)).toBeHidden();

    await saveDraft(page);
    expect(await storedTypes(page.request, id)).toEqual([
      "core/heading",
      "core/divider",
      "core/section",
    ]);
  });

  test("keeps the search box where it is as the results change", async ({
    page,
  }) => {
    const id = await createPage(page.request, `Search pinned ${Date.now()}`);
    await openBuilder(page, id);
    await search(page, "he");
    await expect(group(page, "Add").getByRole("option").first()).toBeVisible();
    const input = palette(page).getByRole("combobox");
    const many = await input.boundingBox();
    await input.fill("xyzzy");
    await expect(palette(page)).toContainText("Nothing matches");
    const none = await input.boundingBox();
    // Pinned near the top, as the agreed design has it: a dialog that
    // re-centred would move the field by half the height the list lost.
    expect(none?.y).toBe(many?.y);
    expect(many?.y ?? 0).toBeLessThan(900 * 0.2);
  });

  test("selects a block found on the page", async ({ page }) => {
    const id = await createPage(page.request, `Search jump ${Date.now()}`);
    await openBuilder(page, id);

    await search(page, "section");
    const row = group(page, "On this page").getByRole("option").first();
    await expect(row).toContainText("Section");
    await row.click();

    await expect.poll(() => selection(page)).toEqual([SECTION]);
  });

  test("opens another page found by its title", async ({ page }) => {
    const stamp = Date.now();
    const other = await createPage(page.request, `Zebra crossing ${stamp}`);
    const id = await createPage(page.request, `Search pages ${stamp}`);
    await openBuilder(page, id);

    await search(page, `Zebra crossing ${stamp}`);
    const row = group(page, "Pages").getByRole("option").first();
    await expect(row).toContainText(`Zebra crossing ${stamp}`);
    await expect(row).toContainText("Draft");
    await row.click();

    await expect(page).toHaveURL(
      new RegExp(`/collections/pages/${other}/builder\\?field=content`)
    );
  });

  test("runs a command, and opens on the shortcut too", async ({ page }) => {
    const id = await createPage(page.request, `Search command ${Date.now()}`);
    await openBuilder(page, id);
    await canvasBlock(page, HEADING).click();

    // Control, not ControlOrMeta: the editor reads `mod` from the platform the
    // browser reports, and this suite's device reports Windows on every host.
    await page.keyboard.press("Control+k");
    await expect(palette(page)).toBeVisible();
    await palette(page).getByRole("combobox").fill("duplicate");
    await palette(page)
      .getByRole("option", { name: /Duplicate/ })
      .first()
      .click();

    await saveDraft(page);
    expect(await storedTypes(page.request, id)).toEqual([
      "core/heading",
      "core/heading",
      "core/section",
    ]);
  });
});
