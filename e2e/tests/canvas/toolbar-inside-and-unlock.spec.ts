/**
 * The block toolbar where there is no room above its block, and on a locked
 * block, in the real editor.
 *
 * - A block at the very top of a page with no header draws its toolbar inside
 *   its own top-left corner, so the block after it stays uncovered; a tall
 *   Section at the top does the same. Under a Layout header the toolbar sits
 *   above the first block, over the header, and over no page block.
 * - While the author types in a block whose toolbar is inside it, the toolbar
 *   steps aside, and comes back when the pointer moves.
 * - A block locked in Layers offers "Unlock" on its toolbar, which unlocks it
 *   as one edit that undo takes back. A block inside a locked one says which
 *   block holds it, with "Select it".
 *
 * Each test makes its own page, named uniquely, so no lock is needed.
 */
import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { gotoAdmin } from "../support/admin";
import { canvasFrame, canvasLayer } from "../support/canvas-frame";
import { test } from "../support/test";

import {
  block,
  boxOf,
  clickBlock,
  field,
  glyphPoint,
  layerRow,
  openLayers,
  selection,
} from "./editor-driver";

const API = "/admin/api";
const ENTRIES = `${API}/collections/pages/entries`;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Whether two boxes share any area (touching edges do not count). */
function overlaps(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/** Whether `inner` lies wholly inside `outer`, to the pixel. */
function within(inner: Box, outer: Box): boolean {
  return (
    inner.x >= outer.x - 0.5 &&
    inner.y >= outer.y - 0.5 &&
    inner.x + inner.width <= outer.x + outer.width + 0.5 &&
    inner.y + inner.height <= outer.y + outer.height + 0.5
  );
}

function stamp(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function idOf(
  response: {
    ok(): boolean;
    status(): number;
    text(): Promise<string>;
    json(): Promise<unknown>;
  },
  what: string
): Promise<string> {
  expect(
    response.ok(),
    `${what}: ${response.status()} ${await response.text()}`
  ).toBe(true);
  const id = ((await response.json()) as { item?: { id?: string } }).item?.id;
  if (typeof id !== "string") throw new Error(`${what}: no id`);
  return id;
}

function heading(id: string, words: string): Record<string, unknown> {
  return {
    id,
    type: "core/heading",
    version: 1,
    props: { text: words, level: "h2" },
  };
}

/**
 * A Heading with room above and below its line, taller than the toolbar, as a
 * page's top heading usually is.
 */
function roomyHeading(id: string, words: string): Record<string, unknown> {
  return {
    ...heading(id, words),
    styles: {
      base: {
        base: { padding: { blockStart: "20px", blockEnd: "20px" } },
      },
    },
  };
}

function text(id: string, words: string): Record<string, unknown> {
  return { id, type: "core/text", version: 1, props: { text: words } };
}

/** A draft page holding `nodes`, with no header or footer unless named. */
async function createPage(
  request: APIRequestContext,
  nodes: readonly unknown[],
  layout?: string
): Promise<string> {
  const at = stamp();
  return idOf(
    await request.post(ENTRIES, {
      data: {
        title: `Toolbar ${at}`,
        slug: `toolbar-${at}`,
        status: "draft",
        content: { formatVersion: 1, kind: "page", nodes },
        ...(layout === undefined
          ? { noHeaderFooter: true }
          : { layout, noHeaderFooter: false }),
      },
    }),
    "creating the page"
  );
}

/** A published Layout whose header is a published component of one heading. */
async function layoutWithHeader(request: APIRequestContext): Promise<string> {
  const at = stamp();
  const header = await idOf(
    await request.post(`${API}/collections/components/entries`, {
      data: {
        title: `Header ${at}`,
        slug: `toolbar-header-${at}`,
        content: {
          formatVersion: 1,
          kind: "component",
          // A header as a site draws one: a band with room in it, taller
          // than the toolbar.
          nodes: [
            {
              id: "band",
              type: "core/section",
              version: 1,
              props: { as: "section", contained: true },
              styles: {
                base: {
                  base: {
                    padding: {
                      blockStart: "32px",
                      blockEnd: "32px",
                      inlineStart: "24px",
                      inlineEnd: "24px",
                    },
                  },
                },
              },
              slots: { children: [heading("h", `Site header ${at}`)] },
            },
          ],
        },
        status: "published",
      },
    }),
    "creating the header component"
  );
  return idOf(
    await request.post(`${API}/collections/layouts/entries`, {
      data: {
        title: `Toolbar layout ${at}`,
        slug: `toolbar-layout-${at}`,
        areas: [{ area: "header", component: header }],
        status: "published",
      },
    }),
    "creating the Layout"
  );
}

async function openBuilder(page: Page, id: string, first: string) {
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
  await expect(await block(page, first)).toBeVisible({ timeout: 30_000 });
}

/** The block toolbar, in the chrome drawn over the canvas. */
function toolbar(page: Page): Locator {
  return canvasLayer(page).locator(".nx-block-toolbar");
}

/** A toolbar control by its name. */
function toolbarControl(page: Page, name: string): Locator {
  return canvasLayer(page)
    .getByRole("toolbar", { name: "Block actions" })
    .getByRole("button", { name, exact: true });
}

/** Select a block with a click on its right edge, clear of the toolbar. */
async function select(page: Page, id: string): Promise<void> {
  await clickBlock(page, id);
  await expect.poll(() => selection(page)).toEqual([id]);
}

/** The toolbar's box once it is drawn on the given side. */
async function barOn(page: Page, side: string): Promise<Box> {
  const bar = toolbar(page);
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute("data-side", side);
  const box = await bar.boundingBox();
  if (box === null) throw new Error("[e2e] the toolbar has no box");
  return box;
}

const HEADING = "a0000000-0000-4000-8000-00000000f001";
const NEXT = "a0000000-0000-4000-8000-00000000f002";
const SECTION = "a0000000-0000-4000-8000-00000000f003";
const INNER = "a0000000-0000-4000-8000-00000000f004";
const HERO = "a0000000-0000-4000-8000-00000000f005";
const TITLE = "a0000000-0000-4000-8000-00000000f006";

const LONG =
  "A heading at the very top of the page, long enough to run well past the toolbar";

test.describe("the block toolbar with no room above, and on a locked block", () => {
  test.describe.configure({ timeout: 180_000 });

  test("draws inside a Heading at the top of a page with no header, and leaves the next block uncovered", async ({
    page,
  }) => {
    const id = await createPage(page.request, [
      roomyHeading(HEADING, LONG),
      text(NEXT, "The block after it, which the toolbar must not cover."),
    ]);
    await openBuilder(page, id, HEADING);
    await select(page, HEADING);

    const bar = await barOn(page, "inside");
    const top = await boxOf(page, HEADING);
    const next = await boxOf(page, NEXT);
    // In the Heading's own top-left corner, a few pixels in.
    expect(bar.y).toBeGreaterThanOrEqual(top.y);
    expect(bar.x).toBeGreaterThanOrEqual(top.x);
    expect(bar.y - top.y).toBeLessThanOrEqual(8);
    // And not over the block after it.
    expect(overlaps(bar, next)).toBe(false);

    // The control: a block lower down keeps its bar above it.
    await select(page, NEXT);
    const above = await barOn(page, "above");
    expect(above.y + above.height).toBeLessThanOrEqual(next.y);
  });

  test("keeps the next block readable under a top block shorter than the toolbar", async ({
    page,
  }) => {
    // A one-line Heading is shorter than the toolbar, so the bar inside it
    // runs past its bottom: it fades while the next block is pointed at.
    const id = await createPage(page.request, [
      heading(HEADING, "A short heading"),
      text(NEXT, "The block after it."),
    ]);
    await openBuilder(page, id, HEADING);
    await select(page, HEADING);
    await expect(toolbar(page)).not.toHaveAttribute("data-faded", "");

    const bar = await barOn(page, "inside");
    const next = await boxOf(page, NEXT);
    // The bar does run onto the next block here: the strip this is about.
    expect(bar.y + bar.height).toBeGreaterThan(next.y);
    await page.mouse.move(next.x + next.width - 20, next.y + next.height / 2);
    await expect(toolbar(page)).toHaveAttribute("data-faded", "");
    await expect(toolbar(page)).toHaveCSS("opacity", "0");

    // A press on that strip, right where Duplicate is drawn, goes to the
    // block under it: the block is selected and nothing is duplicated.
    const duplicate = await toolbarControl(page, "Duplicate").boundingBox();
    if (duplicate === null) throw new Error("[e2e] Duplicate has no box");
    const x = duplicate.x + duplicate.width / 2;
    const y = (next.y + Math.min(bar.y + bar.height, next.y + next.height)) / 2;
    await page.mouse.move(x, next.y + next.height - 2, { steps: 4 });
    await page.mouse.move(x, y, { steps: 4 });
    await page.mouse.down();
    await page.mouse.up();
    await expect.poll(() => selection(page)).toEqual([NEXT]);
    await expect(
      page.getByRole("button", { name: "Undo", exact: true })
    ).toBeDisabled();
  });

  test("draws inside a tall Section at the top, over nothing after it", async ({
    page,
  }) => {
    const pad = "160px";
    const id = await createPage(page.request, [
      {
        id: SECTION,
        type: "core/section",
        version: 1,
        name: "Tall section",
        props: { as: "section", contained: true },
        styles: {
          base: {
            base: {
              padding: {
                blockStart: pad,
                blockEnd: pad,
                inlineStart: "24px",
                inlineEnd: "24px",
              },
            },
          },
        },
        slots: { children: [heading(INNER, "Inside the section")] },
      },
      text(NEXT, "The block after the section."),
    ]);
    await openBuilder(page, id, INNER);
    await select(page, SECTION);

    const bar = await barOn(page, "inside");
    const section = await boxOf(page, SECTION);
    expect(within(bar, section)).toBe(true);
    expect(overlaps(bar, await boxOf(page, NEXT))).toBe(false);
  });

  test("sits above the first block under a header, over the header and no page block", async ({
    page,
  }) => {
    await gotoAdmin(page, "/");
    const layout = await layoutWithHeader(page.request);
    const id = await createPage(
      page.request,
      [
        heading(HEADING, "The first block of the page"),
        text(NEXT, "The block after it."),
      ],
      layout
    );
    await openBuilder(page, id, HEADING);
    const header = canvasFrame(page).locator('[data-nx-region="header"]');
    await expect(header).toBeVisible({ timeout: 30_000 });
    await select(page, HEADING);

    const bar = await barOn(page, "above");
    const first = await boxOf(page, HEADING);
    // Above the block, so over the header's part of the canvas.
    expect(bar.y + bar.height).toBeLessThanOrEqual(first.y);
    for (const each of [HEADING, NEXT]) {
      expect(overlaps(bar, await boxOf(page, each))).toBe(false);
    }
  });

  test("steps aside while the author types in a top Heading, and comes back when the pointer moves", async ({
    page,
  }) => {
    const id = await createPage(page.request, [
      roomyHeading(HEADING, LONG),
      text(NEXT, "The block after it."),
    ]);
    await openBuilder(page, id, HEADING);
    await select(page, HEADING);
    await barOn(page, "inside");

    // Into the Heading's text past the toolbar, which sits over its start.
    const words = await field(page, HEADING, "text");
    const point = await glyphPoint(page, words, 0.9);
    await page.mouse.dblclick(point.x, point.y);
    // The element inline editing marks as the one being typed into.
    await expect(canvasFrame(page).locator("[data-nx-editing]")).toBeVisible({
      timeout: 30_000,
    });
    await page.keyboard.type(" now");
    // Stepped aside: transparent, so the line being typed shows through, and
    // still focusable for Alt+F10.
    await expect(toolbar(page)).toHaveAttribute("data-typing", "");
    await expect(toolbar(page)).toHaveCSS("opacity", "0");

    await page.mouse.move(point.x + 30, point.y + 10);
    await expect(toolbar(page)).not.toHaveAttribute("data-typing", "");
    await expect(toolbar(page)).toHaveCSS("opacity", "1");
    await expect(toolbar(page)).toHaveAttribute("data-side", "inside");
  });

  test("unlocks a block from its toolbar, and undo locks it again", async ({
    page,
  }) => {
    const id = await createPage(page.request, [
      heading(HEADING, "A free block first"),
      {
        id: HERO,
        type: "core/section",
        version: 1,
        name: "Hero",
        locked: true,
        props: { as: "section", contained: true },
        styles: {
          base: {
            base: {
              padding: {
                blockStart: "24px",
                blockEnd: "24px",
                inlineStart: "24px",
                inlineEnd: "24px",
              },
            },
          },
        },
        slots: { children: [heading(TITLE, "Locked heading")] },
      },
    ]);
    await openBuilder(page, id, TITLE);

    // A block inside Hero names it, with Select it and no Unlock.
    await clickBlock(page, TITLE);
    await expect.poll(() => selection(page)).toEqual([TITLE]);
    const note = canvasLayer(page).locator("[data-lock-note]");
    await expect(note).toHaveText("Locked by Hero · Select it");
    await expect(toolbarControl(page, "Unlock")).toHaveCount(0);
    await toolbarControl(page, "Select it").click();
    await expect.poll(() => selection(page)).toEqual([HERO]);

    // Hero's own lock: Unlock in its toolbar, not a "Locked" note.
    const unlock = toolbarControl(page, "Unlock");
    await expect(unlock).toBeVisible();
    await expect(note).toHaveCount(0);
    await expect(toolbarControl(page, "Delete")).toHaveAttribute(
      "aria-disabled",
      "true"
    );
    await unlock.click();

    await expect(toolbarControl(page, "Unlock")).toHaveCount(0);
    await expect(toolbarControl(page, "Delete")).not.toHaveAttribute(
      "aria-disabled",
      "true"
    );

    // One edit: one undo puts the lock back.
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(toolbarControl(page, "Unlock")).toBeVisible();
    await openLayers(page);
    await expect(layerRow(page, HERO).first()).toContainText("Locked");
  });
});
