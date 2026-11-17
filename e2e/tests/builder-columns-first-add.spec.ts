/**
 * A Columns row added in the real editor asks for its layout on the canvas.
 *
 * - Added from the Add panel, the row shows "Choose a layout" in place of its
 *   body, over the row itself, with the six layouts and Skip; focus is on
 *   the first tile.
 * - Picking "3 equal" lays the row out in three columns, and one Undo takes
 *   the whole row away.
 * - Skip keeps two equal columns, stored with no layout of their own.
 * - Escape keeps two equal columns, and a reload shows no chooser on the
 *   stored row.
 * - The keyboard alone picks: the arrows move between tiles, Enter picks.
 *
 * Each test makes its own page, named uniquely, so no lock is needed.
 *
 * @module tests/builder-columns-first-add.spec
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import {
  clickBlock,
  pressSave,
  selection,
  structure,
} from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { canvasFrame } from "./support/canvas-frame";
import { storedPageNodes } from "./support/stored-page";
import { test } from "./support/test";

const ENTRIES = "/admin/api/collections/pages/entries";
const HEADING = "00000000-0000-4000-8000-00000000f001";

const LAYOUTS = [
  "2 equal",
  "3 equal",
  "4 equal",
  "Wide left",
  "Wide right",
  "Wide middle",
];

interface StoredNode {
  id: string;
  type: string;
  styles?: unknown;
  slots?: { children?: StoredNode[] };
}

/** A draft page holding one Heading (and `after` below it), and its id. */
async function createPage(
  request: APIRequestContext,
  after: unknown[] = []
): Promise<string> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await request.post(ENTRIES, {
    data: {
      title: `Columns first add ${stamp}`,
      slug: `columns-first-add-${stamp}`,
      status: "draft",
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: HEADING,
            type: "core/heading",
            version: 1,
            props: { text: "Above the columns", level: "h2" },
          },
          ...after,
        ],
      },
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  return ((await created.json()) as { item: { id: string } }).item.id;
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

/** Add a Columns row from the Add panel, and answer its id. */
async function addColumns(page: Page): Promise<string> {
  const add = page
    .getByRole("navigation", { name: "Editor panels" })
    .getByRole("button", { name: "Add", exact: true });
  if ((await add.getAttribute("aria-pressed")) !== "true") await add.click();
  await expect(
    page.getByRole("combobox", { name: "Insert a block" })
  ).toBeVisible();
  await page.getByRole("option", { name: "Columns", exact: true }).click();
  // The new row is the selection.
  await expect.poll(async () => (await selection(page)).length).toBe(1);
  const [id] = await selection(page);
  if (id === undefined || id === HEADING) throw new Error("no new row");
  return id;
}

/** The chooser drawn over the canvas. */
function chooser(page: Page) {
  return page.locator(".nx-first-add__plate");
}

/** How many columns the canvas draws in the row. */
async function columnsOnCanvas(page: Page, id: string): Promise<number> {
  return (await structure(page)).filter(entry => entry.startsWith(`${id}>`))
    .length;
}

async function storedRow(
  page: Page,
  pageId: string,
  rowId: string
): Promise<StoredNode | undefined> {
  const nodes = (await storedPageNodes(
    page.request,
    ENTRIES,
    pageId
  )) as unknown as StoredNode[];
  return nodes.find(node => node.id === rowId);
}

test.describe("choosing a Columns layout when the row is added", () => {
  test.describe.configure({ timeout: 240_000 });

  test("the chooser shows over the new row; a pick lays it out and one Undo removes it", async ({
    page,
  }) => {
    const pageId = await createPage(page.request);
    await openBuilder(page, pageId);
    const rowId = await addColumns(page);

    await expect(chooser(page)).toBeVisible();
    await expect(chooser(page)).toContainText("Choose a layout");
    await expect(chooser(page).getByRole("button")).toHaveText([
      ...LAYOUTS,
      "Skip",
    ]);
    // Focus is in the chooser, on the first tile.
    await expect(
      chooser(page).getByRole("button", { name: "2 equal" })
    ).toBeFocused();
    // Drawn over the row itself, in place of its body, and the row makes
    // room for it.
    const row = canvasFrame(page).locator(
      `.nx-canvas [data-nx-node="${rowId}"]`
    );
    // Polled: the plate follows the row as the canvas settles.
    await expect
      .poll(async () => {
        const rowBox = await row.boundingBox();
        const plateBox = await chooser(page).boundingBox();
        if (rowBox === null || plateBox === null) return "not drawn";
        const over =
          Math.abs(rowBox.x - plateBox.x) < 2 &&
          Math.abs(rowBox.y - plateBox.y) < 2 &&
          Math.abs(rowBox.width - plateBox.width) < 2 &&
          rowBox.height + 2 >= plateBox.height;
        return over
          ? "over the row"
          : `row ${JSON.stringify(rowBox)} plate ${JSON.stringify(plateBox)}`;
      })
      .toBe("over the row");

    await chooser(page).getByRole("button", { name: "3 equal" }).click();
    await expect(chooser(page)).toHaveCount(0);
    await expect.poll(() => columnsOnCanvas(page, rowId)).toBe(3);

    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(row).toHaveCount(0);
    expect(await structure(page)).toContain(HEADING);
  });

  test("Skip keeps two equal columns, stored with no layout of their own", async ({
    page,
  }) => {
    const pageId = await createPage(page.request);
    await openBuilder(page, pageId);
    const rowId = await addColumns(page);

    await chooser(page).getByRole("button", { name: "Skip" }).click();
    await expect(chooser(page)).toHaveCount(0);
    expect(await columnsOnCanvas(page, rowId)).toBe(2);
    // The row is still selected, with nothing more to undo than the insert.
    expect(await selection(page)).toEqual([rowId]);

    await saveDraft(page);
    const stored = await storedRow(page, pageId, rowId);
    expect(stored?.type).toBe("core/columns");
    expect(stored?.slots?.children).toHaveLength(2);
    expect(stored?.styles).toBeUndefined();
  });

  test("Escape keeps two equal columns, and a reload shows no chooser", async ({
    page,
  }) => {
    const pageId = await createPage(page.request);
    await openBuilder(page, pageId);
    const rowId = await addColumns(page);

    await expect(chooser(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(chooser(page)).toHaveCount(0);
    expect(await columnsOnCanvas(page, rowId)).toBe(2);

    await saveDraft(page);
    await page.reload();
    await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
      timeout: 60_000,
    });
    await expect
      .poll(() => columnsOnCanvas(page, rowId), { timeout: 30_000 })
      .toBe(2);
    // Selecting the stored row, or a column in it, asks nothing.
    await canvasFrame(page)
      .locator(`.nx-canvas [data-nx-node="${rowId}"]`)
      .first()
      .click({ position: { x: 4, y: 4 } });
    await expect.poll(async () => (await selection(page)).length).toBe(1);
    await expect(chooser(page)).toHaveCount(0);
  });

  test("the keyboard alone picks: the arrows move, Enter picks", async ({
    page,
  }) => {
    const pageId = await createPage(page.request);
    await openBuilder(page, pageId);
    const rowId = await addColumns(page);

    const first = chooser(page).getByRole("button", { name: "2 equal" });
    await expect(first).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(
      chooser(page).getByRole("button", { name: "4 equal" })
    ).toBeFocused();
    // Moving picks nothing.
    expect(await columnsOnCanvas(page, rowId)).toBe(2);
    // Tab leaves the tiles for Skip: the tiles are one stop.
    await page.keyboard.press("Tab");
    await expect(
      chooser(page).getByRole("button", { name: "Skip" })
    ).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Enter");
    await expect(chooser(page)).toHaveCount(0);
    await expect.poll(() => columnsOnCanvas(page, rowId)).toBe(4);

    // Stored as the Content tab's "4 equal" tile writes it.
    await saveDraft(page);
    const stored = await storedRow(page, pageId, rowId);
    expect(stored?.slots?.children).toHaveLength(4);
    expect(JSON.stringify(stored?.styles)).toContain("repeat(4, 1fr)");
  });

  test("the chooser opens with focus from the block picker too", async ({
    page,
  }) => {
    const pageId = await createPage(page.request);
    await openBuilder(page, pageId);
    await clickBlock(page, HEADING);
    await expect.poll(() => selection(page)).toEqual([HEADING]);
    await page.keyboard.press("/");
    const search = page
      .getByRole("dialog", { name: "Add a block" })
      .getByRole("combobox", { name: "Search blocks" });
    await expect(search).toBeFocused();
    await search.fill("columns");
    await page.keyboard.press("Enter");

    await expect(chooser(page)).toBeVisible();
    await expect(
      chooser(page).getByRole("button", { name: "2 equal" })
    ).toBeFocused();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    const [rowId] = await selection(page);
    if (rowId === undefined) throw new Error("no new row");
    await expect.poll(() => columnsOnCanvas(page, rowId)).toBe(3);
  });
  test("a save ends the chooser, keeping two equal columns", async ({
    page,
  }) => {
    const pageId = await createPage(page.request);
    await openBuilder(page, pageId);
    const rowId = await addColumns(page);
    await expect(chooser(page)).toBeVisible();

    // A pick after the save would replace the stored insert in place, so the
    // save point would read the changed row as stored: the save ends it.
    await saveDraft(page);
    await expect(chooser(page)).toHaveCount(0);
    const stored = await storedRow(page, pageId, rowId);
    expect(stored?.slots?.children).toHaveLength(2);
  });

  test("a row added at the end of a long page is scrolled into view with its chooser", async ({
    page,
  }) => {
    // Tall spacers push the end of the page well below the canvas's view.
    const spacers = Array.from({ length: 8 }, (_, index) => ({
      id: `00000000-0000-4000-8000-00000000f1${String(index).padStart(2, "0")}`,
      type: "core/spacer",
      version: 1,
      props: {},
      styles: { base: { base: { height: "400px" } } },
    }));
    const pageId = await createPage(page.request, spacers);
    await openBuilder(page, pageId);
    // Nothing selected: the row goes at the end of the page.
    await addColumns(page);

    const tile = chooser(page).getByRole("button", { name: "2 equal" });
    await expect(tile).toBeFocused();
    await expect(tile).toBeInViewport();
    // The tile that has focus, and Skip, inside the canvas's view once a
    // smooth scroll has settled.
    const inView = async (
      target: ReturnType<typeof chooser>
    ): Promise<string> => {
      const canvas = await page
        .getByRole("region", { name: "Canvas" })
        .boundingBox();
      const box = await target.boundingBox();
      if (canvas === null || box === null) return "not drawn";
      return box.y >= canvas.y - 1 &&
        box.y + box.height <= canvas.y + canvas.height + 1
        ? "in view"
        : `${String(box.y)}+${String(box.height)} in ${String(canvas.y)}+${String(canvas.height)}`;
    };
    await expect.poll(() => inView(tile)).toBe("in view");
    await expect
      .poll(() => inView(chooser(page).getByRole("button", { name: "Skip" })))
      .toBe("in view");
  });
});
