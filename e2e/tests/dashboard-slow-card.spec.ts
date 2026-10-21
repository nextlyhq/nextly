/**
 * A slow card holds no other.
 *
 * The playground's slow-card fixture answers as late as this spec asks. Held
 * for ten seconds, every card reading another source must already be drawn
 * while it is still waiting, and it must then arrive on its own, without a
 * reload: the batch's answer streams, one slot as each settles.
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const SLOW_CARD = "slow-widget-fixture/slow";
const CELLS = '[data-testid^="widget-cell-"]';

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
});

test("every other card is drawn while a slow one is still waiting, and the slow one arrives on its own", async ({
  page,
}) => {
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
