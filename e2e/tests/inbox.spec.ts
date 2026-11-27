/**
 * The Inbox at the rail's foot, in a real browser.
 *
 * - Read state is the server's: opening the Inbox marks nothing read, opening
 *   one of three unread items leaves two, a second browser signed in as the
 *   same person agrees once it is looked at again, and "Mark as unread" brings
 *   the count back in both. The items are real: overdue releases of the
 *   signed-in person's own, told to them by a pass of the release runner.
 * - The button and its popover are held to WCAG 2.2 AA: with more than nine
 *   unread items the count says "9+", and an axe scan of the dashboard with
 *   the popover open passes, in light and in dark. axe holds a two-character
 *   count to the full ratio and sets a one-character count aside, so "9+" is
 *   the case it judges.
 *
 * @module tests/inbox.spec
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin, type Theme } from "./support/admin";
import { emptyScanReason, scanAxe } from "./support/axe-scan.mjs";
import { LOCK } from "./support/locks";
import { leaveReleasesAsTheRunnerWould } from "./support/release-states";
import {
  cancel,
  ok,
  post,
  publishNow,
  release,
  schedule,
} from "./support/releases-api";
import { test } from "./support/test";

// Scans the dashboard as a whole, which other specs change; and leaves
// overdue releases and runs a pass of the release runner, as the release
// specs do. See support/locks.ts.
test.describe.configure({ lock: [LOCK.dashboard, LOCK.releases] });

const CELLS = '[data-testid^="widget-cell-"]';
const DAY = 24 * 60 * 60 * 1000;

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

/** The Inbox button, by the name it is given. */
const inbox = (page: Page) => page.getByTestId("inbox-button");

/** The dashboard drawn, every card's first answer in. */
async function dashboardSettled(page: Page, theme: Theme = "light") {
  await gotoAdmin(page, "/", theme);
  await expect(
    page.locator(CELLS).filter({ visible: true }).first()
  ).toBeVisible();
  await expect(
    page.locator('[data-testid="widget-card-body"][aria-busy="true"]')
  ).toHaveCount(0, { timeout: 30_000 });
}

/**
 * Twelve items for you and two alerts, answered for the Inbox's own reads, so
 * the count draws "9+", the Alerts tab draws its red count, and the popover
 * has rows with and without a link, read and unread, to scan.
 */
async function twelveUnreadItems(page: Page): Promise<void> {
  const at = new Date().toISOString();
  const items = Array.from({ length: 12 }, (_, index) => ({
    id: `inbox-e2e-${index}`,
    kind: "workflows.assigned",
    title: `“Item ${index + 1}” was assigned to you for review`,
    subject: { type: "entry", id: `e${index}`, link: null, gone: false },
    createdAt: at,
    readAt: index % 3 === 0 ? at : null,
  }));
  const alerts = Array.from({ length: 2 }, (_, index) => ({
    id: `inbox-e2e-alert-${index}`,
    kind: "jobs.failed",
    title: `A background job failed (${index + 1})`,
    subject: { type: "job", id: `j${index}`, link: "/admin", gone: false },
    createdAt: at,
    readAt: null,
  }));
  await page.route("**/admin/api/notices**", async route => {
    try {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/notices/count")) {
        await route.fulfill({ json: { total: 14, alerts: 2 } });
        return;
      }
      const tab = url.searchParams.get("tab");
      const shown = tab === "alerts" ? alerts : items;
      await route.fulfill({
        json: {
          items: shown,
          meta: { total: shown.length, page: 1, limit: 20, hasNext: false },
        },
      });
    } catch {
      // The page closed while answering.
    }
  });
}

/** Waits for the page to come to rest, then holds it to no axe findings. */
async function expectNoAxeFindings(page: Page): Promise<void> {
  // Settled first: a color mid-animation is one the page never rests at.
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        animation =>
          animation.playState !== "running" ||
          animation.effect?.getTiming().iterations === Number.POSITIVE_INFINITY
      )
  );
  const { results, findings } = await scanAxe(page);
  expect(emptyScanReason(results)).toBeNull();
  expect(
    findings,
    `axe reported ${findings.length} violation(s):\n${JSON.stringify(findings, null, 2)}`
  ).toEqual([]);
}

for (const theme of ["light", "dark"] as Theme[]) {
  test(`the Inbox button and popover pass axe (${theme})`, async ({ page }) => {
    await twelveUnreadItems(page);
    await dashboardSettled(page, theme);
    await expect(page.getByTestId("inbox-badge")).toHaveText("9+");
    await expect(inbox(page)).toHaveAccessibleName("Inbox, 9+ unread");

    await inbox(page).click();
    const tabs = page.getByRole("tablist", { name: "Inbox" });
    await expect(tabs).toBeVisible();
    // It opens on Alerts, which has unread items: its red count and its
    // linked rows are scanned there, then For you's rows without a link.
    await expect(tabs.getByRole("tab", { selected: true })).toHaveText(
      "Alerts 2 unread"
    );
    await expect(
      page.getByRole("link", { name: /A background job failed \(2\)/ })
    ).toBeVisible();
    await expectNoAxeFindings(page);

    await tabs.getByRole("tab", { name: /For you/ }).click();
    await expect(page.getByRole("button", { name: /Item 12/ })).toBeVisible();
    await expectNoAxeFindings(page);
  });
}

test("an item is read when it is opened, not when it is shown, in every browser the person uses", async ({
  page,
  browser,
}) => {
  // Seeding three releases and a pass of the runner, then up to a minute for
  // the second browser's count, on a server that compiles routes as asked.
  test.setTimeout(300_000);
  const stamp = Date.now().toString(36);
  const seeded: Array<{ id: string; title: string }> = [];
  // The same person in a second browser: the session's cookies, nothing else.
  const second = await browser.newContext({
    storageState: await page.context().storageState(),
  });
  try {
    // Whatever earlier specs told this person is read first, so the count
    // below is this spec's three alone.
    await ok(
      await page.request.post("/admin/api/notices/read", {
        data: { all: true },
      })
    );
    for (let n = 1; n <= 3; n += 1) {
      const title = `Inbox e2e ${n} ${stamp}`;
      const id = await release(page, title, await post(page, `${stamp}-${n}`));
      await schedule(page, id, new Date(Date.now() + 40 * DAY), "UTC");
      seeded.push({ id, title });
    }
    await leaveReleasesAsTheRunnerWould(
      page,
      seeded.map(({ id }) => ({ id, outcome: "overdue" as const }))
    );
    // A pass of the runner tells each overdue release's owner, and Publish
    // now runs one.
    const trigger = await release(
      page,
      `Inbox e2e pass ${stamp}`,
      await post(page, `${stamp}-pass`)
    );
    await publishNow(page, trigger);

    await gotoAdmin(page, "/");
    await expect(inbox(page)).toHaveAccessibleName("Inbox, 3 unread");
    const other = await second.newPage();
    await other.setViewportSize({ width: 1440, height: 900 });
    await gotoAdmin(other, "/");
    await expect(inbox(other)).toHaveAccessibleName("Inbox, 3 unread");

    // Opened and closed without opening anything: still three.
    await inbox(page).click();
    const forYou = page.getByRole("tabpanel", { name: /For you/ });
    for (const { title } of seeded) {
      await expect(
        forYou.getByRole("link", {
          name: new RegExp(`“${title}” missed its time`),
        })
      ).toBeVisible();
    }
    await page.keyboard.press("Escape");
    await expect(inbox(page)).toBeFocused();
    await page.reload();
    await expect(inbox(page)).toHaveAccessibleName("Inbox, 3 unread");

    // Opening one marks it read and goes to it.
    const [opened] = seeded;
    await inbox(page).click();
    await page
      .getByRole("link", {
        name: new RegExp(`“${opened!.title}” missed its time`),
      })
      .click();
    await expect(page).toHaveURL(new RegExp(`/admin/releases/${opened!.id}$`));
    await expect(inbox(page)).toHaveAccessibleName("Inbox, 2 unread");

    // The other browser learns it when it is looked at again.
    await other.bringToFront();
    await other.evaluate(() =>
      document.dispatchEvent(new Event("visibilitychange", { bubbles: true }))
    );
    await expect(inbox(other)).toHaveAccessibleName("Inbox, 2 unread", {
      timeout: 70_000,
    });

    // Marked unread again from its menu: three, in both.
    await page.bringToFront();
    await inbox(page).click();
    await page
      .getByRole("button", {
        name: new RegExp(`More actions for “${opened!.title}” missed its time`),
      })
      .click();
    await page.getByRole("menuitem", { name: "Mark as unread" }).click();
    await expect(inbox(page)).toHaveAccessibleName("Inbox, 3 unread");
    await other.bringToFront();
    await other.evaluate(() =>
      document.dispatchEvent(new Event("visibilitychange", { bubbles: true }))
    );
    await expect(inbox(other)).toHaveAccessibleName("Inbox, 3 unread", {
      timeout: 70_000,
    });
  } finally {
    // Left as they were found: an overdue release of this spec's would show
    // in every later spec's strip and card.
    for (const { id } of seeded) await cancel(page, id).catch(() => undefined);
    await second.close();
  }
});
