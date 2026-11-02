/**
 * The dashboard's header, in a browser: the project's name as the page's one
 * heading with the greeting above it and Customize beside it, and a summary
 * part that follows to its card when the card is on the dashboard and opens
 * the card's list when it is not.
 *
 * A release is scheduled two days out, so the releases part says something
 * whatever else the run holds; it is cancelled after. The suite's user is the
 * first account, a super-admin, whom every gate admits.
 *
 * @module tests/dashboard-header.spec
 */
import { expect, type Page } from "@playwright/test";

import { test } from "./support/test";
import { gotoAdmin } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { defaultSizeOf } from "./support/dashboard-sizes";
import { LOCK } from "./support/locks";
import { cancel, post, release, schedule } from "./support/releases-api";

// Shares state with other specs; see support/locks.ts for what each lock guards. Releases too:
// this spec schedules one, which Upcoming releases and the header both count.
test.describe.configure({ lock: [LOCK.dashboard, LOCK.releases] });

const RELEASES_CARD = "core/upcoming-releases";

interface Layout {
  version: number;
  scope: string;
  widgets: Record<string, unknown>;
  placements: Array<{ id: string; widgetId: string; removed?: boolean }>;
}

/** Saves the layout with Upcoming releases placed, or removed. */
async function placeReleasesCard(page: Page, removed: boolean): Promise<void> {
  const layout = (await (
    await page.request.get("/admin/api/dashboard/layout")
  ).json()) as Layout;
  const others = layout.placements.filter(
    placement => placement.widgetId !== RELEASES_CARD
  );
  const card = {
    id: "e2e-header-releases",
    widgetId: RELEASES_CARD,
    ...(await defaultSizeOf(page, RELEASES_CARD)),
    removed,
  };
  const write = await page.request.put("/admin/api/dashboard/layout", {
    data: {
      placements: [card, ...others],
      version: layout.version,
      scope: layout.scope,
    },
  });
  expect(write.ok(), await write.text()).toBe(true);
}

for (const theme of ["light", "dark"] as const) {
  test(`names the project once, greets the reader and offers Customize (${theme})`, async ({
    page,
  }) => {
    await gotoAdmin(page, "/", theme);
    const header = page.getByTestId("dashboard-header");
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toHaveCount(1);
    await expect(header).toContainText(
      /^(Good (morning|afternoon|evening), |Welcome)/
    );
    await expect(header.getByTestId("dashboard-edit-begin")).toBeVisible();
    await expect(header).not.toContainText("Manage your content");
    await expect(
      page.locator('[data-testid="widget-card-body"][aria-busy="true"]')
    ).toHaveCount(0, { timeout: 30_000 });
    await expectNoAxeViolations(page);
  });
}

test("follows the releases part to its card, and to the list once the card is removed", async ({
  page,
}) => {
  const stamp = String(Date.now());
  await gotoAdmin(page, "/");
  const id = await release(
    page,
    `Header e2e ${stamp}`,
    await post(page, stamp)
  );
  try {
    await schedule(
      page,
      id,
      new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      "UTC"
    );
    await placeReleasesCard(page, false);
    await gotoAdmin(page, "/");

    const part = page.getByTestId("dashboard-summary-releases");
    await expect(part).toHaveText(
      /^\d+\+? releases? (today|tomorrow|this week)$/
    );
    await part.click();
    await expect(
      page.getByTestId(`widget-cell-${RELEASES_CARD}`)
    ).toBeFocused();
    await expect(page).toHaveURL(/\/admin\/?$/);

    await placeReleasesCard(page, true);
    await gotoAdmin(page, "/");
    await page.getByTestId("dashboard-summary-releases").click();
    await expect(page).toHaveURL(/\/admin\/releases$/);
  } finally {
    await cancel(page, id);
  }
});
