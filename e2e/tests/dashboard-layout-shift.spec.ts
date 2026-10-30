/**
 * How far the dashboard moves while it loads: the cumulative layout shift from the first paint
 * until every card has settled, at desktop and phone widths.
 *
 * Layout shift counts EXISTING content moving, not new content appearing, so the number asserted
 * is what a reader sees jump: cards drawn in one order and redrawn in another, or a card that
 * changes height when its answer arrives and moves the cards after it.
 *
 * - **Cold:** a fresh load, nothing cached. The bound is 0.1. The one change an answer may bring
 *   is a list closing up over rows it did not need, and that stays under it.
 * - **Warm:** back on the dashboard within the same session, its arrangement and answers cached.
 *   Nothing on the dashboard moves at all.
 *
 * What is asserted for the dashboard is what the DASHBOARD moves: a shift counts as the
 * dashboard's when one of the elements it moved lies inside the dashboard's container. The admin
 * shell around it (the header, the sidebar and its panels) is everything else, reported beside it.
 *
 * The shell holds its own place on a cold load: its navigation and the header's account controls
 * are drawn where they settle, so no element of the shell moves at all, in a shift of its own or
 * in one that moved the dashboard too. That is asserted only against a production build
 * (`E2E_SERVER=production`, how CI runs this suite), because when the shell's pieces arrive
 * depends on bundling and loading order, which `next dev` compiling on request does not share
 * with what ships.
 *
 * - **Round trip:** from the dashboard to a collection and back, on the wide layout the second
 *   sidebar panel opening and closing. There the dashboard's container is gone for part of the
 *   window, so a shift is the shell's only when the elements it moved lie outside the routed
 *   screen's `main`; the destination's own settling is reported, not asserted. A column that
 *   slides is named in a shift entry by its own content, which that rule charges to the routed
 *   screen, so the main column's box is also compared directly: before the panel opens, while it
 *   is open and after it closes. The phone runs as the control, where the panel overlays in the
 *   navigation drawer and nothing reflows.
 *
 * On the e2e dev server, which compiles on first request, the first visit warms the route and
 * only the second is measured; the production server is measured the same way. Each value is
 * attached to the report, so a change in it can be quoted with its conditions.
 *
 * @module tests/dashboard-layout-shift.spec
 */
import { expect, type Page } from "@playwright/test";

import { test } from "./support/test";
import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { leaveReleasesAsTheRunnerWould } from "./support/release-states";
import { cancel, post, release, schedule } from "./support/releases-api";
import { mainColumnBox, waitForShellAnswers } from "./support/shell-geometry";

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({
  lock: [LOCK.dashboard, LOCK.heavy, LOCK.releases],
});

/** The cold-load ceiling. */
const MAX_COLD_SHIFT = 0.1;

/** The ceiling for the shell's share of a round trip between the dashboard and a collection. */
const MAX_ROUND_TRIP_SHELL_SHIFT = 0.01;

/** What a shift's elements must lie inside to be the measured screen's rather than the shell's. */
const DASHBOARD_SCOPE = '[data-testid="dashboard-container"]';
/** The same, for a window that leaves the dashboard: whatever screen is routed. */
const ROUTED_SCOPE = "main";

/** Whether the server is a production build, where the shell's share is asserted. */
const PRODUCTION_SERVER = process.env.E2E_SERVER === "production";

const WIDTHS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
];

interface Shift {
  /** Entries that moved only the dashboard. */
  dashboard: number;
  /** Entries that moved the dashboard AND the shell in one frame: counted against the dashboard. */
  mixed: number;
  /** Entries that moved only the shell. */
  shell: number;
  /**
   * Shell elements that moved, counted in EVERY entry: one that moved only the shell, and one
   * that moved it beside the dashboard. An entry's value cannot be split between the elements it
   * moved, but the elements can be told apart, so this, not the shell's share, says whether the
   * shell moved at all.
   */
  shellMoves: number;
  /** What each shell element moved, from where to where, so a red names the element. */
  shellSources: string[];
}

/**
 * Records layout shifts from before the page's first script runs, so the first paint is inside
 * the window, each counted as the dashboard's or the shell's by what it moved: inside the scope
 * (the dashboard's container, until `measureLeavingTheDashboard` widens it) or not. Shifts within
 * 500 ms of input are left out, as the metric itself does, which is why the warm case navigates
 * with script-issued clicks: those are not a reader's input, so a shift they cause still counts.
 */
async function recordShifts(page: Page): Promise<void> {
  await page.addInitScript(scope => {
    const host = window as unknown as { __shiftScope: string };
    host.__shiftScope = scope;
    const record = {
      dashboard: 0,
      mixed: 0,
      shell: 0,
      shellMoves: 0,
      shellSources: [] as string[],
    };
    (window as unknown as { __shift: typeof record }).__shift = record;
    // An element by its tag and accessible name, and its box before and after the move.
    const describe = (source: {
      node: Node | null;
      previousRect: DOMRectReadOnly;
      currentRect: DOMRectReadOnly;
    }): string => {
      const node = source.node;
      const label =
        node instanceof Element ? node.getAttribute("aria-label") : null;
      const name =
        node instanceof Element
          ? `${node.tagName.toLowerCase()}${label ? `[${label}]` : ""}`
          : (node?.nodeName ?? "removed");
      const box = (rect: DOMRectReadOnly) =>
        `${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}x${Math.round(rect.height)}`;
      return `${name} ${box(source.previousRect)} -> ${box(source.currentRect)}`;
    };
    new PerformanceObserver(list => {
      for (const entry of list.getEntries() as PerformanceEntry[] &
        {
          value: number;
          hadRecentInput: boolean;
          sources: {
            node: Node | null;
            previousRect: DOMRectReadOnly;
            currentRect: DOMRectReadOnly;
          }[];
        }[]) {
        if (entry.hadRecentInput) continue;
        // An entry's value cannot be split between the elements it moved, so one that moved
        // both is charged to the dashboard: the measurement may over-state the dashboard's
        // share, never hide it. `mixed` keeps it visible in the report, so a red caused by
        // the shell moving in the same frame is told apart from the dashboard's own.
        const inside = entry.sources.map(
          source =>
            source.node instanceof Element &&
            source.node.closest(host.__shiftScope) !== null
        );
        const kind = inside.every(Boolean)
          ? "dashboard"
          : inside.some(Boolean)
            ? "mixed"
            : "shell";
        record[kind] += entry.value;
        // The shell's elements in this entry, whichever share its value went to.
        const shellMoved = entry.sources.filter((_, index) => !inside[index]);
        record.shellMoves += shellMoved.length;
        if (shellMoved.length > 0) {
          record.shellSources.push(
            `${kind} ${entry.value.toFixed(4)}: ${shellMoved.map(describe).join("; ")}`
          );
        }
      }
    }).observe({ type: "layout-shift", buffered: true });
  }, DASHBOARD_SCOPE);
}

/**
 * Starts a window that leaves the dashboard: counts from here on, with a shift charged to the
 * shell only when the elements it moved lie outside the routed screen, whichever screen that is.
 */
const measureLeavingTheDashboard = (page: Page) =>
  page.evaluate(scope => {
    (window as unknown as { __shiftScope: string }).__shiftScope = scope;
  }, ROUTED_SCOPE);

const shiftSoFar = (page: Page): Promise<Shift> =>
  page.evaluate(() => {
    const record = (window as unknown as { __shift: Shift }).__shift;
    return { ...record, shellSources: [...record.shellSources] };
  });

const forgetShifts = (page: Page) =>
  page.evaluate(() => {
    const record = (window as unknown as { __shift: Shift }).__shift;
    record.dashboard = 0;
    record.mixed = 0;
    record.shell = 0;
    record.shellMoves = 0;
    record.shellSources.length = 0;
  });

/** Writes the figures, and what the shell moved, where the report and the log can be read. */
function report(
  info: { annotations: { type: string; description?: string }[] },
  label: string,
  shift: Shift,
  scope = "dashboard"
): void {
  const line = `${label}: ${scope} ${shift.dashboard.toFixed(4)}, mixed ${shift.mixed.toFixed(4)}, shell ${shift.shell.toFixed(4)}, shell elements moved ${shift.shellMoves}`;
  info.annotations.push({ type: "layout-shift", description: line });
  console.log(`LAYOUT-SHIFT ${line}`);
  for (const source of shift.shellSources) {
    console.log(`LAYOUT-SHIFT   shell ${source}`);
  }
}

/**
 * Every card drawn and none still loading, and the shell's own answers in, held for a second: the
 * end of the window. A second of stillness, because a batch can settle and a later one start
 * moments after.
 *
 * The shell's answers (the workspace, the permissions, the collections and Singles) are waited on
 * apart from the cards', since nothing ties when they arrive to when the cards settle: one that
 * arrives later than the second of stillness would otherwise move the shell after the window
 * closed. The header's controls row and the sidebar's rail each mark themselves
 * `data-shell-answers="pending"` until the answers they draw from are in.
 */
async function waitForSettled(page: Page): Promise<void> {
  // Drawn cards only: a card the dashboard is drawn without while empty keeps a cell it never
  // shows.
  const cells = page
    .locator('[data-testid^="widget-cell-"]')
    .filter({ visible: true });
  await expect(cells.first()).toBeVisible({ timeout: 60_000 });
  // Nothing still loading: no card marked busy, AND no skeleton drawn anywhere (every skeleton
  // the UI kit draws is marked `data-slot="skeleton"`). A card that draws its own body (a
  // component card) shows its own placeholders while its requests run, and the frame does not
  // mark it busy for those, so busy alone would end the window early.
  const loading = page.locator(
    'main [aria-busy="true"], main [data-slot="skeleton"], main [data-testid="widget-grid-loading"]'
  );
  await expect(loading).toHaveCount(0, { timeout: 60_000 });
  await waitForShellAnswers(page);
  const shellPending = page.locator('[data-shell-answers="pending"]');
  await page.waitForTimeout(1_000);
  await expect(loading).toHaveCount(0);
  await expect(shellPending).toHaveCount(0);
}

/** Follows the link at `href` the way the app does, without it counting as a reader's input. */
async function followLink(page: Page, href: string): Promise<void> {
  await page.evaluate(target => {
    const link = document.querySelector<HTMLAnchorElement>(
      `a[href="${target}"]`
    );
    if (!link) throw new Error(`no link to ${target}`);
    link.click();
  }, href);
}

/**
 * Each case on two sites: one where nothing waits for the reader, so Needs your attention hides
 * while empty, and one where an overdue release waits, so it is placed. The card is decided
 * before the first paint either way: neither its leaving nor its arriving may move the page.
 */
const SITES = [
  { name: "nothing waiting", overdue: false },
  { name: "an overdue release waiting", overdue: true },
];

const DAY = 24 * 60 * 60 * 1000;

for (const site of SITES) {
  test.describe(site.name, () => {
    const seeded: Array<{ id: string; outcome: "overdue" }> = [];

    test.beforeEach(async ({ page }) => {
      if (!site.overdue) return;
      const stamp = Date.now().toString(36);
      const postId = await post(page, stamp);
      const id = await release(page, `Layout shift overdue ${stamp}`, postId);
      await schedule(page, id, new Date(Date.now() + 40 * DAY), "UTC");
      seeded.push({ id, outcome: "overdue" });
      await leaveReleasesAsTheRunnerWould(page, seeded);
    });

    test.afterEach(async ({ page }) => {
      // Left as they were found: an overdue release of this spec's would place the card on
      // every later spec's dashboard.
      for (const { id } of seeded.splice(0)) await cancel(page, id);
    });

    /** On the site with an item waiting, the card is on the page measured. */
    async function cardAsTheSiteHasIt(page: Page): Promise<void> {
      if (!site.overdue) return;
      await expect(
        page
          .getByTestId("widget-cell-core/needs-attention")
          .filter({ visible: true })
      ).toBeVisible();
    }

    for (const size of WIDTHS) {
      test(`moves less than ${MAX_COLD_SHIFT} on a cold load (${size.name})`, async ({
        page,
      }, info) => {
        test.setTimeout(240_000);
        await page.setViewportSize({ width: size.width, height: size.height });
        await recordShifts(page);
        // Warm the route (on the dev server, its compile), then measure a fresh load of it.
        await gotoAdmin(page, "/");
        await waitForSettled(page);
        await page.reload();
        await waitForSettled(page);
        await cardAsTheSiteHasIt(page);
        const shift = await shiftSoFar(page);
        report(info, `cold ${site.name} ${size.name} ${size.width}px`, shift);
        expect(shift.dashboard + shift.mixed).toBeLessThan(MAX_COLD_SHIFT);
        if (PRODUCTION_SERVER) {
          // No shell element moved: the shell's regions are drawn at the size they settle at, so
          // the only way for this to go red is for something already painted to move. Counted by
          // element rather than read from the shell's share, which leaves out a shift that moved
          // the dashboard in the same frame.
          expect(
            shift.shellMoves,
            `the shell moved: ${shift.shellSources.join(" | ")}`
          ).toBe(0);
        }
      });

      test(`does not move at all on a warm return (${size.name})`, async ({
        page,
      }, info) => {
        test.setTimeout(240_000);
        await page.setViewportSize({ width: size.width, height: size.height });
        await recordShifts(page);
        await gotoAdmin(page, "/");
        await waitForSettled(page);
        // Away and back within the session: the arrangement and the answers are cached.
        await followLink(page, "/admin/collections/posts");
        await page.waitForURL(/\/admin\/collections\/posts/);
        await forgetShifts(page);
        await followLink(page, "/admin");
        await page.waitForURL(/\/admin\/?$/);
        await waitForSettled(page);
        await cardAsTheSiteHasIt(page);
        const shift = await shiftSoFar(page);
        report(info, `warm ${site.name} ${size.name} ${size.width}px`, shift);
        expect(shift.dashboard + shift.mixed).toBe(0);
      });
    }
  });
}

for (const size of WIDTHS) {
  test(`holds the main column through a round trip to a collection (${size.name})`, async ({
    page,
  }, info) => {
    test.setTimeout(240_000);
    const wide = size.width >= 1024;
    await page.setViewportSize({ width: size.width, height: size.height });
    await recordShifts(page);
    await gotoAdmin(page, "/");
    await waitForSettled(page);
    // Warm the collection's route (on the dev server, its compile) so the window measures the
    // navigation, not a first compile.
    await followLink(page, "/admin/collections/posts");
    await page.waitForURL(/\/admin\/collections\/posts/);
    await waitForShellAnswers(page);
    await followLink(page, "/admin");
    await page.waitForURL(/\/admin\/?$/);
    await waitForSettled(page);

    const before = await mainColumnBox(page);
    await forgetShifts(page);
    await measureLeavingTheDashboard(page);

    await followLink(page, "/admin/collections/posts");
    await page.waitForURL(/\/admin\/collections\/posts/);
    await waitForShellAnswers(page);
    if (wide) {
      // The second panel is open beside the column, holding the collection's link.
      await expect(
        page.getByTestId("sub-sidebar").getByRole("link", { name: "Posts" })
      ).toBeVisible();
    }
    await page.waitForTimeout(1_000);
    const open = await mainColumnBox(page);

    await followLink(page, "/admin");
    await page.waitForURL(/\/admin\/?$/);
    await waitForSettled(page);
    const after = await mainColumnBox(page);

    const shift = await shiftSoFar(page);
    report(info, `round trip ${size.name} ${size.width}px`, shift, "routed");
    console.log(
      `LAYOUT-SHIFT   main column ${JSON.stringify({ before, open, after })}`
    );

    expect(open, "the main column moved as the second panel opened").toEqual(
      before
    );
    expect(after, "the main column moved as the second panel closed").toEqual(
      before
    );
    if (PRODUCTION_SERVER) {
      if (wide) {
        expect(
          shift.shell,
          `the shell moved: ${shift.shellSources.join(" | ")}`
        ).toBeLessThan(MAX_ROUND_TRIP_SHELL_SHIFT);
      } else {
        // The control: on the phone the panel overlays in the drawer, so nothing reflows.
        expect(
          shift.shell,
          `the shell moved: ${shift.shellSources.join(" | ")}`
        ).toBe(0);
      }
    }

    if (wide) {
      // The population control: the probe sees a move when one happens. Collapsing the panel's
      // track, as the shell did when a surface owned no panel, must move the column by the
      // track's width; a probe that read a fixed box, or the wrong element, would see nothing.
      const track = page.getByTestId("sub-sidebar");
      const trackWidth = await track.evaluate(
        element => element.getBoundingClientRect().width
      );
      expect(trackWidth).toBeGreaterThan(0);
      await track.evaluate(element => {
        (element as HTMLElement).style.width = "0px";
        (element as HTMLElement).style.borderWidth = "0px";
      });
      const collapsed = await mainColumnBox(page);
      expect(collapsed.x).toBe(before.x - Math.round(trackWidth));
    }
  });
}
