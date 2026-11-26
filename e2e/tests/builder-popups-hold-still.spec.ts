/**
 * Builder popups stay where they opened while the author works in them, in a
 * real browser at a laptop's 1568×737.
 *
 * Each popup is opened from a control in the lower half of the window, where
 * there is least room below, and then changed so that a row, a section or a
 * message appears or goes inside it. Its top-left corner, which its controls
 * are measured from, and its side must not move, and the control the author
 * just used must still be under the pointer. Every popup must also be inside the
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
 * window, asks `using` which control the author uses and what that does, and
 * holds the popup to where it was: its side, its top-left corner and that
 * control, measured before the change and after it, all unmoved, and its
 * content's height changed, so the change did resize it.
 */
async function holdsThrough(
  page: Page,
  {
    opener,
    popup,
    using,
  }: {
    opener: Locator;
    popup: Locator;
    using: (
      popup: Locator
    ) => Promise<{ pointer: Locator; change: () => Promise<void> }>;
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

  const side = await popup.getAttribute("data-nx-popup-side");
  const before = await boxOf(popup);
  const height = await popup.evaluate(element => element.scrollHeight);
  const { pointer, change } = await using(popup);
  const at = await boxOf(pointer);
  await change();
  await settled(page);
  await expect
    .poll(() => popup.evaluate(element => element.scrollHeight))
    .not.toBe(height);
  await settled(page);

  const after = await boxOf(popup);
  expect(await popup.getAttribute("data-nx-popup-side")).toBe(side);
  // Its top-left corner, whichever side it opened on: the corner its
  // controls are measured from.
  expectSamePlace(
    { x: after.x, y: after.y },
    { x: before.x, y: before.y },
    "the popup's top-left corner"
  );
  expectSamePlace(await boxOf(pointer), at, "the control just used");
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

/** The site style's classes and variables, as stored. */
async function storedSiteStyle(
  api: APIRequestContext
): Promise<{ classes: unknown[]; tokens: unknown }> {
  const response = await api.get(SITE_STYLE);
  expect(response.ok(), `reading the site style: ${response.status()}`).toBe(
    true
  );
  const body = (await response.json()) as Record<string, unknown>;
  const item = (body.item ?? body) as Record<string, unknown>;
  const raw = item.tokens ?? null;
  return {
    classes: (item.classes as unknown[] | undefined) ?? [],
    tokens: typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw,
  };
}

async function storeSiteStyle(
  api: APIRequestContext,
  data: { classes?: unknown[]; tokens?: unknown }
): Promise<void> {
  const written = await api.patch(SITE_STYLE, {
    data: { ...data, _overwrite: true },
  });
  expect(written.ok(), `writing the site style: ${written.status()}`).toBe(
    true
  );
}

/**
 * Runs `work`, which may change the site's classes and variables, and puts
 * both back as they were stored, whatever it changed.
 */
async function keepingSiteStyle(
  api: APIRequestContext,
  work: () => Promise<void>
): Promise<void> {
  const kept = await storedSiteStyle(api);
  try {
    await work();
  } finally {
    await storeSiteStyle(api, kept);
  }
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
    await keepingSiteStyle(page.request, async () => {
      await openEditorWith(page, NODES, TEXT);
      const panel = await openDesign(page);
      await panel.getByRole("tab", { name: /^Type/ }).click();
      const rows = panel
        .getByRole("region", { name: "Site text" })
        .getByRole("button", { name: /^Site text: / });
      // The lowest of the type size rows, as low in the window as it goes.
      const row = rows.filter({ hasNotText: /link/i }).last();
      await lowered(panel.locator(".nx-vars__body").first(), row);
      // The popup is named after the row's label.
      const name = (await row.locator(".nx-vars__name").textContent())?.trim();
      expect(name, "the row's label").toBeTruthy();

      await holdsThrough(page, {
        opener: row,
        popup: page.getByRole("dialog", { name: `Edit ${name}`, exact: true }),
        using: async popup => {
          const reset = popup.getByRole("button", {
            name: "Reset",
            exact: true,
          });
          if (await reset.isVisible()) {
            return {
              pointer: popup.getByRole("radio").first(),
              change: async () => {
                await reset.click();
                await expect(reset).toHaveCount(0);
              },
            };
          }
          const radio = popup.getByRole("radio", { checked: false }).first();
          return {
            pointer: radio,
            change: async () => {
              await radio.check();
              await expect(reset).toBeVisible();
            },
          };
        },
      });
    });
  });

  test("a colour variable, as its dark value is added or taken off", async ({
    page,
  }) => {
    await keepingSiteStyle(page.request, async () => {
      await openEditorWith(page, NODES, TEXT);
      const panel = await openDesign(page);
      await panel.getByRole("tab", { name: /^Colou?rs/ }).click();
      const row = panel.locator(".nx-vars__row").last();
      await lowered(panel.locator(".nx-vars__body").first(), row);

      await holdsThrough(page, {
        opener: row,
        popup: page.locator('[data-slot="popover-content"].nx-vars-editor'),
        using: async popup => {
          const remove = popup.getByRole("button", {
            name: "Remove dark value",
          });
          const add = popup.getByRole("button", { name: "Add dark value" });
          const gone = await remove.isVisible();
          return {
            // The Light value, above the dark one that comes or goes.
            pointer: popup.getByLabel("Light", { exact: true }),
            change: async () => {
              await (gone ? remove : add).click();
              await expect(gone ? add : remove).toBeVisible();
            },
          };
        },
      });
    });
  });

  test("a text style editor, as a part is set and its reset appears", async ({
    page,
  }) => {
    await keepingSiteStyle(page.request, async () => {
      await storeSiteStyle(page.request, { classes: [LEAD] });
      await openEditorWith(page, NODES, TEXT);
      const panel = await openDesign(page);
      await panel.getByRole("tab", { name: /^Type/ }).click();
      const section = panel.getByRole("region", { name: "Text styles" });
      const row = section.getByRole("button", { name: /^Text styles: Lead\b/ });
      await lowered(panel.locator(".nx-vars__body").first(), row);

      await holdsThrough(page, {
        opener: row,
        popup: page.getByRole("dialog", { name: "Edit Lead" }),
        using: async popup => {
          const spacing = popup.getByRole("textbox", {
            name: "Letter spacing",
          });
          return {
            pointer: spacing,
            change: async () => {
              await spacing.fill("0.05");
              await spacing.press("Enter");
              await expect(
                popup.getByRole("button", { name: /^Reset Letter spacing/ })
              ).toBeVisible();
            },
          };
        },
      });
    });
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

    await holdsThrough(page, {
      opener,
      popup: page.locator(
        '[data-slot="popover-content"].nx-style-inspector__picker'
      ),
      using: async popup => {
        const custom = popup.getByRole("button", { name: "Custom colour" });
        return {
          pointer: custom,
          change: async () => {
            await custom.click();
            await expect(page.getByLabel("Hex colour")).toBeVisible();
          },
        };
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

    await holdsThrough(page, {
      opener,
      popup: page.getByRole("dialog", { name: "Padding bottom" }),
      using: async popup => {
        const number = popup.getByLabel("Value for Padding bottom");
        return {
          pointer: number,
          change: async () => {
            await number.fill("twelve");
            await number.press("Enter");
            await expect(popup.getByRole("alert")).toBeVisible();
          },
        };
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

    await holdsThrough(page, {
      opener: add,
      popup: page.getByRole("dialog", { name: "Add a block" }),
      using: async popup => {
        const search = popup.getByRole("combobox", { name: "Search blocks" });
        return { pointer: search, change: () => search.fill("he") };
      },
    });
  });
});

test.describe("what may move a builder popup", () => {
  test("it moves with its control when the panel under it scrolls", async ({
    page,
  }) => {
    const inspector = await styleBox(page);
    await expand(inspector.getByRole("button", { name: /^Spacing/ }));
    const scroller = page.locator(".nx-inspector");
    const opener = page
      .locator(".nx-spacing-box")
      .getByRole("button", { name: /^Padding top / });
    await lowered(scroller, opener);
    await opener.click();
    const popup = page.getByRole("dialog", { name: "Padding top" });
    await expect(popup).toHaveAttribute("data-nx-popup", "held");
    await settled(page);

    const before = await boxOf(popup);
    const openerBefore = await boxOf(opener);
    const by = await scroller.evaluate(element => {
      const was = element.scrollTop;
      element.scrollTop += 40;
      return element.scrollTop - was;
    });
    expect(by, "the panel has room to scroll").toBeGreaterThan(0);
    await settled(page);

    const openerAfter = await boxOf(opener);
    const after = await boxOf(popup);
    expectSamePlace(
      { y: openerAfter.y },
      { y: openerBefore.y - by },
      "the control"
    );
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
    // A short window, so the results are taller than the room they have.
    const short = { width: WINDOW.width, height: 480 };
    await page.setViewportSize(short);
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

    const box = await boxOf(popup);
    const bar = await boxOf(page.locator(".nx-builder-topbar").first());
    expect(box.y).toBeGreaterThanOrEqual(bar.y + bar.height);
    expect(box.y + box.height).toBeLessThanOrEqual(short.height);
    // Its list of results is taller than the room, and scrolls inside it
    // rather than running the picker off the window.
    const list = popup.getByRole("listbox", { name: "Matching blocks" });
    await expect(list).toBeVisible();
    const overflow = await list.evaluate(element => ({
      scroll: element.scrollHeight,
      client: element.clientHeight,
    }));
    expect(overflow.scroll, "the results overflow the list").toBeGreaterThan(
      overflow.client
    );
    const moved = await list.evaluate(element => {
      element.scrollTop += 40;
      return element.scrollTop;
    });
    expect(moved, "the list scrolls").toBeGreaterThan(0);
  });
});
