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

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ lock: [LOCK.dashboard, LOCK.heavy] });

/** The cold-load ceiling. */
const MAX_COLD_SHIFT = 0.1;

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
 * the window, each counted as the dashboard's or the shell's by what it moved. Shifts within
 * 500 ms of input are left out, as the metric itself does, which is why the warm case navigates
 * with script-issued clicks: those are not a reader's input, so a shift they cause still counts.
 */
async function recordShifts(page: Page): Promise<void> {
  await page.addInitScript(() => {
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
            source.node.closest('[data-testid="dashboard-container"]') !== null
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
  });
}

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
  shift: Shift
): void {
  const line = `${label}: dashboard ${shift.dashboard.toFixed(4)}, mixed ${shift.mixed.toFixed(4)}, shell ${shift.shell.toFixed(4)}, shell elements moved ${shift.shellMoves}`;
  info.annotations.push({ type: "layout-shift", description: line });
  console.log(`LAYOUT-SHIFT ${line}`);
  for (const source of shift.shellSources) {
    console.log(`LAYOUT-SHIFT   shell ${source}`);
  }
}

/**
 * Every card drawn and none still loading, held for a second: the end of the window. A second
 * of stillness, because a batch can settle and a later one start moments after.
 */
async function waitForSettled(page: Page): Promise<void> {
  const cells = page.locator('[data-testid^="widget-cell-"]');
  await expect(cells.first()).toBeVisible({ timeout: 60_000 });
  // Nothing still loading: no card marked busy, AND no skeleton drawn anywhere (every skeleton
  // the UI kit draws is marked `data-slot="skeleton"`). A card that draws its own body (a
  // component card) shows its own placeholders while its requests run, and the frame does not
  // mark it busy for those, so busy alone would end the window early.
  const loading = page.locator(
    'main [aria-busy="true"], main [data-slot="skeleton"], main [data-testid="widget-grid-loading"]'
  );
  await expect(loading).toHaveCount(0, { timeout: 60_000 });
  await page.waitForTimeout(1_000);
  await expect(loading).toHaveCount(0);
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
    const shift = await shiftSoFar(page);
    report(info, `cold ${size.name} ${size.width}px`, shift);
    expect(shift.dashboard + shift.mixed).toBeLessThan(MAX_COLD_SHIFT);
    if (PRODUCTION_SERVER) {
      // No shell element moved: the shell's regions are drawn at the size they settle at, so the
      // only way for this to go red is for something already painted to move. Counted by element
      // rather than read from the shell's share, which leaves out a shift that moved the
      // dashboard in the same frame.
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
    const shift = await shiftSoFar(page);
    report(info, `warm ${size.name} ${size.width}px`, shift);
    expect(shift.dashboard + shift.mixed).toBe(0);
  });
}
