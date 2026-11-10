/**
 * Needs your attention draws the open work waiting for its reader, and only
 * while something is.
 *
 * A stopped and an overdue release are left as the release runner would leave
 * them. The card then draws a critical row for each, with its reason and the
 * release named under it, linked to its page, and each Review opens Releases'
 * Needs attention tab narrowed to that row's part. A
 * reader who may not read releases has nothing waiting, so their dashboard
 * draws no card at all, rather than one that says all is clear.
 *
 * Other specs leave their own stopped and overdue releases in the shared
 * database, so the spec finds its rows by label and reads no exact count.
 */
import { expect, type Page, type Route } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { isLayoutRead } from "./support/dashboard-layout";
import { cardHeightPx, defaultSizeOf } from "./support/dashboard-sizes";
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
    // Each row names its releases as well as counting them, each linked to
    // its page.
    for (const { id, outcome } of seeded) {
      const named = (outcome === "stopped" ? stopped : overdue).getByRole(
        "link",
        { name: `Attention e2e ${outcome} ${stamp}` }
      );
      await expect(named).toHaveAttribute(
        "href",
        new RegExp(`/admin/releases/${id}$`)
      );
    }
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
        theirs.getByTestId("widget-cell-core/continue")
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
 * Where a return goes away to: Media, whose link the admin's navigation draws on every screen.
 * Not a collection's list, which the navigation does not link to from the dashboard: there the
 * only link to one is a card's, drawn only once that card's answer lands, and only for the
 * collections it has room for.
 */
const AWAY = "/admin/media";

/**
 * Follows the link at `href` the way the app does, within the page, so the dashboard's cached
 * layout answer is the one a return is first drawn from. Waits for the link to be drawn.
 */
async function followLink(page: Page, href: string): Promise<void> {
  await page
    .locator(`a[href="${href}"]`)
    .filter({ visible: true })
    .first()
    .evaluate((link: HTMLElement) => link.click());
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
    // A read the page gave up while it was answered is already settled: nothing waits for it.
    await route.fulfill({ response, json: body }).catch(() => {});
  });
}

/** A batch answered whole, `{ results }`, or `undefined` for one streamed as lines. */
function wholeAnswer(text: string): { results: unknown[] } | undefined {
  try {
    const body = JSON.parse(text) as { results?: unknown };
    return Array.isArray(body.results)
      ? { ...body, results: body.results }
      : undefined;
  } catch {
    return undefined;
  }
}

/** The dashboard's batch of card answers. */
const isBatchRead = (url: URL) => url.pathname.endsWith("/dashboard/query");

/** The card's answer with no item in it, which its own empty test holds for. */
const EMPTY_ANSWER = {
  ok: true,
  result: { op: "data", data: { items: [] } },
  empty: true,
};

/**
 * Passes the dashboard's batch through as one that found the card with nothing waiting, as
 * `readCardAsEmpty` does the layout read: a card hidden while empty is shown once its own batch
 * answer holds something, so the batch must agree with the layout read for the card to stay off.
 */
async function answerCardAsEmpty(page: Page): Promise<void> {
  await page.route(isBatchRead, async (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const asked =
      (
        route.request().postDataJSON() as {
          queries?: Array<{ widget?: string }>;
        }
      ).queries ?? [];
    const at = asked.findIndex(entry => entry.widget === CARD);
    // Aborted rather than thrown when the read is given up, as in `readCardAsEmpty`.
    let response: Awaited<ReturnType<Route["fetch"]>>;
    try {
      response = await route.fetch();
    } catch {
      await route.abort().catch(() => {});
      return;
    }
    // A batch the page gave up while it was answered (a newer load asks again) is already
    // settled: nothing waits for it, and a throw here would fail the test and print the request.
    const body =
      at === -1 ? undefined : withCardEmpty(await response.text(), at);
    await route
      .fulfill(body === undefined ? { response } : { response, body })
      .catch(() => {});
  });
}

/**
 * A batch answer with the slot at `at` answered empty: in a whole `{ results }` answer, or in the
 * `{ index, slot }` line that carries it when the answer is streamed.
 */
function withCardEmpty(text: string, at: number): string {
  const whole = wholeAnswer(text);
  if (whole !== undefined) {
    whole.results[at] = EMPTY_ANSWER;
    return JSON.stringify(whole);
  }
  return text
    .split("\n")
    .map(line => {
      if (line.trim() === "") return line;
      const settled = JSON.parse(line) as { index: number };
      return settled.index === at
        ? JSON.stringify({ index: at, slot: EMPTY_ANSWER })
        : line;
    })
    .join("\n");
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
    await answerCardAsEmpty(page);
    await gotoAdmin(page, "");
    // Drawn cards only: a card the page is drawn without keeps a cell it never shows.
    const card = page
      .getByTestId(`widget-cell-${CARD}`)
      .filter({ visible: true });
    await expect(
      page.getByTestId("widget-cell-core/continue").filter({ visible: true })
    ).toBeVisible();
    // Hidden, not absent: the page keeps the card's cell, undrawn.
    await expect(card).toBeHidden();

    // Away and back within the session: the return is drawn from the cached answer, which hid
    // the card, and the read it makes again finds the overdue release.
    await followLink(page, AWAY);
    await page.waitForURL(/\/admin\/media/);
    await page.unroute(isLayoutRead);
    await page.unroute(isBatchRead);
    await followLink(page, "/admin");
    await page.waitForURL(/\/admin\/?$/);

    await expect(card).toBeVisible();
    await expect(
      card.getByText(/^\d+ items? needs? your attention$/)
    ).toBeAttached();
  } finally {
    await page.unroute(isLayoutRead).catch(() => {});
    await page.unroute(isBatchRead).catch(() => {});
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

    await followLink(page, AWAY);
    await page.waitForURL(/\/admin\/media/);
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

const RELEASES = "core/upcoming-releases";

/**
 * A slot's answer with its list cut to its first item: the server's own shape, so the card draws
 * what it would for one item whatever other specs left in the shared database.
 */
function withOneItem(slot: unknown): unknown {
  const answer = slot as {
    result?: { data?: { items?: unknown[] } };
  };
  const items = answer.result?.data?.items;
  if (!Array.isArray(items)) return slot;
  return {
    ...answer,
    result: {
      ...answer.result,
      data: { ...answer.result?.data, items: items.slice(0, 1) },
    },
  };
}

/** A batch answer with the slots at `at` cut to one item, whole or streamed as lines. */
function withOneItemAt(text: string, at: readonly number[]): string {
  const whole = wholeAnswer(text);
  if (whole !== undefined) {
    for (const index of at)
      whole.results[index] = withOneItem(whole.results[index]);
    return JSON.stringify(whole);
  }
  return text
    .split("\n")
    .map(line => {
      if (line.trim() === "") return line;
      const settled = JSON.parse(line) as { index: number; slot: unknown };
      return at.includes(settled.index)
        ? JSON.stringify({ ...settled, slot: withOneItem(settled.slot) })
        : line;
    })
    .join("\n");
}

/** Passes the dashboard's batch through with `widgets`' answers cut to one item each. */
async function answerWithOneItem(
  page: Page,
  widgets: readonly string[]
): Promise<void> {
  await page.route(isBatchRead, async (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const asked =
      (
        route.request().postDataJSON() as {
          queries?: Array<{ widget?: string }>;
        }
      ).queries ?? [];
    const at = asked.flatMap((entry, index) =>
      entry.widget !== undefined && widgets.includes(entry.widget)
        ? [index]
        : []
    );
    // Aborted rather than thrown when the read is given up, as in `readCardAsEmpty`.
    let response: Awaited<ReturnType<Route["fetch"]>>;
    try {
      response = await route.fetch();
    } catch {
      await route.abort().catch(() => {});
      return;
    }
    const body =
      at.length === 0 ? undefined : withOneItemAt(await response.text(), at);
    await route
      .fulfill(body === undefined ? { response } : { response, body })
      .catch(() => {});
  });
}

test("stands at its one item's height, its row beside Upcoming releases at the same height", async ({
  page,
}) => {
  // Something waiting, so both cards are drawn; their answers are then cut to one item each.
  const id = await overdueRelease(page, Date.now().toString(36));
  try {
    await answerWithOneItem(page, [CARD, RELEASES]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoAdmin(page, "");
    const card = page
      .getByTestId(`widget-cell-${CARD}`)
      .filter({ visible: true });
    const releases = page
      .getByTestId(`widget-cell-${RELEASES}`)
      .filter({ visible: true });
    await expect(card.getByTestId("needs-attention-item")).toHaveCount(1);
    await expect(releases).toBeVisible();

    // 🔴 At least a row shorter than its stored rows: fixed rows draw it at their full height,
    // one item over three empty rows. The row it shares sizes to the taller of the two, and
    // both stand at it, their tops and bottoms aligned.
    const stored = cardHeightPx((await defaultSizeOf(page, CARD)).h);
    const heightOf = async (cell: typeof card) =>
      (await cell.boundingBox())?.height ?? Number.POSITIVE_INFINITY;
    await expect.poll(() => heightOf(card)).toBeLessThan(stored - 72);
    const [attentionBox, releasesBox] = await Promise.all([
      card.boundingBox(),
      releases.boundingBox(),
    ]);
    if (attentionBox === null || releasesBox === null) {
      throw new Error("[e2e] a card of the pair has no box");
    }
    expect(Math.abs(attentionBox.y - releasesBox.y)).toBeLessThan(1);
    expect(
      Math.abs(attentionBox.height - releasesBox.height)
    ).toBeLessThanOrEqual(1);
  } finally {
    await page.unroute(isBatchRead).catch(() => {});
    await cancel(page, id);
  }
});
