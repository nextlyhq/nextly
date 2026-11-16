/**
 * The Add panel in the real editor: where a click puts a block, and what the
 * panel says before it does.
 *
 * What each asserts, and the broken version it rules out:
 *
 * - Five clicks with a block selected make five siblings after it, in order,
 *   each the next one's anchor. A panel that added inside the selection, or
 *   kept adding after the first block, stores a different shape.
 * - An empty container's "+" adds inside it, and the next click adds after
 *   the block just added, still inside. A "+" that only selected the
 *   container would add after it, at the page's top level.
 * - A block that cannot go anywhere a click may use stays listed, greyed,
 *   with its reason, and a click on it adds nothing. A panel that hid it, or
 *   let the click through, fails here.
 * - The popover describes the tile under the pointer and the tile the arrow
 *   keys reach, and Escape closes it.
 *
 * Each test makes its own page, named uniquely, so no lock is needed.
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { pressSave } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { canvasFrame } from "./support/canvas-frame";
import { storedPageNodes } from "./support/stored-page";
import { test } from "./support/test";

const ENTRIES = "/admin/api/collections/pages/entries";

const HEADING = "00000000-0000-4000-8000-00000000b001";
const SECTION = "00000000-0000-4000-8000-00000000b002";

/** A heading, then an empty section. */
function document(): unknown {
  const pad = "24px";
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: HEADING,
        type: "core/heading",
        version: 1,
        props: { text: "Add panel heading", level: "h2" },
      },
      {
        id: SECTION,
        type: "core/section",
        version: 1,
        props: { as: "section", contained: true },
        // Padding, so the empty section has a surface of its own.
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

/** A draft page of its own, holding the document above, and its id. */
async function createPage(request: APIRequestContext): Promise<string> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await request.post(ENTRIES, {
    data: {
      title: `Add panel ${stamp}`,
      slug: `add-panel-${stamp}`,
      status: "draft",
      content: document(),
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

/** The page's stored nodes, read back through the API. */
async function storedNodes(
  request: APIRequestContext,
  id: string
): Promise<Record<string, unknown>[]> {
  return await storedPageNodes(request, ENTRIES, id);
}

async function openBuilder(page: Page, id: string): Promise<void> {
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

/** Open the Add panel from the rail, unless it is open already. */
async function openAdd(page: Page): Promise<void> {
  const add = page
    .getByRole("navigation", { name: "Editor panels" })
    .getByRole("button", { name: "Add", exact: true });
  if ((await add.getAttribute("aria-pressed")) !== "true") await add.click();
  await expect(
    page.getByRole("combobox", { name: "Insert a block" })
  ).toBeVisible();
}

/** The line under the search that says where the next block goes. */
function placementLine(page: Page) {
  return page.locator(".nx-insert-panel__placement");
}

function tile(page: Page, label: string) {
  return page.getByRole("option", { name: label, exact: true });
}

function popover(page: Page) {
  return page.locator(".nx-insert-popover");
}

test.describe("the Add panel", () => {
  test.describe.configure({ timeout: 180_000 });

  test("five clicks after a selected block make five siblings, in order", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openBuilder(page, id);
    await canvasFrame(page)
      .locator(`.nx-canvas [data-nx-node="${HEADING}"]`)
      .click();
    await openAdd(page);

    await expect(placementLine(page)).toHaveText("Adding after Heading");
    for (let added = 0; added < 5; added++) {
      await tile(page, "Divider").click();
      // The block just added is the selection, and the next one's anchor.
      await expect(placementLine(page)).toHaveText("Adding after Divider");
    }
    await saveDraft(page);

    const nodes = await storedNodes(page.request, id);
    expect(nodes.map(node => node.type)).toEqual([
      "core/heading",
      ...Array.from({ length: 5 }, () => "core/divider"),
      "core/section",
    ]);
  });

  test("an empty container's + adds inside it, then after what it added", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openBuilder(page, id);

    await page
      .getByRole("button", {
        name: "Drop a block here, or click to add one, in Section",
      })
      .click();
    await expect(placementLine(page)).toHaveText("Adding inside Section");
    await tile(page, "Divider").click();
    await expect(placementLine(page)).toHaveText("Adding after Divider");
    await tile(page, "Divider").click();
    await saveDraft(page);

    const nodes = await storedNodes(page.request, id);
    // The top level as it was; both dividers in the section, in order.
    expect(nodes.map(node => node.type)).toEqual([
      "core/heading",
      "core/section",
    ]);
    const children = (nodes[1]?.slots as Record<string, unknown[]>)
      .children as Record<string, unknown>[];
    expect(children.map(node => node.type)).toEqual([
      "core/divider",
      "core/divider",
    ]);
  });

  test("a block with nowhere to go stays listed, greyed, with its reason", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openBuilder(page, id);
    await canvasFrame(page)
      .locator(`.nx-canvas [data-nx-node="${HEADING}"]`)
      .click();
    await openAdd(page);

    // An accordion item belongs inside an accordion, and nothing a click may
    // use from here is one.
    const item = tile(page, "Accordion item");
    await expect(item).toHaveAttribute("data-refused", "true");
    // One plain instruction, generated from where the rule lets it go.
    await expect(item).toHaveAccessibleDescription(
      /^Goes inside an Accordion\. Select an Accordion first, or drag this into one\./
    );
    await item.click();
    await expect(placementLine(page)).toHaveText("Adding after Heading");

    // The control: a block the page takes is not greyed, and adds.
    await expect(tile(page, "Divider")).not.toHaveAttribute(
      "data-refused",
      "true"
    );
    await saveDraft(page);
    const nodes = await storedNodes(page.request, id);
    expect(nodes.map(node => node.type)).toEqual([
      "core/heading",
      "core/section",
    ]);
  });

  test("the popover describes the tile under the pointer or the arrow keys", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openBuilder(page, id);
    await openAdd(page);

    // At rest, nothing is highlighted and nothing is described.
    await expect(popover(page)).toHaveCount(0);

    await tile(page, "Divider").hover();
    await expect(popover(page).locator(".nx-insert-popover__name")).toHaveText(
      "Divider"
    );

    const search = page.getByRole("combobox", { name: "Insert a block" });
    await search.focus();
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowDown");
    const highlighted = await search.getAttribute("aria-activedescendant");
    expect(highlighted).toBeTruthy();
    // The highlighted option by its role and state, and the same element the
    // search names as active.
    const option = page.getByRole("option", { selected: true });
    await expect(option).toHaveAttribute("id", highlighted ?? "");
    const name = await option.getAttribute("aria-label");
    await expect(popover(page).locator(".nx-insert-popover__name")).toHaveText(
      name ?? ""
    );

    await page.keyboard.press("Escape");
    await expect(popover(page)).toHaveCount(0);
  });
});
