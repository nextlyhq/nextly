/**
 * A slow card holds no other.
 *
 * The playground's slow-card fixture answers as late as this spec asks. Held
 * for ten seconds, every card reading another source must already be drawn
 * while it is still waiting, and it must then arrive on its own, without a
 * reload: the batch's answer streams, one slot as each settles.
 *
 * A plugin places no card on core's default dashboard, so the spec places the
 * fixture's card itself, at the top of the saved layout beside core's cards,
 * and drops the saved layout again after each test.
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { resetToDefault } from "./support/dashboard-layout";
import { defaultSizeOf } from "./support/dashboard-sizes";
import { test } from "./support/test";
import { LOCK } from "./support/locks";

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ lock: [LOCK.dashboard, LOCK.heavy] });

const SLOW_CARD = "slow-widget-fixture/slow";
const CELLS = '[data-testid^="widget-cell-"]';
const LAYOUT = "/admin/api/dashboard/layout";

interface Layout {
  version: number;
  scope: string;
  /** Every widget this reader may see, by id: the layout write accepts any of them. */
  widgets: Record<string, unknown>;
  placements: Array<{ id: string; widgetId: string }>;
}

/** Puts the fixture's card first on the saved layout, ahead of every card already there. */
async function placeSlowCard(page: Page): Promise<void> {
  const read = await page.request.get(LAYOUT);
  expect(read.ok()).toBe(true);
  const layout = (await read.json()) as Layout;
  // Fails here, naming the card, rather than later as a missing cell.
  if (!(SLOW_CARD in layout.widgets))
    throw new Error(`${SLOW_CARD} is not visible to this reader`);
  const others = layout.placements.filter(p => p.widgetId !== SLOW_CARD);
  const placements = [
    {
      id: "e2e-slow-card",
      widgetId: SLOW_CARD,
      // Its own default; the layout write holds a card to its widget's bounds.
      ...(await defaultSizeOf(page, SLOW_CARD)),
      removed: false,
    },
    ...others,
  ];
  const write = await page.request.put(LAYOUT, {
    data: { placements, version: layout.version, scope: layout.scope },
  });
  expect(write.ok()).toBe(true);
}

/** How long the fixture's card takes to answer, in milliseconds; 0 answers at once. */
async function holdSlowCard(page: Page, ms: number): Promise<void> {
  const res = await page.request.post("/api/e2e/slow-widget", {
    data: { ms },
  });
  expect(res.ok()).toBe(true);
}

/** Every card's state on the dashboard, read in one pass, by the widget its cell draws. */
async function cardStates(page: Page): Promise<Record<string, string>> {
  return page
    .locator(CELLS)
    .evaluateAll(cells =>
      Object.fromEntries(
        cells.map(cell => [
          cell.getAttribute("data-testid")!.replace("widget-cell-", ""),
          cell.querySelector("[data-state]")?.getAttribute("data-state") ?? "",
        ])
      )
    );
}

test.afterEach(async ({ page }) => {
  await holdSlowCard(page, 0);
  await resetToDefault(page);
});

test("every other card is drawn while a slow one is still waiting, and the slow one arrives on its own", async ({
  page,
}) => {
  await placeSlowCard(page);
  await holdSlowCard(page, 10_000);
  const started = Date.now();
  await gotoAdmin(page, "/", "light");

  const slow = page.getByTestId(`widget-cell-${SLOW_CARD}`);
  await expect(slow).toBeVisible({ timeout: 30_000 });

  // Every other card settles while the slow one is still loading. Polled, then read in one pass,
  // so the claim is about one moment: the others drawn AND the slow one not yet.
  await expect
    .poll(
      async () => {
        const states = await cardStates(page);
        const others = Object.entries(states).filter(
          ([id]) => id !== SLOW_CARD
        );
        return (
          others.length > 0 &&
          others.every(([, state]) => state !== "loading") &&
          states[SLOW_CARD] === "loading"
        );
      },
      { timeout: 9_000 }
    )
    .toBe(true);
  // The must-differ half: this moment came well before the slow card could have answered.
  expect(Date.now() - started).toBeLessThan(10_000);

  // Then it arrives, drawn from the same request, with no reload in between.
  await expect(slow.locator("[data-state]").first()).toHaveAttribute(
    "data-state",
    "ready",
    { timeout: 20_000 }
  );
  await expect(slow).toContainText("42");
});
