/**
 * A widget the site config declares itself reaches the dashboard as a
 * plugin's does: the layout offers it, a card of it is placed, and the grid
 * draws it with the component the generated component map imports from
 * beside the config file, where the site named it.
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { defaultSizeOf } from "./support/dashboard-sizes";
import { LOCK } from "./support/locks";
import { ok } from "./support/releases-api";
import { test } from "./support/test";

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ lock: [LOCK.dashboard] });

const API = "/admin/api";
const SITE_NOTES = "playground/site-notes";

interface Layout {
  version: number;
  scope: string;
  placements: Array<{ widgetId: string }>;
  available: string[];
}

/** Put a card of the site's widget first on the reader's dashboard. */
async function placeSiteNotes(page: Page, layout: Layout): Promise<void> {
  const others = layout.placements.filter(p => p.widgetId !== SITE_NOTES);
  await ok(
    await page.request.put(`${API}/dashboard/layout`, {
      data: {
        placements: [
          {
            id: "e2e-site-notes",
            widgetId: SITE_NOTES,
            ...(await defaultSizeOf(page, SITE_NOTES)),
            removed: false,
          },
          ...others,
        ],
        version: layout.version,
        scope: layout.scope,
      },
    })
  );
}

test("a widget the site config declares is offered, and draws with its own component", async ({
  page,
}) => {
  await gotoAdmin(page, "/");
  const layout = await ok<Layout>(
    await page.request.get(`${API}/dashboard/layout`)
  );
  // Offered as a plugin's declared widget is, and placed by nobody yet.
  expect(layout.available).toContain(SITE_NOTES);

  await placeSiteNotes(page, layout);
  await gotoAdmin(page, "/");

  // Visible only: a page Cache Components keeps hidden holds a copy of the card.
  const card = page
    .getByTestId(`widget-cell-${SITE_NOTES}`)
    .filter({ visible: true });
  await expect(card.getByTestId("site-notes-card")).toBeVisible({
    timeout: 30_000,
  });
  await expect(card).toContainText("Declared by the site, not a plugin.");
  // Drawn, not the card's error state for a component the map lacks.
  await expect(card.getByTestId("widget-card-error")).toHaveCount(0);
});
