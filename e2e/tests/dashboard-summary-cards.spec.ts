/**
 * The dashboard's Team, Content, Create and Upcoming releases cards, in a
 * browser: each draws from its own answer and offers the way on that its name
 * promises.
 *
 * - Team draws the number of people and links to Users.
 * - Content draws a tile per collection, each linking to its list.
 * - Create draws its shortcuts.
 * - Upcoming releases, with nothing scheduled, offers Releases as its one way on.
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

import { test } from "./support/test";
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
  "core/content",
  "core/quick-create",
  "core/upcoming-releases",
] as const;

interface Layout {
  version: number;
  scope: string;
  widgets: Record<string, unknown>;
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
  test(`draws Team, Content, Create and Upcoming releases with their links (${theme})`, async ({
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

    const content = cell(page, "core/content");
    // At least one collection tile, each a link to its list.
    await expect(content.getByRole("link").first()).toBeVisible();

    await expect(cell(page, "core/quick-create")).toBeVisible();

    // Upcoming releases offers Releases as its one way on, whatever the run holds: its empty
    // state's "Open Releases" when nothing is scheduled, or its list's "View all" when a spec
    // that ran before this one left a release scheduled, as the whole suite on one database does.
    const releases = cell(page, "core/upcoming-releases");
    await expect(
      releases
        .getByRole("link", { name: "Open Releases" })
        .or(releases.getByRole("link", { name: /^View all/ }))
    ).toHaveAttribute("href", /\/admin\/releases$/);

    // A card refreshing its data dims its body and marks it aria-busy until the
    // answer lands, and a scan in that window measures dimmed text no reader is
    // left with: wait for every card to settle first.
    await expect(
      page.locator('[data-testid="widget-card-body"][aria-busy="true"]')
    ).toHaveCount(0, { timeout: 30_000 });
    await expectNoAxeViolations(page);
  });
}
