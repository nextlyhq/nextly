/**
 * The line the canvas draws where the Add panel's highlighted tile would land.
 *
 * Pointing at a tile, or moving to it with the arrow keys, names its own place
 * in the panel's line and draws a blue line on the canvas at exactly the place
 * a click uses, with the same words. It never animates or scrolls the canvas,
 * and does not blink while the pointer crosses the tiles. A place off screen
 * is named at the canvas edge with an arrow; an empty container the block
 * would go inside is lit instead of a line.
 *
 * @module canvas/insertion-line.spec
 */
import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { gotoAdmin } from "../support/admin";
import { canvasBlock, canvasFrame, canvasLayer } from "../support/canvas-frame";
import { test } from "../support/test";

const ENTRIES = "/admin/api/collections/pages/entries";

const HERO = "00000000-0000-4000-8000-00000000c101";
const HERO_HEADING = "00000000-0000-4000-8000-00000000c102";
const PRICING = "00000000-0000-4000-8000-00000000c103";
const PRICING_TEXT = "00000000-0000-4000-8000-00000000c104";
const BOX = "00000000-0000-4000-8000-00000000c105";

const PAD = {
  base: {
    base: {
      padding: {
        blockStart: "32px",
        blockEnd: "32px",
        inlineStart: "32px",
        inlineEnd: "32px",
      },
    },
  },
};

/** Hero holding a Heading, then Pricing holding a Text, then an empty Box. */
function nodes(tall: boolean): unknown[] {
  return [
    {
      id: HERO,
      type: "core/section",
      version: 1,
      name: "Hero",
      props: { as: "section" },
      styles: PAD,
      slots: {
        children: [
          {
            id: HERO_HEADING,
            type: "core/heading",
            version: 1,
            props: { text: "Plan the work", level: "h2" },
          },
        ],
      },
    },
    {
      id: PRICING,
      type: "core/section",
      version: 1,
      name: "Pricing",
      props: { as: "section" },
      styles: tall
        ? { base: { base: { ...PAD.base.base, minHeight: "2400px" } } }
        : PAD,
      slots: {
        children: [
          {
            id: PRICING_TEXT,
            type: "core/text",
            version: 1,
            props: { text: "Prices for every size of job." },
          },
        ],
      },
    },
    {
      id: BOX,
      type: "core/box",
      version: 1,
      props: {},
      styles: PAD,
    },
  ];
}

async function createPage(
  request: APIRequestContext,
  tall = false
): Promise<string> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await request.post(ENTRIES, {
    data: {
      title: `Insertion line ${stamp}`,
      slug: `insertion-line-${stamp}`,
      status: "draft",
      content: { formatVersion: 1, kind: "page", nodes: nodes(tall) },
    },
  });
  expect(created.ok(), `creating a page: ${created.status()}`).toBe(true);
  const body = (await created.json()) as { item?: { id?: string } };
  const id = body.item?.id;
  if (typeof id !== "string") throw new Error("the new page has no id");
  return id;
}

async function openBuilder(page: Page, id: string): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(canvasBlock(page, HERO_HEADING)).toBeVisible({
    timeout: 60_000,
  });
}

/**
 * Select a container by pressing its own padding, not a block inside it: at
 * its bottom right, clear of the header's lock mark, which hangs over the top
 * of the page's first block.
 */
async function selectContainer(page: Page, id: string): Promise<void> {
  const block = canvasBlock(page, id);
  const box = await block.boundingBox();
  if (box === null) throw new Error("[e2e] the container drew nothing");
  await block.click({ position: { x: box.width - 8, y: box.height - 8 } });
  await expect(block).toHaveAttribute("data-nx-selected", "primary");
}

async function openAdd(page: Page): Promise<void> {
  const add = page
    .getByRole("navigation", { name: "Editor panels" })
    .getByRole("button", { name: "Add", exact: true });
  if ((await add.getAttribute("aria-pressed")) !== "true") await add.click();
  await expect(
    page.getByRole("combobox", { name: "Insert a block" })
  ).toBeVisible();
}

function tile(page: Page, label: string): Locator {
  return page.getByRole("option", { name: label, exact: true });
}

function placementLine(page: Page): Locator {
  return page.locator(".nx-insert-panel__placement");
}

function line(page: Page): Locator {
  return canvasLayer(page).locator(".nx-insertion-line .nx-drop-indicator");
}

function label(page: Page): Locator {
  return canvasLayer(page).locator(".nx-insertion-line__label");
}

/** How far the canvas's page is scrolled. */
function scrolledBy(page: Page): Promise<number> {
  return canvasFrame(page)
    .locator(".nx-canvas")
    .evaluate(
      element => element.ownerDocument.scrollingElement?.scrollTop ?? -1
    );
}

async function middleY(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("[e2e] nothing drawn to measure");
  return box.y + box.height / 2;
}

/** The ids of the page's top-level blocks, in order, as the canvas draws them. */
function topLevel(page: Page): Promise<string[]> {
  return canvasFrame(page)
    .locator(".nx-canvas")
    .evaluate(root =>
      Array.from(root.querySelectorAll("[data-nx-node]"))
        .filter(
          element => element.parentElement?.closest("[data-nx-node]") === null
        )
        .map(element => element.getAttribute("data-nx-node") ?? "")
    );
}

test.describe("the line where a highlighted tile would land", () => {
  // The builder's first open on a dev server alone can take a minute.
  test.describe.configure({ timeout: 180_000 });

  test("pointing at Heading then Section with Hero selected shows each place, and a click lands there", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openBuilder(page, id);
    await selectContainer(page, HERO);
    await openAdd(page);

    await tile(page, "Heading").hover();
    await expect(label(page)).toHaveText(
      "Heading goes inside Hero, at the end"
    );
    await expect(placementLine(page)).toHaveText(
      "Heading goes inside Hero, at the end"
    );
    // At the end of Hero's content: below its heading, inside Hero.
    const hero = await canvasBlock(page, HERO).boundingBox();
    const heading = await canvasBlock(page, HERO_HEADING).boundingBox();
    if (hero === null || heading === null) throw new Error("no layout");
    const headingLine = await middleY(line(page));
    expect(headingLine).toBeGreaterThan(heading.y + heading.height - 2);
    expect(headingLine).toBeLessThan(hero.y + hero.height);

    await tile(page, "Section").hover();
    await expect(label(page)).toHaveText("Section goes after Hero");
    const sectionLine = await middleY(line(page));
    // Between Hero and Pricing.
    const pricing = await canvasBlock(page, PRICING).boundingBox();
    if (pricing === null) throw new Error("no layout");
    expect(sectionLine).toBeGreaterThan(hero.y + hero.height - 2);
    expect(sectionLine).toBeLessThan(pricing.y + 2);

    // A click on Heading puts it where its line was.
    await tile(page, "Heading").click();
    const added = canvasFrame(page).locator(
      `.nx-canvas [data-nx-node="${HERO}"] [data-nx-node]`
    );
    await expect(added).toHaveCount(2);
    const placed = await added.nth(1).boundingBox();
    if (placed === null) throw new Error("no layout");
    expect(Math.abs(placed.y - headingLine)).toBeLessThan(24);
  });

  test("follows the arrow keys as the pointer does", async ({ page }) => {
    const id = await createPage(page.request);
    await openBuilder(page, id);
    await selectContainer(page, HERO);
    await openAdd(page);
    const search = page.getByRole("combobox", { name: "Insert a block" });
    await search.focus();
    // The canvas says what the panel's line says, for each tile in turn. A
    // tile refused here (a Column outside Columns) has no place to draw.
    const followed = new Set<string>();
    for (let press = 0; press < 8 && followed.size < 3; press += 1) {
      await page.keyboard.press("ArrowDown");
      const words = (await placementLine(page).textContent()) ?? "";
      if (!words.includes(" goes ")) {
        await expect(label(page)).toHaveCount(0);
        continue;
      }
      await expect(label(page)).toHaveText(words);
      followed.add(words);
    }
    expect(followed.size).toBe(3);
  });

  test("moves at once across a row of tiles, never blinking, and never animates", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openBuilder(page, id);
    await selectContainer(page, HERO);
    await openAdd(page);
    await tile(page, "Heading").hover();
    await expect(line(page)).toBeVisible();
    await expect(line(page)).toHaveCSS("transition-duration", "0s");
    await expect(label(page)).toHaveCSS("transition-duration", "0s");
    // Count every time the line leaves the canvas while the pointer moves
    // across the tiles' grid, gaps included.
    await canvasLayer(page).evaluate(layer => {
      const removed = { count: 0 };
      (window as unknown as { __lineRemoved: typeof removed }).__lineRemoved =
        removed;
      new MutationObserver(records => {
        for (const record of records) {
          for (const node of Array.from(record.removedNodes)) {
            if (
              node instanceof Element &&
              (node.matches(".nx-drop-indicator") ||
                node.querySelector(".nx-drop-indicator") !== null)
            ) {
              removed.count += 1;
            }
          }
        }
      }).observe(layer, { childList: true, subtree: true });
    });
    const first = await tile(page, "Heading").boundingBox();
    const last = await tile(page, "Text").boundingBox();
    if (first === null || last === null) throw new Error("no tiles");
    await page.mouse.move(
      first.x + first.width / 2,
      first.y + first.height / 2
    );
    await page.mouse.move(last.x + last.width / 2, last.y + last.height / 2, {
      steps: 30,
    });
    await page.mouse.move(
      first.x + first.width / 2,
      first.y + first.height / 2,
      {
        steps: 30,
      }
    );
    await expect(line(page)).toBeVisible();
    const removals = await page.evaluate(
      () =>
        (window as unknown as { __lineRemoved: { count: number } })
          .__lineRemoved.count
    );
    expect(removals).toBe(0);
    // Off the panel, it goes shortly after.
    await page.mouse.move(720, 880);
    await expect(line(page)).toHaveCount(0);
  });

  test("names a place scrolled out of view at the canvas edge, without scrolling", async ({
    page,
  }) => {
    const id = await createPage(page.request, true);
    await openBuilder(page, id);
    await selectContainer(page, HERO);
    // Hero scrolled out of view above.
    await canvasFrame(page)
      .locator(".nx-canvas")
      .evaluate(element => {
        element.ownerDocument.scrollingElement?.scrollTo({ top: 1600 });
      });
    await expect.poll(() => scrolledBy(page)).toBeGreaterThan(1000);
    const before = await scrolledBy(page);
    await openAdd(page);
    await tile(page, "Heading").hover();
    const edge = canvasLayer(page).locator(".nx-insertion-line__edge");
    await expect(edge).toHaveText("↑ Heading goes inside Hero, at the end");
    await expect(line(page)).toHaveCount(0);
    expect(await scrolledBy(page)).toBe(before);
  });

  test("lights an empty Box it would go inside, and draws no line", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openBuilder(page, id);
    await selectContainer(page, BOX);
    await openAdd(page);
    await tile(page, "Text").hover();
    await expect(placementLine(page)).toHaveText(/^Text goes inside/);
    const lit = canvasLayer(page).locator(".nx-insertion-line__container");
    await expect(lit).toBeVisible();
    await expect(line(page)).toHaveCount(0);
    const box = await canvasBlock(page, BOX).boundingBox();
    const drawn = await lit.boundingBox();
    if (box === null || drawn === null) throw new Error("no layout");
    expect(Math.abs(drawn.y - box.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(drawn.height - box.height)).toBeLessThanOrEqual(1);
  });

  test("puts a Section after Hero when a Heading inside Hero is selected", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openBuilder(page, id);
    await canvasBlock(page, HERO_HEADING).click();
    await openAdd(page);
    await tile(page, "Section").hover();
    await expect(label(page)).toHaveText("Section goes after Hero");
    await tile(page, "Section").click();
    await expect.poll(async () => (await topLevel(page)).length).toBe(4);
    const order = await topLevel(page);
    expect(order[0]).toBe(HERO);
    expect(order[2]).toBe(PRICING);
  });
});
