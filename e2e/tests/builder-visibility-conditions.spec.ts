/**
 * A block's visibility conditions in the editor: built in the inspector,
 * badged on the canvas, and applied, so the canvas shows the page as a
 * visitor gets it.
 *
 * 1. In a block's "Show when", the author builds one condition on the page's
 *    own fields; the canvas badges the block, and the save stores the
 *    condition as the engine reads it.
 * 2. On a page whose conditioned block's conditions don't hold for it,
 *    "Preview as visitor", in the top bar's Preview menu, draws that block as
 *    a one-line marker saying why, shows the item checked and a strip saying
 *    what was hidden, whose Stop turns it off; nothing stored changes, and a
 *    reload starts with it off. No "Apply conditions" switch is left above
 *    the canvas, and a page with no conditioned block lists the item
 *    disabled, saying why.
 * 3. On a page listing entries whose block shows for some of them only,
 *    previewing as a visitor reads the list as a visitor does: the draft entry goes, the
 *    entry the block's conditions don't hold for draws the block's marker,
 *    the list says how many of the author's entries a visitor sees, and
 *    Stop brings the author’s entries back.
 * 4. On a page placing a component, a block of the component's own whose
 *    conditions don't hold for the page is drawn as its marker, and counted,
 *    as the published page leaves it out; its other blocks draw as before.
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
import { includingHidden, test } from "./support/test";

const PAGES = "/admin/api/collections/pages/entries";
const COMPONENTS = "/admin/api/collections/components/entries";
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

/**
 * Opens Preview's menu in the top bar: its arrow, or the menu's own button
 * where no preview press sits beside it.
 */
async function openPreviewMenu(page: Page): Promise<void> {
  await page
    .locator('[data-topbar="end"]')
    .getByRole("button", { name: /^Preview( options)?$/ })
    .last()
    .click();
}

/** "Preview as visitor" in Preview's menu, which must be open. */
const visitorItem = (page: Page) =>
  page.getByRole("menuitemcheckbox", { name: /Preview as visitor/ });

/** Turns "Preview as visitor" on or off from Preview's menu. */
async function previewAsVisitor(page: Page, on: boolean): Promise<void> {
  await openPreviewMenu(page);
  await expect(visitorItem(page)).toHaveAttribute(
    "aria-checked",
    on ? "false" : "true"
  );
  await visitorItem(page).click();
}

/** The strip above the canvas while previewing as a visitor. */
const visitorStrip = (page: Page) => page.locator("[data-visitor-preview]");

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

    // Show when is on the Advanced tab, under Visibility.
    await page.getByRole("tab", { name: "Advanced" }).click();
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

  test("previews a page as a visitor: a block its conditions hide is drawn as its marker, said, and stopped", async ({
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
    const stored = await storedPageNodes(page.request, PAGES, id);
    await openBuilder(page, id);
    const pack = (await canvasRoot(page)).locator(`[data-nx-node="${PACK}"]`);
    // CONTROL: off, the canvas draws the block as itself.
    await expect(pack).toContainText("Your member pack");
    // The switch that sat above the canvas is gone, and nothing is said.
    await expect(
      page.getByRole("switch", { name: "Apply conditions" })
    ).toHaveCount(0);
    await expect(
      includingHidden(page).getByText("Apply conditions")
    ).toHaveCount(0);
    // No strip at all above a page's canvas while the view is off, where
    // the switch's own strip used to sit.
    await expect(page.locator(".nx-preview-strip")).toHaveCount(0);

    await previewAsVisitor(page, true);
    await expect(visitorStrip(page)).toContainText("Previewing as a visitor");
    await expect(
      visitorStrip(page)
        .getByRole("status")
        .filter({ hasText: "1 block hidden for this" })
    ).toBeVisible({ timeout: 30_000 });
    await expect(pack).toContainText("Member pack");
    await expect(pack).toContainText(/hidden for this .+: Title/);
    await expect(pack).not.toContainText("Your member pack");
    // The item shows it is on.
    await openPreviewMenu(page);
    await expect(visitorItem(page)).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");

    // Stop turns it off: the block is drawn as itself again.
    await visitorStrip(page).getByRole("button", { name: "Stop" }).click();
    await expect(pack).toContainText("Your member pack");
    await expect(visitorStrip(page)).toHaveCount(0);
    // Nothing stored changed.
    expect(await storedPageNodes(page.request, PAGES, id)).toEqual(stored);

    // It lasts only for the session: on again, then a reload, and it's off.
    await previewAsVisitor(page, true);
    await expect(visitorStrip(page)).toBeVisible();
    await openBuilder(page, id);
    await expect(
      (await canvasRoot(page)).locator(`[data-nx-node="${PACK}"]`)
    ).toContainText("Your member pack");
    await expect(visitorStrip(page)).toHaveCount(0);
    await openPreviewMenu(page);
    await expect(visitorItem(page)).toHaveAttribute("aria-checked", "false");
  });

  test("lists Preview as visitor disabled on a page with no conditioned block, saying why", async ({
    page,
  }) => {
    await gotoAdmin(page, "/");
    const mark = `V${Date.now().toString(36)}`;
    const id = await created(page.request, PAGES, {
      title: `Plain page ${mark}`,
      slug: `conditions-none-${mark.toLowerCase()}`,
      status: "published",
      content: packPage(),
    });
    await openBuilder(page, id);
    await openPreviewMenu(page);
    await expect(visitorItem(page)).toHaveAttribute("aria-disabled", "true");
    await expect(visitorItem(page)).toContainText(
      "No block on this page has conditions"
    );
    await expect(
      page.getByRole("switch", { name: "Apply conditions" })
    ).toHaveCount(0);
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

    // CONTROL: off, the author's entries, the draft among them,
    // each drawing the badge.
    await expect
      .poll(() => listedTitles(page), { timeout: 30_000 })
      .toEqual([`${mark} Alder`, `${mark} Birch`, `${mark} Cedar`]);
    await expect(list.getByText("Premium pick")).toHaveCount(3);

    await previewAsVisitor(page, true);
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

    // Stopped, the author's own entries again.
    await visitorStrip(page).getByRole("button", { name: "Stop" }).click();
    await expect
      .poll(() => listedTitles(page), { timeout: 30_000 })
      .toEqual([`${mark} Alder`, `${mark} Birch`, `${mark} Cedar`]);
    await expect(list).not.toHaveAttribute("data-nx-list-visitors", /./);
  });

  test("applies a page's conditions inside a component it places", async ({
    page,
  }) => {
    await gotoAdmin(page, "/");
    const api = page.request;
    const mark = `V${Date.now().toString(36)}`;
    const componentId = await created(api, COMPONENTS, {
      title: `Promo ${mark}`,
      slug: `conditions-promo-${mark.toLowerCase()}`,
      status: "published",
      content: {
        formatVersion: 1,
        kind: "component",
        nodes: [
          {
            id: "everyone",
            type: "core/text",
            version: 1,
            props: { text: "News from the journal." },
          },
          {
            id: "members",
            type: "core/text",
            version: 1,
            name: "Members offer",
            props: { text: "Members get the archive." },
            visibility: { conditions: FOR_MEMBERS },
          },
        ],
      },
    });
    // Published, and not titled with Members: visitors don't see the offer.
    const id = await created(api, PAGES, {
      title: `Join the journal ${mark}`,
      slug: `conditions-component-${mark.toLowerCase()}`,
      status: "published",
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "00000000-0000-4000-8000-0000002c03c1",
            type: "nextly/component-instance",
            version: 1,
            props: { componentId },
          },
        ],
      },
    });
    await openBuilder(page, id);
    const root = await canvasRoot(page);
    // CONTROL: off, the component draws both its blocks.
    await expect(root.getByText("Members get the archive.")).toBeVisible({
      timeout: 30_000,
    });
    await expect(root.getByText("News from the journal.")).toBeVisible();

    await previewAsVisitor(page, true);
    await expect(
      page.getByRole("status").filter({ hasText: "1 block hidden for this" })
    ).toBeVisible({ timeout: 30_000 });
    // Its marker, naming it and why, where the offer was drawn.
    await expect(root.locator(".nx-condition-hidden")).toContainText(
      /Members offer · hidden for this .+: Title/
    );
    await expect(root.getByText("Members get the archive.")).toHaveCount(0);
    await expect(root.getByText("News from the journal.")).toBeVisible();

    // Turned off from the menu, the component draws both again.
    await previewAsVisitor(page, false);
    await expect(root.getByText("Members get the archive.")).toBeVisible();
  });
});
