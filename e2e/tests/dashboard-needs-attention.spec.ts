/**
 * Needs your attention draws the open work waiting for its reader, and only
 * while something is.
 *
 * A stopped and an overdue release are left as the release runner would leave
 * them. The card then draws a critical row for each, with its reason, and each
 * Review opens Releases' Needs attention tab narrowed to that row's part. A
 * reader who may not read releases has nothing waiting, so their dashboard
 * draws no card at all, rather than one that says all is clear.
 *
 * Other specs leave their own stopped and overdue releases in the shared
 * database, so the spec finds its rows by label and reads no exact count.
 */
import { expect, type Page, type Route } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { isLayoutRead } from "./support/dashboard-layout";
import { signInAsLimitedUser } from "./support/limited-user";
import { LOCK } from "./support/locks";
import {
  leaveReleasesAsTheRunnerWould,
  type RunnerOutcome,
} from "./support/release-states";
import { cancel, post, release, schedule } from "./support/releases-api";
import { test } from "./support/test";

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ lock: [LOCK.dashboard, LOCK.releases] });

const CARD = "core/needs-attention";
const DAY = 24 * 60 * 60 * 1000;

test("rows for stopped and overdue releases, each with its reason and Review; no card for a reader of no releases", async ({
  page,
  browser,
  baseURL,
}) => {
  const stamp = Date.now().toString(36);
  const postId = await post(page, stamp);
  const seeded: Array<{ id: string; outcome: RunnerOutcome }> = [];
  for (const outcome of ["overdue", "stopped"] as const) {
    const id = await release(page, `Attention e2e ${outcome} ${stamp}`, postId);
    await schedule(page, id, new Date(Date.now() + 40 * DAY), "UTC");
    seeded.push({ id, outcome });
  }
  await leaveReleasesAsTheRunnerWould(page, seeded);

  try {
    await gotoAdmin(page, "");
    const card = page.getByTestId(`widget-cell-${CARD}`);
    await expect(card).toBeVisible();
    const row = (label: string) =>
      card.getByTestId("needs-attention-item").filter({ hasText: label });

    const stopped = row("Releases that stopped");
    await expect(stopped).toContainText("A scheduled publish failed.");
    await expect(stopped.getByTestId("needs-attention-critical")).toBeVisible();
    const overdue = row("Overdue releases");
    await expect(overdue).toContainText("Still scheduled after its time.");
    await expect(overdue.getByTestId("needs-attention-critical")).toBeVisible();
    // Nothing on the card dismisses an item.
    await expect(
      card.getByRole("button", { name: /dismiss|mark/i })
    ).toHaveCount(0);

    await overdue
      .getByRole("link", { name: "Review overdue releases" })
      .click();
    await expect(page).toHaveURL(
      /\/admin\/releases\?tab=attention&reason=overdue$/
    );

    // A reader of posts only: no release kind is theirs, and no plugin item
    // is declared, so nothing waits for them and the card is not drawn.
    const reader = await signInAsLimitedUser(
      browser,
      page.request,
      baseURL ?? "",
      ["read-posts"]
    );
    try {
      const theirs = await reader.context.newPage();
      await gotoAdmin(theirs, "");
      // Their dashboard has drawn: a card every reader is shown is there.
      await expect(
        theirs.getByTestId("widget-cell-core/recently-edited")
      ).toBeVisible();
      await expect(theirs.getByTestId(`widget-cell-${CARD}`)).toBeHidden();
      await expect(theirs.getByText("All clear")).toHaveCount(0);
    } finally {
      await reader.context.close();
    }
  } finally {
    // Left as they were found: a stopped or overdue release of this spec's
    // would show the card on every later spec's dashboard.
    for (const { id } of seeded) await cancel(page, id);
  }
});

/**
 * Follows the link at `href` the way the app does, within the page, so the dashboard's cached
 * layout answer is the one a return is first drawn from.
 */
async function followLink(page: Page, href: string): Promise<void> {
  await page.evaluate(target => {
    const link = document.querySelector<HTMLAnchorElement>(
      `a[href="${target}"]`
    );
    if (!link) throw new Error(`no link to ${target}`);
    link.click();
  }, href);
}

/**
 * Passes the layout read through as one that found the card with nothing waiting, so the first
 * visit is drawn without it whatever the shared database holds.
 */
async function readCardAsEmpty(page: Page): Promise<void> {
  await page.route(isLayoutRead, async (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    // Aborted rather than thrown when the read is given up: a throw out of the handler prints
    // the request, session cookie included.
    let response: Awaited<ReturnType<Route["fetch"]>>;
    try {
      response = await route.fetch();
    } catch {
      await route.abort().catch(() => {});
      return;
    }
    const body = (await response.json()) as Record<string, unknown>;
    const layout = (Array.isArray(body.placements) ? body : body.data) as {
      placements: Array<{ id: string; widgetId: string }>;
      hiddenWhileEmpty?: string[];
    };
    const card = layout.placements.find(p => p.widgetId === CARD);
    if (card) {
      layout.hiddenWhileEmpty = [...(layout.hiddenWhileEmpty ?? []), card.id];
    }
    await route.fulfill({ response, json: body });
  });
}

/** An overdue release left as the runner would leave it, for this spec to cancel. */
async function overdueRelease(page: Page, stamp: string) {
  const postId = await post(page, stamp);
  const id = await release(page, `Attention return ${stamp}`, postId);
  await schedule(page, id, new Date(Date.now() + 40 * DAY), "UTC");
  await leaveReleasesAsTheRunnerWould(page, [{ id, outcome: "overdue" }]);
  return id;
}

test("a return that finds new work waiting shows the card, and says so", async ({
  page,
}) => {
  const id = await overdueRelease(page, Date.now().toString(36));
  try {
    await readCardAsEmpty(page);
    await gotoAdmin(page, "");
    // Drawn cards only: a card the page is drawn without keeps a cell it never shows.
    const card = page
      .getByTestId(`widget-cell-${CARD}`)
      .filter({ visible: true });
    await expect(
      page
        .getByTestId("widget-cell-core/recently-edited")
        .filter({ visible: true })
    ).toBeVisible();
    // Hidden, not absent: the page keeps the card's cell, undrawn.
    await expect(card).toBeHidden();

    // Away and back within the session: the return is drawn from the cached answer, which hid
    // the card, and the read it makes again finds the overdue release.
    await followLink(page, "/admin/collections/posts");
    await page.waitForURL(/\/admin\/collections\/posts/);
    await page.unroute(isLayoutRead);
    await followLink(page, "/admin");
    await page.waitForURL(/\/admin\/?$/);

    await expect(card).toBeVisible();
    await expect(
      card.getByText(/^\d+ items? needs? your attention$/)
    ).toBeAttached();
  } finally {
    await page.unroute(isLayoutRead).catch(() => {});
    await cancel(page, id);
  }
});

test("a return whose waiting work was done meanwhile keeps the card in place", async ({
  page,
}) => {
  const id = await overdueRelease(page, Date.now().toString(36));
  let cancelled = false;
  try {
    await gotoAdmin(page, "");
    const card = page
      .getByTestId(`widget-cell-${CARD}`)
      .filter({ visible: true });
    await expect(card).toBeVisible();

    await followLink(page, "/admin/collections/posts");
    await page.waitForURL(/\/admin\/collections\/posts/);
    await cancel(page, id);
    cancelled = true;
    const reread = page.waitForResponse(
      response =>
        response.url().includes("/dashboard/layout") &&
        response.request().method() === "GET"
    );
    await followLink(page, "/admin");
    await page.waitForURL(/\/admin\/?$/);
    await reread;

    // Shown when the reader came back, so it stays: what they are looking at does not jump up.
    // It says nothing is waiting, or shows what other work still is.
    await expect(card).toBeVisible();
  } finally {
    if (!cancelled) await cancel(page, id);
  }
});
