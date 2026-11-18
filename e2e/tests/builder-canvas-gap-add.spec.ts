/**
 * The "+" in the canvas's gaps, in the real editor: between top-level
 * sections, after the last one, and between the children of the selected
 * block, each opening the in-place picker aimed at exactly its gap.
 *
 * What each asserts, and the broken version it rules out:
 *
 * - A page of three sections offers three "+" (two between, one after the
 *   last); with the middle one, holding a row of three Boxes, selected, two
 *   more, drawn down the lines between the Boxes. Gaps measured at the top
 *   level only, or across a row, count or draw otherwise.
 * - Showing a "+" moves no block on the page: every block's box is the same
 *   before and while it shows. A "+" laid out in the page's flow shifts them.
 * - Nothing shows while a block is dragged from the Add panel.
 * - Its name and tooltip say where it adds, and it is at least 24×24 on
 *   screen with the canvas fitted at about half size.
 * - Tab from a selected block goes to the "+" below it, then to the next in
 *   reading order.
 * - Pressing it with nothing selected opens the picker naming the gap, and a
 *   Heading chosen there lands in the gap; by keyboard alone, too, with the
 *   caret then in the new Heading. "Browse all" keeps the gap.
 * - The picker opened from the "+" at the top of the page and from the one
 *   at its end is wholly on screen at 1280×800.
 *
 * Each test makes its own page, named uniquely, so no lock is needed.
 *
 * @module tests/builder-canvas-gap-add.spec
 */
import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import {
  boxOf,
  canvasRoot,
  clearSelection,
  clickBlock,
  selection,
  structure,
} from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const PAGES = "/admin/api/collections/pages/entries";
const HERO = "00000000-0000-4000-8000-0000000ca501";
const PRICING = "00000000-0000-4000-8000-0000000ca502";
const CONTACT = "00000000-0000-4000-8000-0000000ca503";
const BOXES = [
  "00000000-0000-4000-8000-0000000ca504",
  "00000000-0000-4000-8000-0000000ca505",
  "00000000-0000-4000-8000-0000000ca506",
] as const;

function stamp(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function heading(id: string, text: string) {
  return {
    id,
    type: "core/heading",
    version: 1,
    props: { text, level: "h2" },
  };
}

function section(
  id: string,
  name: string,
  children: readonly object[],
  styles?: object
) {
  return {
    id,
    type: "core/section",
    version: 1,
    name,
    props: { as: "section", contained: true },
    ...(styles === undefined ? {} : { styles }),
    slots: { children },
  };
}

/**
 * Hero, Pricing and Contact, each a Section holding a Heading but Pricing,
 * which lays out three Boxes in a row, each a third of the row's width and
 * tall enough to point beside the line between two of them.
 */
async function createPage(request: APIRequestContext): Promise<string> {
  const t = stamp();
  const created = await request.post(PAGES, {
    data: {
      title: `Gap add ${t}`,
      slug: `gap-add-${t}`,
      status: "draft",
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          section(HERO, "Hero", [
            heading("00000000-0000-4000-8000-0000000ca511", "Welcome"),
          ]),
          section(
            PRICING,
            "Pricing",
            BOXES.map((id, index) => ({
              id,
              type: "core/box",
              version: 1,
              name: `Box ${"ABC"[index] ?? ""}`,
              props: { as: "div" },
              styles: { base: { base: { width: "30%", minHeight: "160px" } } },
              slots: {
                children: [
                  heading(
                    `00000000-0000-4000-8000-0000000ca52${String(index)}`,
                    `Plan ${String(index + 1)}`
                  ),
                ],
              },
            })),
            {
              base: {
                base: {
                  display: "flex",
                  flexDirection: "row",
                  justifyContent: "space-between",
                },
              },
            }
          ),
          section(CONTACT, "Contact", [
            heading("00000000-0000-4000-8000-0000000ca513", "Write to us"),
          ]),
        ],
      },
    },
  });
  expect(created.ok(), `creating the page: ${created.status()}`).toBe(true);
  return ((await created.json()) as { item: { id: string } }).item.id;
}

async function openBuilder(page: Page, id: string): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
  await expect.poll(async () => (await structure(page)).length).toBe(11);
}

/** Every gap's "+", in the order the canvas draws them. */
function gapControls(page: Page): Locator {
  return page.locator(".nx-page-inserters__add");
}

function gap(page: Page, name: string): Locator {
  return page.getByRole("button", { name, exact: true });
}

function picker(page: Page): Locator {
  return page.getByRole("dialog", { name: "Add a block" });
}

/**
 * Bring a "+" out by moving the pointer near its gap, along the gap's line
 * away from the "+" itself, and a few pixels to the block-before's side.
 */
async function pointNear(page: Page, add: Locator): Promise<void> {
  const spot = await add.boundingBox();
  if (spot === null) throw new Error("[e2e] the + is not laid out");
  const line = await add.evaluate(
    element =>
      element.closest("[data-line]")?.getAttribute("data-line") ?? "across"
  );
  const x = spot.x + spot.width / 2;
  const y = spot.y + spot.height / 2;
  await page.mouse.move(
    line === "down" ? x - 3 : x - 160,
    line === "down" ? y - 40 : y - 3,
    { steps: 4 }
  );
  await expect
    .poll(() => add.evaluate(element => getComputedStyle(element).opacity))
    .toBe("1");
}

/** The page's top-level blocks, in page order. */
async function topLevel(page: Page): Promise<string[]> {
  return (await structure(page)).filter(entry => !entry.includes(">"));
}

/** Every block's box on screen, by id. */
async function everyBox(page: Page): Promise<Record<string, object>> {
  const ids = await structure(page);
  const boxes: Record<string, object> = {};
  for (const entry of ids) {
    const id = entry.split(">").at(-1) ?? entry;
    boxes[id] = await boxOf(page, id);
  }
  return boxes;
}

/** Three lines of text, one after another, as short as a block gets. */
const LINES = [
  "00000000-0000-4000-8000-0000000ca531",
  "00000000-0000-4000-8000-0000000ca532",
  "00000000-0000-4000-8000-0000000ca533",
] as const;

async function createShortPage(request: APIRequestContext): Promise<string> {
  const t = stamp();
  const created = await request.post(PAGES, {
    data: {
      title: `Short blocks ${t}`,
      slug: `short-blocks-${t}`,
      status: "draft",
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: LINES.map((id, index) => ({
          id,
          type: "core/text",
          version: 1,
          name: `Line ${String(index + 1)}`,
          props: { text: `Line ${String(index + 1)}` },
        })),
      },
    },
  });
  expect(created.ok(), `creating the page: ${created.status()}`).toBe(true);
  return ((await created.json()) as { item: { id: string } }).item.id;
}

test.describe("the + in the canvas's gaps", () => {
  test.describe.configure({ timeout: 240_000 });

  test("is in each gap between sections, after the last, and between a selected row's Boxes", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openBuilder(page, id);
    await clearSelection(page);
    await expect
      .poll(() =>
        gapControls(page).evaluateAll(buttons =>
          buttons.map(button => button.getAttribute("aria-label"))
        )
      )
      .toEqual([
        "Add a block between Hero and Pricing",
        "Add a block between Pricing and Contact",
        "Add a block after Contact",
      ]);

    await clickBlock(page, PRICING);
    await expect.poll(() => selection(page)).toEqual([PRICING]);
    await expect
      .poll(() =>
        gapControls(page).evaluateAll(buttons =>
          buttons.map(button => button.getAttribute("aria-label"))
        )
      )
      .toEqual([
        "Add a block between Hero and Pricing",
        "Add a block between Box A and Box B",
        "Add a block between Box B and Box C",
        "Add a block between Pricing and Contact",
        "Add a block after Contact",
      ]);
    // Between the Boxes, down the line between them: they are in a row.
    for (const name of [
      "Add a block between Box A and Box B",
      "Add a block between Box B and Box C",
    ]) {
      await expect(
        gap(page, name).locator("xpath=ancestor::*[@data-line][1]")
      ).toHaveAttribute("data-line", "down");
      // Its full 24×24 there too, not squeezed by a line of no width.
      await pointNear(page, gap(page, name));
      const size = await gap(page, name).boundingBox();
      expect(size?.width ?? 0, name).toBeGreaterThanOrEqual(24);
      expect(size?.height ?? 0, name).toBeGreaterThanOrEqual(24);
    }
  });

  test("moves nothing on the page while it shows, and shows nothing while a block is dragged", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openBuilder(page, id);
    await clickBlock(page, PRICING);
    await expect.poll(() => selection(page)).toEqual([PRICING]);
    const before = await everyBox(page);

    const add = gap(page, "Add a block between Box A and Box B");
    await pointNear(page, add);
    expect(await everyBox(page)).toEqual(before);
    await add.hover();
    expect(await everyBox(page)).toEqual(before);

    // A block dragged from the Add panel over the canvas: no "+" at all.
    const rail = page
      .getByRole("navigation", { name: "Editor panels" })
      .getByRole("button", { name: "Add", exact: true });
    if ((await rail.getAttribute("aria-pressed")) !== "true") {
      await rail.click();
    }
    const from = await page
      .getByRole("option", { name: "Heading", exact: true })
      .boundingBox();
    const to = await (await canvasRoot(page)).boundingBox();
    if (from === null || to === null) throw new Error("[e2e] no boxes");
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 40, from.y + 10, { steps: 4 });
    await page.mouse.move(to.x + to.width / 2, to.y + 40, { steps: 12 });
    await expect(gapControls(page)).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.mouse.up();
  });

  test("says where it adds, and is at least 24 by 24 with the canvas at about half size", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openBuilder(page, id);
    await clearSelection(page);
    // The canvas at half size, where the page is drawn at half its pixels.
    const zoom = page.getByRole("button", { name: /^Canvas zoom:/ });
    await zoom.click();
    await page.getByRole("menuitemradio", { name: "50%", exact: true }).click();
    await expect(zoom).toHaveAttribute("aria-label", "Canvas zoom: 50%");

    const add = gap(page, "Add a block between Hero and Pricing");
    await pointNear(page, add);
    const box = await add.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(24);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(24);
    await add.hover();
    await expect(page.getByRole("tooltip")).toHaveText(
      "Add a block between Hero and Pricing"
    );
  });

  test("is the next Tab stop after the block above it, then the next in reading order", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openBuilder(page, id);
    await clickBlock(page, HERO);
    await expect.poll(() => selection(page)).toEqual([HERO]);
    await page.keyboard.press("Tab");
    const first = gap(page, "Add a block between Hero and Pricing");
    await expect(first).toBeFocused();
    await expect
      .poll(() => first.evaluate(element => getComputedStyle(element).opacity))
      .toBe("1");
    await page.keyboard.press("Tab");
    await expect(
      gap(page, "Add a block between Pricing and Contact")
    ).toBeFocused();
  });

  test("adds a Heading in its gap through the picker, with nothing selected beforehand", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openBuilder(page, id);
    await clearSelection(page);
    const add = gap(page, "Add a block between Hero and Pricing");
    await pointNear(page, add);
    await add.click();
    await expect(picker(page)).toHaveAccessibleDescription(
      "Adding between Hero and Pricing"
    );
    // The press selected nothing on the way.
    expect(await selection(page)).toEqual([]);
    await picker(page).getByRole("gridcell", { name: "Heading" }).click();
    await expect
      .poll(() => topLevel(page))
      .toEqual([HERO, expect.any(String), PRICING, CONTACT]);
    const [, added] = await topLevel(page);
    expect(
      await (await canvasRoot(page))
        .locator(`[data-nx-node="${added}"]`)
        .evaluate(element => element.tagName)
    ).toMatch(/^H[1-6]$/);
  });

  test("adds a block between two sections by keyboard alone, the caret then in it", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openBuilder(page, id);
    const add = gap(page, "Add a block between Pricing and Contact");
    // Tab through the editor until the "+" has focus, as an author would.
    for (let press = 0; press < 120; press += 1) {
      if (await add.evaluate(element => element === document.activeElement)) {
        break;
      }
      await page.keyboard.press("Tab");
    }
    await expect(add).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(
      picker(page).getByRole("combobox", { name: "Search blocks" })
    ).toBeFocused();
    // Heading is first of the six, highlighted; Enter adds it.
    await page.keyboard.press("Enter");
    await expect
      .poll(() => topLevel(page))
      .toEqual([HERO, PRICING, expect.any(String), CONTACT]);
    const [, , added] = await topLevel(page);
    // The caret in the new Heading's text.
    await expect
      .poll(async () =>
        (await canvasRoot(page)).evaluate(root => {
          const active = root.ownerDocument.activeElement;
          return (
            active?.closest("[data-nx-node]")?.getAttribute("data-nx-node") ??
            null
          );
        })
      )
      .toBe(added);
  });

  test("Browse all from a gap's + adds a block clicked in the panel in that gap", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openBuilder(page, id);
    await clearSelection(page);
    const add = gap(page, "Add a block between Hero and Pricing");
    await pointNear(page, add);
    await add.click();
    await picker(page)
      .getByRole("button", { name: "Browse all blocks and sections →" })
      .click();
    await expect(
      page.locator(".nx-insert-panel__placement").first()
    ).toHaveText("Adding between Hero and Pricing");
    await page.getByRole("option", { name: "Heading", exact: true }).click();
    await expect
      .poll(() => topLevel(page))
      .toEqual([HERO, expect.any(String), PRICING, CONTACT]);
  });

  test("opens the picker wholly on screen from the + at the top of the page and at its end", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openBuilder(page, id);
    await clearSelection(page);
    for (const name of [
      "Add a block between Hero and Pricing",
      "Add a block after Contact",
    ]) {
      const add = gap(page, name);
      await add.scrollIntoViewIfNeeded();
      await pointNear(page, add);
      await add.click();
      await expect(picker(page)).toBeVisible();
      const box = await picker(page).boundingBox();
      expect(box, name).not.toBeNull();
      if (box !== null) {
        expect(box.x, name).toBeGreaterThanOrEqual(0);
        expect(box.y, name).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, name).toBeLessThanOrEqual(1280);
        expect(box.y + box.height, name).toBeLessThanOrEqual(800);
      }
      await page.keyboard.press("Escape");
      await expect(picker(page)).toBeHidden();
    }
  });
  test("never takes a click at a short block's middle, at half size", async ({
    page,
  }) => {
    const id = await createShortPage(page.request);
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
    await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
      timeout: 60_000,
    });
    await expect.poll(async () => (await structure(page)).length).toBe(3);
    const zoom = page.getByRole("button", { name: /^Canvas zoom:/ });
    await zoom.click();
    await page.getByRole("menuitemradio", { name: "50%", exact: true }).click();
    await expect(zoom).toHaveAttribute("aria-label", "Canvas zoom: 50%");
    await clearSelection(page);

    const line = await boxOf(page, LINES[1]);
    // Drawn shorter than the 24px "+".
    expect(line.height).toBeLessThan(24);
    // On the line between the first two, off to the side, where the "+"
    // shows in the middle of the line...
    await page.mouse.move(line.x + line.width * 0.75, line.y, { steps: 4 });
    const add = gap(page, "Add a block between Line 1 and Line 2");
    await expect
      .poll(() => add.evaluate(element => getComputedStyle(element).opacity))
      .toBe("1");
    // ...then a click at the very middle of the second, under where that
    // "+" is drawn, selects the block, and opens nothing.
    await page.mouse.click(line.x + line.width / 2, line.y + line.height / 2);
    await expect.poll(() => selection(page)).toEqual([LINES[1]]);
    await expect(picker(page)).toBeHidden();
  });
});
