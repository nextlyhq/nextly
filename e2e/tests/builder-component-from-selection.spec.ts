/**
 * Making a component from a selection, in the Page Builder.
 *
 * Each case seeds its own page through the admin API and opens it in the
 * builder, as an author arrives. A convert starts from the block toolbar's
 * "More" menu and a save from the context menu, both through the exposure
 * picker; what is stored is read back through the API after a reload.
 *
 * @module tests/builder-component-from-selection.spec
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
const INSTANCE_TYPE = "nextly/component-instance";

interface StoredNode {
  id: string;
  type: string;
  props: Record<string, unknown>;
}

/** Seed a draft page holding a heading and a paragraph; returns its id. */
async function seed(page: Page, tag: string): Promise<string> {
  const created = await page.request.post(PAGES, {
    data: {
      title: `Component from selection ${tag}`,
      slug: `component-from-selection-${tag}`,
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "hero-title",
            type: "core/heading",
            version: 1,
            props: { text: `Launch week ${tag}`, level: "h2" },
          },
          {
            id: "hero-body",
            type: "core/text",
            version: 1,
            props: { text: `Everything ships ${tag}` },
          },
        ],
      },
    },
  });
  expect(created.ok(), `seeding the page: ${created.status()}`).toBe(true);
  return ((await created.json()) as { item: { id: string } }).item.id;
}

async function openBuilder(page: Page, pageId: string): Promise<void> {
  await gotoAdmin(page, `/collections/pages/${pageId}/builder?field=content`);
  await expect(await block(page, "hero-title")).toBeVisible({
    timeout: 30_000,
  });
}

/** The page's nodes as stored, in every status. */
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

/** A component as stored, by id. */
async function storedComponent(
  page: Page,
  id: string
): Promise<Record<string, unknown>> {
  const read = await page.request.get(`${COMPONENTS}/${id}?status=all`);
  expect(read.ok(), `reading the component: ${read.status()}`).toBe(true);
  const body = (await read.json()) as Record<string, unknown>;
  return (body.item ?? body) as Record<string, unknown>;
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

test.describe("making a component from a selection", () => {
  test.describe.configure({ timeout: 180_000 });

  test("converts from the toolbar, with a picked field, as one undo step that survives a reload", async ({
    page,
  }) => {
    const tag = `${Date.now()}`;
    const pageId = await seed(page, tag);
    await openBuilder(page, pageId);

    await clickBlock(page, "hero-title");
    await page.getByRole("button", { name: "More actions" }).click();
    // One item for both ways; the dialog opens on replacing the blocks.
    await expect(
      page.getByRole("menuitem", { name: /^(Save as|Convert to) component/ })
    ).toHaveCount(0);
    await page.getByRole("menuitem", { name: /^Turn into component/ }).click();

    const dialog = page.getByRole("dialog", { name: "Turn into component" });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText("Checking what this will change…")
    ).toBeHidden({ timeout: 15_000 });
    await dialog.getByLabel("Name", { exact: true }).fill(`Launch hero ${tag}`);
    // The heading's text, offered to every placement, named for the author.
    await dialog.getByRole("checkbox", { name: "Text" }).click();
    await dialog.getByLabel(/Name pages see for Text/).fill("Headline");
    await dialog.getByRole("button", { name: "Turn into component" }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    // The heading is now drawn through a placement: the same words, and no
    // longer the page's own block.
    const canvas = await canvasRoot(page);
    await expect(canvas.getByText(`Launch week ${tag}`)).toBeVisible();
    await expect(await block(page, "hero-title")).toHaveCount(0);
    await expect(await block(page, "hero-body")).toBeVisible();

    // One undo puts the heading back, and redo converts it again. Control, not
    // ControlOrMeta: the editor reads `mod` from the platform the browser
    // reports, and this suite's device reports Windows on every host.
    await page.keyboard.press("Control+z");
    await expect(await block(page, "hero-title")).toBeVisible();
    await page.keyboard.press("Control+Shift+z");
    await expect(await block(page, "hero-title")).toHaveCount(0);

    await save(page, pageId);
    await page.reload();
    await expect(canvas.getByText(`Launch week ${tag}`)).toBeVisible({
      timeout: 30_000,
    });

    const nodes = await storedNodes(page, pageId);
    expect(nodes.map(node => node.type)).toEqual([INSTANCE_TYPE, "core/text"]);
    const componentId = String(nodes[0]?.props.componentId);
    const component = await storedComponent(page, componentId);
    expect(component.title).toBe(`Launch hero ${tag}`);
    expect(component.status).toBe("published");
    const definition = (
      typeof component.content === "string"
        ? JSON.parse(component.content)
        : component.content
    ) as { nodes: StoredNode[]; exposed: Record<string, unknown>[] };
    expect(definition.nodes.map(node => node.type)).toEqual(["core/heading"]);
    expect(definition.exposed).toEqual([
      expect.objectContaining({
        label: "Headline",
        propPath: "text",
        type: "text",
        nodeId: definition.nodes[0]?.id,
      }),
    ]);
  });

  test("saves a copy from the context menu, keeping the originals, and leaves the page as it was", async ({
    page,
  }) => {
    const tag = `${Date.now()}`;
    const pageId = await seed(page, tag);
    await openBuilder(page, pageId);

    await clickBlock(page, "hero-body");
    await (await block(page, "hero-body")).click({ button: "right" });
    await page.getByRole("menuitem", { name: /^Turn into component/ }).click();

    const dialog = page.getByRole("dialog", { name: "Turn into component" });
    await expect(dialog).toBeVisible();
    // Keeping the originals is the save: the page is left as it was.
    await dialog
      .getByRole("checkbox", { name: "Keep the original blocks on this page" })
      .click();
    await expect(
      dialog.getByText("This page is not changed.", { exact: false })
    ).toBeVisible();
    await dialog.getByLabel("Name", { exact: true }).fill(`Body copy ${tag}`);
    const created = page.waitForResponse(
      response =>
        new URL(response.url()).pathname.endsWith(
          "/components/from-selection"
        ) && response.status() === 201
    );
    await dialog.getByRole("button", { name: "Save component" }).click();
    const answer = (await (await created).json()) as {
      item: { component: { id: string } };
    };
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    // The page keeps its own block, and the copy is in the library.
    await expect(await block(page, "hero-body")).toBeVisible();
    const component = await storedComponent(page, answer.item.component.id);
    expect(component.title).toBe(`Body copy ${tag}`);
    expect(component.status).toBe("published");
  });
});
