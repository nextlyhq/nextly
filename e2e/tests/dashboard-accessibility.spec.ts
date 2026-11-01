/**
 * The dashboard held to WCAG 2.2 AA across its surfaces (dashboard-experience R-23): an axe scan
 * of the whole page at rest, in customise mode, with the add gallery open, at its add step and
 * with a card's quick popover open, with its More settings panel open, and the header with its
 * New menu open, in light and in dark; a keyboard-only visit that adds a collection widget
 * through its add step, changes its quick setting and saves, then retitles the card from its More
 * settings panel, with focus back on the control that opened each menu, panel and popover as it
 * closes, drawn with a ring that can be seen (3:1 against what is behind it); the New menu by
 * keyboard; and the gallery's count, said for the chip and the search that are on.
 *
 * Each surface's own spec scans it alone (`dashboard-gallery`, `dashboard-customise`,
 * `dashboard-header`). This one walks them as one reader does, so a defect that shows only once
 * two are on screen together, or only on the way from one to the next, is found here.
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
import { LOCK } from "./support/locks";
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
  page.getByRole("group", { name: "Customize your dashboard" });

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
  return {
    backdrop,
    border: line("border-top"),
    outline: line("outline"),
    rings,
  };
}

/**
 * The colours of every focus indicator `node` draws, each against what is behind it: an outline
 * with a width, each ring of its box shadow, and its border.
 */
function indicatorsOf(drawn: ReturnType<typeof drawnColours>) {
  const outline =
    drawn.outline.style !== "none" && drawn.outline.width > 0
      ? [drawn.outline.color]
      : [];
  return {
    marks: [...outline, ...drawn.rings],
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

/** Puts an Over time card on the reader's dashboard, at its default size. */
async function placeOverTime(page: Page): Promise<string> {
  const layout = await readLayout(page);
  const id = "e2e-a11y-over-time";
  const write = await page.request.put("/admin/api/dashboard/layout", {
    data: {
      placements: [
        { id, widgetId: OVER_TIME, w: 6, h: 3, removed: false },
        ...layout.placements.filter(p => p.id !== id),
      ],
      version: layout.version,
      scope: layout.scope,
    },
  });
  expect(write.ok(), await write.text()).toBe(true);
  return id;
}

for (const theme of ["light", "dark"] as Theme[]) {
  test(`every surface passes axe (${theme}): at rest, customising, the gallery, its add step, the quick popover, More settings`, async ({
    page,
  }) => {
    await gotoAdmin(page, "/", theme);
    const card = await placeOverTime(page);
    await dashboardAtRest(page, theme);
    const cell = page.locator(`${CELLS}[data-placement-id="${card}"]`);

    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await scan(page, "at rest");

    // The quick popover at rest, opened from the card's title.
    await cell.getByTestId("card-title-button").click();
    const popover = page.getByTestId("card-quick-popover");
    await expect(popover).toBeVisible();
    await scan(page, "quick popover at rest");

    // Its More settings panel, opened from the popover, beside the dashboard it changes.
    await popover.getByRole("button", { name: "More settings" }).click();
    const settings = page.getByRole("dialog", { name: /settings$/ });
    await expect(settings).toBeVisible();
    await expect(settings.getByLabel("Title", { exact: true })).toBeVisible();
    await scan(page, "More settings panel");
    await settings.getByRole("button", { name: "Cancel" }).click();
    await expect(settings).toBeHidden();

    // The card's menu at rest.
    await cell.getByTestId("card-menu").click();
    await expect(page.getByRole("menu")).toBeVisible();
    await scan(page, "card menu at rest");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);

    await page.getByTestId("dashboard-edit-begin").click();
    await expect(bar(page)).toBeVisible();
    await scan(page, "customise mode");

    // The card's menu while customising, with its moves and Remove.
    await cell.getByTestId("card-actions").click();
    await expect(page.getByRole("menu")).toBeVisible();
    await scan(page, "card menu in customise mode");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);

    // The quick popover while customising, opened from Settings in the card's menu.
    await cell.getByTestId("card-actions").click();
    await page.getByRole("menuitem", { name: "Settings" }).click();
    await expect(popover).toBeVisible();
    await scan(page, "quick popover in customise mode");
    await page.keyboard.press("Escape");
    await expect(popover).toBeHidden();

    await bar(page).getByRole("button", { name: "Add widget" }).click();
    const panel = gallery(page);
    await expect(panel.getByTestId("add-panel-tiles")).toBeVisible();
    await scan(page, "gallery");

    await panel.getByRole("button", { name: /Over time$/ }).click();
    await expect(panel.getByTestId("add-panel-step")).toBeVisible();
    await expect(panel.getByTestId("settings-preview")).toBeVisible();
    await scan(page, "gallery add step");

    // Contrast of the environment badge's edge, when the config names one, and of the gallery's
    // text are inside the scans above; nothing here saves.
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
  });
}

/**
 * The badge's edge as the built stylesheet draws it, at least 3:1 against what is behind it
 * (dashboard-experience R-23; axe does not judge an edge). Read from the computed style, so a
 * border utility missing from the compiled CSS, or a rule that removes the border, fails here
 * whatever the class list says. Each colour is resolved by painting it, alpha included, and the
 * backdrop is the nearest ancestors' backgrounds composited until one is opaque.
 */
async function expectEdgeContrast(badge: Locator, label: string) {
  await settleTransitions(badge.page());
  const drawn = await badge.evaluate(drawnColours);
  const edge = drawn.border;
  expect(edge.style, `${label}: the badge draws no border`).not.toBe("none");
  expect(
    edge.width,
    `${label}: the badge's border has no width`
  ).toBeGreaterThan(0);
  const ratio = contrastRatio(edge.color, drawn.backdrop);
  expect(
    ratio,
    `${label}: edge rgb(${edge.color.map(Math.round).join(",")}) on rgb(${drawn.backdrop.map(Math.round).join(",")}) is ${ratio.toFixed(2)}:1`
  ).toBeGreaterThanOrEqual(3);
}

for (const theme of ["light", "dark"] as Theme[]) {
  test(`the environment badge passes axe in each tone (${theme})`, async ({
    page,
  }) => {
    // The suite's server names no environment, so the summary read is answered with one: the
    // badge is drawn from that answer alone, as the config's environment reaches it.
    let tone = "neutral";
    await page.route("**/api/dashboard/summary*", async route => {
      try {
        const response = await route.fetch();
        const body = (await response.json()) as Record<string, unknown>;
        await route.fulfill({
          response,
          json: { ...body, environment: { label: "Staging", tone } },
        });
      } catch {
        // A page closed under the request: nothing left to answer.
        await route.abort().catch(() => undefined);
      }
    });
    for (const each of ["neutral", "warning", "critical"]) {
      tone = each;
      await dashboardAtRest(page, theme);
      const badge = page.getByTestId("dashboard-environment");
      await expect(badge).toHaveAttribute("data-tone", each);
      await scan(page, `environment badge, ${each}`);
      await expectEdgeContrast(badge, `${each}, ${theme}`);
    }
  });
}

test("a keyboard alone adds a collection card through its add step, changes its quick setting and saves, focus coming back each time", async ({
  page,
}) => {
  await dashboardAtRest(page, "light");
  const customize = page.getByTestId("dashboard-edit-begin");

  // Into customise mode from Customize, reached by Tab.
  await tabTo(page, customize);
  await page.keyboard.press("Enter");
  await expect(bar(page)).toBeFocused();

  // The gallery, from Add widget: focus in its search.
  const addWidget = bar(page).getByRole("button", { name: "Add widget" });
  await tabTo(page, addWidget);
  await page.keyboard.press("Enter");
  const panel = gallery(page);
  const search = panel.getByRole("searchbox", {
    name: "Search widgets or collections",
  });
  await expect(search).toBeFocused();

  // A search, its count said.
  await page.keyboard.type("over");
  const live = panel.getByTestId("add-panel-live");
  await expect(live).toHaveText(/^\d+ results? for “over”\.$/);

  // The widget's tile, then its add step: focus on the step's heading.
  const tile = panel.getByRole("button", { name: /Over time$/ });
  await tabTo(page, tile);
  await page.keyboard.press("Enter");
  const step = panel.getByTestId("add-panel-step");
  await expect(step.getByRole("heading", { name: /Over time/ })).toBeFocused();
  const collection = step.getByRole("combobox", { name: "Collection" });
  await tabTo(page, collection);
  if ((await collection.inputValue()) === "") {
    await page.keyboard.press("ArrowDown");
  }
  await expect(collection).not.toHaveValue("");

  // Added from the step: said, back in the gallery, focus on the tile it came from.
  const before = await page.locator(CELLS).count();
  await tabTo(page, step.getByRole("button", { name: "Add to dashboard" }));
  await page.keyboard.press("Enter");
  await expect(page.locator(CELLS)).toHaveCount(before + 1);
  await expect(live).toHaveText(/^Added .+\.$/);
  await expect(step).toBeHidden();
  await expectVisibleFocus(tile);

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

  // Settings from the menu: the quick popover, focus inside it.
  await page.keyboard.press("Enter");
  const settings = page.getByRole("menuitem", { name: "Settings" });
  await expect(settings).toBeFocused();
  await page.keyboard.press("Enter");
  const popover = page.getByTestId("card-quick-popover");
  await expect(popover).toBeVisible();
  await expect.poll(() => focusIsIn(popover)).toBe(true);

  // Its Date range changed from the keyboard: the list opened, the next range chosen.
  const range = popover.getByRole("combobox", { name: "Date range" });
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
  await expectVisibleFocus(
    range,
    popover.getByRole("combobox", { name: "Collection" })
  );

  // Closed with Escape: focus back on the menu button it was opened from.
  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
  await expectVisibleFocus(actions);

  // Saved from the bar: customise mode closes, focus on Customize.
  await tabTo(page, bar(page).getByRole("button", { name: "Save" }), {
    backward: true,
  });
  await page.keyboard.press("Enter");
  await expect(bar(page)).toBeHidden();
  await expectVisibleFocus(customize);
  const saved = (await readLayout(page)).placements.find(
    p => p.id === placementId
  );
  expect(saved?.widgetId).toBe(OVER_TIME);
  expect(saved?.config?.["collection"]).toBeTruthy();
  expect(saved?.config?.["dateRange"]).toBeDefined();
  expect(saved?.config?.["dateRange"]).not.toBe("30d");

  // At rest: the popover from the card's title, and the card menu, each back on its opener.
  const title = cell.getByTestId("card-title-button");
  await tabTo(page, title);
  await page.keyboard.press("Enter");
  await expect(popover).toBeVisible();
  await expect.poll(() => focusIsIn(popover)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
  await expectVisibleFocus(title);

  const menu = cell.getByTestId("card-menu");
  await tabTo(page, menu);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expectVisibleFocus(menu);

  // More settings, from the popover the title opens: focus into the sheet, the card retitled
  // there, Done, and focus back on the title the popover was opened from.
  await tabTo(page, title);
  await page.keyboard.press("Enter");
  await expect(popover).toBeVisible();
  await tabTo(page, popover.getByRole("button", { name: "More settings" }));
  await page.keyboard.press("Enter");
  await expect(popover).toBeHidden();
  const sheet = page.getByRole("dialog", { name: /settings$/ });
  await expect(sheet).toBeVisible();
  await expect.poll(() => focusIsIn(sheet)).toBe(true);
  const ownTitle = sheet.getByLabel("Title", { exact: true });
  await tabTo(page, ownTitle);
  await page.keyboard.type("Keyboard card");
  await tabTo(page, sheet.getByRole("button", { name: "Done" }));
  await page.keyboard.press("Enter");
  await expect(sheet).toBeHidden();
  await expectVisibleFocus(title);
  await expect(title).toHaveText(/Keyboard card/);
  await expect
    .poll(
      async () =>
        (await readLayout(page)).placements.find(p => p.id === placementId)
          ?.title
    )
    .toBe("Keyboard card");
});

/** The header's New split button: its caret, and the popover the caret opens. */
const newCaret = (page: Page) =>
  page.getByRole("button", { name: "Choose what to create" });
const newMenuOf = (page: Page) =>
  page.getByRole("dialog", { name: "Choose what to create" });

for (const theme of ["light", "dark"] as Theme[]) {
  test(`the header and its New menu pass axe (${theme})`, async ({ page }) => {
    await dashboardAtRest(page, theme);
    await expect(page.getByTestId("dashboard-new-primary")).toBeVisible();
    await scan(page, "header at rest");
    await newCaret(page).click();
    const menu = newMenuOf(page);
    await expect(
      menu.getByRole("listbox", { name: "Types to create" })
    ).toBeVisible();
    await scan(page, "New menu open");
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  });
}

test("the New menu by keyboard: caret, search, a type chosen; Escape hands focus back to the caret", async ({
  page,
}) => {
  await dashboardAtRest(page, "light");
  const caret = newCaret(page);
  const primary = page.getByTestId("dashboard-new-primary");
  await expect(primary).toHaveAccessibleName(/^New .+/);

  // Opened from the caret by Enter, closed by Escape: focus back on the caret, with a ring.
  await tabTo(page, caret);
  await page.keyboard.press("Enter");
  const menu = newMenuOf(page);
  await expect(menu).toBeVisible();
  await expect(caret).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expectVisibleFocus(caret);

  // Opened again: the playground offers more than ten types, so focus is in the search. A search
  // that keeps several types, the arrow key moving to the second, which the search box names as
  // its active option to a screen reader; Enter creates that type.
  await page.keyboard.press("Enter");
  await expect(menu).toBeVisible();
  const search = menu.getByRole("combobox", { name: "Search types to create" });
  await expect(
    search,
    "the playground's types fit in ten, so the menu offers no search"
  ).toBeFocused();
  // Focus in the search is drawn, not only a caret: the shared input removes its outline.
  await expectVisibleFocus(search);
  await page.keyboard.type("p");
  const options = menu.getByRole("option");
  await expect.poll(() => options.count()).toBeGreaterThan(1);
  await page.keyboard.press("ArrowDown");
  await expect(search).toHaveAttribute("aria-activedescendant", /.+/);
  const active = await search.getAttribute("aria-activedescendant");
  const reached = menu.locator(`[id="${active}"]`);
  await expect(reached).toHaveAttribute("aria-selected", "true");
  const second = await options.nth(1).getAttribute("data-testid");
  expect(await reached.getAttribute("data-testid")).toBe(second);
  const slug = (second ?? "").replace(/^dashboard-new-(recent|type)-/, "");
  await page.keyboard.press("Enter");
  // A choice opens the type's create form, which takes the page and its focus.
  await expect(page).toHaveURL(
    new RegExp(`/admin/collections/${slug}/create$`)
  );
});

test("the gallery says how many it lists for the chip and the search that are on", async ({
  page,
}) => {
  await dashboardAtRest(page, "light");
  await page.getByTestId("dashboard-edit-begin").click();
  await bar(page).getByRole("button", { name: "Add widget" }).click();
  const panel = gallery(page);
  await expect(panel.getByTestId("add-panel-tiles")).toBeVisible();
  const live = panel.getByTestId("add-panel-live");
  const count = panel.getByTestId("add-panel-count");
  const tiles = panel.locator('[data-testid^="add-panel-tile-"]');
  const all = await tiles.count();

  // A chip narrows the tiles; what is said, and the count line, follow it.
  const content = panel
    .getByRole("group", { name: "Filter widgets" })
    .getByRole("button", { name: "Content" });
  await content.focus();
  await page.keyboard.press("Enter");
  await expect(content).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => tiles.count()).toBeLessThan(all);
  const inContent = await tiles.count();
  const contentCount = new RegExp(
    `^${inContent} ${inContent === 1 ? "widget" : "widgets"}\\b`
  );
  await expect.soft(count).toHaveText(contentCount);
  await expect.soft(live).toHaveText(contentCount);

  // Nothing found under it, then Clear: the count said is the chip's, not every widget's.
  await panel
    .getByRole("searchbox", { name: "Search widgets or collections" })
    .fill("zzzz");
  await expect(panel.getByTestId("add-panel-none")).toBeVisible();
  await expect(live).toHaveText(/^0 results for “zzzz”/);
  await panel.getByRole("button", { name: "Clear" }).click();
  await expect(tiles).toHaveCount(inContent);
  await expect.soft(live).toHaveText(contentCount);
  await expect.soft(count).toHaveText(contentCount);
});
