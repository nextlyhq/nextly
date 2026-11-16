/**
 * The Team card's role filter, in a browser: the header's Role choice narrows the list to the
 * people holding that role, is saved as the card's setting, and holds across a reload.
 *
 * The suite's user is the first account, a super-admin, so Super admin always has at least one
 * person, whatever other specs have added.
 *
 * @module tests/dashboard-team.spec
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
const TEAM = "core/team";

interface Layout {
  version: number;
  scope: string;
  placements: Array<{
    widgetId: string;
    config?: Record<string, unknown>;
  }>;
}

/** Put one Team card, showing every role, on the reader's dashboard at its default size. */
async function placeTeam(page: Page): Promise<void> {
  const layout = await ok<Layout>(
    await page.request.get(`${API}/dashboard/layout`)
  );
  const others = layout.placements.filter(p => p.widgetId !== TEAM);
  await ok(
    await page.request.put(`${API}/dashboard/layout`, {
      data: {
        placements: [
          {
            id: "e2e-core-team",
            widgetId: TEAM,
            ...(await defaultSizeOf(page, TEAM)),
            removed: false,
            config: { role: "all" },
          },
          ...others,
        ],
        version: layout.version,
        scope: layout.scope,
      },
    })
  );
}

test("Team's role filter narrows the list, and is kept across a reload", async ({
  page,
}) => {
  await gotoAdmin(page, "/");
  await placeTeam(page);
  await gotoAdmin(page, "/");

  const card = page.getByTestId(`widget-cell-${TEAM}`);
  const role = card.getByRole("combobox", { name: "Role for Team" });
  await expect(role).toHaveText(/All roles/);
  await expect(card.getByTestId("entity-row").first()).toBeVisible();

  await role.click();
  await page.getByRole("option", { name: "Super admin" }).click();
  // Only super-admins: every row's role is theirs, and the link carries the role.
  await expect(card.getByTestId("team-view-all")).toHaveAttribute(
    "href",
    /\/admin\/users\?role=super-admin$/
  );
  const roles = card.getByTestId("team-role");
  await expect(roles.first()).toHaveText("Super Admin");
  for (const each of await roles.all()) {
    await expect(each).toHaveText("Super Admin");
  }

  // Saved as the card's setting, so it holds across a reload.
  await expect
    .poll(async () => {
      const layout = await ok<Layout>(
        await page.request.get(`${API}/dashboard/layout`)
      );
      return layout.placements.find(p => p.widgetId === TEAM)?.config?.role;
    })
    .toBe("super-admin");
  await page.reload();
  await expect(
    card.getByRole("combobox", { name: "Role for Team" })
  ).toHaveText(/Super admin/);
  await expect(card.getByTestId("team-role").first()).toHaveText("Super Admin");
});
