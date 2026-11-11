/**
 * The add panel in a browser: one list under a focused search, cards added by keyboard with the
 * panel open throughout, Count added three times by a reader who may read two collections, the
 * collection widgets offered without Add to a reader who may read none, and an axe scan of the
 * open panel in both themes.
 *
 * jsdom draws no layout and runs no real query, so the component tests can say what each control
 * does but not that a card lands on the dashboard, ringed and in view, with the settings it
 * started on, nor that the server offers what the panel lists.
 *
 * Each test returns its reader to the default dashboard when it ends, so a test that fails half
 * way leaves the next spec the dashboard a new site has.
 *
 * @module tests/dashboard-gallery.spec
 */
import {
  expect,
  type Browser,
  type Locator,
  type Page,
  type PlaywrightWorkerArgs,
  type TestInfo,
} from "@playwright/test";

import { gotoAdmin, type Theme } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { resetToDefault } from "./support/dashboard-layout";
import { signInAsLimitedUser, type LimitedUser } from "./support/limited-user";
import { LOCK } from "./support/locks";
import { fileAccount, test } from "./support/test";

// Shares the dashboard with other specs, and makes roles and users; see support/locks.ts.
test.describe.configure({ lock: [LOCK.dashboard, LOCK.usersRoles] });

const CELLS = '[data-testid^="widget-cell-"]';
const COUNT_CELLS = '[data-testid="widget-cell-core/count"]';

/** The widgets that read a collection. */
const COLLECTION_WIDGETS = [
  "core/count",
  "core/recent-entries",
  "core/over-time",
  "core/breakdown",
] as const;

interface LayoutRead {
  placements: Array<{
    widgetId: string;
    removed?: boolean;
    title?: string;
    config?: Record<string, unknown>;
  }>;
}

const bar = (page: Page) =>
  page.getByRole("group", { name: "Customize dashboard" });

/** The dashboard in customise mode, its add panel open, focus in its search. */
async function openPanel(page: Page, theme: Theme = "light") {
  await gotoAdmin(page, "/", theme);
  await expect(page.getByTestId("dashboard-edit-begin")).toBeVisible();
  await page.getByTestId("dashboard-edit-begin").click();
  return reopenPanel(page);
}

/** The add panel opened again from the bar, its list drawn, focus in its search. */
async function reopenPanel(page: Page): Promise<Locator> {
  await bar(page).getByRole("button", { name: "Add widget" }).click();
  const panel = page.getByRole("dialog", { name: "Add widget" });
  await expect(
    panel.getByRole("searchbox", { name: "Search widgets" })
  ).toBeFocused();
  await expect(panel.getByTestId("add-panel-list")).toBeVisible();
  return panel;
}

/** The reader's saved layout. */
async function savedLayout(page: Page): Promise<LayoutRead> {
  const read = await page.request.get("/admin/api/dashboard/layout");
  expect(read.ok(), await read.text()).toBe(true);
  return (await read.json()) as LayoutRead;
}

/** A reader who may do only `permissions`, signed in with a context of their own. */
async function limitedReader(
  browser: Browser,
  playwright: PlaywrightWorkerArgs["playwright"],
  testInfo: TestInfo,
  permissions: readonly string[]
): Promise<LimitedUser> {
  const baseURL = testInfo.project.use.baseURL;
  if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
  const admin = await playwright.request.newContext({
    baseURL,
    storageState: await fileAccount(baseURL, testInfo),
  });
  try {
    return await signInAsLimitedUser(browser, admin, baseURL, permissions);
  } finally {
    await admin.dispose();
  }
}

test.describe("as the site's administrator", () => {
  test.afterEach(async ({ page }) => {
    await resetToDefault(page);
  });

  test("is one list under a focused search: no Suggested, Removed or chips, each row with its icon, name, one line and Add", async ({
    page,
  }) => {
    const panel = await openPanel(page);
    await expect(panel.getByTestId("add-panel-count")).toHaveText(
      /^\d+ widgets$/
    );
    // One list: no group headings, no filter chips, no second step.
    await expect(panel.getByRole("heading", { level: 3 })).toHaveCount(0);
    await expect(panel.getByRole("group")).toHaveCount(0);
    await expect(panel.getByRole("combobox")).toHaveCount(0);

    const count = panel.getByTestId("add-panel-row-core/count");
    await expect(count).toContainText("Count");
    await expect(count.locator("svg").first()).toBeVisible();
    await expect(
      count.getByRole("button", { name: "Add Count" })
    ).toBeVisible();
    // The collection cards come first.
    await expect(
      panel.locator('[data-testid^="add-panel-row-"]').first()
    ).toHaveAttribute("data-testid", "add-panel-row-core/count");
    // A plugin's widget names its plugin, as the admin's plugin catalogue knows it, else by its
    // package name.
    await expect(panel.getByTestId("add-panel-row-seo/issues")).toContainText(
      "SEO plugin"
    );
    await expect(
      panel.getByTestId("add-panel-row-widget-kit-fixture/kit")
    ).toContainText("widget-kit-fixture plugin");
    // A one-card widget on the default dashboard says so, with nothing to add.
    await expect(
      panel.getByTestId("add-panel-on-dashboard-core/team-activity")
    ).toHaveText("On dashboard");
  });

  test("a keyboard alone adds two cards with the panel open throughout, then lands on the last one", async ({
    page,
  }) => {
    await gotoAdmin(page, "/");
    const begin = page.getByTestId("dashboard-edit-begin");
    await begin.focus();
    await page.keyboard.press("Enter");
    const addWidget = bar(page).getByRole("button", { name: "Add widget" });
    await addWidget.focus();
    await page.keyboard.press("Enter");
    const panel = page.getByRole("dialog", { name: "Add widget" });
    const search = panel.getByRole("searchbox", { name: "Search widgets" });
    await expect(search).toBeFocused();
    const before = await page.locator(CELLS).count();

    await page.keyboard.type("note");
    const live = panel.getByTestId("add-panel-live");
    await expect(live).toHaveText("1 widget.");
    // The one row's Add is the next stop after the search.
    await page.keyboard.press("Tab");
    const add = panel.getByRole("button", { name: "Add Note" });
    await expect(add).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator(CELLS)).toHaveCount(before + 1);
    await expect(live).toHaveText("Added Note.");
    await expect(add).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator(CELLS)).toHaveCount(before + 2);
    await expect(panel).toBeVisible();

    // Closed: focus on the last card's menu, the card ringed and in view at the end.
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    const last = page.locator(CELLS).last();
    await expect(last).toHaveAttribute("data-testid", "widget-cell-core/note");
    await expect(last).toHaveAttribute("data-highlighted", /.*/);
    await expect(last).toBeInViewport();
    await expect(last.getByTestId("card-actions")).toBeFocused();
  });

  test("says when nothing matches", async ({ page }) => {
    const panel = await openPanel(page);
    await panel.getByRole("searchbox", { name: "Search widgets" }).fill("zzzz");
    await expect(panel.getByTestId("add-panel-none")).toHaveText(
      "No widget matches. Try another word."
    );
    await expect(panel.getByTestId("add-panel-count")).toHaveText("0 widgets");
  });

  for (const theme of ["light", "dark"] as const) {
    test(`the open panel has no AA violations (${theme})`, async ({ page }) => {
      await openPanel(page, theme);
      await expectNoAxeViolations(page, {
        include: '[data-testid="add-widget-panel"]',
      });
    });
  }
});

test.describe("a reader who may read two collections", () => {
  test.describe.configure({ mode: "serial" });

  let limited: LimitedUser;
  let page: Page;

  test.beforeAll(async ({ browser, playwright }, testInfo) => {
    limited = await limitedReader(browser, playwright, testInfo, [
      "read-posts",
      "read-tags",
    ]);
    page = await limited.context.newPage();
  });

  test.afterAll(async () => {
    await limited?.context.close();
  });

  test("adds Count three times: two collections, then a third card that must be told apart", async () => {
    const panel = await openPanel(page);
    const add = () => panel.getByRole("button", { name: "Add Count" }).click();

    // The first two start on each collection in turn.
    await add();
    await expect(page.locator(COUNT_CELLS)).toHaveCount(1);
    await add();
    await expect(page.locator(COUNT_CELLS)).toHaveCount(2);

    // The third matches one: the panel gives way to its settings, and Save is refused until
    // something tells it apart.
    await add();
    await expect(panel).toBeHidden();
    const drawer = page.getByTestId("widget-settings-drawer");
    await expect(drawer).toBeVisible();
    await expect(page.locator(COUNT_CELLS)).toHaveCount(3);
    await expect(
      page.getByText(
        "Count added. Every collection already has one, so pick its settings."
      )
    ).toBeVisible();
    await drawer.getByRole("button", { name: "Save" }).click();
    await expect(drawer).toContainText(
      "This matches a card you already have. Change a setting first."
    );
    await expect(drawer).toBeVisible();

    // Closed unsaved, it is taken back off.
    await drawer.getByRole("button", { name: "Cancel" }).click();
    await expect(drawer).toBeHidden();
    await expect(page.locator(COUNT_CELLS)).toHaveCount(2);

    // Again, told apart by a title of its own: kept.
    await reopenPanel(page);
    await add();
    await expect(drawer).toBeVisible();
    await drawer.getByLabel("Title").fill("Third count");
    await drawer.getByRole("button", { name: "Save" }).click();
    await expect(drawer).toBeHidden();
    await expect(page.locator(COUNT_CELLS)).toHaveCount(3);

    await page.getByTestId("dashboard-edit-save").click();
    await expect(bar(page)).toBeHidden();
    const counts = (await savedLayout(page)).placements.filter(
      card => card.widgetId === "core/count" && card.removed !== true
    );
    expect(
      counts
        .map(card => card.config?.collection)
        .slice(0, 2)
        .sort()
    ).toEqual(["posts", "tags"]);
    expect(counts[2]).toMatchObject({ title: "Third count" });
    await resetToDefault(page);
  });
});

test.describe("a reader who may read no collection", () => {
  test.describe.configure({ mode: "serial" });

  let limited: LimitedUser;
  let page: Page;

  test.beforeAll(async ({ browser, playwright }, testInfo) => {
    limited = await limitedReader(browser, playwright, testInfo, [
      "read-media",
    ]);
    page = await limited.context.newPage();
  });

  test.afterAll(async () => {
    await limited?.context.close();
  });

  test("is offered the widgets that read one without Add, and the others with it", async () => {
    const panel = await openPanel(page);
    for (const id of COLLECTION_WIDGETS) {
      const row = panel.getByTestId(`add-panel-row-${id}`);
      await expect(row, id).toContainText("Needs a collection you can read");
      await expect(row.getByRole("button"), id).toHaveCount(0);
    }
    await expect(panel.getByRole("button", { name: "Add Note" })).toBeEnabled();
  });
});
