/**
 * Where a clicked block lands, in the real editor: a content block goes
 * inside a selected Section, at the end; a Box after a Box is its sibling; a
 * Section added from inside a band goes after the band; and every way of
 * adding a block puts it in the same place.
 *
 * What each asserts, and the broken version it rules out:
 *
 * - A Heading clicked with a Section selected is the Section's last child.
 *   A panel that added after the selection stores it beside the Section.
 * - Box, then Box, stores two sibling Boxes. A rule that put every block
 *   inside a selected container would nest the second in the first.
 * - Five Text blocks clicked in a row inside a Section are five siblings in
 *   it. A rule that put a block inside the last one added would nest them.
 * - A Section clicked with a Heading inside a Section selected stores two
 *   top-level Sections. A rule that treated a Section as any layout block
 *   would put it after the Heading, inside the first Section.
 * - The "+" in the gap below a Section adds in that gap, even though the
 *   Section is then selected. A "+" that only selected the Section would
 *   put a Heading inside it.
 * - One component added by a click, by Enter on its tile, from the
 *   Components panel and from search, each with the Section selected, lands
 *   inside the Section each time. A surface with a placement of its own
 *   stores its copy somewhere else.
 *
 * Each test makes its own page, named uniquely, so no lock is needed.
 *
 * @module tests/builder-insert-lands.spec
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import {
  clickBlock,
  layerRow,
  openLayers,
  pressSave,
  selection,
  structure,
} from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { storedPageNodes } from "./support/stored-page";
import { test } from "./support/test";

const PAGES = "/admin/api/collections/pages/entries";
const COMPONENTS = "/admin/api/collections/components/entries";
const INSTANCE = "nextly/component-instance";

const HERO = "00000000-0000-4000-8000-00000000e001";
const HEADING = "00000000-0000-4000-8000-00000000e002";

interface StoredNode {
  type: string;
  props?: { componentId?: string };
  slots?: { children?: StoredNode[] };
}

function stamp(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** A Section named Hero holding one Heading, or nothing at all. */
function content(empty: boolean, pricing: boolean): unknown {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: empty
      ? []
      : [
          {
            id: HERO,
            type: "core/section",
            version: 1,
            name: "Hero",
            props: { as: "section", contained: true },
            slots: {
              children: [
                {
                  id: HEADING,
                  type: "core/heading",
                  version: 1,
                  props: { text: "Welcome", level: "h2" },
                },
              ],
            },
          },
          ...(pricing
            ? [
                {
                  id: "00000000-0000-4000-8000-00000000e003",
                  type: "core/section",
                  version: 1,
                  name: "Pricing",
                  props: { as: "section", contained: true },
                  slots: { children: [] },
                },
              ]
            : []),
        ],
  };
}

async function createPage(
  request: APIRequestContext,
  empty = false,
  pricing = false
): Promise<string> {
  const t = stamp();
  const created = await request.post(PAGES, {
    data: {
      title: `Insert lands ${t}`,
      slug: `insert-lands-${t}`,
      status: "draft",
      content: content(empty, pricing),
    },
  });
  expect(created.ok(), `creating the page: ${created.status()}`).toBe(true);
  return ((await created.json()) as { item: { id: string } }).item.id;
}

/** A published component whose one top-level block is a Heading. */
async function createComponent(
  request: APIRequestContext,
  title: string
): Promise<string> {
  const created = await request.post(COMPONENTS, {
    data: {
      title,
      slug: `insert-lands-component-${stamp()}`,
      status: "published",
      content: {
        formatVersion: 1,
        kind: "component",
        nodes: [
          {
            id: "inside",
            type: "core/heading",
            version: 1,
            props: { text: `Inside ${title}`, level: "h3" },
          },
        ],
      },
    },
  });
  expect(created.ok(), `creating ${title}: ${created.status()}`).toBe(true);
  return ((await created.json()) as { item: { id: string } }).item.id;
}

/** The stored page as types, nested blocks under their container. */
async function shape(request: APIRequestContext, id: string) {
  const name = (node: StoredNode): string =>
    node.type === INSTANCE ? `component:${node.props?.componentId}` : node.type;
  const nodes = (await storedPageNodes(request, PAGES, id)) as StoredNode[];
  return nodes.map(node =>
    node.slots?.children === undefined || node.slots.children.length === 0
      ? name(node)
      : { [name(node)]: node.slots.children.map(name) }
  );
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

function railButton(page: Page, name: string) {
  return page
    .getByRole("navigation", { name: "Editor panels" })
    .getByRole("button", { name, exact: true });
}

/** Open a rail panel unless it is open already; the rail item is a toggle. */
async function openPanel(page: Page, name: "Add" | "Components") {
  const item = railButton(page, name);
  if ((await item.getAttribute("aria-pressed")) !== "true") await item.click();
}

async function openAdd(page: Page): Promise<void> {
  await openPanel(page, "Add");
  await expect(
    page.getByRole("combobox", { name: "Insert a block" })
  ).toBeVisible();
}

/** Select a block from its Layers row, then come back to Add. */
async function select(page: Page, id: string): Promise<void> {
  await openLayers(page);
  await layerRow(page, id).locator(`[data-nx-layer="${id}"]`).first().click();
  await expect.poll(() => selection(page)).toEqual([id]);
}

/** How many blocks the canvas draws directly inside Hero. */
async function heroChildren(page: Page): Promise<number> {
  return (await structure(page)).filter(entry => entry.startsWith(`${HERO}>`))
    .length;
}

function placementLine(page: Page) {
  return page.locator(".nx-insert-panel__placement").first();
}

function tile(page: Page, label: string) {
  return page.getByRole("option", { name: label, exact: true });
}

/**
 * That the polite region of the surface just used announces `text`. Each
 * surface has its own region, so the one holding the sentence is asked for.
 */
async function announced(page: Page, text: string): Promise<void> {
  await expect(
    page.locator("[data-insert-announcement]", { hasText: text })
  ).toHaveCount(1);
}

test.describe("where a clicked block lands", () => {
  test.describe.configure({ timeout: 240_000 });

  test("a Heading clicked with a Section selected is the Section's last child", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openBuilder(page, id);
    await select(page, HERO);
    await openAdd(page);

    await expect(placementLine(page)).toHaveText(
      "Adding inside Hero, at the end"
    );
    await tile(page, "Heading").click();
    await announced(page, "Heading added inside Hero, at the end");
    // The new Heading is the selection, and the next click's anchor.
    await expect(placementLine(page)).toHaveText(
      "Adding after Heading, inside Hero"
    );
    await saveDraft(page);

    expect(await shape(page.request, id)).toEqual([
      { "core/section": ["core/heading", "core/heading"] },
    ]);
  });

  test("Box, then Box, makes two sibling Boxes", async ({ page }) => {
    const id = await createPage(page.request, true);
    await openBuilder(page, id);
    await openAdd(page);

    await expect(placementLine(page)).toHaveText(
      "Adding at the end of the page"
    );
    await tile(page, "Box").click();
    // The new Box is the selection; another Box goes after it, as its tile
    // says.
    await expect(tile(page, "Box")).toHaveAccessibleDescription(
      /^Goes after Box\./
    );
    await tile(page, "Box").click();
    await saveDraft(page);

    expect(await shape(page.request, id)).toEqual(["core/box", "core/box"]);
  });

  test("five Text blocks clicked inside a Section are five siblings in it", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openBuilder(page, id);
    await select(page, HERO);
    await openAdd(page);

    for (let added = 0; added < 5; added++) {
      await tile(page, "Text").click();
      await expect(placementLine(page)).toHaveText(
        "Adding after Text, inside Hero"
      );
    }
    await saveDraft(page);

    expect(await shape(page.request, id)).toEqual([
      {
        "core/section": [
          "core/heading",
          ...Array.from({ length: 5 }, () => "core/text"),
        ],
      },
    ]);
  });

  test("a Section added with a Heading inside a Section selected goes after the Section", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openBuilder(page, id);
    await clickBlock(page, HEADING);
    await expect.poll(() => selection(page)).toEqual([HEADING]);
    await openAdd(page);

    await tile(page, "Section").click();
    await announced(page, "Section added after Hero");
    await saveDraft(page);

    expect(await shape(page.request, id)).toEqual([
      { "core/section": ["core/heading"] },
      "core/section",
    ]);
  });

  test("the + below a Section adds in the gap there, not inside the Section", async ({
    page,
  }) => {
    const id = await createPage(page.request, false, true);
    await openBuilder(page, id);
    // Pressed from the keyboard: the "+" is a button an author can tab to,
    // and Enter runs the press a click does, wherever the pointer is.
    const gap = page.getByRole("button", { name: "Add a section after Hero" });
    await gap.focus();
    await page.keyboard.press("Enter");
    await expect(placementLine(page)).toHaveText(
      "Adding between Hero and Pricing"
    );
    await tile(page, "Heading").click();
    await announced(page, "Heading added between Hero and Pricing");
    await saveDraft(page);

    expect(await shape(page.request, id)).toEqual([
      { "core/section": ["core/heading"] },
      "core/heading",
      "core/section",
    ]);
  });

  test("a click, Enter, the Components panel and search put one block in one place", async ({
    page,
  }) => {
    const title = `Badge ${stamp()}`;
    const componentId = await createComponent(page.request, title);
    const id = await createPage(page.request);
    await openBuilder(page, id);
    const combobox = page.getByRole("combobox", { name: "Insert a block" });

    // A click on its Add tile.
    await select(page, HERO);
    await openAdd(page);
    await combobox.fill(title);
    await tile(page, title).click();
    await announced(page, `${title} added inside Hero, at the end`);
    await expect.poll(() => heroChildren(page)).toBe(2);

    // Enter on its Add tile.
    await select(page, HERO);
    await openAdd(page);
    await combobox.fill(title);
    await combobox.press("Enter");
    await expect.poll(() => heroChildren(page)).toBe(3);

    // Its row in the Components panel.
    await select(page, HERO);
    await openPanel(page, "Components");
    await page
      .locator(".nx-components-panel")
      .getByRole("button", { name: title, exact: true })
      .click();
    await expect.poll(() => heroChildren(page)).toBe(4);

    // Its row in the editor's search.
    await select(page, HERO);
    await page.getByRole("button", { name: "Search and commands" }).click();
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await palette.getByRole("combobox").fill(title);
    const row = palette
      .getByRole("group", { name: "Add" })
      .getByRole("option")
      .first();
    await expect(row).toContainText("Adding inside Hero, at the end");
    await page.keyboard.press("Enter");
    await expect(palette).toBeHidden();
    await saveDraft(page);

    const placed = `component:${componentId}`;
    expect(await shape(page.request, id)).toEqual([
      { "core/section": ["core/heading", placed, placed, placed, placed] },
    ]);
  });
});
