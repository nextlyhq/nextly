/**
 * A card's settings in a browser: the quick setting on the card's header, saved at once for the
 * reader and announced, at each reference width; a click on the card's title opening nothing;
 * the card menu at rest, with Settings…, Refresh and Remove; and the one settings drawer, opened
 * from Settings…, beside a dashboard that stays usable, with a live preview at the card's own
 * tier, the card untouched until Save, saving on Save at rest (its width and its own title with
 * it) so it stays after a reload, discarding on Cancel, and staging its change with the
 * dashboard's other unsaved changes while customising.
 *
 * Drawn with the style fixture's settings card (`style-fixture/recent`), which the suite's
 * server switches on: a list of posts with a Rows setting (keyed `limit`, so drawn as a choice of
 * 5, 10 or 20 beside its stored 3) and one quick setting, Accent. The card is placed by each test,
 * so no other spec's dashboard carries it.
 */
import {
  expect,
  type Locator,
  type Page,
  type Request,
} from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { ownSeat, test } from "./support/test";
import { widestSizeOf } from "./support/dashboard-sizes";
import { LOCK } from "./support/locks";
import { resetToDefault } from "./support/dashboard-layout";

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

// A test here spends about fifty REST reads (two dashboard loads, and the layout reads around
// them), so the file's sixteen run through four seats (`ownSeat`), none spending more than about
// 300 of its 500 a minute. The first group, the quick setting at each width, keeps seat 0.

test.beforeEach(async ({ page }) => {
  await gotoAdmin(page, "/");
  await enoughPosts(page, 4);
  await placeCard(page);
});

// Asserted: a reset that fails names itself here, not as a later spec's stray card.
test.afterEach(async ({ page }) => {
  await resetToDefault(page);
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

test.describe("the card's title and the card menu at rest", () => {
  ownSeat(2);

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload();
    await expect(rows(page)).toHaveCount(3);
  });

  test("a click on the card's title opens nothing", async ({ page }) => {
    const heading = cell(page).getByRole("heading", { name: TITLE });
    await expect(heading.getByRole("button")).toHaveCount(0);
    await heading.click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("Settings… in the card menu opens the drawer, and Escape returns to the menu's button", async ({
    page,
  }) => {
    const menu = await openCardMenu(page);
    await menu.getByRole("menuitem", { name: "Settings…" }).click();
    const drawer = page.getByRole("dialog", { name: TITLE });
    await expect(drawer).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(
      cell(page).getByRole("button", { name: `Card menu for ${TITLE}` })
    ).toBeFocused();
  });

  test("the card menu lists Settings…, Refresh and Remove, in that order, and no size", async ({
    page,
  }) => {
    const menu = await openCardMenu(page);
    const items = (await menu.getByRole("menuitem").allTextContents()).map(
      item => item.trim()
    );
    expect(items).toEqual(["Settings…", "Refresh", "Remove"]);
    await expect(menu.getByRole("menuitemradio")).toHaveCount(0);
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

test.describe("the settings drawer", () => {
  ownSeat(3);

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload();
    await expect(rows(page)).toHaveCount(3);
  });

  async function openSettings(page: Page) {
    const menu = await openCardMenu(page);
    await menu.getByRole("menuitem", { name: "Settings…" }).click();
    const drawer = page.getByRole("dialog", { name: TITLE });
    await expect(drawer).toBeVisible();
    await expect(
      drawer.getByRole("radiogroup", { name: "Width" })
    ).toBeVisible();
    return drawer;
  }

  /** The drawer's Rows, a choice of 5, 10 or 20 beside the card's stored 3. */
  function rowsChoice(drawer: Locator) {
    return drawer.getByRole("radiogroup", { name: "Rows" });
  }

  test("draws the preview, then Content, Display and Size, nothing folded, beside a dashboard that stays usable", async ({
    page,
  }) => {
    const drawer = await openSettings(page);
    await expect(drawer).toHaveAccessibleDescription("Widget settings");
    const box = await drawer.boundingBox();
    expect(box?.width).toBe(440);
    // The fixture declares no setting over its content, so Content is not drawn.
    const headings = (await drawer.locator("section h3").allTextContents()).map(
      heading => heading.trim()
    );
    expect(headings).toEqual(["Display", "Size"]);
    await expect(drawer.getByText("Preview", { exact: true })).toBeVisible();
    await expect(
      rowsChoice(drawer).getByRole("radio", { name: "3" })
    ).toHaveAttribute("aria-checked", "true");
    // The card is as wide as it may be on a 1,440 px dashboard: drawn large, scaled to fit.
    const card = cell(page).locator("[data-tier]").first();
    await expect(card).toHaveAttribute("data-tier", "large");
    const preview = drawer.getByTestId("settings-preview");
    await expect(preview.locator("[data-tier]").first()).toHaveAttribute(
      "data-tier",
      "large"
    );
    expect(Number(await preview.getAttribute("data-scale"))).toBeLessThan(1);
    // Not modal: a card beside it can still be reached, and reaching it keeps the drawer open.
    // This card is full width, so its own menu sits under the drawer: the first card menu clear
    // of the drawer's box is used, found by its test id, not its name, which follows the title.
    const menus = await page.getByTestId("card-menu").all();
    let reachable: (typeof menus)[number] | undefined;
    for (const menu of menus) {
      const at = await menu.boundingBox();
      if (at && box && at.width > 0 && at.x + at.width < box.x) {
        reachable = menu;
        break;
      }
    }
    if (reachable === undefined)
      throw new Error("no card menu clear of the drawer");
    await reachable.click();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer).toBeVisible();
  });

  test("updates the preview as settings change, and leaves the card untouched until Save", async ({
    page,
  }) => {
    const drawer = await openSettings(page);
    const preview = drawer.getByRole("region", { name: `Preview of ${TITLE}` });
    await expect(rowsIn(preview)).toHaveCount(3);
    await rowsChoice(drawer).getByRole("radio", { name: "5" }).click();
    // More rows than the card's 3: every post the card may list, up to five.
    await expect.poll(() => rowsIn(preview).count()).toBeGreaterThan(3);
    await drawer.getByRole("radio", { name: "50% width" }).click();
    await expect(drawer.getByTestId("settings-preview-width")).toHaveText(
      "At 50% of the dashboard"
    );
    // The card itself is unchanged until Save.
    await expect(rows(page)).toHaveCount(3);
    expect((await storedCard(page))?.config ?? {}).toEqual({});
  });

  test("Cancel, Escape and the close button leave the card as it was", async ({
    page,
  }) => {
    for (const close of ["Cancel", "Escape", "Close"]) {
      const drawer = await openSettings(page);
      await rowsChoice(drawer).getByRole("radio", { name: "5" }).click();
      if (close === "Escape") await page.keyboard.press("Escape");
      else await drawer.getByRole("button", { name: close }).click();
      await expect(drawer).toBeHidden();
      await expect(rows(page)).toHaveCount(3);
    }
    const drawer = await openSettings(page);
    await expect(
      rowsChoice(drawer).getByRole("radio", { name: "3" })
    ).toHaveAttribute("aria-checked", "true");
  });

  test("Save at rest keeps the settings, the width and the card's own title, and they stay after a reload", async ({
    page,
  }) => {
    const drawer = await openSettings(page);
    await rowsChoice(drawer).getByRole("radio", { name: "5" }).click();
    await drawer.getByRole("radio", { name: "50% width" }).click();
    await drawer.getByLabel("Title").fill("  Posts to review ");
    await drawer.getByRole("button", { name: "Save" }).click();
    await expect(drawer).toBeHidden();
    await expect.poll(() => rows(page).count()).toBeGreaterThan(3);
    // The card's own region, found within its cell, is now named by the reader's title.
    await expect(cell(page).getByRole("region").first()).toHaveAccessibleName(
      /^Posts to review/
    );
    const stored = await storedCard(page);
    expect(stored).toMatchObject({
      w: 6,
      title: "Posts to review",
      config: { limit: 5 },
    });
    await page.reload();
    await expect.poll(() => rows(page).count()).toBeGreaterThan(3);
    await expect(cell(page)).toHaveClass(/col-span-6/);
  });

  test("is the whole width of a phone, with Save in reach while the form is taller than the screen", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 400 });
    await page.reload();
    await expect(rows(page)).toHaveCount(3);
    const drawer = await openSettings(page);
    expect((await drawer.boundingBox())?.width).toBe(390);
    // Guards the guard: the form must be taller than the room it is given, or Save is in reach
    // whatever the drawer's layout does.
    const overflows = await drawer
      .locator("form > div")
      .first()
      .evaluate(part => part.scrollHeight > part.clientHeight);
    expect(overflows, "the form must be taller than its room").toBe(true);
    const save = drawer.getByRole("button", { name: "Save" });
    await expect(save).toBeInViewport();
    await rowsChoice(drawer).getByRole("radio", { name: "5" }).click();
    await expect(save).toBeInViewport();
    await save.click();
    await expect(drawer).toBeHidden();
    await expect.poll(() => rows(page).count()).toBeGreaterThan(3);
  });

  test("Save while customising stages the change until the dashboard is saved", async ({
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
    await page.getByRole("menuitem", { name: "Settings…" }).click();
    const drawer = page.getByRole("dialog", { name: TITLE });
    await rowsChoice(drawer).getByRole("radio", { name: "5" }).click();
    await drawer.getByRole("radio", { name: "50% width" }).click();
    await drawer.getByRole("button", { name: "Save" }).click();
    await expect(drawer).toBeHidden();
    await expect(bar.getByText("Unsaved changes")).toBeVisible();
    expect(writes).toEqual([]);

    await bar.getByRole("button", { name: "Save" }).click();
    await expect(bar).toBeHidden();
    expect(writes).toHaveLength(1);
    await page.reload();
    await expect.poll(() => rows(page).count()).toBeGreaterThan(3);
    expect(await storedCard(page)).toMatchObject({
      w: 6,
      config: { limit: 5 },
    });
  });
});
