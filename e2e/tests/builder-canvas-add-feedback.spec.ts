/**
 * Every add control on the canvas visibly answers, and the Add panel's tile
 * card never covers a tile.
 *
 * For each control (the empty page's "Add section", an empty container's
 * "Drop a block here, or click to add one", and a gap's "Add a section
 * after"), pressed with the Add panel closed and again with it open and
 * scrolled: the panel is open, its search has focus, its list is back at the
 * top, and the line naming the place is highlighted and says where the block
 * goes. A press that only re-opened an open panel changed nothing on screen,
 * which is the broken version these rule out.
 *
 * Hovering a first-column tile puts its card outside the panel, level with
 * the tile, and the tile beside it takes the very next click.
 *
 * Each test makes its own page, named uniquely, so no lock is needed.
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const ENTRIES = "/admin/api/collections/pages/entries";

const HEADING = "00000000-0000-4000-8000-00000000c001";
const SECTION = "00000000-0000-4000-8000-00000000c002";

/** A heading, then an empty, padded section. */
function headingAndSection(): unknown {
  const pad = "24px";
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: HEADING,
        type: "core/heading",
        version: 1,
        props: { text: "Add feedback heading", level: "h2" },
      },
      {
        id: SECTION,
        type: "core/section",
        version: 1,
        props: { as: "section", contained: true },
        styles: {
          base: {
            base: {
              padding: {
                blockStart: pad,
                blockEnd: pad,
                inlineStart: pad,
                inlineEnd: pad,
              },
            },
          },
        },
        slots: { children: [] },
      },
    ],
  };
}

/** A draft page of its own holding `content`, and its id. */
async function createPage(
  request: APIRequestContext,
  content: unknown
): Promise<string> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await request.post(ENTRIES, {
    data: {
      title: `Add feedback ${stamp}`,
      slug: `add-feedback-${stamp}`,
      status: "draft",
      content,
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  return ((await created.json()) as { item: { id: string } }).item.id;
}

async function openBuilder(page: Page, id: string): Promise<void> {
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
}

/** The rail's Add button. */
function railAdd(page: Page) {
  return page
    .getByRole("navigation", { name: "Editor panels" })
    .getByRole("button", { name: "Add", exact: true });
}

const search = (page: Page) =>
  page.getByRole("combobox", { name: "Insert a block" });

/** Open Add from the rail and scroll its list down, or close it. */
async function setAdd(page: Page, open: boolean): Promise<void> {
  const pressed = (await railAdd(page).getAttribute("aria-pressed")) === "true";
  if (pressed !== open) await railAdd(page).click();
  if (!open) {
    await expect(search(page)).toBeHidden();
    return;
  }
  await expect(search(page)).toBeVisible();
  // Down the list, and focus elsewhere, so a press that changes nothing
  // shows as a list left scrolled and a search without focus.
  await page.locator(".nx-insert-panel__list").evaluate(list => {
    list.scrollTop = list.scrollHeight;
  });
  await expect
    .poll(() =>
      page.locator(".nx-insert-panel__list").evaluate(list => list.scrollTop)
    )
    .toBeGreaterThan(0);
  await page.getByRole("region", { name: "Canvas" }).focus();
}

/** The panel's answer to a press, naming the place it says. */
async function expectAnswered(page: Page, place: string): Promise<void> {
  await expect(search(page)).toBeVisible();
  await expect(search(page)).toBeFocused();
  await expect
    .poll(() =>
      page.locator(".nx-insert-panel__list").evaluate(list => list.scrollTop)
    )
    .toBe(0);
  const line = page.locator(".nx-insert-panel__placement");
  await expect(line).toHaveAttribute("data-flash", "");
  await expect(line).toHaveText(place);
}

test.describe("the canvas's add controls", () => {
  test.describe.configure({ timeout: 240_000 });

  test("the empty page's Add section answers with Add closed and open", async ({
    page,
  }) => {
    const id = await createPage(page.request, {
      formatVersion: 1,
      kind: "page",
      nodes: [],
    });
    await openBuilder(page, id);
    const start = page.getByRole("button", { name: "Add section", exact: true });
    for (const open of [false, true]) {
      await setAdd(page, open);
      await start.click();
      await expectAnswered(page, "Adding at the end of the page");
    }
  });

  test("an empty container's + and a gap's + answer with Add closed and open", async ({
    page,
  }) => {
    const id = await createPage(page.request, headingAndSection());
    await openBuilder(page, id);
    const appender = page.getByRole("button", {
      name: "Drop a block here, or click to add one, in Section",
    });
    for (const open of [false, true]) {
      await setAdd(page, open);
      await appender.click();
      await expectAnswered(page, "Adding inside Section");
    }
    // The "+" in the gap after the heading, pressed from the keyboard: it is
    // a button an author can tab to, and Enter runs the same press a click
    // does, whatever the pointer is near.
    const after = page.getByRole("button", {
      name: "Add a section after Heading",
    });
    for (const open of [false, true]) {
      await setAdd(page, open);
      await after.focus();
      await page.keyboard.press("Enter");
      await expectAnswered(page, "Adding after Heading");
    }
  });
});

test.describe("the Add panel's tile card", () => {
  test.describe.configure({ timeout: 180_000 });

  test("sits outside the panel at the tile's height, and the next tile takes the first click", async ({
    page,
  }) => {
    const id = await createPage(page.request, headingAndSection());
    await openBuilder(page, id);
    await setAdd(page, true);
    await page.locator(".nx-insert-panel__list").evaluate(list => {
      list.scrollTop = 0;
    });
    // The first row's first two tiles: one in the first column, and the one
    // beside it.
    const tiles = page.locator(".nx-insert-panel__list [cmdk-item]");
    const first = tiles.nth(0);
    const beside = tiles.nth(1);
    const [a, b] = [await first.boundingBox(), await beside.boundingBox()];
    if (a === null || b === null) throw new Error("[e2e] tiles drew no box");
    expect(Math.abs(a.y - b.y)).toBeLessThan(2);
    expect(b.x).toBeGreaterThan(a.x);

    await first.hover();
    const card = page.locator(".nx-insert-popover");
    await expect(card).toBeVisible();
    const panel = await page.locator(".nx-insert-panel").boundingBox();
    const cardBox = await card.boundingBox();
    if (panel === null || cardBox === null) {
      throw new Error("[e2e] the panel or the card drew no box");
    }
    // Outside the panel, to its right, and level with the tile.
    expect(cardBox.x).toBeGreaterThanOrEqual(panel.x + panel.width);
    expect(Math.abs(cardBox.y - a.y)).toBeLessThan(2);

    // The tile beside takes the very next click: it adds its block.
    const name = (await beside.getAttribute("aria-label")) ?? "";
    await beside.click();
    await expect(page.locator(".nx-insert-panel__placement")).toHaveText(
      `Adding after ${name}`
    );
  });
});
