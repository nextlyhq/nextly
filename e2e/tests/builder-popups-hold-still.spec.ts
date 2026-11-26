/**
 * Builder popups stay where they opened while the author works in them, in a
 * real browser at a laptop's 1568×737.
 *
 * Each popup is opened from a control in the lower half of the window, where
 * there is least room below, and then changed so that a row, a section or a
 * message appears or goes inside it. The edge beside the control that opened
 * it, and its side, must not move by a pixel, and the control the author just
 * used must still be under the pointer. Every popup must also be inside the
 * window and clear of the top bar.
 *
 * - The type size editor (Design › Type › Site text).
 * - A colour variable (Design › Colours).
 * - A text style editor (Design › Type › Text styles).
 * - A block's colour picker (Style › Text › Colour).
 * - One side of a block's spacing (Style › Spacing).
 * - The add picker, from the "+" between two blocks.
 *
 * And the two things that may move a popup: scrolling what holds its anchor
 * (it moves with it) and resizing the window (it may be placed again).
 */
import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import {
  clearSelection,
  clickBlock,
  openEditorWith,
  selection,
  structure,
} from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { test } from "./support/test";

// The homepage Single is reseeded, and the site's text styles are changed
// and put back.
test.describe.configure({ lock: [LOCK.homepage, LOCK.siteStyle] });

const WINDOW = { width: 1568, height: 737 };
const SITE_STYLE = "/admin/api/singles/site-style";
const PAGES = "/admin/api/collections/pages/entries";

const TEXT = "popups-text";
const BOX = "popups-box";
const NODES = [
  {
    id: BOX,
    type: "core/box",
    version: 1,
    props: { as: "div" },
    slots: {
      children: [
        {
          id: TEXT,
          type: "core/heading",
          version: 1,
          props: { text: "A heading to style", level: "h2" },
        },
      ],
    },
  },
];

/** A text style with no letter spacing, so setting one adds its reset. */
const LEAD = {
  id: "e2e-popups-lead",
  slug: "popups-lead",
  label: "Lead",
  orderIndex: 0,
  role: "text",
  styles: { base: { base: { fontSize: "20px", lineHeight: 1.5 } } },
};

type Box = { x: number; y: number; width: number; height: number };

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("[e2e] not laid out");
  return box;
}

/** Two frames, so anything the change would move has moved. */
async function settled(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>(done =>
        requestAnimationFrame(() => requestAnimationFrame(() => done()))
      )
  );
}

/** The popup's edge beside its anchor and its start edge, by its side. */
function heldEdges(side: string, box: Box): { across: number; along: number } {
  switch (side) {
    case "right":
      return { across: box.x, along: box.y };
    case "left":
      return { across: box.x + box.width, along: box.y };
    case "top":
      return { across: box.y + box.height, along: box.x };
    default:
      return { across: box.y, along: box.x };
  }
}

/**
 * Two places the same to within a pixel. A popup's height is fractional (its
 * lines are), and the popover rounds its place to whole pixels, so a popup
 * held by its bottom edge can settle a fraction of a pixel away; a popup that
 * moves is tens of pixels away.
 */
function expectSamePlace(
  after: Record<string, number>,
  before: Record<string, number>,
  what: string
): void {
  for (const key of Object.keys(before)) {
    expect(
      Math.abs((after[key] ?? Number.NaN) - (before[key] ?? 0)),
      `${what}: ${key} moved from ${before[key]} to ${after[key]}`
    ).toBeLessThan(1);
  }
}

/** Inside the window, and below the builder's top bar. */
async function expectInsideWindow(page: Page, popup: Locator): Promise<void> {
  const box = await boxOf(popup);
  const bar = await boxOf(page.locator(".nx-builder-topbar").first());
  expect(box.y, "the popup's top is below the top bar").toBeGreaterThanOrEqual(
    bar.y + bar.height
  );
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(WINDOW.width);
  expect(
    box.y + box.height,
    "the popup's bottom is inside the window"
  ).toBeLessThanOrEqual(WINDOW.height);
}

/**
 * Opens `popup` from `opener`, which must sit in the lower half of the
 * window, makes `change`, and holds the popup to where it was: its side, the
 * edge beside the opener, its start edge and `pointer` (the control the
 * author just used) all unmoved, and its content's height changed, so the
 * change did resize it.
 */
async function holdsThrough(
  page: Page,
  {
    opener,
    popup,
    pointer,
    change,
  }: {
    opener: Locator;
    popup: Locator;
    pointer: (popup: Locator) => Locator;
    change: (popup: Locator) => Promise<void>;
  }
): Promise<void> {
  const from = await boxOf(opener);
  expect(
    from.y + from.height / 2,
    "the popup is opened from the lower half of the window"
  ).toBeGreaterThan(WINDOW.height / 2);
  await opener.click();
  await expect(popup).toBeVisible();
  await expect(popup).toHaveAttribute("data-nx-popup", "held");
  await settled(page);
  await expectInsideWindow(page, popup);

  const side = (await popup.getAttribute("data-side")) ?? "";
  const before = await boxOf(popup);
  const height = await popup.evaluate(element => element.scrollHeight);
  await change(popup);
  const at = await boxOf(pointer(popup));
  await settled(page);
  await expect
    .poll(() => popup.evaluate(element => element.scrollHeight))
    .not.toBe(height);
  await settled(page);

  const after = await boxOf(popup);
  expect(await popup.getAttribute("data-side")).toBe(side);
  expectSamePlace(
    heldEdges(side, after),
    heldEdges(side, before),
    "the edge beside the opener"
  );
  expectSamePlace(await boxOf(pointer(popup)), at, "the control just used");
  await expectInsideWindow(page, popup);
}

async function openDesign(page: Page): Promise<Locator> {
  const panel = page.getByRole("region", { name: "Design panel" });
  await page.getByRole("navigation", { name: "Editor panels" }).waitFor();
  if (!(await panel.isVisible())) {
    await page
      .getByRole("navigation", { name: "Editor panels" })
      .getByRole("button", { name: "Design", exact: true })
      .click();
  }
  return panel;
}

/** The inspector's Style tab, on the Box holding the heading. */
async function styleBox(page: Page): Promise<Locator> {
  await openEditorWith(page, NODES, TEXT);
  await clickBlock(page, TEXT);
  await expect.poll(() => selection(page)).toEqual([TEXT]);
  await page.keyboard.press("Escape");
  await expect.poll(() => selection(page)).toEqual([BOX]);
  const inspector = page.getByTestId("inspector");
  await inspector.getByRole("tab", { name: "Style" }).click();
  return inspector;
}

async function expand(section: Locator): Promise<void> {
  if ((await section.getAttribute("aria-expanded")) !== "true") {
    await section.click();
  }
  await expect(section).toHaveAttribute("aria-expanded", "true");
}

/** Scrolls `scroller` until `target` is in the lower half of the window. */
async function lowered(scroller: Locator, target: Locator): Promise<void> {
  for (let tries = 0; tries < 20; tries += 1) {
    const box = await boxOf(target);
    const middle = box.y + box.height / 2;
    if (middle > WINDOW.height / 2 && middle < WINDOW.height - 40) return;
    const by = middle < WINDOW.height / 2 ? -80 : 80;
    const moved = await scroller.evaluate((element, step) => {
      const was = element.scrollTop;
      element.scrollTop += step;
      return element.scrollTop !== was;
    }, by);
    if (!moved) return;
  }
}

async function storeClasses(
  api: APIRequestContext,
  classes: unknown[]
): Promise<void> {
  const written = await api.patch(SITE_STYLE, {
    data: { classes, _overwrite: true },
  });
  expect(written.ok(), `writing the classes: ${written.status()}`).toBe(true);
}

async function storedClasses(api: APIRequestContext): Promise<unknown[]> {
  const response = await api.get(SITE_STYLE);
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as Record<string, unknown>;
  const item = (body.item ?? body) as Record<string, unknown>;
  return (item.classes as unknown[] | undefined) ?? [];
}

/** A page of three sections, for the "+" between two of them. */
async function createPage(request: APIRequestContext): Promise<string> {
  const t = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const section = (id: string, name: string, text: string) => ({
    id,
    type: "core/section",
    version: 1,
    name,
    props: { as: "section", contained: true },
    styles: { base: { base: { minHeight: "220px" } } },
    slots: {
      children: [
        {
          id: `${id}-h`,
          type: "core/heading",
          version: 1,
          props: { text, level: "h2" },
        },
      ],
    },
  });
  const created = await request.post(PAGES, {
    data: {
      title: `Popups ${t}`,
      slug: `popups-${t}`,
      status: "draft",
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          section("00000000-0000-4000-8000-0000000cb501", "Hero", "Welcome"),
          section("00000000-0000-4000-8000-0000000cb502", "Pricing", "Plans"),
          section("00000000-0000-4000-8000-0000000cb503", "Contact", "Write"),
        ],
      },
    },
  });
  expect(created.ok(), `creating the page: ${created.status()}`).toBe(true);
  return ((await created.json()) as { item: { id: string } }).item.id;
}

test.beforeEach(async ({ page }) => {
  // The first open of the builder compiles it, on a development server.
  test.setTimeout(120_000);
  await page.setViewportSize(WINDOW);
});

test.describe("a builder popup holds still while its content changes", () => {
  test("the type size editor, as a Reset row comes or goes", async ({
    page,
  }) => {
    await openEditorWith(page, NODES, TEXT);
    const panel = await openDesign(page);
    await panel.getByRole("tab", { name: /^Type/ }).click();
    const rows = panel
      .getByRole("region", { name: "Site text" })
      .getByRole("button", { name: /^Site text: / });
    // The lowest of the type size rows, as low in the window as it goes.
    const row = rows.filter({ hasNotText: /link/i }).last();
    await lowered(panel.locator(".nx-vars__body").first(), row);
    const label = (await row.getAttribute("aria-label")) ?? "";
    const name = /^Site text: ([^,]+)/.exec(
      (await row.textContent()) ?? label
    )?.[1];

    let used: Locator | undefined;
    await holdsThrough(page, {
      opener: row,
      popup: page.getByRole("dialog", { name: `Edit ${name ?? ""}`.trim() }),
      pointer: () => used ?? row,
      change: async popup => {
        const reset = popup.getByRole("button", { name: "Reset", exact: true });
        if (await reset.isVisible()) {
          used = popup.getByRole("radio").first();
          await reset.click();
          await expect(reset).toHaveCount(0);
        } else {
          used = popup.getByRole("radio", { checked: false }).first();
          await used.check();
          await expect(reset).toBeVisible();
        }
      },
    });
  });

  test("a colour variable, as its dark value is added or taken off", async ({
    page,
  }) => {
    await openEditorWith(page, NODES, TEXT);
    const panel = await openDesign(page);
    await panel.getByRole("tab", { name: /^Colou?rs/ }).click();
    const row = panel.locator(".nx-vars__row").last();
    await lowered(panel.locator(".nx-vars__body").first(), row);

    let used: Locator | undefined;
    await holdsThrough(page, {
      opener: row,
      popup: page.locator('[data-slot="popover-content"].nx-vars-editor'),
      pointer: () => used ?? row,
      change: async popup => {
        const remove = popup.getByRole("button", { name: "Remove dark value" });
        if (await remove.isVisible()) {
          used = popup.getByLabel("Light", { exact: true });
          await remove.click();
        } else {
          used = popup.getByRole("button", { name: "Add dark value" });
          await used.click();
          used = popup.getByLabel("Light", { exact: true });
        }
      },
    });
  });

  test("a text style editor, as a part is set and its reset appears", async ({
    page,
  }) => {
    const kept = await storedClasses(page.request);
    try {
      await storeClasses(page.request, [LEAD]);
      await openEditorWith(page, NODES, TEXT);
      const panel = await openDesign(page);
      await panel.getByRole("tab", { name: /^Type/ }).click();
      const section = panel.getByRole("region", { name: "Text styles" });
      const row = section.getByRole("button", { name: /^Text styles: Lead\b/ });
      await lowered(panel.locator(".nx-vars__body").first(), row);

      const spacing = (popup: Locator) =>
        popup.getByRole("textbox", { name: "Letter spacing" });
      await holdsThrough(page, {
        opener: row,
        popup: page.getByRole("dialog", { name: "Edit Lead" }),
        pointer: spacing,
        change: async popup => {
          await spacing(popup).fill("0.05");
          await spacing(popup).press("Enter");
          await expect(
            popup.getByRole("button", { name: /^Reset Letter spacing/ })
          ).toBeVisible();
        },
      });
    } finally {
      await storeClasses(page.request, kept);
    }
  });

  test("a block's colour picker, as its custom colour opens", async ({
    page,
  }) => {
    const inspector = await styleBox(page);
    await expand(
      inspector.getByRole("button", { name: /^Text(\s?has changes)?$/ })
    );
    const opener = inspector.getByRole("button", {
      name: /^Colour for Colou?r/,
    });
    await lowered(page.locator(".nx-inspector"), opener);

    const custom = (popup: Locator) =>
      popup.getByRole("button", { name: "Custom colour" });
    await holdsThrough(page, {
      opener,
      popup: page.locator(
        '[data-slot="popover-content"].nx-style-inspector__picker'
      ),
      pointer: custom,
      change: async popup => {
        await custom(popup).click();
        await expect(page.getByLabel("Hex colour")).toBeVisible();
      },
    });
  });

  test("one side of a block's spacing, as a refusal is said in it", async ({
    page,
  }) => {
    const inspector = await styleBox(page);
    await expand(inspector.getByRole("button", { name: /^Spacing/ }));
    const opener = page
      .locator(".nx-spacing-box")
      .getByRole("button", { name: /^Padding bottom / });
    await lowered(page.locator(".nx-inspector"), opener);

    const number = (popup: Locator) =>
      popup.getByLabel("Value for Padding bottom");
    await holdsThrough(page, {
      opener,
      popup: page.getByRole("dialog", { name: "Padding bottom" }),
      pointer: number,
      change: async popup => {
        await number(popup).fill("twelve");
        await number(popup).press("Enter");
        await expect(popup.getByRole("alert")).toBeVisible();
      },
    });
  });

  test("the add picker, as its search narrows the blocks", async ({ page }) => {
    const id = await createPage(page.request);
    await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
    await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
      timeout: 60_000,
    });
    await expect.poll(async () => (await structure(page)).length).toBe(6);
    await clearSelection(page);
    const add = page.getByRole("button", {
      name: "Add a block between Pricing and Contact",
      exact: true,
    });
    await add.scrollIntoViewIfNeeded();
    const spot = await boxOf(add);
    await page.mouse.move(spot.x - 160, spot.y + spot.height / 2 - 3, {
      steps: 4,
    });
    await expect
      .poll(() => add.evaluate(element => getComputedStyle(element).opacity))
      .toBe("1");

    const search = (popup: Locator) =>
      popup.getByRole("combobox", { name: "Search blocks" });
    await holdsThrough(page, {
      opener: add,
      popup: page.getByRole("dialog", { name: "Add a block" }),
      pointer: search,
      change: async popup => {
        await search(popup).fill("he");
      },
    });
  });
});

test.describe("what may move a builder popup", () => {
  test("it moves with its row when the panel under it scrolls", async ({
    page,
  }) => {
    await page.setViewportSize({ width: WINDOW.width, height: 560 });
    await openEditorWith(page, NODES, TEXT);
    const panel = await openDesign(page);
    await panel.getByRole("tab", { name: /^Colou?rs/ }).click();
    // By its element: the open popup is modal, which takes the panel's
    // region out of the accessibility tree.
    const row = page
      .locator('section[aria-label="Design panel"] .nx-vars__row')
      .nth(1);
    await row.click();
    const popup = page.locator('[data-slot="popover-content"].nx-vars-editor');
    await expect(popup).toHaveAttribute("data-nx-popup", "held");
    await settled(page);

    const before = await boxOf(popup);
    const rowBefore = await boxOf(row);
    const scroller = page
      .locator('section[aria-label="Design panel"] .nx-vars__body')
      .first();
    const by = await scroller.evaluate(element => {
      const was = element.scrollTop;
      element.scrollTop += 40;
      return element.scrollTop - was;
    });
    expect(by, "the panel has room to scroll").toBeGreaterThan(0);
    await settled(page);

    const rowAfter = await boxOf(row);
    const after = await boxOf(popup);
    expectSamePlace({ y: rowAfter.y }, { y: rowBefore.y - by }, "the row");
    expectSamePlace(
      { x: after.x, y: after.y },
      { x: before.x, y: before.y - by },
      "the popup"
    );
  });

  test("it may be placed again when the window is resized, inside it", async ({
    page,
  }) => {
    await openEditorWith(page, NODES, TEXT);
    const panel = await openDesign(page);
    await panel.getByRole("tab", { name: /^Type/ }).click();
    const row = panel
      .getByRole("region", { name: "Site text" })
      .getByRole("button", { name: /^Site text: / })
      .first();
    await row.click();
    const popup = page.getByRole("dialog").first();
    await expect(popup).toHaveAttribute("data-nx-popup", "held");

    const smaller = { width: 1280, height: 520 };
    await page.setViewportSize(smaller);
    await settled(page);
    await settled(page);

    const box = await boxOf(popup);
    const bar = await boxOf(page.locator(".nx-builder-topbar").first());
    expect(box.y).toBeGreaterThanOrEqual(bar.y + bar.height);
    expect(box.y + box.height).toBeLessThanOrEqual(smaller.height);
    expect(box.x + box.width).toBeLessThanOrEqual(smaller.width);
  });

  test("the add picker opened low stays inside and scrolls its list", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
    await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
      timeout: 60_000,
    });
    await expect.poll(async () => (await structure(page)).length).toBe(6);
    await clearSelection(page);
    const add = page.getByRole("button", {
      name: "Add a block between Pricing and Contact",
      exact: true,
    });
    await add.scrollIntoViewIfNeeded();
    const spot = await boxOf(add);
    await page.mouse.move(spot.x - 160, spot.y + spot.height / 2 - 3, {
      steps: 4,
    });
    await expect
      .poll(() => add.evaluate(element => getComputedStyle(element).opacity))
      .toBe("1");
    await add.click();
    const popup = page.getByRole("dialog", { name: "Add a block" });
    await expect(popup).toHaveAttribute("data-nx-popup", "held");
    await popup.getByRole("combobox", { name: "Search blocks" }).fill("e");
    await settled(page);

    await expectInsideWindow(page, popup);
    // Its list of results scrolls inside it, rather than running it off the
    // window.
    const list = popup.getByRole("listbox", { name: "Matching blocks" });
    await expect(list).toBeVisible();
    expect(
      await list.evaluate(element => getComputedStyle(element).overflowY)
    ).toMatch(/^(auto|scroll)$/);
  });
});
