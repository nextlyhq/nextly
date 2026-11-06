/**
 * Detaching a placement, duplicating its component, and updating a pattern,
 * in the Page Builder.
 *
 * Each case seeds its own component, pattern and page through the admin API,
 * opens the page in the builder and works from the block toolbar's "More"
 * menu, as an author does. What is stored is read back through the API.
 *
 * @module tests/builder-component-detach-duplicate.spec
 */
import { expect, type Page } from "@playwright/test";

import {
  block,
  canvasRoot,
  clickBlock,
  pressSave,
} from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const PAGES = "/admin/api/collections/pages/entries";
const COMPONENTS = "/admin/api/collections/components/entries";
const PATTERNS = "/admin/api/collections/patterns/entries";
const INSTANCE_TYPE = "nextly/component-instance";

interface StoredNode {
  id: string;
  type: string;
  props: Record<string, unknown>;
}

function heading(id: string, text: string) {
  return { id, type: "core/heading", version: 1, props: { text, level: "h2" } };
}

async function created(
  page: Page,
  url: string,
  data: Record<string, unknown>
): Promise<string> {
  const answer = await page.request.post(url, { data });
  expect(answer.ok(), `seeding ${url}: ${answer.status()}`).toBe(true);
  return ((await answer.json()) as { item: { id: string } }).item.id;
}

/** A published card component, and a page placing it twice. */
async function seedPlacements(page: Page, tag: string) {
  const componentId = await created(page, COMPONENTS, {
    title: `Card ${tag}`,
    slug: `card-${tag}`,
    status: "published",
    content: {
      formatVersion: 1,
      kind: "component",
      nodes: [
        {
          id: "frame",
          type: "core/box",
          version: 1,
          props: {},
          slots: { children: [heading("t", "Card title")] },
        },
      ],
      exposed: [
        {
          id: "title",
          label: "Title",
          nodeId: "t",
          propPath: "text",
          type: "text",
        },
      ],
    },
  });
  const pageId = await created(page, PAGES, {
    title: `Placements ${tag}`,
    slug: `placements-${tag}`,
    content: {
      formatVersion: 1,
      kind: "page",
      nodes: [
        heading("lead", `Lead ${tag}`),
        {
          id: "p1",
          type: INSTANCE_TYPE,
          version: 1,
          props: { componentId, overrides: { title: `Mine ${tag}` } },
        },
        {
          id: "p2",
          type: INSTANCE_TYPE,
          version: 1,
          props: { componentId },
        },
      ],
    },
  });
  return { componentId, pageId };
}

async function openBuilder(page: Page, pageId: string): Promise<void> {
  await gotoAdmin(page, `/collections/pages/${pageId}/builder?field=content`);
  await expect(await block(page, "lead")).toBeVisible({ timeout: 30_000 });
}

/** Select a placement by its own text, which a composed node draws. */
async function selectPlacement(page: Page, text: string): Promise<void> {
  const canvas = await canvasRoot(page);
  const target = canvas.getByText(text, { exact: true }).first();
  await expect(target).toBeVisible({ timeout: 30_000 });
  await target.click();
}

/** The canvas's top band, where the seeded blocks are drawn. */
async function blocksClip(
  page: Page
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await (await canvasRoot(page)).boundingBox();
  if (box === null) throw new Error("[e2e] the canvas rendered no box");
  return { x: box.x, y: box.y, width: box.width, height: 240 };
}

async function more(page: Page, verb: RegExp): Promise<void> {
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: verb }).click();
}

async function storedNodes(page: Page, pageId: string): Promise<StoredNode[]> {
  const read = await page.request.get(`${PAGES}/${pageId}?status=all`);
  expect(read.ok(), `reading the page: ${read.status()}`).toBe(true);
  const body = (await read.json()) as Record<string, unknown>;
  const item = (body.item ?? body) as Record<string, unknown>;
  const content = (
    typeof item.content === "string" ? JSON.parse(item.content) : item.content
  ) as { nodes: StoredNode[] };
  return content.nodes;
}

async function save(page: Page, pageId: string): Promise<void> {
  const saved = page.waitForResponse(
    response =>
      new URL(response.url()).pathname.endsWith(`/entries/${pageId}`) &&
      ["PATCH", "PUT"].includes(response.request().method()) &&
      response.ok()
  );
  await pressSave(page);
  await saved;
}

test.describe("detach, duplicate and update a pattern", () => {
  test.describe.configure({ timeout: 180_000 });

  test("detach keeps the placement looking exactly the same", async ({
    page,
  }) => {
    const tag = `${Date.now()}`;
    const { pageId } = await seedPlacements(page, tag);
    await openBuilder(page, pageId);
    // The pointer off the canvas, so no hover outline is in either picture,
    // and the picture clipped to the blocks, clear of the floating checklist
    // and toasts, which change with the edit itself.
    await page.mouse.move(0, 0);
    const clip = await blocksClip(page);
    const before = await page.screenshot({ clip, animations: "disabled" });

    await selectPlacement(page, `Mine ${tag}`);
    await more(page, /^Detach from component/);
    const dialog = page.getByRole("dialog", { name: "Detach from component" });
    await expect(dialog.getByRole("button", { name: "Detach" })).toBeEnabled({
      timeout: 15_000,
    });
    await dialog.getByRole("button", { name: "Detach" }).click();
    await expect(dialog).toBeHidden();
    // Nothing selected, so the selection outline is not part of the picture.
    await page.keyboard.press("Escape");
    await page.mouse.move(0, 0);

    const after = await page.screenshot({ clip, animations: "disabled" });
    expect(after.equals(before)).toBe(true);

    await save(page, pageId);
    const nodes = await storedNodes(page, pageId);
    expect(nodes.map(node => node.type)).toEqual([
      "core/heading",
      "core/box",
      INSTANCE_TYPE,
    ]);
  });

  test("duplicate points only the placement it came from at the copy", async ({
    page,
  }) => {
    const tag = `${Date.now()}`;
    const { componentId, pageId } = await seedPlacements(page, tag);
    await openBuilder(page, pageId);

    await selectPlacement(page, `Mine ${tag}`);
    await more(page, /^Duplicate component/);
    const dialog = page.getByRole("dialog", { name: "Duplicate component" });
    await expect(dialog.getByLabel("Name of the copy")).toHaveValue(
      `Card ${tag} copy`
    );
    await dialog.getByRole("button", { name: "Duplicate" }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    const canvas = await canvasRoot(page);
    await expect(canvas.getByText(`Mine ${tag}`)).toBeVisible();

    await save(page, pageId);
    const nodes = await storedNodes(page, pageId);
    const copyId = String(nodes[1]?.props.componentId);
    expect(copyId).not.toBe(componentId);
    expect(nodes[1]?.props.overrides).toEqual({ title: `Mine ${tag}` });
    expect(nodes[2]?.props.componentId).toBe(componentId);
    const copy = await page.request.get(`${COMPONENTS}/${copyId}?status=all`);
    const copyBody = (await copy.json()) as Record<string, unknown>;
    const item = (copyBody.item ?? copyBody) as Record<string, unknown>;
    expect(item?.title).toBe(`Card ${tag} copy`);
    expect(item?.status).toBe("published");
  });

  test("updating a pattern leaves an earlier insert of it unchanged", async ({
    page,
  }) => {
    const tag = `${Date.now()}`;
    const patternId = await created(page, PATTERNS, {
      title: `Hero ${tag}`,
      slug: `hero-${tag}`,
      granularity: "section",
      status: "published",
      content: {
        formatVersion: 1,
        kind: "pattern",
        nodes: [heading("old", "Old hero")],
      },
    });
    // A page holding an earlier insert of the pattern: a copy with no link.
    const earlierId = await created(page, PAGES, {
      title: `Earlier ${tag}`,
      slug: `earlier-${tag}`,
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [heading("copied", "Old hero")],
      },
    });
    const { pageId } = await seedPlacements(page, tag);
    await openBuilder(page, pageId);

    await clickBlock(page, "lead");
    await more(page, /^Update a pattern/);
    const dialog = page.getByRole("dialog", { name: "Update a pattern" });
    await dialog.getByRole("combobox", { name: "Pattern" }).click();
    await page.getByRole("option", { name: `Hero ${tag}` }).click();
    await dialog.getByRole("button", { name: "Update pattern" }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    const pattern = await page.request.get(
      `${PATTERNS}/${patternId}?status=all`
    );
    const patternBody = (await pattern.json()) as Record<string, unknown>;
    const stored = (patternBody.item ?? patternBody) as Record<string, unknown>;
    const content = (
      typeof stored?.content === "string"
        ? JSON.parse(stored.content)
        : stored?.content
    ) as { nodes: StoredNode[] };
    expect(content.nodes[0]?.props.text).toBe(`Lead ${tag}`);
    const earlier = await storedNodes(page, earlierId);
    expect(earlier[0]?.props.text).toBe("Old hero");
  });
});
