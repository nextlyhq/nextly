/**
 * The page builder's main flow, by keyboard alone.
 *
 * No click anywhere: focus moves by Tab, and every action is a key. The
 * author opens Layers, selects a block in the tree, moves it, adds a block
 * from the Add panel's search, and saves; the stored page is read back to
 * show each step happened. A flow that needed a pointer at any step stalls
 * at that step, as a keyboard-only author would.
 *
 * "Control" stands for the editor's "mod" key here: the suite's browser
 * reports a Windows user agent, so the editor reads "mod" as Control.
 */
import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { storedPageNodes } from "./support/stored-page";
import { test } from "./support/test";

const ENTRIES = "/admin/api/collections/pages/entries";
const FIRST = "00000000-0000-4000-8000-00000000d611";
const SECOND = "00000000-0000-4000-8000-00000000d612";

function heading(id: string, text: string) {
  return {
    id,
    type: "core/heading",
    version: 1,
    props: { text, level: "h2" },
  };
}

async function createPage(request: APIRequestContext): Promise<string> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await request.post(ENTRIES, {
    data: {
      title: `Keyboard ${stamp}`,
      slug: `keyboard-${stamp}`,
      status: "draft",
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [heading(FIRST, "First"), heading(SECOND, "Second")],
      },
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

async function storedNodes(
  request: APIRequestContext,
  id: string
): Promise<Record<string, unknown>[]> {
  return await storedPageNodes(request, ENTRIES, id);
}

/**
 * Press Tab until `target` has focus, as an author would, failing if it
 * never does: a control Tab cannot reach is one a keyboard author cannot use.
 */
async function tabTo(page: Page, target: Locator, limit = 40): Promise<void> {
  for (let press = 0; press < limit; press++) {
    if (await target.evaluate(element => element === document.activeElement)) {
      return;
    }
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}

function railButton(page: Page, name: string): Locator {
  return page
    .getByRole("navigation", { name: "Editor panels" })
    .getByRole("button", { name, exact: true });
}

test.describe("the page builder by keyboard alone", () => {
  test.describe.configure({ timeout: 180_000 });

  test("selects and moves a block in Layers, adds one from Add, and saves", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
    await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
      timeout: 60_000,
    });

    // Open Layers from the rail.
    await tabTo(page, railButton(page, "Layers"));
    await page.keyboard.press("Enter");
    const tree = page.getByRole("tree", { name: "Layers" });
    await expect(tree).toBeVisible();

    // Into the tree, down to the second block, and select it.
    await tabTo(page, tree.getByRole("treeitem").first());
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(tree.getByRole("treeitem", { selected: true })).toHaveCount(1);

    // Move it above the first.
    await page.keyboard.press("Alt+ArrowUp");

    // Open Add from the rail, find a block by its name, and add it.
    await tabTo(page, railButton(page, "Add"));
    await page.keyboard.press("Enter");
    const search = page.getByRole("combobox", { name: "Insert a block" });
    await tabTo(page, search);
    await page.keyboard.type("Divider");
    // A search highlights its first match, which Enter takes.
    await expect(
      page.getByRole("option", { name: "Divider", exact: true })
    ).toBeVisible();
    await page.keyboard.press("Enter");

    // Save.
    const saved = page.waitForResponse(
      response =>
        ["PATCH", "PUT"].includes(response.request().method()) &&
        new URL(response.url()).pathname === `${ENTRIES}/${id}`
    );
    await page.keyboard.press("Control+s");
    expect((await saved).ok()).toBe(true);

    // Second moved above First, and the divider was added after the moved
    // block, the selection.
    const nodes = await storedNodes(page.request, id);
    expect(nodes.map(node => node.id).slice(0, 1)).toEqual([SECOND]);
    expect(nodes.map(node => node.type)).toEqual([
      "core/heading",
      "core/divider",
      "core/heading",
    ]);
    expect(nodes[2]?.id).toBe(FIRST);
  });
});
