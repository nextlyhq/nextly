/**
 * The dashboard's Team, Content and Upcoming releases cards, in a
 * browser: each draws from its own answer and offers the way on that its name
 * promises.
 *
 * - Team draws the number of people and links to Users. It is not on the default dashboard:
 *   a reader who manages the team adds it.
 * - Content draws a tile per collection, each linking to its list.
 * - Upcoming releases hides while nothing is scheduled, stopped or overdue, and
 *   otherwise leads to Releases.
 *
 * The cards are placed through the layout write first, so the test does not
 * depend on which conditional cards this run's other specs left offered; the
 * suite's user is the first account, a super-admin, whom every gate admits.
 * Upcoming releases is offered only once a release exists, so one is made
 * first, as a draft holding nothing.
 *
 * @module tests/dashboard-summary-cards.spec
 */
import { expect, type Page } from "@playwright/test";

import { includingHidden, test } from "./support/test";
import { gotoAdmin, type Theme } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { defaultSizeOf } from "./support/dashboard-sizes";
import { LOCK } from "./support/locks";
import { ok } from "./support/releases-api";

// Shares state with other specs; see support/locks.ts for what each lock guards.
// Releases too: Upcoming releases draws whatever releases the run holds, and a spec scheduling
// one alongside would change the card under this one.
test.describe.configure({ lock: [LOCK.dashboard, LOCK.releases] });

const CARDS = [
  "core/team",
  "core/content-table",
  "core/upcoming-releases",
] as const;

interface Layout {
  version: number;
  scope: string;
  widgets: Record<string, unknown>;
  /** What a reset would return to: the default dashboard this reader is handed. */
  defaultPlacements: Array<{ widgetId: string }>;
  placements: Array<{
    id: string;
    widgetId: string;
    w: number;
    h: number;
    removed?: boolean;
  }>;
}

/**
 * Place each of the four cards, at the size a new one starts at and not removed, in the saved
 * layout: not every card may be drawn full width.
 */
async function placeCards(page: Page): Promise<void> {
  await ok(
    await page.request.post("/admin/api/releases", {
      data: { title: `Summary cards e2e ${Date.now()}` },
    })
  );
  const read = await page.request.get("/admin/api/dashboard/layout");
  const layout = (await read.json()) as Layout;
  for (const id of CARDS) {
    if (!(id in layout.widgets)) {
      throw new Error(`${id} is not visible to this reader`);
    }
  }
  // Offered to this reader, and still not on their default: a reader who manages the team adds
  // Team from the add panel.
  expect(layout.defaultPlacements.map(p => p.widgetId)).not.toContain(
    "core/team"
  );
  const others = layout.placements.filter(
    placement => !CARDS.includes(placement.widgetId as (typeof CARDS)[number])
  );
  const placed = [];
  for (const widgetId of CARDS) {
    placed.push({
      id: `e2e-${widgetId.replace("/", "-")}`,
      widgetId,
      ...(await defaultSizeOf(page, widgetId)),
      removed: false,
    });
  }
  const placements = [...placed, ...others];
  const write = await page.request.put("/admin/api/dashboard/layout", {
    data: { placements, version: layout.version, scope: layout.scope },
  });
  expect(write.ok()).toBe(true);
}

const cell = (page: Page, id: string) => page.getByTestId(`widget-cell-${id}`);

for (const theme of ["light", "dark"] as const satisfies readonly Theme[]) {
  test(`draws Team, Content and Upcoming releases with their links (${theme})`, async ({
    page,
  }) => {
    await gotoAdmin(page, "/");
    await placeCards(page);
    await gotoAdmin(page, "/", theme);

    const team = cell(page, "core/team");
    await expect(team.getByText("Users").first()).toBeVisible();
    await expect(team.getByRole("link", { name: "All users" })).toHaveAttribute(
      "href",
      /\/admin\/users$/
    );

    const content = cell(page, "core/content-table");
    // At least one row of the Content table, its label a link to its list.
    await expect(content.getByRole("link").first()).toBeVisible();

    // Upcoming releases hides while nothing is scheduled, stopped or overdue, which is all this
    // spec makes, and a spec that ran before this one may have left a release scheduled, as the
    // whole suite on one database does: either the card is off the dashboard, marked hidden
    // while empty, or it leads to Releases.
    // Read including hidden elements: a card hidden while empty is in the page with its cell
    // hidden, which a visible-only locator would never find.
    const releases = includingHidden(page).getByTestId(
      "widget-cell-core/upcoming-releases"
    );
    const region = releases.locator('[role="region"]');
    await expect(region).toHaveCount(1);
    // Its answer first: only an answer says whether it is empty, so the card is read once it lands.
    await expect(
      releases.locator('[data-testid="widget-card-body"][aria-busy="true"]')
    ).toHaveCount(0, { timeout: 30_000 });
    if ((await region.getAttribute("data-hidden-empty")) === "") {
      await expect(releases).toBeHidden();
    } else {
      await expect(
        releases
          .getByRole("link", { name: /^View all/ })
          .or(
            releases.getByTestId("release-attention").getByRole("link").first()
          )
      ).toHaveAttribute("href", /\/admin\/releases/);
    }

    // A card refreshing its data dims its body and marks it aria-busy until the
    // answer lands, and a scan in that window measures dimmed text no reader is
    // left with: wait for every card to settle first.
    await expect(
      page.locator('[data-testid="widget-card-body"][aria-busy="true"]')
    ).toHaveCount(0, { timeout: 30_000 });
    await expectNoAxeViolations(page);
  });
}
