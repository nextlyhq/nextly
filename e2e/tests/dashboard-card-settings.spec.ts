/**
 * A card's settings in a browser: the quick setting on the card, saved at once for the reader
 * and announced, at each reference width; the quick popover, opened from the card's title,
 * applying a change at once with Undo; the card menu at rest, with Settings, Size, Refresh and
 * Remove; and the More settings panel, opened through the popover's More settings, beside a
 * dashboard that stays usable, with a live preview at the card's own tier, saving on Done at
 * rest (the card's own title with it), restoring on Cancel, and holding its change with the
 * dashboard's other unsaved changes while customising.
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
    title?: string;
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
 * The rows drawn inside `within`, however the card draws them: a list's entity rows at the medium
 * tier, a table's rows at the large one, which is what a full card on a wide dashboard is. Read
 * by the list card's own row hooks, which every list card draws through.
 */
function rowsIn(within: Locator) {
  return within.locator(
    '[data-testid="entity-row"], [data-testid="list-card-table-row"]'
  );
}

/** The card's own placement, as the reader's stored layout holds it now. */
async function storedCard(page: Page) {
  return (await readLayout(page)).placements.find(p => p.id === "e2e-settings");
}

/** The card's quick popover, opened from the card's title. */
async function openPopover(page: Page) {
  await cell(page).getByRole("button", { name: TITLE, exact: true }).click();
  const popover = page.getByRole("dialog", {
    name: `Quick settings for ${TITLE}`,
  });
  await expect(popover).toBeVisible();
  return popover;
}

/** The card's menu at rest, opened. */
async function openCardMenu(page: Page) {
  await cell(page)
    .getByRole("button", { name: `Card menu for ${TITLE}` })
    .click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
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
  test(`the quick setting saves at once, asks no other card, and is said once (${viewport.name})`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.reload();
    await expect(rows(page)).toHaveCount(3);
    const sent = watchRequests(page);

    // A choice of two is drawn as a segmented control: both options in view.
    const accent = cell(page).getByRole("radiogroup", {
      name: `Accent for ${TITLE}`,
    });
    await accent.getByRole("radio", { name: "Bold" }).click();

    // Said once, by the toast that offers its Undo; the grid's own live region stays silent.
    await expect(page.getByText(`${TITLE}: Accent set to Bold.`)).toBeVisible();
    await expect(page.getByTestId("widget-grid-live")).not.toHaveText(
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
        (request.postDataJSON() as { queries?: Array<{ widget?: string }> })
          .queries ?? []
    );
    // A declared widget's card is asked for by its widget's id.
    expect(
      asked.filter(
        queries => queries.length !== 1 || queries[0]?.widget !== CARD
      ),
      `requests that asked other cards: ${JSON.stringify(asked)}`
    ).toEqual([]);

    // Saved for this reader: it is there after a reload.
    await page.reload();
    await expect(
      cell(page)
        .getByRole("radiogroup", { name: `Accent for ${TITLE}` })
        .getByRole("radio", { name: "Bold" })
    ).toHaveAttribute("aria-checked", "true");
  });
}

for (const viewport of WIDTHS) {
  test(`the quick popover applies a change at once, and Undo puts back the value before it (${viewport.name})`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.reload();
    await expect(rows(page)).toHaveCount(3);
    const sent = watchRequests(page);

    const popover = await openPopover(page);
    const accent = popover.getByRole("combobox", { name: "Accent" });
    await expect(accent).toHaveText(/Plain/);
    await accent.click();
    await page.getByRole("option", { name: "Bold" }).click();

    // Written on the change itself, with the popover still open and the card in view beside it.
    await expect.poll(() => sent.filter(isSettingsWrite).length).toBe(1);
    await expect(popover).toBeVisible();
    await expect(cell(page)).toBeInViewport({ ratio: 0.25 });
    await expect
      .poll(async () => (await storedCard(page))?.config)
      .toEqual({
        accent: "bold",
      });

    // Undo writes back what the card had just before the change: no setting of its own.
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect
      .poll(async () => (await storedCard(page))?.config ?? {})
      .toEqual({});
    await page.reload();
    // The header draws a choice of two as a segmented control.
    await expect(
      cell(page)
        .getByRole("radiogroup", { name: `Accent for ${TITLE}` })
        .getByRole("radio", { name: "Plain" })
    ).toHaveAttribute("aria-checked", "true");
  });
}

test.describe("the quick popover and the card menu at rest", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload();
    await expect(rows(page)).toHaveCount(3);
  });

  test("Escape closes the popover, and focus goes back to the title", async ({
    page,
  }) => {
    const popover = await openPopover(page);
    // Focus moves into the popover as it opens.
    await expect(
      popover.getByRole("combobox", { name: "Accent" })
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(popover).toBeHidden();
    await expect(
      cell(page).getByRole("button", { name: TITLE, exact: true })
    ).toBeFocused();
  });

  test("Settings in the card menu opens the popover, and Escape returns to the menu's button", async ({
    page,
  }) => {
    const menu = await openCardMenu(page);
    await menu.getByRole("menuitem", { name: "Settings…" }).click();
    const popover = page.getByRole("dialog", {
      name: `Quick settings for ${TITLE}`,
    });
    await expect(popover).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(popover).toBeHidden();
    await expect(
      cell(page).getByRole("button", { name: `Card menu for ${TITLE}` })
    ).toBeFocused();
  });

  test("the card menu lists Settings, Size, Refresh and Remove, in that order", async ({
    page,
  }) => {
    const menu = await openCardMenu(page);
    const items = (await menu.getByRole("menuitem").allTextContents()).map(
      item => item.trim()
    );
    // The fixture's card has one height, so its Size is its width alone.
    expect(items).toEqual([
      "Settings…",
      expect.stringMatching(/^Width/),
      "Refresh",
      "Remove",
    ]);
  });

  test("Size in the card menu saves the card's width at once, and Undo puts it back", async ({
    page,
  }) => {
    const before = await storedCard(page);
    const menu = await openCardMenu(page);
    // By keyboard: a pointer travelling from the submenu's trigger to its item crosses the menu
    // and can close the submenu under it, which no reader's pointer does.
    await menu.getByRole("menuitem", { name: /^Width/ }).press("ArrowRight");
    const half = page.getByRole("menuitemradio", {
      name: "Half width, 6 columns",
    });
    await expect(half).toBeVisible();
    await half.press("Enter");
    await expect.poll(async () => (await storedCard(page))?.w).toBe(6);

    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(async () => (await storedCard(page))?.w).toBe(before?.w);
  });

  test("Remove in the card menu asks nothing, and Undo puts the card back", async ({
    page,
  }) => {
    const menu = await openCardMenu(page);
    await menu.getByRole("menuitem", { name: "Remove" }).click();
    await expect(cell(page)).toBeHidden();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    // The card was placed by a layout write, so this reader has an arrangement, and Remove takes
    // the card out of it rather than marking it removed.
    await expect.poll(async () => await storedCard(page)).toBeUndefined();

    await page.getByRole("button", { name: `Undo removing ${TITLE}` }).click();
    await expect(cell(page)).toBeVisible();
    await expect
      .poll(async () => (await storedCard(page))?.removed)
      .toBe(false);
  });
});

test.describe("the settings sheet", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload();
    await expect(rows(page)).toHaveCount(3);
  });

  async function openSettings(page: Page) {
    // Settings opens the card's quick popover, and its More settings the sheet.
    const menu = await openCardMenu(page);
    await menu.getByRole("menuitem", { name: "Settings…" }).click();
    const popover = page.getByRole("dialog", {
      name: `Quick settings for ${TITLE}`,
    });
    await popover.getByRole("button", { name: "More settings" }).click();
    const sheet = page.getByRole("dialog", { name: `${TITLE} settings` });
    await expect(sheet).toBeVisible();
    return sheet;
  }

  async function chooseRows(sheet: ReturnType<Page["getByRole"]>, n: number) {
    const field = sheet.getByRole("spinbutton", { name: /Rows/ });
    await field.fill(String(n));
    await field.press("Tab");
  }

  test("leaves the dashboard usable beside it, and previews the card at the tier its width gives it", async ({
    page,
  }) => {
    const sheet = await openSettings(page);
    const box = await sheet.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(480);
    expect(box?.width).toBeLessThanOrEqual(560);
    // The card is as wide as it may be on a 1,440 px dashboard: drawn large, scaled to fit.
    const card = cell(page).locator("[data-tier]").first();
    await expect(card).toHaveAttribute("data-tier", "large");
    const preview = sheet.getByTestId("settings-preview");
    await expect(preview.locator("[data-tier]").first()).toHaveAttribute(
      "data-tier",
      "large"
    );
    expect(Number(await preview.getAttribute("data-scale"))).toBeLessThan(1);
    // Not modal: the card behind it can still be reached, and reaching it keeps the panel open.
    // Found by its test id, not its name, which follows the card's title.
    await cell(page).getByTestId("card-menu").click();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeVisible();
  });

  test("keeps the card's own title on Done, and draws the card under it", async ({
    page,
  }) => {
    const sheet = await openSettings(page);
    await sheet.getByLabel("Title").fill("  Posts to review ");
    await sheet.getByRole("button", { name: "Done" }).click();
    await expect(sheet).toBeHidden();
    // The card's own region, found within its cell, is now named by the reader's title.
    await expect(cell(page).getByRole("region").first()).toHaveAccessibleName(
      /^Posts to review/
    );
    expect((await storedCard(page))?.title).toBe("Posts to review");
  });

  test("shows the card at the top of the panel, as the panel's values would draw it", async ({
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
    // Settings opens the card's quick popover, and its More settings the sheet.
    await page
      .getByRole("dialog", { name: `Quick settings for ${TITLE}` })
      .getByRole("button", { name: "More settings" })
      .click();
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
