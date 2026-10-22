/**
 * A card's settings in a browser: the quick setting on the card, saved at once for the reader
 * and announced, at each reference width; and the settings sheet opened from the card menu,
 * beside a live preview, saving on Done at rest, restoring on Cancel, and holding its change
 * with the dashboard's other unsaved changes while customising.
 *
 * Drawn with the style fixture's settings card (`style-fixture/recent`), which the suite's
 * server switches on: a list of posts with a Rows setting and one quick setting, Accent. No
 * built-in widget offers a quick setting yet. The card is placed by each test, so no other
 * spec's dashboard carries it.
 */
import {
  expect,
  type Locator,
  type Page,
  type Request,
} from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const CARD = "style-fixture/recent";
const TITLE = "Fixture recent posts";

interface Layout {
  version: number;
  scope: string;
  placements: Array<{
    id: string;
    widgetId: string;
    width: string;
    removed?: boolean;
    config?: Record<string, unknown>;
  }>;
}

async function readLayout(page: Page): Promise<Layout> {
  const read = await page.request.get("/admin/api/dashboard/layout");
  expect(read.ok()).toBe(true);
  return (await read.json()) as Layout;
}

/** Put the settings card on the reader's dashboard, full width, at its defaults. */
async function placeCard(page: Page): Promise<void> {
  const layout = await readLayout(page);
  const others = layout.placements.filter(p => p.widgetId !== CARD);
  const write = await page.request.put("/admin/api/dashboard/layout", {
    data: {
      placements: [
        { id: "e2e-settings", widgetId: CARD, width: "full", removed: false },
        ...others,
      ],
      version: layout.version,
      scope: layout.scope,
    },
  });
  expect(write.ok()).toBe(true);
}

/** At least `count` posts, so the card has rows for its Rows setting to limit. */
async function enoughPosts(page: Page, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    const created = await page.request.post(
      "/admin/api/collections/posts/entries",
      {
        data: {
          title: `Settings post ${i}`,
          slug: `settings-${Date.now()}-${i}`,
        },
      }
    );
    expect(created.ok()).toBe(true);
  }
}

function cell(page: Page) {
  return page.getByTestId(`widget-cell-${CARD}`);
}

/**
 * The rows drawn inside `within`, however the card draws them: a list at the medium tier, a table
 * at the large one, which is what a full card on a wide dashboard is.
 */
function rowsIn(within: Locator) {
  return within.locator('[data-testid="widget-list"] > li, table tbody tr');
}

/** The rows the card draws. */
function rows(page: Page) {
  return rowsIn(cell(page));
}

/** A widget query the dashboard sends. */
const isQuery = (request: Request) =>
  request.url().includes("/api/dashboard/query");

/** A card body the reader is told is still being read. */
const busyCards = (page: Page) =>
  page.locator('[data-testid="widget-card-body"][aria-busy="true"]');

/**
 * Give the page focus, and let what focus starts finish. The dashboard reads every card again
 * when its window gains focus, by design, and a test's first click is what first focuses the
 * page; watched from before it, that read would be counted as caused by whatever was clicked.
 *
 * Finished means what the reader sees: no card is marked busy. The read focus starts is caught
 * first, when there is one, because a card is marked busy only once React draws the read, and
 * an assertion made in that gap would pass before the read had begun. (Not `networkidle`: the
 * dev server holds a long poll open, so the page never goes idle.)
 */
async function focusPage(page: Page): Promise<void> {
  const focusRead = page
    .waitForRequest(isQuery, { timeout: 1_000 })
    .catch(() => undefined);
  await page.getByRole("heading", { level: 1 }).first().click();
  await (await focusRead)?.response();
  await expect(busyCards(page)).toHaveCount(0);
}

/** Every widget query the dashboard sends from now on. */
function watchQueries(page: Page): Request[] {
  const sent: Request[] = [];
  page.on("request", request => {
    if (isQuery(request)) sent.push(request);
  });
  return sent;
}

test.beforeEach(async ({ page }) => {
  await gotoAdmin(page, "/");
  await enoughPosts(page, 4);
  await placeCard(page);
});

test.afterEach(async ({ page }) => {
  const body = await readLayout(page);
  if (body.version === 0) return;
  await page.request.delete(
    `/admin/api/dashboard/layout?version=${body.version}&scope=${encodeURIComponent(body.scope)}`
  );
});

const WIDTHS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "820", width: 820, height: 1180 },
  { name: "phone 390", width: 390, height: 844 },
];

for (const viewport of WIDTHS) {
  test(`the quick setting saves at once, asks no other card, and is announced (${viewport.name})`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.reload();
    await expect(rows(page)).toHaveCount(3);
    await focusPage(page);
    const sent = watchQueries(page);

    const accent = cell(page).getByRole("combobox", {
      name: `Accent for ${TITLE}`,
    });
    await accent.click();
    await page.getByRole("option", { name: "Bold" }).click();

    await expect(page.getByTestId("widget-grid-live")).toHaveText(
      `${TITLE}: Accent set to Bold.`
    );
    // Only this card may be asked again for its own setting, never another card: each request
    // sent carries this card's question alone.
    const asked = sent.map(
      request =>
        (request.postDataJSON() as { queries?: Array<{ source?: string }> })
          .queries ?? []
    );
    expect(
      asked.filter(
        queries =>
          queries.length !== 1 || queries[0]?.source !== "collection:posts"
      ),
      `requests that asked other cards: ${JSON.stringify(asked)}`
    ).toEqual([]);

    // Saved for this reader: it is there after a reload.
    await page.reload();
    await expect(
      cell(page).getByRole("combobox", { name: `Accent for ${TITLE}` })
    ).toHaveText(/Bold/);
  });
}

test.describe("the settings sheet", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload();
    await expect(rows(page)).toHaveCount(3);
  });

  async function openSettings(page: Page) {
    await cell(page)
      .getByRole("button", { name: `Card menu for ${TITLE}` })
      .click();
    await page.getByRole("menuitem", { name: "Settings…" }).click();
    const sheet = page.getByRole("dialog", { name: `${TITLE} settings` });
    await expect(sheet).toBeVisible();
    return sheet;
  }

  async function chooseRows(sheet: ReturnType<Page["getByRole"]>, n: number) {
    const field = sheet.getByRole("spinbutton", { name: /Rows/ });
    await field.fill(String(n));
    await field.press("Tab");
  }

  test("shows the card beside the form, as the form's values would draw it", async ({
    page,
  }) => {
    const sheet = await openSettings(page);
    const preview = sheet.getByRole("region", { name: `Preview of ${TITLE}` });
    await expect(rowsIn(preview)).toHaveCount(3);
    await chooseRows(sheet, 2);
    await expect(rowsIn(preview)).toHaveCount(2);
    // The card itself is unchanged until Done.
    await expect(rows(page)).toHaveCount(3);
  });

  test("Cancel leaves the card as it was", async ({ page }) => {
    let sheet = await openSettings(page);
    await chooseRows(sheet, 2);
    await sheet.getByRole("button", { name: "Cancel" }).click();
    await expect(sheet).toBeHidden();
    await expect(rows(page)).toHaveCount(3);
    sheet = await openSettings(page);
    await expect(sheet.getByRole("spinbutton", { name: /Rows/ })).toHaveValue(
      "3"
    );
  });

  test("Done at rest saves the change for the reader at once", async ({
    page,
  }) => {
    const sheet = await openSettings(page);
    await chooseRows(sheet, 2);
    await sheet.getByRole("button", { name: "Done" }).click();
    await expect(sheet).toBeHidden();
    await expect(rows(page)).toHaveCount(2);
    await page.reload();
    await expect(rows(page)).toHaveCount(2);
  });

  test("Done while customising holds the change until the dashboard is saved", async ({
    page,
  }) => {
    const begin = page.getByTestId("dashboard-edit-begin");
    await begin.click();
    const bar = page.getByRole("group", { name: "Customize your dashboard" });
    await expect(bar).toBeVisible();

    const writes: Request[] = [];
    page.on("request", request => {
      if (
        request.method() === "PUT" &&
        request.url().includes("/api/dashboard/layout")
      ) {
        writes.push(request);
      }
    });
    await page
      .getByRole("button", { name: `Card actions for ${TITLE}` })
      .click();
    await page.getByRole("menuitem", { name: "Settings" }).click();
    const sheet = page.getByRole("dialog", { name: `${TITLE} settings` });
    await chooseRows(sheet, 2);
    await sheet.getByRole("button", { name: "Done" }).click();
    await expect(sheet).toBeHidden();
    await expect(bar.getByText("Unsaved changes")).toBeVisible();
    expect(writes).toEqual([]);

    await bar.getByRole("button", { name: "Save" }).click();
    await expect(bar).toBeHidden();
    expect(writes).toHaveLength(1);
    await page.reload();
    await expect(rows(page)).toHaveCount(2);
  });
});
