/**
 * The dashboard held to WCAG 2.2 AA across its surfaces (dashboard-experience R-23): an axe scan
 * of the whole page at rest with every core card on it, System health's Details, customise mode,
 * the add drawer and a card's settings drawer, at rest and while customising, at a desktop's
 * width and a phone's, and with the Customize dashboard cog focused and its tooltip shown, in
 * light and in dark; on a phone used by touch, every control at least 24 by 24 and none shown
 * only on hover, at rest, while customising and in each drawer; a keyboard-only
 * visit that adds a collection widget through its add step, changes its settings in the drawer
 * and saves, then retitles the card from its drawer, with focus back on the control that opened
 * each menu and drawer as it closes, drawn with a ring that can be seen (3:1 against what is
 * behind it); and the gallery's count, said for the chip and the search that are on.
 *
 * Each surface's own spec scans it alone (`dashboard-gallery`, `dashboard-customise`,
 * `dashboard-header`). This one walks them as one reader does, so a defect that shows only once
 * two are on screen together, or only on the way from one to the next, is found here. The header
 * bell's count is held to AA in `notification-bell`, on the dev server: a production build, which
 * this suite runs on, hides the bell with the Schema Builder.
 *
 * Each test returns the reader to the default dashboard when it ends.
 *
 * @module tests/dashboard-accessibility.spec
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { contrastRatio, gotoAdmin, type Theme } from "./support/admin";
import {
  emptyScanReason,
  scanAxe,
  settleTransitions,
} from "./support/axe-scan.mjs";
import { defaultSizeOf } from "./support/dashboard-sizes";
import { LOCK } from "./support/locks";
import { createEntry } from "./support/runtime-collection";
import { test } from "./support/test";

// Shares the dashboard with other specs; see support/locks.ts.
test.describe.configure({ lock: [LOCK.dashboard] });

const CELLS = '[data-testid^="widget-cell-"]';
const OVER_TIME = "core/over-time";

interface LayoutRead {
  version: number;
  scope: string;
  placements: Array<{
    id: string;
    widgetId: string;
    removed?: boolean;
    config?: Record<string, unknown>;
    title?: string;
  }>;
}

async function readLayout(page: Page): Promise<LayoutRead> {
  const read = await page.request.get("/admin/api/dashboard/layout");
  expect(read.ok()).toBe(true);
  return (await read.json()) as LayoutRead;
}

/** Back to the default dashboard, through the guarded reset a reader uses. */
async function resetToDefault(page: Page): Promise<void> {
  const body = await readLayout(page);
  if (body.version === 0) return;
  const reset = await page.request.delete(
    `/admin/api/dashboard/layout?version=${body.version}&scope=${encodeURIComponent(body.scope)}`
  );
  expect(reset.status()).toBe(200);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

test.afterEach(async ({ page }) => {
  await resetToDefault(page);
});

const bar = (page: Page) =>
  page.getByRole("group", { name: "Customize dashboard" });

const gallery = (page: Page) =>
  page.getByRole("dialog", { name: "Add widget" });

/** The dashboard drawn, every card's first answer in. */
async function dashboardAtRest(page: Page, theme: Theme): Promise<void> {
  await gotoAdmin(page, "/", theme);
  await expect(
    page.locator(CELLS).filter({ visible: true }).first()
  ).toBeVisible();
  await expect(
    page.locator('[data-testid="widget-card-body"][aria-busy="true"]')
  ).toHaveCount(0, { timeout: 30_000 });
}

/**
 * axe's AA scan of the whole page, recorded rather than stopping the test, so one run lists
 * every surface's violations. Waited for the page to settle first: a sheet sliding in or a
 * popover fading in is a colour the page never rests at.
 */
async function scan(page: Page, surface: string): Promise<void> {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        animation =>
          animation.playState !== "running" ||
          animation.effect?.getTiming().iterations === Number.POSITIVE_INFINITY
      )
  );
  const { results, findings } = await scanAxe(page);
  expect(emptyScanReason(results), surface).toBeNull();
  expect
    .soft(
      findings,
      `${surface}: axe reported ${findings.length} violation(s):\n${JSON.stringify(findings, null, 2)}`
    )
    .toEqual([]);
}

/**
 * Presses Tab (or Shift+Tab) until `target` has focus, as a keyboard reader moves to a control,
 * failing with where focus went if it never arrives.
 */
async function tabTo(
  page: Page,
  target: Locator,
  { backward = false, max = 200 } = {}
): Promise<void> {
  const key = backward ? "Shift+Tab" : "Tab";
  const visited: string[] = [];
  for (let i = 0; i < max; i += 1) {
    if (await target.evaluate(node => node === document.activeElement)) return;
    await page.keyboard.press(key);
    visited.push(
      await page.evaluate(() => {
        const active = document.activeElement;
        if (active === null || active === document.body) return "(body)";
        return (
          active.getAttribute("aria-label") ??
          active.textContent?.trim().slice(0, 40) ??
          active.tagName
        );
      })
    );
  }
  throw new Error(
    `${key} never reached ${String(target)}; focus went through:\n${visited.slice(-40).join("\n")}`
  );
}

/** A colour resolved to plain RGB, composited over what is behind it. */
type Rgb = [number, number, number];

/**
 * The colours an element is drawn with where its edge and its focus indicator are, each resolved
 * by painting it (alpha included) and composited over the backdrop: the backgrounds of the
 * nearest ancestors, composited until one is opaque (a page's canvas is white). Its border, its
 * outline, and each ring its box shadow draws (a layer with a spread; a soft shadow has none).
 * Read from the computed style, so a utility missing from the built stylesheet reads as drawn
 * nothing, whatever the class list says.
 */
function drawnColours(node: Element) {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no 2d context");
  type Rgba = [number, number, number, number];
  const rgba = (color: string): Rgba => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  };
  const over = (top: Rgba, under: Rgb): Rgb =>
    [0, 1, 2].map(i => top[i] * top[3] + under[i] * (1 - top[3])) as Rgb;
  const layers: Rgba[] = [];
  for (let at = node.parentElement; at !== null; at = at.parentElement) {
    const layer = rgba(getComputedStyle(at).backgroundColor);
    if (layer[3] === 0) continue;
    layers.push(layer);
    if (layer[3] === 1) break;
  }
  let backdrop: Rgb = [255, 255, 255];
  for (const layer of layers.reverse()) backdrop = over(layer, backdrop);
  const style = getComputedStyle(node);
  // Each shadow layer: its colour, then its lengths; split on the commas between layers only.
  const rings =
    style.boxShadow === "none"
      ? []
      : style.boxShadow
          .split(/,(?![^(]*\))/)
          .map(layer => {
            const color =
              /^\s*([a-z-]+\([^)]*\)|#[0-9a-f]+|[a-z]+)/i.exec(layer)?.[1] ??
              "";
            const lengths =
              layer
                .slice(layer.indexOf(color) + color.length)
                .match(/-?[\d.]+px/g) ?? [];
            return { color, spread: Number.parseFloat(lengths[3] ?? "0") };
          })
          .filter(layer => layer.color !== "" && layer.spread > 0)
          .map(layer => over(rgba(layer.color), backdrop));
  const line = (kind: "border-top" | "outline") => ({
    style: style.getPropertyValue(`${kind}-style`),
    width: Number.parseFloat(style.getPropertyValue(`${kind}-width`)),
    color: over(rgba(style.getPropertyValue(`${kind}-color`)), backdrop),
  });
  // A frame drawn by the element's `::after` box (a row that marks focus inside its own edges),
  // when that box is drawn at all.
  const after = getComputedStyle(node, "::after");
  const frame =
    after.content === "none" || after.content === "normal"
      ? null
      : {
          style: after.borderTopStyle,
          width: Number.parseFloat(after.borderTopWidth),
          color: over(rgba(after.borderTopColor), backdrop),
        };
  return {
    backdrop,
    border: line("border-top"),
    outline: line("outline"),
    rings,
    frame,
  };
}

/**
 * The colours of every focus indicator `node` draws, each against what is behind it: an outline
 * with a width, each ring of its box shadow, the frame its `::after` box draws, and its border.
 */
function indicatorsOf(drawn: ReturnType<typeof drawnColours>) {
  const outline =
    drawn.outline.style !== "none" && drawn.outline.width > 0
      ? [drawn.outline.color]
      : [];
  const frame =
    drawn.frame !== null &&
    drawn.frame.style !== "none" &&
    drawn.frame.width > 0
      ? [drawn.frame.color]
      : [];
  return {
    marks: [...outline, ...drawn.rings, ...frame],
    border:
      drawn.border.style !== "none" && drawn.border.width > 0
        ? drawn.border.color
        : null,
  };
}

/** The strongest contrast among `colours` against `backdrop`, 1 when there are none. */
function strongest(colours: Rgb[], backdrop: Rgb): number {
  return Math.max(1, ...colours.map(color => contrastRatio(color, backdrop)));
}

/**
 * `target` holds focus and draws an indicator a reader can SEE (WCAG 2.4.7, measured as 1.4.11's
 * 3:1): an outline, or the ring the admin draws as a box shadow, at least 3:1 against what is
 * behind the control. A control that marks focus by its border instead (a select's trigger) is
 * judged against `twin`, an unfocused control of the same kind beside it: its border must have
 * changed, and the changed border must hold 3:1. An indicator drawn in the surface's own colour,
 * or one too faint to tell apart, fails, as a style that is merely not "none" would not. Polled,
 * since an indicator can ease in.
 */
async function expectVisibleFocus(
  target: Locator,
  twin?: Locator
): Promise<void> {
  await expect(target).toBeFocused();
  await expectDrawnIndicator(target, twin);
}

/**
 * `target` draws an indicator at 3:1 against what is behind it, measured as `expectVisibleFocus`
 * measures it, whether or not it holds focus: an option a list marks as active
 * (`aria-activedescendant`) shows where the keys are while focus stays in the search.
 */
async function expectDrawnIndicator(
  target: Locator,
  twin?: Locator
): Promise<void> {
  const rest =
    twin === undefined ? undefined : await twin.evaluate(drawnColours);
  // Polled as the strongest indicator's contrast, so a failure prints the ratio it measured.
  await expect
    .poll(
      async () => {
        const drawn = await target.evaluate(drawnColours);
        const { marks, border } = indicatorsOf(drawn);
        const changedBorder =
          rest !== undefined &&
          border !== null &&
          border.some((v, i) => Math.abs(v - rest.border.color[i]) > 1)
            ? [border]
            : [];
        const ratio = strongest([...marks, ...changedBorder], drawn.backdrop);
        return Math.round(ratio * 100) / 100;
      },
      {
        message: `${String(target)} has focus but draws no indicator at 3:1 against what is behind it`,
      }
    )
    .toBeGreaterThanOrEqual(3);
}

/** Whether focus is anywhere inside `within`. */
async function focusIsIn(within: Locator): Promise<boolean> {
  return within.evaluate(node => node.contains(document.activeElement));
}

/**
 * The cards the scans add to the default dashboard, so every core card's colours are on the page
 * at once: a chart, a count, a note with a link, the people and the install's health.
 */
const SCANNED_CARDS = [
  {
    id: "e2e-a11y-count",
    widgetId: "core/count",
    config: { collection: "posts" },
  },
  {
    id: "e2e-a11y-note",
    widgetId: "core/note",
    config: {
      text: "**This week:** review the drafts.\n- Read the [guide](https://example.com)",
    },
  },
  { id: "e2e-a11y-team", widgetId: "core/team", config: {} },
  { id: "e2e-a11y-health", widgetId: "core/system-health", config: {} },
] as const;

/**
 * Puts an Over time card first on the reader's dashboard, at its default size, and the cards of
 * `SCANNED_CARDS` after the default ones, each at its own default size; the Over time card's id.
 */
async function placeOverTime(page: Page): Promise<string> {
  const layout = await readLayout(page);
  const id = "e2e-a11y-over-time";
  const ours = new Set<string>([id, ...SCANNED_CARDS.map(card => card.id)]);
  // Each widget once: a default card of the same widget gives way to ours.
  const widgets = new Set<string>(SCANNED_CARDS.map(card => card.widgetId));
  const added = await Promise.all(
    SCANNED_CARDS.map(async card => ({
      ...card,
      ...(await defaultSizeOf(page, card.widgetId)),
      removed: false,
    }))
  );
  const write = await page.request.put("/admin/api/dashboard/layout", {
    data: {
      placements: [
        {
          id,
          widgetId: OVER_TIME,
          w: 6,
          h: 3,
          removed: false,
          // A collection, so the chart and its "View as table" are drawn.
          config: { collection: "posts" },
        },
        ...layout.placements.filter(
          p => !ours.has(p.id) && !widgets.has(p.widgetId)
        ),
        ...added,
      ],
      version: layout.version,
      scope: layout.scope,
    },
  });
  expect(write.ok(), await write.text()).toBe(true);
  return id;
}

/** The widths the surfaces are scanned at: a desktop's and a phone's. */
const SCANNED_WIDTHS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

for (const theme of ["light", "dark"] as Theme[]) {
  for (const viewport of SCANNED_WIDTHS) {
    test(`every surface passes axe (${theme}, ${viewport.width}px): at rest with every core card, System health's Details, customising, the add drawer, the settings drawer`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await gotoAdmin(page, "/", theme);
      const card = await placeOverTime(page);
      await dashboardAtRest(page, theme);
      const cell = page.locator(`${CELLS}[data-placement-id="${card}"]`);

      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await scan(page, "at rest");

      // System health's Details, with the report it copies.
      const health = page.getByTestId("widget-cell-core/system-health");
      await health.getByRole("button", { name: "Details" }).click();
      await expect(page.getByTestId("system-health-report")).toBeVisible();
      await scan(page, "System health's Details");
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("system-health-details")).toBeHidden();

      // The card's menu at rest.
      await cell.getByTestId("card-menu").click();
      await expect(page.getByRole("menu")).toBeVisible();
      await scan(page, "card menu at rest");

      // Its settings drawer, opened from Settings… in that menu, beside the dashboard it changes:
      // the preview, then Content, Display and Size, all open.
      await page.getByRole("menuitem", { name: "Settings…" }).click();
      const settings = page.getByTestId("widget-settings-drawer");
      await expect(settings).toBeVisible();
      await expect(settings.getByLabel("Title", { exact: true })).toBeVisible();
      await expect(
        settings.getByRole("radiogroup", { name: "Width" })
      ).toBeVisible();
      await scan(page, "settings drawer at rest");
      await settings.getByRole("button", { name: "Cancel" }).click();
      await expect(settings).toBeHidden();

      await page.getByTestId("dashboard-edit-begin").click();
      await expect(bar(page)).toBeVisible();
      await scan(page, "customise mode");

      // The card's menu while customising, with its moves and Remove.
      await cell.getByTestId("card-actions").click();
      await expect(page.getByRole("menu")).toBeVisible();
      await scan(page, "card menu in customise mode");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu")).toHaveCount(0);

      // The settings drawer while customising, opened from Settings… in the card's menu.
      await cell.getByTestId("card-actions").click();
      await page.getByRole("menuitem", { name: "Settings…" }).click();
      await expect(
        settings.getByRole("radiogroup", { name: "Width" })
      ).toBeVisible();
      await scan(page, "settings drawer in customise mode");
      await page.keyboard.press("Escape");
      await expect(settings).toBeHidden();

      await bar(page).getByRole("button", { name: "Add widget" }).click();
      const panel = gallery(page);
      await expect(panel.getByTestId("add-panel-list")).toBeVisible();
      await scan(page, "add panel");

      // Contrast of the panel's text is inside the scan above; nothing here saves.
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
    });
  }
}

test("a keyboard alone adds a collection card from the list, changes its settings in the drawer and saves, focus coming back each time", async ({
  page,
}) => {
  await dashboardAtRest(page, "light");
  const customize = page.getByTestId("dashboard-edit-begin");

  // Into customise mode from the cog, reached by Tab.
  await tabTo(page, customize);
  await page.keyboard.press("Enter");
  await expect(bar(page)).toBeFocused();

  // The panel, from Add widget: focus in its search.
  const addWidget = bar(page).getByRole("button", { name: "Add widget" });
  await tabTo(page, addWidget);
  await page.keyboard.press("Enter");
  const panel = gallery(page);
  const search = panel.getByRole("searchbox", { name: "Search widgets" });
  await expect(search).toBeFocused();

  // A search, its count said.
  await page.keyboard.type("over");
  const live = panel.getByTestId("add-panel-live");
  await expect(live).toHaveText(/^\d+ widgets?\.$/);

  // The widget's Add: the card lands at once, said, focus still on its Add.
  const before = await page.locator(CELLS).count();
  const add = panel.getByRole("button", { name: "Add Over time" });
  await tabTo(page, add);
  await page.keyboard.press("Enter");
  await expect(page.locator(CELLS)).toHaveCount(before + 1);
  await expect(live).toHaveText(/^Added .+\.$/);
  await expectVisibleFocus(add);

  // Closed: focus on the new card's menu button.
  const added = page.locator(CELLS).last();
  await expect(added).toHaveAttribute(
    "data-testid",
    `widget-cell-${OVER_TIME}`
  );
  const placementId = await added.getAttribute("data-placement-id");
  expect(placementId).not.toBeNull();
  const cell = page.locator(`${CELLS}[data-placement-id="${placementId}"]`);
  const actions = cell.getByTestId("card-actions");
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expectVisibleFocus(actions);

  // The card's menu, closed with Escape: focus back on its button.
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expectVisibleFocus(actions);

  // Settings… from the menu: the settings drawer, focus inside it.
  await page.keyboard.press("Enter");
  const settings = page.getByRole("menuitem", { name: "Settings…" });
  await expect(settings).toBeFocused();
  await page.keyboard.press("Enter");
  const drawer = page.getByTestId("widget-settings-drawer");
  await expect(drawer).toBeVisible();
  await expect.poll(() => focusIsIn(drawer)).toBe(true);

  // Its Date range changed from the keyboard: the list opened, the next range chosen.
  const range = drawer.getByRole("combobox", { name: "Date range" });
  await tabTo(page, range);
  const was = (await range.textContent())?.trim();
  await page.keyboard.press("Enter");
  // Each key once the list has focus where it puts it: the chosen range, then the next.
  const options = page.getByRole("listbox").getByRole("option");
  await expect(options.filter({ hasText: was ?? "" }).first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(
    options.filter({ hasText: was ?? "" }).first()
  ).not.toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(range).not.toHaveText(was ?? "");
  // A select marks focus by its border, judged against the drawer's other select.
  await expectVisibleFocus(
    range,
    drawer.getByRole("combobox", { name: "Collection" })
  );

  // Its width, a radio group: the arrows choose the next width.
  const widths = drawer.getByRole("radiogroup", { name: "Width" });
  const chosenWidth = widths.getByRole("radio", { checked: true });
  await tabTo(page, chosenWidth);
  const wasWidth = await chosenWidth.getAttribute("aria-label");
  await page.keyboard.press("ArrowRight");
  await expect(
    widths.getByRole("radio", { checked: true })
  ).not.toHaveAttribute("aria-label", wasWidth ?? "");

  // Saved in the drawer: staged with the session's changes, focus back on the menu button.
  await tabTo(page, drawer.getByRole("button", { name: "Save" }));
  await page.keyboard.press("Enter");
  await expect(drawer).toBeHidden();
  await expectVisibleFocus(actions);

  // Saved from the bar: customise mode closes, focus on Customize.
  await tabTo(page, bar(page).getByRole("button", { name: "Save" }), {
    backward: true,
  });
  await page.keyboard.press("Enter");
  await expect(bar(page)).toBeHidden();
  // Leaving customise mode puts focus on the greeting, the page's heading.
  await expectVisibleFocus(page.getByRole("heading", { level: 1 }));
  const saved = (await readLayout(page)).placements.find(
    p => p.id === placementId
  );
  expect(saved?.widgetId).toBe(OVER_TIME);
  expect(saved?.config?.["collection"]).toBeTruthy();
  expect(saved?.config?.["dateRange"]).toBeDefined();
  expect(saved?.config?.["dateRange"]).not.toBe("30d");

  // At rest: the card's title is no control, and the card menu hands focus back to its button.
  await expect(
    cell.getByRole("heading", { level: 2 }).getByRole("button")
  ).toHaveCount(0);
  const menu = cell.getByTestId("card-menu");
  await tabTo(page, menu);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expectVisibleFocus(menu);

  // Settings… at rest: focus into the drawer, the card retitled there, Save, and focus back on
  // the menu button it was opened from.
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Settings…" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(drawer).toBeVisible();
  await expect.poll(() => focusIsIn(drawer)).toBe(true);
  const ownTitle = drawer.getByLabel("Title", { exact: true });
  await tabTo(page, ownTitle);
  await page.keyboard.type("Keyboard card");
  await tabTo(page, drawer.getByRole("button", { name: "Save" }));
  await page.keyboard.press("Enter");
  await expect(drawer).toBeHidden();
  await expectVisibleFocus(menu);
  await expect(cell.getByRole("heading", { level: 2 })).toHaveText(
    /Keyboard card/
  );
  await expect
    .poll(
      async () =>
        (await readLayout(page)).placements.find(p => p.id === placementId)
          ?.title
    )
    .toBe("Keyboard card");
});

for (const theme of ["light", "dark"] as Theme[]) {
  test(`the greeting and the bar's cog pass axe, the cog's focus drawn and its tooltip shown (${theme})`, async ({
    page,
  }) => {
    await dashboardAtRest(page, theme);
    const cog = page.getByRole("button", { name: "Customize dashboard" });
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await tabTo(page, cog);
    await expectVisibleFocus(cog);
    await expect(page.getByRole("tooltip")).toHaveText("Customize dashboard");
    await scan(page, "the bar's cog with its tooltip");
  });
}

for (const theme of ["light", "dark"] as Theme[]) {
  test(`Team activity's initials pass axe (${theme})`, async ({ page }) => {
    // Something recent to list, so the initials are drawn at all.
    const tag = `${theme}-${Date.now()}`;
    await createEntry(page.request, "posts", {
      title: `Activity ${tag}`,
      slug: `activity-${tag}`,
    });

    await dashboardAtRest(page, theme);
    // The row for the entry just written, so the header's own avatar can't stand in.
    await expect(
      page
        .locator("li")
        .filter({ hasText: `Activity ${tag}` })
        .locator('[data-slot="avatar-fallback"]')
        .first()
    ).toBeVisible();
    await scan(page, "Team activity's initials");
  });
}

test("the add panel says how many it lists for the search that is on", async ({
  page,
}) => {
  await dashboardAtRest(page, "light");
  await page.getByTestId("dashboard-edit-begin").click();
  await bar(page).getByRole("button", { name: "Add widget" }).click();
  const panel = gallery(page);
  await expect(panel.getByTestId("add-panel-list")).toBeVisible();
  const live = panel.getByTestId("add-panel-live");
  const count = panel.getByTestId("add-panel-count");
  const rows = panel.locator('[data-testid^="add-panel-row-"]');
  const all = await rows.count();
  await expect(count).toHaveText(`${all} widgets`);
  // Opening says nothing: the count line under the search already says it.
  await expect(live).toHaveText("");

  // A search narrows the rows; what is said, and the count line, follow it.
  const search = panel.getByRole("searchbox", { name: "Search widgets" });
  await search.fill("collection");
  await expect.poll(() => rows.count()).toBeLessThan(all);
  const found = await rows.count();
  const foundCount = new RegExp(
    `^${found} ${found === 1 ? "widget" : "widgets"}\\b`
  );
  await expect(count).toHaveText(foundCount);
  await expect(live).toHaveText(foundCount);

  // Nothing found.
  await search.fill("zzzz");
  await expect(panel.getByTestId("add-panel-none")).toBeVisible();
  await expect(live).toHaveText("0 widgets.");
});

/**
 * The controls drawn in `scopes` that a finger cannot use: smaller than 24 by 24 px, or drawn
 * so faintly (opacity under 0.1, its own and its ancestors') that only a hover would show them.
 * A control out of reach (inside `inert` or `aria-hidden`) or not drawn at all is not counted.
 * Each is named by its accessible name, test id or text, with its size, so a failure says which.
 */
async function untouchable(page: Page, scopes: string[]): Promise<string[]> {
  return page.evaluate(selectors => {
    const CONTROL =
      'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="radio"], [role="combobox"], [role="switch"], [role="checkbox"], [role="menuitem"], [role="tab"]';
    const found: string[] = [];
    const seen = new Set<Element>();
    for (const selector of selectors) {
      for (const scope of document.querySelectorAll(selector)) {
        for (const control of scope.querySelectorAll(CONTROL)) {
          if (seen.has(control)) continue;
          seen.add(control);
          if (control.closest("[inert], [aria-hidden='true']")) continue;
          const box = control.getBoundingClientRect();
          const style = getComputedStyle(control);
          if (box.width === 0 || box.height === 0) continue;
          if (style.visibility === "hidden") continue;
          // A visually hidden control (`sr-only`) is clipped to one pixel and is not drawn.
          if (box.width <= 1 && box.height <= 1) continue;
          let opacity = 1;
          for (let at: Element | null = control; at; at = at.parentElement)
            opacity *= Number(getComputedStyle(at).opacity);
          const name =
            control.getAttribute("aria-label") ??
            control.getAttribute("data-testid") ??
            (control.textContent ?? "").trim().slice(0, 40);
          const size = `${Math.round(box.width)}x${Math.round(box.height)}`;
          if (box.width < 24 || box.height < 24)
            found.push(`${name} is ${size}`);
          else if (opacity < 0.1) found.push(`${name} is shown only on hover`);
        }
      }
    }
    return found;
  }, scopes);
}

/** Whether the page scrolls sideways: wider than the window it is drawn in. */
async function scrollsSideways(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth
  );
}

test.describe("on a phone, by touch", () => {
  test.use({ hasTouch: true, isMobile: true });

  test("every control is at least 24 by 24 and shown without hover, at rest, while customising and in each drawer", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoAdmin(page, "/", "light");
    const card = await placeOverTime(page);
    await dashboardAtRest(page, "light");
    // The touch screen this test means: one that cannot hover.
    expect(await page.evaluate(() => matchMedia("(hover: none)").matches)).toBe(
      true
    );
    // The page's own content and the dashboard's action. The bar's breadcrumb is the shell's.
    const PAGE = ["main"];
    const MENU = ['[role="menu"]'];
    const DRAWER = ['[role="dialog"]'];
    const BAR = ['[data-testid="dashboard-edit-bar"]'];

    expect(await untouchable(page, PAGE)).toEqual([]);
    expect(await scrollsSideways(page)).toBe(false);

    // A card's menu, opened by a tap.
    const cell = page.locator(`${CELLS}[data-placement-id="${card}"]`);
    await cell.getByTestId("card-menu").tap();
    await expect(page.getByRole("menu")).toBeVisible();
    expect(await untouchable(page, MENU)).toEqual([]);

    // Its settings drawer.
    await page.getByRole("menuitem", { name: "Settings…" }).tap();
    const settings = page.getByTestId("widget-settings-drawer");
    await expect(
      settings.getByRole("radiogroup", { name: "Width" })
    ).toBeVisible();
    expect(await untouchable(page, DRAWER)).toEqual([]);
    expect(await scrollsSideways(page)).toBe(false);
    await settings.getByRole("button", { name: "Cancel" }).tap();
    await expect(settings).toBeHidden();

    // System health's Details.
    const health = page.getByTestId("widget-cell-core/system-health");
    await health.getByRole("button", { name: "Details" }).tap();
    await expect(page.getByTestId("system-health-report")).toBeVisible();
    expect(await untouchable(page, DRAWER)).toEqual([]);
    expect(await scrollsSideways(page)).toBe(false);
    await page
      .getByTestId("system-health-details")
      .getByRole("button", { name: "Close" })
      .tap();
    await expect(page.getByTestId("system-health-details")).toBeHidden();

    // Customising: the cards, their menus and the bar's controls.
    await page.getByTestId("dashboard-edit-begin").tap();
    await expect(bar(page)).toBeVisible();
    expect(await untouchable(page, [...PAGE, ...BAR])).toEqual([]);
    expect(await scrollsSideways(page)).toBe(false);
    await cell.getByTestId("card-actions").tap();
    await expect(page.getByRole("menu")).toBeVisible();
    expect(await untouchable(page, MENU)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);

    // The add drawer, from the bar's Add widget, drawn as its icon on a phone.
    await bar(page).getByRole("button", { name: "Add widget" }).tap();
    const panel = gallery(page);
    await expect(panel.getByTestId("add-panel-list")).toBeVisible();
    expect(await untouchable(page, DRAWER)).toEqual([]);
    expect(await scrollsSideways(page)).toBe(false);
  });
});
