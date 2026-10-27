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
import { widestSizeOf } from "./support/dashboard-sizes";
import { LOCK } from "./support/locks";

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ lock: [LOCK.dashboard] });

const CARD = "style-fixture/recent";
const TITLE = "Fixture recent posts";

interface Layout {
  version: number;
  scope: string;
  placements: Array<{
    id: string;
    widgetId: string;
    w: number;
    h: number;
    removed?: boolean;
    config?: Record<string, unknown>;
  }>;
}

async function readLayout(page: Page): Promise<Layout> {
  const read = await page.request.get("/admin/api/dashboard/layout");
  expect(read.ok()).toBe(true);
  return (await read.json()) as Layout;
}

/** Put the settings card on the reader's dashboard, as wide as it may be, at its defaults. */
async function placeCard(page: Page): Promise<void> {
  const layout = await readLayout(page);
  const others = layout.placements.filter(p => p.widgetId !== CARD);
  const write = await page.request.put("/admin/api/dashboard/layout", {
    data: {
      placements: [
        {
          id: "e2e-settings",
          widgetId: CARD,
          ...(await widestSizeOf(page, CARD)),
          removed: false,
        },
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

/** The write that keeps a card's settings. */
const isSettingsWrite = (request: Request) =>
  request.method() === "PUT" && request.url().includes("/api/dashboard/layout");

/**
 * Every request the page sends from now on, in the order it sent them, so a test can ask what
 * went out after a given one. Order, not time: what a write causes is sent after the write, on
 * any machine, while a read the page started for another reason before it is not the write's
 * doing and is not counted against it.
 */
function watchRequests(page: Page): Request[] {
  const sent: Request[] = [];
  page.on("request", request => sent.push(request));
  return sent;
}

/** The widget queries sent after the first settings write, or none if no write was sent. */
function queriesAfterWrite(sent: readonly Request[]): Request[] {
  const write = sent.findIndex(isSettingsWrite);
  return write === -1 ? [] : sent.slice(write + 1).filter(isQuery);
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
    const sent = watchRequests(page);

    const accent = cell(page).getByRole("combobox", {
      name: `Accent for ${TITLE}`,
    });
    await accent.click();
    await page.getByRole("option", { name: "Bold" }).click();

    await expect(page.getByTestId("widget-grid-live")).toHaveText(
      `${TITLE}: Accent set to Bold.`
    );
    // The setting was kept by its write, so what it asked again went out after that write.
    expect(sent.some(isSettingsWrite), "the setting's write was sent").toBe(
      true
    );
    // Only this card may be asked again for its own setting, never another card: each request
    // sent after the write carries this card's question alone.
    const asked = queriesAfterWrite(sent).map(
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

  test("keeps Done within reach on a short phone screen, where the form is taller than it", async ({
    page,
  }) => {
    // 🔴 The sheet's base is not a flex box, so the area below its header took its own height and
    // ran past the screen with nothing to scroll: on a phone the footer, Done included, was off
    // the bottom and out of reach. The area now scrolls inside the sheet, so Done can be brought
    // into view, and pressing it keeps the change.
    await page.setViewportSize({ width: 390, height: 400 });
    await page.reload();
    await expect(rows(page)).toHaveCount(3);
    const sheet = await openSettings(page);
    await chooseRows(sheet, 2);
    const done = sheet.getByRole("button", { name: "Done" });
    // Guards the guard: Done must start below the screen, or it is in view whatever the sheet's
    // layout does, and this test would pass on the old one.
    const startsBelow = await done.evaluate(
      element => element.getBoundingClientRect().bottom > window.innerHeight
    );
    expect(startsBelow, "Done must start below the screen").toBe(true);
    await done.scrollIntoViewIfNeeded();
    await expect(done).toBeInViewport();
    await done.click();
    await expect(sheet).toBeHidden();
    await expect(rows(page)).toHaveCount(2);
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
