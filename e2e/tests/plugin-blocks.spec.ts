/**
 * Blocks another plugin contributes, in the real editor.
 *
 * The playground's block fixture declares two blocks for the page builder and
 * names an editor entry exporting them; the generated component map imports
 * that entry and the custom block's own inspector. So these tests cover the
 * whole path a contributed block takes: declaration, generated map, the
 * browser registry, the Add panel, the inspector, the save and a reload.
 *
 * What each asserts, and the broken version it rules out:
 *
 * - The plain block is found by the Add panel's SEARCH, gets the generated
 *   inspector, and an edit made there survives a reload. An editor whose
 *   registry held only the core blocks offers nothing for the search.
 * - The custom block's own inspector is drawn in place of the generated
 *   controls, an edit through it reaches the stored document, and the CSS id,
 *   attributes and Style set beside it survive the same reload. A custom
 *   inspector replacing the whole panel, or one whose commit went nowhere,
 *   fails here.
 * - A stored document holding a contributed block opens with that block drawn,
 *   on the canvas and in the entry screen's miniature, never as the
 *   unknown-block placeholder.
 *
 * Each test makes its own page, named uniquely, so no lock is needed.
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const ENTRIES = "/admin/api/collections/pages/entries";
/** The unknown-block placeholder's marker, from `@nextlyhq/blocks-react`. */
const PLACEHOLDER = "[data-nx-block-placeholder]";

/** A draft page of its own, with the document given, and its id. */
async function createPage(
  request: APIRequestContext,
  content?: unknown
): Promise<string> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await request.post(ENTRIES, {
    data: {
      title: `Plugin blocks ${stamp}`,
      slug: `plugin-blocks-${stamp}`,
      status: "draft",
      ...(content === undefined ? {} : { content }),
    },
  });
  if (!created.ok()) {
    throw new Error(
      `creating a page failed: ${created.status()} ${await created.text()}`
    );
  }
  const body = (await created.json()) as { item?: { id?: string } };
  const id = body.item?.id;
  if (typeof id !== "string") throw new Error("the new page has no id");
  return id;
}

/** The page's stored document, read back through the API. */
async function storedNodes(
  request: APIRequestContext,
  id: string
): Promise<Record<string, unknown>[]> {
  const response = await request.get(`${ENTRIES}?status=draft&limit=100`);
  const body = (await response.json()) as {
    items: { id: string; content?: { nodes?: Record<string, unknown>[] } }[];
  };
  return body.items.find(item => item.id === id)?.content?.nodes ?? [];
}

/** Open the page builder on a page's `content` field. */
async function openBuilder(page: Page, id: string): Promise<void> {
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
}

/** Insert a block by typing in the Add panel's search and taking the match. */
async function insertBySearch(
  page: Page,
  query: string,
  label: string
): Promise<void> {
  const insert = page.getByRole("button", { name: "Insert", exact: true });
  if ((await insert.getAttribute("aria-pressed")) !== "true") {
    await insert.click();
  }
  const search = page.getByRole("combobox", { name: "Insert a block" });
  await search.fill(query);
  const option = page
    .getByRole("listbox", { name: "Suggestions" })
    .getByRole("option", { name: label, exact: true });
  await expect(option).toBeVisible();
  await option.click();
}

/** Save the draft from the editor's top bar and wait for the write. */
async function saveDraft(page: Page): Promise<void> {
  const saved = page.waitForResponse(
    response =>
      response.url().includes("/collections/pages/entries") &&
      ["PATCH", "PUT", "POST"].includes(response.request().method()) &&
      response.ok()
  );
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await saved;
}

/** One drawn fixture block on the canvas. */
function fixture(page: Page, kind: "plain" | "custom") {
  return page.locator(`.nx-canvas [data-fixture="${kind}"]`);
}

test.describe("blocks a plugin contributes", () => {
  test.describe.configure({ timeout: 180_000 });

  test("a plain block is found by search, edited in the generated inspector, and kept", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openBuilder(page, id);

    await insertBySearch(page, "fixture", "Test fixture: plain");
    await expect(fixture(page, "plain")).toHaveText("Plain fixture");

    // The generated control for its one declared prop.
    const label = page
      .getByRole("tabpanel", { name: "Content" })
      .getByLabel("Label");
    await label.fill("Edited plain");
    await label.press("Enter");
    await expect(fixture(page, "plain")).toHaveText("Edited plain");

    await saveDraft(page);
    await expect
      .poll(async () => (await storedNodes(page.request, id))[0]?.props)
      .toEqual({ label: "Edited plain" });

    await page.reload();
    await expect(fixture(page, "plain")).toHaveText("Edited plain", {
      timeout: 60_000,
    });
    await expect(page.locator(PLACEHOLDER)).toHaveCount(0);
  });

  test("a custom inspector edits its block, beside the CSS id, attributes and Style", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openBuilder(page, id);

    await insertBySearch(page, "fixture", "Test fixture: custom inspector");
    const content = page.getByRole("tabpanel", { name: "Content" });
    const headline = content.getByLabel("Fixture headline");
    // The block's own control, in place of the generated one.
    await expect(headline).toHaveValue("Custom fixture");
    await expect(content.getByLabel("Headline", { exact: true })).toHaveCount(
      0
    );

    await headline.fill("Edited headline");
    await headline.press("Enter");
    await expect(fixture(page, "custom")).toHaveText("Edited headline");

    // What every block keeps beside its own inspector.
    await page.getByRole("tab", { name: "Advanced" }).click();
    const cssId = page.getByRole("textbox", { name: "CSS id" });
    await cssId.fill("fixture-anchor");
    await cssId.press("Enter");
    await page.getByRole("button", { name: "Add attribute" }).click();
    await page
      .getByRole("textbox", { name: "Name of attribute 1" })
      .fill("data-fixture-note");
    const value = page.getByRole("textbox", { name: "Value of attribute 1" });
    await value.fill("kept");
    await value.press("Tab");

    await page.getByRole("tab", { name: "Style" }).click();
    const color = page
      .getByRole("region", { name: "Color" })
      .getByRole("textbox", { name: "Color", exact: true });
    await color.fill("#1155cc");
    await color.press("Enter");

    const drawn = fixture(page, "custom");
    await expect(drawn).toHaveAttribute("id", "fixture-anchor");
    await expect(drawn).toHaveAttribute("data-fixture-note", "kept");
    await expect(drawn).toHaveCSS("color", "rgb(17, 85, 204)");

    await saveDraft(page);
    await expect
      .poll(async () => (await storedNodes(page.request, id))[0]?.props)
      .toEqual({ headline: "Edited headline" });

    await page.reload();
    const reloaded = fixture(page, "custom");
    await expect(reloaded).toHaveText("Edited headline", { timeout: 60_000 });
    await expect(reloaded).toHaveAttribute("id", "fixture-anchor");
    await expect(reloaded).toHaveAttribute("data-fixture-note", "kept");
    await expect(reloaded).toHaveCSS("color", "rgb(17, 85, 204)");

    // Selected again, it opens on its own inspector with the stored value.
    await reloaded.click();
    await expect(
      page
        .getByRole("tabpanel", { name: "Content" })
        .getByLabel("Fixture headline")
    ).toHaveValue("Edited headline");
  });

  test("a stored page holding a contributed block opens with it drawn", async ({
    page,
  }) => {
    const id = await createPage(page.request, {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "00000000-0000-4000-8000-0000000000f1",
          type: "fixture/plain",
          version: 1,
          props: { label: "Stored plain" },
        },
      ],
    });

    // The entry screen's miniature, before any editor has mounted.
    await gotoAdmin(page, `/collections/pages/${id}`);
    await expect(page.getByText("Stored plain").first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator(PLACEHOLDER)).toHaveCount(0);

    await openBuilder(page, id);
    await expect(fixture(page, "plain")).toHaveText("Stored plain", {
      timeout: 60_000,
    });
    await expect(page.locator(PLACEHOLDER)).toHaveCount(0);
  });
});
