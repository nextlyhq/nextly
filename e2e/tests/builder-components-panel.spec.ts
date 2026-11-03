/**
 * The Components panel in the real editor: the site's components by name,
 * searched, placed where Add would place a block, and opened alone.
 *
 * What each asserts, and the broken version it rules out:
 *
 * - The search narrows the list to the components it matches. A list that
 *   ignored the query, or matched nothing, fails.
 * - A site with no components says so plainly. A panel that drew an empty
 *   region, or "could not be loaded", fails.
 * - A component goes after the selected block, and at the end of an empty
 *   page, named first. A panel that placed it anywhere else stores another
 *   shape.
 * - A component inserted from Add and from Components, by click, by keyboard
 *   and by drag, lands in the same spot each time. A second placement path
 *   that drifted from Add's fails one of the six.
 * - Edit opens the component alone, saying how far a change reaches, and
 *   Back returns to the page with the panel still open.
 * - An author who may read components but not update them can place one and
 *   is offered no Edit.
 * - The panel meets WCAG 2.2 AA in light and dark.
 *
 * Each test makes its own components and page, named uniquely, so no lock is
 * needed.
 *
 * @module tests/builder-components-panel
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import {
  boxOf,
  clearSelection,
  layerRow,
  openLayers,
  pressSave,
  structure,
} from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { settleTransitions } from "./support/axe-scan.mjs";
import { signInAsLimitedUser, type LimitedUser } from "./support/limited-user";
import { fileAccount, test } from "./support/test";

const COMPONENTS = "/admin/api/collections/components/entries";
const PAGES = "/admin/api/collections/pages/entries";
const INSTANCE = "nextly/component-instance";
const AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const HEADING = "00000000-0000-4000-8000-00000000d001";
const SECTION = "00000000-0000-4000-8000-00000000d002";

function stamp(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** A published component holding one heading; answers its id. */
async function createComponent(
  request: APIRequestContext,
  title: string
): Promise<string> {
  const t = stamp();
  const created = await request.post(COMPONENTS, {
    data: {
      title,
      slug: `component-${t}`,
      status: "published",
      content: {
        formatVersion: 1,
        kind: "component",
        nodes: [
          {
            id: "inside",
            type: "core/heading",
            version: 1,
            props: { text: `Inside ${title}`, level: "h2" },
          },
        ],
      },
    },
  });
  expect(created.ok(), `creating ${title}: ${created.status()}`).toBe(true);
  return ((await created.json()) as { item: { id: string } }).item.id;
}

/** A draft page of a heading then a section, or of nothing; its id. */
async function createPage(
  request: APIRequestContext,
  empty = false
): Promise<string> {
  const t = stamp();
  const created = await request.post(PAGES, {
    data: {
      title: `Components panel ${t}`,
      slug: `components-panel-${t}`,
      status: "draft",
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: empty
          ? []
          : [
              {
                id: HEADING,
                type: "core/heading",
                version: 1,
                props: { text: "Components panel heading", level: "h2" },
              },
              {
                id: SECTION,
                type: "core/section",
                version: 1,
                props: { as: "section", contained: true },
                slots: { children: [] },
              },
            ],
      },
    },
  });
  expect(created.ok(), `creating the page: ${created.status()}`).toBe(true);
  return ((await created.json()) as { item: { id: string } }).item.id;
}

/** A published page placing the component, so a change to it reaches one. */
async function placeOnAPublishedPage(
  request: APIRequestContext,
  componentId: string
): Promise<void> {
  const t = stamp();
  const created = await request.post(PAGES, {
    data: {
      title: `Places it ${t}`,
      slug: `places-it-${t}`,
      status: "published",
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          { id: "placed", type: INSTANCE, version: 1, props: { componentId } },
        ],
      },
    },
  });
  expect(created.ok(), `creating the placing page: ${created.status()}`).toBe(
    true
  );
}

/** The page's stored top-level nodes, read back through the API. */
async function storedNodes(
  request: APIRequestContext,
  id: string
): Promise<{ type: string; props?: { componentId?: string } }[]> {
  const response = await request.get(`${PAGES}?status=draft&limit=100`);
  const body = (await response.json()) as {
    items: {
      id: string;
      content?: {
        nodes?: { type: string; props?: { componentId?: string } }[];
      };
    }[];
  };
  return body.items.find(item => item.id === id)?.content?.nodes ?? [];
}

/** What the page holds, as a type per block and the component it places. */
async function shape(request: APIRequestContext, id: string) {
  return (await storedNodes(request, id)).map(node =>
    node.type === INSTANCE ? `component:${node.props?.componentId}` : node.type
  );
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

async function openComponents(page: Page): Promise<void> {
  await openPanel(page, "Components");
  await expect(searchBox(page)).toBeVisible();
}

function searchBox(page: Page) {
  return page.getByRole("searchbox", { name: "Search components" });
}

/** The button that places a component from the Components panel. */
function row(page: Page, title: string) {
  return page
    .locator(".nx-components-panel")
    .getByRole("button", { name: title, exact: true });
}

/** Add's tile for a component. */
function tile(page: Page, title: string) {
  return page.getByRole("option", { name: title, exact: true });
}

async function selectHeading(page: Page): Promise<void> {
  const box = await boxOf(page, HEADING);
  await page.mouse.click(box.x + box.width - 8, box.y + box.height / 2);
}

/**
 * Drag an element onto the lower part of the heading, which drops after it:
 * pressed, moved past the drag threshold, then across in steps, as a hand.
 *
 * Level with the heading before it enters the canvas: a drag holds the place
 * it first aimed at until the pointer has travelled past a switch band, so a
 * path that crossed the end of the page on its way would keep that place.
 */
async function dragAfterHeading(page: Page, from: ReturnType<typeof row>) {
  const start = await from.boundingBox();
  if (start === null) throw new Error("[e2e] the row rendered no box");
  const x = start.x + start.width / 2;
  const y = start.y + start.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 24, y, { steps: 4 });
  const target = await boxOf(page, HEADING);
  const aimY = target.y + target.height * 0.8;
  await page.mouse.move(x + 24, aimY, { steps: 8 });
  await page.mouse.move(target.x + target.width / 2, aimY, { steps: 12 });
  await page.mouse.up();
}

test.describe("the Components panel", () => {
  test.describe.configure({ timeout: 240_000 });

  test("lists the site's components by name, and searches them", async ({
    page,
  }) => {
    const t = stamp();
    await createComponent(page.request, `Promo ${t}`);
    await createComponent(page.request, `Band ${t}`);
    const id = await createPage(page.request);
    await openBuilder(page, id);
    await openComponents(page);

    await expect(row(page, `Promo ${t}`)).toBeVisible({ timeout: 30_000 });
    await expect(row(page, `Band ${t}`)).toBeVisible();

    await searchBox(page).fill(`Promo ${t}`);
    await expect(row(page, `Promo ${t}`)).toBeVisible();
    await expect(row(page, `Band ${t}`)).toHaveCount(0);

    await searchBox(page).fill(`Nothing ${t}`);
    await expect(
      page.getByText(`No components match “Nothing ${t}”.`)
    ).toBeVisible();
  });

  test("says plainly when the site has no components", async ({ page }) => {
    // The suite's database is shared with every other spec, which makes
    // components of its own, so the empty site is the library's answer: an
    // empty list, as the route gives a site with none.
    await page.route("**/library/components*", async route => {
      try {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            items: [],
            meta: { count: 0, truncated: false },
          }),
        });
      } catch {
        // The page closed under the request; nothing is waiting for it.
      }
    });
    const id = await createPage(page.request);
    await openBuilder(page, id);
    await openComponents(page);

    await expect(
      page.getByText("This site has no components yet.")
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("[data-component-row-place]")).toHaveCount(0);
  });

  test("places a component after the selected block, naming the place first", async ({
    page,
  }) => {
    const title = `Promo ${stamp()}`;
    const component = await createComponent(page.request, title);
    const id = await createPage(page.request);
    await openBuilder(page, id);
    await selectHeading(page);
    await openComponents(page);

    const line = page
      .locator(".nx-components-panel")
      .locator(".nx-insert-panel__placement");
    await expect(line).toHaveText("Adding after Heading");
    await row(page, title).click();
    await saveDraft(page);

    expect(await shape(page.request, id)).toEqual([
      "core/heading",
      `component:${component}`,
      "core/section",
    ]);
  });

  test("places a component at the end of an empty page", async ({ page }) => {
    const title = `Promo ${stamp()}`;
    const component = await createComponent(page.request, title);
    const id = await createPage(page.request, true);
    await openBuilder(page, id);
    await openComponents(page);

    await expect(
      page
        .locator(".nx-components-panel")
        .locator(".nx-insert-panel__placement")
    ).toHaveText("Adding at the end of the page");
    await row(page, title).click();
    await saveDraft(page);

    expect(await shape(page.request, id)).toEqual([`component:${component}`]);
  });

  for (const way of ["click", "keyboard"] as const) {
    test(`inserts from Add and from Components by ${way}, in the same spot`, async ({
      page,
    }) => {
      // One component from each panel, so the stored page says which landed
      // where.
      const t = stamp();
      const fromAdd = `Added ${t}`;
      const fromPanel = `Placed ${t}`;
      const addId = await createComponent(page.request, fromAdd);
      const panelId = await createComponent(page.request, fromPanel);
      const id = await createPage(page.request);
      await openBuilder(page, id);

      const before = (await structure(page)).length;
      // From Add, after the selected heading.
      await selectHeading(page);
      await openPanel(page, "Add");
      const combobox = page.getByRole("combobox", { name: "Insert a block" });
      await expect(combobox).toBeVisible();
      await combobox.fill(fromAdd);
      if (way === "click") await tile(page, fromAdd).click();
      else await combobox.press("Enter");
      // Drawn on the canvas before the next insert is aimed at the heading.
      await expect
        .poll(async () => (await structure(page)).length)
        .toBeGreaterThan(before);

      // From Components, after the heading selected again.
      await selectHeading(page);
      await openComponents(page);
      if (way === "click") {
        await row(page, fromPanel).click();
      } else {
        await searchBox(page).fill(fromPanel);
        await searchBox(page).press("ArrowDown");
        await expect(row(page, fromPanel)).toBeFocused();
        await page.keyboard.press("Enter");
      }
      await saveDraft(page);

      // Both right after the heading: the second pushed the first along.
      expect(await shape(page.request, id)).toEqual([
        "core/heading",
        `component:${panelId}`,
        `component:${addId}`,
        "core/section",
      ]);
    });
  }

  test("inserts from Add and from Components by drag, in the same spot", async ({
    page,
  }) => {
    // Each panel's drag onto its own copy of the same page, aimed at the same
    // point: a drag aims by the pointer alone, so nothing is selected, and no
    // block toolbar covers the heading it aims at.
    const t = stamp();
    const title = `Dragged ${t}`;
    const component = await createComponent(page.request, title);
    for (const from of ["Add", "Components"] as const) {
      const id = await createPage(page.request);
      await openBuilder(page, id);
      await clearSelection(page);
      if (from === "Add") {
        await openPanel(page, "Add");
        await page
          .getByRole("combobox", { name: "Insert a block" })
          .fill(title);
        await dragAfterHeading(page, tile(page, title));
      } else {
        await openComponents(page);
        await dragAfterHeading(page, row(page, title));
      }
      await saveDraft(page);

      expect(await shape(page.request, id), from).toEqual([
        "core/heading",
        `component:${component}`,
        "core/section",
      ]);
    }
  });

  test("Edit opens the component alone, says what it reaches, and Back returns", async ({
    page,
  }) => {
    const title = `Promo ${stamp()}`;
    const component = await createComponent(page.request, title);
    await placeOnAPublishedPage(page.request, component);
    const id = await createPage(page.request);
    await openBuilder(page, id);
    await openComponents(page);

    await page
      .getByRole("button", { name: `Edit ${title}`, exact: true })
      .click();

    await expect(page).toHaveURL(
      new RegExp(
        `/admin/collections/components/${component}/builder\\?field=content&return=`
      )
    );
    const banner = page.getByRole("region", { name: "Editing a component" });
    await expect(banner).toContainText(title);
    await expect(banner).toContainText(
      /Changes reach (at least )?the 1 document that places it\./
    );

    await banner.getByRole("button", { name: "Back" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/admin/collections/pages/${id}/builder\\?`)
    );
    await expect(banner).toHaveCount(0);
    // Where the author came from: the page, with Components still open.
    await expect(railButton(page, "Components")).toHaveAttribute(
      "aria-pressed",
      "true",
      { timeout: 30_000 }
    );
    await expect(searchBox(page)).toBeVisible();
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`meets WCAG 2.2 AA in ${scheme}`, async ({ page }) => {
      const title = `Promo ${stamp()}`;
      await createComponent(page.request, title);
      const id = await createPage(page.request);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await gotoAdmin(
        page,
        `/collections/pages/${id}/builder?field=content`,
        scheme
      );
      await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
        timeout: 60_000,
      });
      await openComponents(page);
      await expect(row(page, title)).toBeVisible({ timeout: 30_000 });
      await row(page, title).hover();
      await settleTransitions(page);

      const results = await new AxeBuilder({ page })
        .withTags(AA_TAGS)
        .analyze();
      expect(results.violations).toEqual([]);
    });
  }
});

test.describe("the Components panel, for an author who may not update components", () => {
  let admin: APIRequestContext;
  let author: LimitedUser;

  test.beforeAll(async ({ browser, playwright }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
    admin = await playwright.request.newContext({
      baseURL,
      storageState: await fileAccount(baseURL, testInfo),
    });
    author = await signInAsLimitedUser(browser, admin, baseURL, [
      "read-pages",
      "update-pages",
      "read-components",
    ]);
  });

  test.afterAll(async () => {
    await author?.context.close();
    await admin?.dispose();
  });

  test("can place a component and is offered no Edit", async () => {
    test.setTimeout(240_000);
    const title = `Promo ${stamp()}`;
    const component = await createComponent(admin, title);
    const id = await createPage(admin);
    const page = await author.context.newPage();
    await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
    // Selected in Layers: this author may not read the site's styles, so the
    // canvas is not drawn for them, and Layers is where they select.
    await openLayers(page);
    await expect(layerRow(page, HEADING)).toBeVisible({ timeout: 60_000 });
    await layerRow(page, HEADING).click();
    await openComponents(page);
    await expect(
      page
        .locator(".nx-components-panel")
        .locator(".nx-insert-panel__placement")
    ).toHaveText("Adding after Heading");

    await expect(row(page, title)).toBeVisible({ timeout: 30_000 });
    await expect(
      page.locator(".nx-components-panel").getByRole("button", {
        name: /^Edit /,
      })
    ).toHaveCount(0);

    await row(page, title).click();
    await saveDraft(page);
    expect(await shape(admin, id)).toEqual([
      "core/heading",
      `component:${component}`,
      "core/section",
    ]);
  });
});
