/**
 * System health in a browser, as a super-admin: the status line, the facts
 * the test app's SQLite database answers (no Connection line, since a file has
 * nothing to encrypt), and Details with the runtime and plugins.
 *
 * Placed by the test through the layout, as the Note spec places its card, so
 * the spec is about what the card draws.
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
const CARD = "core/system-health";

interface Layout {
  version: number;
  scope: string;
  placements: Array<{ widgetId: string }>;
}

/** Put System health first on the reader's dashboard. */
async function placeSystemHealth(page: Page) {
  const layout = await ok<Layout>(
    await page.request.get(`${API}/dashboard/layout`)
  );
  const others = layout.placements.filter(p => p.widgetId !== CARD);
  await ok(
    await page.request.put(`${API}/dashboard/layout`, {
      data: {
        placements: [
          {
            id: "e2e-system-health",
            widgetId: CARD,
            ...(await defaultSizeOf(page, CARD)),
            removed: false,
            config: {},
          },
          ...others,
        ],
        version: layout.version,
        scope: layout.scope,
      },
    })
  );
}

test("System health says how the install stands, fact by fact, and opens Details", async ({
  page,
}) => {
  await gotoAdmin(page, "/");
  await placeSystemHealth(page);
  await gotoAdmin(page, "/");

  const card = page.getByTestId(`widget-cell-${CARD}`);
  await expect(card.getByTestId("system-health-status")).toBeVisible();
  const facts = card.getByTestId("system-health-facts");
  await expect(facts.locator("dt")).toHaveText([
    "Nextly",
    "Environment",
    "Database",
    "Migrations",
    "Storage",
    "Email",
    "Background jobs",
  ]);
  await expect(card.getByTestId("system-health-database")).toContainText(
    /^SQLite \d+\.\d+\.\d+ · \d+ ms$/
  );
  await expect(card.getByTestId("system-health-jobs")).toContainText(
    /\d+ queued · \d+ failed \(24 h\)/
  );
  // The registry may or may not answer from the test machine; either way the
  // installed version is shown, and "Latest" only beside a check that succeeded.
  await expect(card.getByTestId("system-health-version")).toContainText(
    /\d+\.\d+\.\d+.*(Latest|available|Couldn't check for updates)/
  );

  await card.getByRole("button", { name: "Details" }).click();
  const details = page.getByTestId("system-health-details");
  await expect(details).toBeVisible();
  await expect(
    details.getByRole("heading", { name: "System health" })
  ).toBeVisible();
  await expect(
    details.getByTestId("system-health-runtime").locator("dt")
  ).toHaveText(["Node", "Next.js", "React"]);
  await expect(details.getByText(/^Plugins \(\d+\)$/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(details).toBeHidden();
});

test("Copy diagnostics copies the report Details shows, with no address or email in it", async ({
  page,
  context,
}) => {
  // The suite runs in Chromium alone, which lets a test read the clipboard back.
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await gotoAdmin(page, "/");
  await placeSystemHealth(page);
  await gotoAdmin(page, "/");

  const card = page.getByTestId(`widget-cell-${CARD}`);
  await card.getByRole("button", { name: "Copy diagnostics" }).click();
  await expect(
    page.getByText(
      "Diagnostics copied. No passwords, keys or addresses are in it."
    )
  ).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(
    /^Nextly diagnostics, \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC\n/
  );
  expect(copied).toMatch(/^Database: SQLite [\d.]+ · \d+ ms round trip$/m);
  expect(copied).toMatch(/^Content: \d+ collections? · /m);
  expect(copied).not.toMatch(/@[\w-]+\./);
  expect(copied).not.toMatch(/:\/\//);

  // Details shows the same report, line for line but its first.
  await card.getByRole("button", { name: "Details" }).click();
  const report = page.getByTestId("system-health-report");
  await expect(report).toContainText("Nextly diagnostics, ");
  const shown = (await report.textContent()) ?? "";
  expect(shown.split("\n").slice(1, 4)).toEqual(copied.split("\n").slice(1, 4));
});

test("a refused copy opens Details with the report selected", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const refuse = () =>
      Promise.reject(new DOMException("No", "NotAllowedError"));
    Object.defineProperty(navigator, "clipboard", {
      value: { write: refuse, writeText: refuse },
      configurable: true,
    });
  });
  await gotoAdmin(page, "/");
  await placeSystemHealth(page);
  await gotoAdmin(page, "/");

  const card = page.getByTestId(`widget-cell-${CARD}`);
  await card.getByRole("button", { name: "Copy diagnostics" }).click();
  await expect(
    page.getByText(
      "Couldn't copy here. The report is selected in Details: press Ctrl+C or ⌘C."
    )
  ).toBeVisible();
  const report = page.getByTestId("system-health-report");
  await expect(report).toBeFocused();
  const selected = await page.evaluate(() => window.getSelection()?.toString());
  expect(selected).toBe(await report.textContent());
  expect(selected).toMatch(/^Nextly diagnostics, /);
});

test("copying from Details says so above the drawer's footer, clear of its Copy diagnostics button", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await gotoAdmin(page, "/");
  await placeSystemHealth(page);
  await gotoAdmin(page, "/");

  const card = page.getByTestId(`widget-cell-${CARD}`);
  await card.getByRole("button", { name: "Details" }).click();
  await expect(page.getByTestId("system-health-report")).toBeVisible();
  const copy = page.getByTestId("system-health-details-copy");
  await copy.click();
  const said = page
    .locator("[data-sonner-toast]")
    .filter({ hasText: "Diagnostics copied." });
  await expect(said).toBeVisible();
  // Read once it has finished sliding in.
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        animation =>
          animation.playState !== "running" ||
          animation.effect?.getTiming().iterations === Number.POSITIVE_INFINITY
      )
  );
  const toast = await said.boundingBox();
  const button = await copy.boundingBox();
  if (toast === null || button === null) throw new Error("not drawn");
  // The toast ends above the footer's button: it covers none of it.
  expect(toast.y + toast.height).toBeLessThanOrEqual(button.y);
});
