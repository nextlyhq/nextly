/**
 * A block's visibility conditions in the editor: built in the inspector,
 * badged on the canvas, and applied, so the canvas shows the page as a
 * visitor gets it.
 *
 * 1. In a block's "Show when", the author builds one condition on the page's
 *    own fields; the canvas badges the block, and the save stores the
 *    condition as the engine reads it.
 * 2. On a page whose conditioned block's conditions don't hold for it,
 *    Apply conditions draws that block as a one-line marker saying why, and
 *    the strip counts it.
 * 3. On a page listing entries whose block shows for some of them only, Apply
 *    conditions reads the list as a visitor does: the draft entry goes, the
 *    entry the block's conditions don't hold for draws the block's marker,
 *    the list says how many of the author's entries a visitor sees, and
 *    switching off brings the author's entries back.
 *
 * Every page and entry is this run's own, its titles marked with the run, so
 * other files writing pages and blog posts alongside change nothing here.
 *
 * @module tests/builder-visibility-conditions.spec
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import {
  canvasRoot,
  layerRow,
  openLayers,
  pressSave,
} from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { storedPageNodes } from "./support/stored-page";
import { test } from "./support/test";

const PAGES = "/admin/api/collections/pages/entries";
const ENTRIES = "/admin/api/collections/bound-entries/entries";

/** The node ids this file's pages hold. */
const HEADING = "00000000-0000-4000-8000-0000002c03a1";
const PACK = "00000000-0000-4000-8000-0000002c03a2";
const LIST = "00000000-0000-4000-8000-0000002c03b1";
const BADGE = "00000000-0000-4000-8000-0000002c03b3";

/** Shown only on a page whose title mentions members. */
const FOR_MEMBERS = [[{ field: "title", op: "contains", value: "Members" }]];

/** One of the run's own records, created through the REST API. */
async function created(
  api: APIRequestContext,
  endpoint: string,
  data: Record<string, unknown>
): Promise<string> {
  const response = await api.post(endpoint, { data });
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as { item: { id: string } }).item.id;
}

/** A page: a heading, and the member pack, conditioned when given some. */
function packPage(conditions?: unknown): Record<string, unknown> {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: HEADING,
        type: "core/heading",
        version: 1,
        props: { text: "Join the journal", level: "h1" },
      },
      {
        id: PACK,
        type: "core/text",
        version: 1,
        name: "Member pack",
        props: { text: "Your member pack: worksheets and the archive." },
        ...(conditions === undefined ? {} : { visibility: { conditions } }),
      },
    ],
  };
}

/**
 * A page listing the blog posts titled with `mark`, each with its title and
 * a badge shown only for a post priced over 10.
 */
function listPage(mark: string): Record<string, unknown> {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: LIST,
        type: "core/collection-loop",
        version: 1,
        props: {
          collection: "bound-entries",
          limit: 10,
          sort: "title",
          filters: [{ field: "title", op: "contains", value: mark }],
        },
        slots: {
          children: [
            {
              id: "00000000-0000-4000-8000-0000002c03b2",
              type: "core/heading",
              version: 1,
              props: { text: "Entry", level: "h3" },
              bindings: { text: { $bind: "title", source: "item" } },
            },
            {
              id: BADGE,
              type: "core/text",
              version: 1,
              name: "Premium badge",
              props: { text: "Premium pick: members get it first." },
              visibility: {
                conditions: [
                  [{ field: "price", op: "greater_than", value: 10 }],
                ],
              },
            },
          ],
        },
      },
    ],
  };
}

/** Open a page's builder and wait for its canvas. */
async function openBuilder(page: Page, id: string): Promise<void> {
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
}

const applyConditions = (page: Page) =>
  page.getByRole("switch", { name: "Apply conditions" });

/** The titles the canvas's list draws, in order. */
async function listedTitles(page: Page): Promise<string[]> {
  const list = (await canvasRoot(page)).locator(`[data-nx-node="${LIST}"]`);
  return list.locator("h3").allTextContents();
}

test.describe("a block's visibility conditions in the editor", () => {
  test.describe.configure({ timeout: 240_000 });

  test("builds a condition in Show when, badges the block, and saves it", async ({
    page,
  }) => {
    await gotoAdmin(page, "/");
    const mark = `V${Date.now().toString(36)}`;
    const id = await created(page.request, PAGES, {
      title: `Members ${mark}`,
      slug: `conditions-build-${mark.toLowerCase()}`,
      status: "draft",
      content: packPage(),
    });
    await openBuilder(page, id);
    await openLayers(page);
    await layerRow(page, PACK).click();

    const showWhen = page.getByRole("region", { name: "Show when" });
    await expect(showWhen.getByText("Always shown.")).toBeVisible();
    await showWhen.getByRole("button", { name: "Add condition" }).click();
    // Only fields visitors can read are offered, and a new row opens on them.
    const fields = page.getByRole("listbox", { name: "Fields to check" });
    await fields.getByRole("option", { name: /^Title/ }).click();
    await showWhen
      .getByRole("combobox", { name: "How Title is compared" })
      .click();
    await page.getByRole("option", { name: "contains", exact: true }).click();
    const value = showWhen.getByRole("textbox", {
      name: /^Condition Title contains/,
    });
    await value.fill("Members");
    await value.press("Enter");

    // The canvas badges the block its conditions now gate.
    await expect(
      page.getByText("Conditional", { exact: true }).first()
    ).toBeVisible({ timeout: 30_000 });

    // Saved as the engine reads it: one AND group of one condition.
    await pressSave(page);
    await expect
      .poll(
        async () =>
          (await storedPageNodes(page.request, PAGES, id)).find(
            node => node.id === PACK
          )?.visibility,
        { timeout: 15_000 }
      )
      .toEqual({ conditions: FOR_MEMBERS });
  });

  test("applies a page's conditions: a block they hide is drawn as its marker, and counted", async ({
    page,
  }) => {
    await gotoAdmin(page, "/");
    const mark = `V${Date.now().toString(36)}`;
    // Published, and not titled with Members: visitors don't see the pack.
    const id = await created(page.request, PAGES, {
      title: `Join the journal ${mark}`,
      slug: `conditions-page-${mark.toLowerCase()}`,
      status: "published",
      content: packPage(FOR_MEMBERS),
    });
    await openBuilder(page, id);
    const pack = (await canvasRoot(page)).locator(`[data-nx-node="${PACK}"]`);
    // CONTROL: switched off, the canvas draws the block as itself.
    await expect(pack).toContainText("Your member pack");

    await applyConditions(page).click();
    await expect(applyConditions(page)).toBeChecked();
    await expect(
      page.getByRole("status").filter({ hasText: "1 block hidden for this" })
    ).toBeVisible({ timeout: 30_000 });
    await expect(pack).toContainText("Member pack");
    await expect(pack).toContainText(/hidden for this .+: Title/);
    await expect(pack).not.toContainText("Your member pack");

    // Switched off, the block is drawn as itself again.
    await applyConditions(page).click();
    await expect(pack).toContainText("Your member pack");
  });

  test("applies conditions to a list: read as a visitor, each entry checked, and the shrink said", async ({
    page,
  }) => {
    await gotoAdmin(page, "/");
    const api = page.request;
    const mark = `V${Date.now().toString(36)}`;
    for (const [title, price, status] of [
      [`${mark} Alder`, 25, "published"],
      [`${mark} Birch`, 5, "published"],
      [`${mark} Cedar`, 40, "draft"],
    ] as const) {
      await created(api, ENTRIES, { title, price, status });
    }
    const id = await created(api, PAGES, {
      title: `Field guides ${mark}`,
      slug: `conditions-list-${mark.toLowerCase()}`,
      status: "published",
      content: listPage(mark),
    });
    await openBuilder(page, id);
    const list = (await canvasRoot(page)).locator(`[data-nx-node="${LIST}"]`);

    // CONTROL: switched off, the author's entries, the draft among them,
    // each drawing the badge.
    await expect
      .poll(() => listedTitles(page), { timeout: 30_000 })
      .toEqual([`${mark} Alder`, `${mark} Birch`, `${mark} Cedar`]);
    await expect(list.getByText("Premium pick")).toHaveCount(3);

    await applyConditions(page).click();
    // A visitor reads the published entries only.
    await expect
      .poll(() => listedTitles(page), { timeout: 30_000 })
      .toEqual([`${mark} Alder`, `${mark} Birch`]);
    // Alder is priced over 10, so its badge shows; Birch's is its marker.
    await expect(list.getByText("Premium pick")).toHaveCount(1);
    await expect(list).toContainText(
      "Premium badge · hidden for this entry: Price isn’t more than 10"
    );
    await expect(list).toHaveAttribute(
      "data-nx-list-visitors",
      "Showing what visitors see: 2 of 3 entries",
      { timeout: 30_000 }
    );
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Conditions checked for each entry in the list" })
    ).toBeVisible();

    // Switched off, the author's own entries again.
    await applyConditions(page).click();
    await expect
      .poll(() => listedTitles(page), { timeout: 30_000 })
      .toEqual([`${mark} Alder`, `${mark} Birch`, `${mark} Cedar`]);
    await expect(list).not.toHaveAttribute("data-nx-list-visitors", /./);
  });
});
