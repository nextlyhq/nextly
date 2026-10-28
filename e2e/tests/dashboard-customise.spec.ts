/**
 * Customise mode in a browser: where focus goes, what the keyboard can reach,
 * what happens on the way out with unsaved changes, the add panel, and axe scans.
 *
 * jsdom has no `inert`, no focus navigation and no `beforeunload` prompt, so
 * the component tests can say which attributes and handlers are there but not
 * what a reader meets. These press the keys and follow the history.
 *
 * Nothing here saves. Each test still returns the reader to the default
 * dashboard when it ends, as `dashboard-arrangement.spec.ts` does, so a test
 * that fails half way leaves the next spec the dashboard a new site has.
 *
 * @module tests/dashboard-customise.spec
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page } from "@playwright/test";

import { test } from "./support/test";
import { gotoAdmin, type Theme } from "./support/admin";
import { LOCK } from "./support/locks";

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ lock: [LOCK.dashboard] });

const CELLS = '[data-testid^="widget-cell-"]';

/** The dashboard's address, with or without the trailing slash. */
const DASHBOARD_PATH = /\/admin\/?$/;

/** WCAG 2.2 AA and every level below it, as `builder-a11y.spec.ts` states. */
const AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * The host app's `<title>`, which the playground's client root layout cannot
 * declare. The reason is given in full in `builder-a11y.spec.ts`.
 */
const HOST_OWNED_RULES = ["document-title"];

/**
 * One known defect outside the dashboard, set aside by rule AND place, as in
 * `dashboard-heading.spec.ts`: `link-name` on the sidebar rail's icon-only
 * links. Every other rule still runs on the rail, and `link-name` still fails
 * anywhere else.
 */
const KNOWN_DEFECT = { rule: "link-name", within: "aside nav" } as const;

/** Back to the default dashboard, through the guarded reset a reader uses. */
async function resetToDefault(page: Page): Promise<void> {
  const read = await page.request.get("/admin/api/dashboard/layout");
  const body = (await read.json()) as { version: number; scope: string };
  if (body.version === 0) return;
  const reset = await page.request.delete(
    `/admin/api/dashboard/layout?version=${body.version}&scope=${encodeURIComponent(body.scope)}`
  );
  expect(reset.status()).toBe(200);
}

function bar(page: Page) {
  return page.getByRole("group", { name: "Customize your dashboard" });
}

/** Opens customise mode from the keyboard. */
async function customize(page: Page): Promise<void> {
  const begin = page.getByTestId("dashboard-edit-begin");
  await begin.focus();
  await page.keyboard.press("Enter");
  await expect(bar(page)).toBeVisible();
}

/** One unsaved change: the first card moved one place later. */
async function moveFirstCardLater(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: /^Card actions for / })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Move later" }).click();
  await expect(bar(page).getByText("Unsaved changes")).toBeVisible();
}

/** The unsaved-changes prompt's buttons, by name, in document order. */
async function promptChoices(page: Page): Promise<string[]> {
  return page
    .getByRole("alertdialog")
    .getByRole("button")
    .evaluateAll(buttons => buttons.map(button => button.textContent ?? ""));
}

/** axe's AA violations on the whole page, named so a failure says what to fix. */
async function expectNoAxeViolations(page: Page): Promise<void> {
  // Scanned once the page has settled: a menu fading out or a moved card's
  // transition caught halfway is a colour the page never rests at, and axe
  // measures its contrast as drawn. Endless animations (a spinner) never
  // settle and are left out of the wait.
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        animation =>
          animation.playState !== "running" ||
          animation.effect?.getTiming().iterations === Number.POSITIVE_INFINITY
      )
  );
  const results = await new AxeBuilder({ page })
    .withTags(AA_TAGS)
    .disableRules(HOST_OWNED_RULES)
    .analyze();
  // A scan of nothing reports no violations too; enough passing rules shows
  // it looked at a drawn page.
  expect(
    results.passes.length,
    "axe reported no passing rules, so it scanned nothing"
  ).toBeGreaterThan(10);
  const findings = [];
  for (const v of results.violations) {
    const targets: string[] = [];
    for (const node of v.nodes) {
      const selector = node.target.map(String).join(" ");
      if (v.id === KNOWN_DEFECT.rule) {
        const inRail = await page.evaluate(
          ([sel, within]) =>
            document.querySelector(sel)?.closest(within) != null,
          [selector, KNOWN_DEFECT.within] as const
        );
        if (inRail) continue;
      }
      targets.push(selector);
    }
    if (targets.length > 0) {
      findings.push({ id: v.id, impact: v.impact ?? "unknown", targets });
    }
  }
  expect(
    findings,
    `axe reported ${findings.length} violation(s):\n${JSON.stringify(findings, null, 2)}`
  ).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

test.afterEach(async ({ page }) => {
  await resetToDefault(page);
});

test("entering by keyboard lands on the bar, and Tab never reaches a card's own link", async ({
  page,
}) => {
  await gotoAdmin(page, "/");
  await expect(page.locator(CELLS).first()).toBeVisible();
  // The positive control: at rest the cards DO hold links of their own, so a
  // Tab walk that meets none in customise mode has measured a fence rather
  // than an empty dashboard.
  // Waited for: a card draws its links once its data arrives, after the
  // card itself, so a count taken at once can read an empty dashboard.
  const cardLinks = page.locator(`${CELLS} a[href]`);
  await expect(cardLinks.first()).toBeVisible();

  await customize(page);
  await expect(bar(page)).toBeFocused();

  // Tab from the bar through every card, until focus leaves the last of them.
  // Each stop inside a card must be one of its edit controls.
  const stops: Array<{ label: string; inCard: boolean; isControl: boolean }> =
    [];
  for (let i = 0; i < 400; i += 1) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate(() => {
      const active = document.activeElement;
      if (!active) return null;
      return {
        label:
          active.getAttribute("aria-label") ?? active.textContent?.trim() ?? "",
        inCard: active.closest('[data-testid^="widget-cell-"]') !== null,
        isControl: active.matches(
          '[data-testid="widget-drag-handle"], [aria-label^="Card actions for "]'
        ),
        onBar: active.closest('[data-testid="dashboard-edit-bar"]') !== null,
      };
    });
    if (!stop) break;
    // Out of the cards once inside them: the grid has been passed.
    if (!stop.inCard && stops.some(seen => seen.inCard)) break;
    // Round the page and back to the bar: every card has been passed.
    if (stop.onBar && stops.some(seen => seen.inCard)) break;
    stops.push(stop);
  }
  const intoCards = stops.filter(stop => stop.inCard);
  expect(intoCards.length, "Tab never reached the cards").toBeGreaterThan(0);
  expect(intoCards.filter(stop => !stop.isControl)).toEqual([]);
  // And the links are still drawn, each inside the fence.
  await expect(cardLinks.first()).toBeVisible();
  expect(
    await cardLinks.evaluateAll(links =>
      links.every(link => link.closest("[inert]") !== null)
    )
  ).toBe(true);
});

test("moving within the admin with unsaved changes asks, and Keep Editing stays", async ({
  page,
}) => {
  await gotoAdmin(page, "/");
  await customize(page);
  await moveFirstCardLater(page);

  // An ordinary in-app link: the sidebar's, to any page but this one.
  await page.locator('aside nav a[href^="/admin/"]').first().click();

  const prompt = page.getByRole("alertdialog");
  await expect(prompt).toBeVisible();
  expect(await promptChoices(page)).toEqual([
    "Discard Changes",
    "Keep Editing",
    "Save Changes",
  ]);
  const keep = prompt.getByRole("button", { name: "Keep Editing" });
  await expect(keep).toBeFocused();
  await expect(page).toHaveURL(DASHBOARD_PATH);

  await page.keyboard.press("Enter");
  await expect(prompt).toBeHidden();
  await expect(page).toHaveURL(DASHBOARD_PATH);
  await expect(bar(page).getByText("Unsaved changes")).toBeVisible();
});

test("going Back with unsaved changes asks, and Keep Editing stays", async ({
  page,
}) => {
  // Reach the dashboard from another admin page inside the app, so Back has
  // an in-app entry to go to. Through `history.pushState`, which is how the
  // admin's own links move: its router hears it and draws the page.
  await gotoAdmin(page, "/");
  const elsewhere = await page
    .locator('aside nav a[href^="/admin/"]')
    .first()
    .getAttribute("href");
  expect(elsewhere).not.toBeNull();
  await page.evaluate(
    path => window.history.pushState(null, "", path),
    elsewhere
  );
  await expect(page).not.toHaveURL(DASHBOARD_PATH);
  await page.evaluate(() => window.history.pushState(null, "", "/admin"));
  await expect(page).toHaveURL(DASHBOARD_PATH);
  await expect(page.locator(CELLS).first()).toBeVisible();

  await customize(page);
  await moveFirstCardLater(page);

  // From the page itself, as the browser's Back button does: Playwright's
  // own `goBack` waits for a navigation the guard is there to hold.
  await page.evaluate(() => window.history.back());

  const prompt = page.getByRole("alertdialog");
  await expect(prompt).toBeVisible();
  await expect(page).toHaveURL(DASHBOARD_PATH);
  // Still the dashboard behind the question, not the page Back was going to.
  // Found among hidden elements: the prompt is modal, so everything behind it
  // is out of the accessibility tree while it shows, though still drawn.
  await expect(
    page.getByRole("group", {
      name: "Customize your dashboard",
      includeHidden: true,
    })
  ).toBeVisible();
  await prompt.getByRole("button", { name: "Keep Editing" }).click();
  await expect(prompt).toBeHidden();
  await expect(page).toHaveURL(DASHBOARD_PATH);
  await expect(bar(page).getByText("Unsaved changes")).toBeVisible();
});

test("reloading with unsaved changes gets the browser's own prompt", async ({
  page,
}) => {
  await gotoAdmin(page, "/");
  await customize(page);
  await moveFirstCardLater(page);

  const dialog = page.waitForEvent("dialog");
  // Started from the page, which the browser runs `beforeunload` for; not
  // awaited, because the reload waits on the answer to the prompt.
  void page.evaluate(() => window.location.reload()).catch(() => undefined);
  const prompt = await dialog;
  expect(prompt.type()).toBe("beforeunload");
  await prompt.dismiss();

  // Dismissed, the page stays, changes and all.
  await expect(bar(page).getByText("Unsaved changes")).toBeVisible();
});

for (const theme of ["light", "dark"] as Theme[]) {
  test(`customise mode passes axe at 1440 (${theme})`, async ({ page }) => {
    await gotoAdmin(page, "/", theme);
    await expect(page.locator(CELLS).first()).toBeVisible();
    await customize(page);
    // With a change made, so the unsaved-changes marker is scanned too.
    await moveFirstCardLater(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expectNoAxeViolations(page);
  });
}

/** Opens the add panel from the bar, and waits for focus to land in its search. */
async function openAddPanel(page: Page) {
  await bar(page).getByRole("button", { name: "Add widget" }).click();
  const panel = page.getByRole("dialog", { name: "Add widget" });
  await expect(
    panel.getByRole("searchbox", { name: "Search widgets" })
  ).toBeFocused();
  return panel;
}

/**
 * The next control in the panel that puts a card on the dashboard: a new card (Add, Add
 * another) where one is offered, else a removed card back. Whichever widgets the site offers,
 * so the visit does not depend on them.
 */
function nextAdd(panel: Locator): Locator {
  const fresh = panel.locator(
    '[data-testid^="add-panel-add-"]:not([data-testid^="add-panel-add-back-"]):enabled'
  );
  const back = panel.locator('[data-testid^="add-panel-add-back-"]');
  return fresh.or(back).first();
}

test("the add panel adds three cards in one visit, each said and ringed, and closing lands on the last", async ({
  page,
}) => {
  await gotoAdmin(page, "/");
  await expect(page.locator(CELLS).first()).toBeVisible();
  await customize(page);
  // Three cards out of the draft first, so there is something to put back on any site.
  for (let i = 0; i < 3; i += 1) {
    await page
      .getByRole("button", { name: /^Card actions for / })
      .first()
      .click();
    await page.getByRole("menuitem", { name: "Remove" }).click();
  }
  const before = await page.locator(CELLS).count();

  const panel = await openAddPanel(page);
  for (let added = 1; added <= 3; added += 1) {
    await nextAdd(panel).click();
    await expect(page.locator(CELLS)).toHaveCount(before + added);
    await expect(panel.getByTestId("add-panel-live")).toHaveText(
      new RegExp(`^Added (back )?.+ at position \\d+ of ${before + added}\\.$`)
    );
    // Still open, and focus still inside it.
    await expect(panel).toBeVisible();
    expect(
      await panel.evaluate(node => node.contains(document.activeElement))
    ).toBe(true);
    await expect(page.locator(`${CELLS}[data-highlighted]`)).toHaveCount(1);
  }

  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  const ringed = page.locator(`${CELLS}[data-highlighted]`);
  await expect(ringed).toBeInViewport();
  await expect(
    ringed.getByRole("button", { name: /^Card actions for / })
  ).toBeFocused();
});

for (const theme of ["light", "dark"] as Theme[]) {
  for (const viewport of [
    { name: "1440", width: 1440, height: 900 },
    { name: "phone 390", width: 390, height: 844 },
  ]) {
    test(`the add panel passes axe at ${viewport.name} (${theme}), every control at least 24px`, async ({
      page,
    }) => {
      // Customise mode is offered at every width, so it is entered at the one measured.
      await page.setViewportSize(viewport);
      await gotoAdmin(page, "/", theme);
      await expect(page.locator(CELLS).first()).toBeVisible();
      await customize(page);
      // One card removed, so the Removed group and its Add back are scanned too.
      await page
        .getByRole("button", { name: /^Card actions for / })
        .first()
        .click();
      await page.getByRole("menuitem", { name: "Remove" }).click();
      const panel = await openAddPanel(page);
      if (viewport.width < 640) {
        // Full width on a phone.
        expect((await panel.boundingBox())?.width).toBe(viewport.width);
      }

      await expectNoAxeViolations(page);

      // WCAG 2.5.8's minimum, measured on every control the panel draws.
      const small = await panel
        .locator("button:visible, input:visible")
        .evaluateAll(controls =>
          controls.flatMap(control => {
            const box = control.getBoundingClientRect();
            return box.width < 24 || box.height < 24
              ? [
                  `${control.getAttribute("aria-label") ?? control.textContent?.trim()}: ${box.width}x${box.height}`,
                ]
              : [];
          })
        );
      expect(small).toEqual([]);
    });
  }
}

/** The cards' placements in the order the grid draws them. */
async function cardOrder(page: Page): Promise<string[]> {
  return page
    .locator(CELLS)
    .evaluateAll(cells =>
      cells.map(cell => cell.getAttribute("data-placement-id") ?? "")
    );
}

/** Where a drawn element is; one not drawn fails the test here, rather than measuring as zero. */
async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (box === null) throw new Error(`not drawn: ${String(locator)}`);
  return box;
}

/** The drawn rectangles of every card but one, to show they stayed put. */
async function otherBoxes(page: Page, except: string) {
  // From the grid's own corner rather than the window's: a drag toward a card below the fold
  // scrolls the page, which moves every card on screen without moving any within the grid.
  return page
    .locator(`${CELLS}:not([data-placement-id="${except}"])`)
    .evaluateAll(cells =>
      cells.map(cell => {
        const grid = cell.closest('[aria-label="Dashboard widgets"]');
        const origin = grid?.getBoundingClientRect() ?? { left: 0, top: 0 };
        const r = cell.getBoundingClientRect();
        return [
          r.left - origin.left,
          r.top - origin.top,
          r.width,
          r.height,
        ].map(Math.round);
      })
    );
}

test("a pointer drag shows a line, moves nothing else, and puts the card down after the one it was over", async ({
  page,
}) => {
  // Tall enough that the card dragged to is on screen and clear of the bottom edge: a pointer
  // held there scrolls the page, as it should, and the card would land wherever the scroll
  // stopped rather than after the one aimed at.
  await page.setViewportSize({ width: 1440, height: 2400 });
  await gotoAdmin(page, "/");
  await expect(page.locator(CELLS).nth(2)).toBeVisible();
  await customize(page);
  // Mixed widths: the first card that may change width put at the narrowest its bounds allow
  // (the menu lists them narrowest first), so rows hold cards of different spans whatever that
  // card is. A card of one fixed width offers no Width, so the menus are tried in turn.
  // By keyboard: this test is about the drag, and the submenu opens on the arrow with focus on
  // its first width, wherever the pointer is.
  const menus = page.getByRole("button", { name: /^Card actions for / });
  for (let index = 0; ; index += 1) {
    expect(index, "no card on the dashboard may change width").toBeLessThan(
      await menus.count()
    );
    await menus.nth(index).click();
    if ((await page.getByTestId("card-width-menu").count()) > 0) break;
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
  }
  await page.getByTestId("card-width-menu").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("menuitemradio").first()).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toHaveCount(0);

  const before = await cardOrder(page);
  const [held, , target] = before;
  const handle = page
    .locator(`${CELLS}[data-placement-id="${held}"]`)
    .getByTestId("widget-drag-handle");
  const from = await handle.boundingBox();
  const over = await page
    .locator(`${CELLS}[data-placement-id="${target}"]`)
    .boundingBox();
  if (from === null || over === null) throw new Error("nothing to drag");
  const still = await otherBoxes(page, held);

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  // Into the target's second half: after it, whichever way it is split.
  const x = over.x + over.width * 0.75;
  const y = over.y + over.height * 0.75;
  await page.mouse.move(x, y, { steps: 12 });

  await expect(page.getByTestId("widget-drop-line")).toBeVisible();
  await expect(page.getByTestId("widget-drag-chip")).toBeVisible();
  expect(await otherBoxes(page, held)).toEqual(still);
  expect(await cardOrder(page)).toEqual(before);

  await page.mouse.up();
  const after = before.filter(id => id !== held);
  after.splice(after.indexOf(target) + 1, 0, held);
  await expect.poll(() => cardOrder(page)).toEqual(after);
  await expect(page.getByTestId("widget-grid-live")).toHaveText(
    new RegExp(
      `moved from 1 to ${after.indexOf(held) + 1} of ${after.length}\\.`
    )
  );
  await expect(page.getByTestId("widget-drop-line")).toHaveCount(0);
  await expect(
    page.locator(`${CELLS}[data-placement-id="${held}"]`)
  ).toHaveAttribute("data-highlighted", "true");
});

test("a keyboard drag moves the card, and its handle keeps focus in view below the bar", async ({
  page,
}) => {
  await gotoAdmin(page, "/");
  await expect(page.locator(CELLS).nth(2)).toBeVisible();
  await customize(page);
  const before = await cardOrder(page);
  const held = before[0];
  const handle = page
    .locator(`${CELLS}[data-placement-id="${held}"]`)
    .getByTestId("widget-drag-handle");

  await handle.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("widget-drop-line")).toBeVisible();
  await page.keyboard.press("Space");

  const after = before.filter(id => id !== held);
  after.splice(2, 0, held);
  await expect.poll(() => cardOrder(page)).toEqual(after);
  await expect(handle).toBeFocused();
  await expect(handle).toBeInViewport();
  // Not hidden under the sticky bar (WCAG 2.4.11).
  const barBox = await bar(page).boundingBox();
  const handleBox = await handle.boundingBox();
  expect(handleBox?.y ?? 0).toBeGreaterThanOrEqual(
    (barBox?.y ?? 0) + (barBox?.height ?? 0) - 1
  );
});

test.describe("on a phone, with touch", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  // The file's own beforeEach sets 1440 for every test, after `test.use` has sized the page, so
  // the phone width is set again here, last.
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test("moves, resizes, removes, adds, resets and saves from the menus and the bar, with no handle", async ({
    page,
  }) => {
    await gotoAdmin(page, "/");
    await expect(page.locator(CELLS).nth(1)).toBeVisible();
    await page.getByTestId("dashboard-edit-begin").tap();
    await expect(bar(page)).toBeVisible();
    await expect(page.getByTestId("widget-drag-handle")).toHaveCount(0);

    const menu = (n: number) =>
      page.getByRole("button", { name: /^Card actions for / }).nth(n);
    const before = await cardOrder(page);

    // Move.
    await menu(0).tap();
    await page.getByRole("menuitem", { name: "Move later" }).tap();
    await expect
      .poll(() => cardOrder(page))
      .toEqual([before[1], before[0], ...before.slice(2)]);

    // Resize: the sizes are listed in place in the card menu, which fits the screen.
    await menu(0).tap();
    await expect(page.getByTestId("card-width-menu")).toHaveCount(0);
    await expect(page.getByTestId("card-height-menu")).toHaveCount(0);
    const choice = page.getByRole("menuitemradio").first();
    await expect(choice).toBeInViewport({ ratio: 1 });
    await choice.tap();
    await expect(page.getByRole("menu")).toHaveCount(0);

    // Remove, then add one back from the panel, which takes the whole width.
    await menu(0).tap();
    await page.getByRole("menuitem", { name: "Remove" }).tap();
    await bar(page).getByRole("button", { name: "Add widget" }).tap();
    const panel = page.getByRole("dialog", { name: "Add widget" });
    expect((await panel.boundingBox())?.width).toBe(390);
    await panel.locator('[data-testid^="add-panel-add-back-"]').first().tap();
    await panel.getByRole("button", { name: "Close" }).tap();
    await expect(panel).toBeHidden();

    // Reset, confirmed, then Save.
    const reset = bar(page).getByRole("button", { name: "Reset to default" });
    if ((await reset.count()) > 0) {
      await reset.tap();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Reset dashboard" })
        .tap();
    }
    await bar(page).getByRole("button", { name: "Save" }).tap();
    await expect(bar(page)).toBeHidden();
    await expect(page.getByTestId("dashboard-edit-begin")).toBeVisible();
  });

  for (const theme of ["light", "dark"] as Theme[]) {
    test(`customise mode passes axe at 390 (${theme}), its bar laid out for a phone`, async ({
      page,
    }) => {
      await gotoAdmin(page, "/", theme);
      await expect(page.locator(CELLS).first()).toBeVisible();
      await customize(page);
      await moveFirstCardLater(page);
      // Cancel leading, Save trailing, Add widget below them.
      const button = (name: string) =>
        boxOf(bar(page).getByRole("button", { name }));
      const [cancel, save, add] = await Promise.all([
        button("Cancel"),
        button("Save"),
        button("Add widget"),
      ]);
      expect(cancel.x).toBeLessThan(save.x);
      expect(add.y).toBeGreaterThan(cancel.y);
      // The hint on a row of its own below Cancel and Save, across the bar, not squeezed between
      // the two buttons.
      const [status, whole] = await Promise.all([
        boxOf(bar(page).getByTestId("dashboard-edit-status")),
        boxOf(bar(page)),
      ]);
      expect(status.y).toBeGreaterThanOrEqual(cancel.y + cancel.height);
      expect(status.width).toBeGreaterThan(whole.width / 2);
      await expectNoAxeViolations(page);
    });
  }
});
