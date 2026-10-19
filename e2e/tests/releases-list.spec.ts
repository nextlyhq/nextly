/**
 * The Releases list in a real browser: its four tabs, their counts and pages,
 * and its times in the reader's own zone.
 *
 * The releases are written through the API, each named with a stamp this run
 * owns, and the list is searched for that stamp, so the counts and rows are
 * exactly the ones written here whatever else the database holds.
 */
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { test, expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";

const API = "/admin/api";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * The suite's own throwaway database (see `playwright.config.ts`), emptied
 * before every run.
 */
const E2E_DB = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../apps/playground/data/e2e.db"
);

/**
 * Leave a scheduled release as the runner leaves one it never reached or
 * could not finish.
 *
 * Written to the row because no request does this on purpose: scheduling a
 * time already past runs the release there and then, and a release with a
 * problem is refused a schedule. Overdue is a scheduled release more than ten
 * minutes past its time; stopped is the runner's `blocked`.
 */
function leaveAsTheRunnerWould(
  id: string,
  outcome: "overdue" | "stopped"
): void {
  const db = new DatabaseSync(E2E_DB);
  try {
    const anHourAgo = Math.floor((Date.now() - HOUR) / 1000);
    db.prepare(
      "UPDATE nextly_releases SET state = ?, scheduled_at = ? WHERE id = ?"
    ).run(outcome === "stopped" ? "blocked" : "scheduled", anHourAgo, id);
  } finally {
    db.close();
  }
}

async function ok<T>(
  response: Awaited<ReturnType<Page["request"]["post"]>>
): Promise<T> {
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as T;
}

/** A post to put in releases: a release with no documents is not scheduled. */
async function post(page: Page, stamp: string): Promise<string> {
  const { item } = await ok<{ item: { id: string } }>(
    await page.request.post(`${API}/collections/posts/entries`, {
      data: { title: `Release e2e ${stamp}`, slug: `release-e2e-${stamp}` },
    })
  );
  return item.id;
}

/** A release holding one post, created as a draft. */
async function release(
  page: Page,
  title: string,
  postId: string
): Promise<string> {
  const { item } = await ok<{ item: { id: string } }>(
    await page.request.post(`${API}/releases`, { data: { title } })
  );
  await ok(
    await page.request.post(`${API}/releases/${item.id}/members`, {
      data: {
        scopeKind: "collection",
        scopeSlug: "posts",
        entryId: postId,
        action: "publish",
      },
    })
  );
  return item.id;
}

async function schedule(
  page: Page,
  id: string,
  at: Date,
  timezone: string
): Promise<void> {
  await ok(
    await page.request.post(`${API}/releases/${id}/schedule`, {
      data: { at: at.toISOString(), timezone },
    })
  );
}

/** The titles the open tab lists, page by page until the last. */
async function titlesInTab(page: Page): Promise<string[]> {
  const table = page.getByRole("table");
  const titles: string[] = [];
  for (;;) {
    await expect(table.locator("tbody tr").first()).toBeVisible();
    titles.push(
      ...(await table.locator("tbody tr td:first-child a").allTextContents())
    );
    const next = page.getByRole("button", { name: "Go to next page" });
    if (!(await next.isVisible()) || (await next.isDisabled())) break;
    const first = await table
      .locator("tbody tr td:first-child a")
      .first()
      .textContent();
    await next.click();
    await expect(
      table.locator("tbody tr td:first-child a").first()
    ).not.toHaveText(first ?? "");
  }
  return titles.map(title => title.trim());
}

async function searchFor(page: Page, text: string): Promise<void> {
  await page.getByPlaceholder("Search by title or description").fill(text);
}

test.describe("the Releases list", () => {
  test("shows each tab with its count, and every release in exactly one tab, paged", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    const stamp = `${Date.now()}`;
    const postId = await post(page, stamp);
    const name = (what: string) => `${what} ${stamp}`;

    // More upcoming releases than one page of 25 holds.
    const upcoming: string[] = [];
    for (let i = 1; i <= 27; i += 1) {
      const title = name(`Upcoming ${String(i).padStart(2, "0")}`);
      const id = await release(page, title, postId);
      await schedule(page, id, new Date(Date.now() + i * DAY), "UTC");
      upcoming.push(title);
    }
    // Needs attention holds both of its parts: one overdue, one stopped.
    // Scheduled now and left as the runner would leave them only after every
    // other write, because Publish now runs a pass of the runner, which would
    // run an overdue release it found.
    const overdue = name("Overdue");
    const stopped = name("Stopped");
    const needAttention: Array<[string, "overdue" | "stopped"]> = [];
    for (const [title, outcome] of [
      [overdue, "overdue"],
      [stopped, "stopped"],
    ] as const) {
      const id = await release(page, title, postId);
      await schedule(page, id, new Date(Date.now() + 40 * DAY), "UTC");
      needAttention.push([id, outcome]);
    }
    const draft = name("Draft");
    await release(page, draft, postId);
    const published = name("Published");
    await ok(
      await page.request.post(
        `${API}/releases/${await release(page, published, postId)}/publish`,
        { data: {} }
      )
    );
    const cancelled = name("Cancelled");
    await ok(
      await page.request.post(
        `${API}/releases/${await release(page, cancelled, postId)}/cancel`,
        { data: {} }
      )
    );

    for (const [id, outcome] of needAttention) {
      leaveAsTheRunnerWould(id, outcome);
    }

    await gotoAdmin(page, "/releases");
    await searchFor(page, stamp);

    const tab = (label: string) => page.getByRole("tab", { name: label });
    await expect(tab("Upcoming (27)")).toBeVisible();
    await expect(tab("Needs attention (2)")).toBeVisible();
    await expect(tab("Drafts (1)")).toBeVisible();
    await expect(tab("Done (2)")).toBeVisible();

    // Upcoming pages like the other tables: 25, then the rest, soonest first.
    await expect(page.getByText(/Showing 1.25 of 27 releases/)).toBeVisible();
    const inUpcoming = await titlesInTab(page);
    expect(inUpcoming).toEqual(upcoming);

    const seen: Record<string, string[]> = { upcoming: inUpcoming };
    for (const [key, label] of [
      ["attention", "Needs attention (2)"],
      ["drafts", "Drafts (1)"],
      ["done", "Done (2)"],
    ] as const) {
      await tab(label).click();
      seen[key] = await titlesInTab(page);
    }
    // Stopped first: it will not run until somebody acts.
    expect(seen.attention).toEqual([stopped, overdue]);
    expect(seen.drafts).toEqual([draft]);
    expect([...seen.done].sort()).toEqual([cancelled, published].sort());

    // Every release written, in exactly one tab.
    const all = Object.values(seen).flat();
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual(
      [...upcoming, overdue, stopped, draft, published, cancelled].sort()
    );
  });
});

test.describe("the Releases list, read from New York", () => {
  test.use({ timezoneId: "America/New_York" });

  test("shows the reader's time, and the scheduled zone's where it differs", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const stamp = `${Date.now()}`;
    const postId = await post(page, stamp);

    // 07:00 on Thursday 17 June 2027 in Karachi is 22:00 the evening before
    // in New York.
    const karachi = `From Karachi ${stamp}`;
    await schedule(
      page,
      await release(page, karachi, postId),
      new Date("2027-06-17T02:00:00.000Z"),
      "Asia/Karachi"
    );
    // The control: scheduled in the reader's own zone, so one time only.
    const local = `From New York ${stamp}`;
    await schedule(
      page,
      await release(page, local, postId),
      new Date("2027-06-18T13:00:00.000Z"),
      "America/New_York"
    );

    await gotoAdmin(page, "/releases");
    await searchFor(page, stamp);

    const table = page.getByRole("table");
    const row = (title: string) =>
      table.locator("tbody tr").filter({ hasText: title });

    const away = row(karachi);
    await expect(away).toContainText(/Wed, Jun 16, 2027,? 10:00\sPM/);
    await expect(away).toContainText("your time");
    await expect(away).toContainText(
      /Thu, Jun 17, 2027,? 7:00\sAM Asia\/Karachi/
    );
    await expect(away).toContainText("(as scheduled)");

    const home = row(local);
    await expect(home).toContainText(/Fri, Jun 18, 2027,? 9:00\sAM/);
    await expect(home).not.toContainText("your time");
    await expect(home).not.toContainText("as scheduled");
  });
});
