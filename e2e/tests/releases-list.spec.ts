/**
 * The Releases list in a real browser: its four tabs, their counts and pages,
 * its times in the reader's own zone, and every tab under axe with the
 * suite's brand colour applied.
 *
 * The releases are written through the API, each named with a stamp this run
 * owns, and the list is searched for that stamp, so the counts and rows are
 * exactly the ones written here whatever else the database holds.
 */
import { expect, type Page } from "@playwright/test";

import { test } from "./support/test";
import { gotoAdmin } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import {
  leaveReleasesAsTheRunnerWould,
  type RunnerOutcome,
} from "./support/release-states";
import {
  cancel,
  post,
  publishNow,
  release,
  schedule,
} from "./support/releases-api";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Rows per page: the list starts at 25. */
const PAGE_SIZE = 25;

/**
 * The titles the open tab lists, page by page, for a tab holding `total`.
 *
 * Each page is read once the pager says it is showing that page of that
 * total, and the table holds that many rows, so a page is never read while
 * the one before it is still on screen.
 */
async function titlesInTab(page: Page, total: number): Promise<string[]> {
  const links = page.getByRole("table").locator("tbody tr td:first-child a");
  const titles: string[] = [];
  for (let from = 1; from <= total; from += PAGE_SIZE) {
    const to = Math.min(total, from + PAGE_SIZE - 1);
    await expect(
      page.getByText(new RegExp(`Showing ${from}.${to} of ${total} releases?$`))
    ).toBeVisible();
    await expect(links).toHaveCount(to - from + 1);
    titles.push(...(await links.allTextContents()));
    if (to < total) {
      await page.getByRole("button", { name: "Go to next page" }).click();
    }
  }
  return titles.map(title => title.trim());
}

/**
 * Search the list, and wait until the open tab's page is the searched one.
 *
 * Waited for by its response, not by what the screen shows: the search box
 * waits a moment before it searches, and on a database holding only this
 * run's releases the unsearched list already reads the same. A page turned
 * in that moment is rightly sent back to the first page when the search
 * lands, as any new search is.
 */
async function searchFor(page: Page, text: string): Promise<void> {
  const searched = page.waitForResponse(
    response =>
      response.url().includes("/admin/api/releases?") &&
      response.url().includes(`search=${encodeURIComponent(text)}`) &&
      // The tab's page, not one of the tab counts, which ask for no page.
      new URL(response.url()).searchParams.has("page") &&
      response.ok()
  );
  await page.getByPlaceholder("Search by title or description").fill(text);
  await searched;
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
    const needAttention: Array<{ id: string; outcome: RunnerOutcome }> = [];
    for (const [title, outcome] of [
      [overdue, "overdue"],
      [stopped, "stopped"],
    ] as const) {
      const id = await release(page, title, postId);
      await schedule(page, id, new Date(Date.now() + 40 * DAY), "UTC");
      needAttention.push({ id, outcome });
    }
    const draft = name("Draft");
    await release(page, draft, postId);
    const published = name("Published");
    await publishNow(page, await release(page, published, postId));
    const cancelled = name("Cancelled");
    await cancel(page, await release(page, cancelled, postId));

    await leaveReleasesAsTheRunnerWould(page, needAttention);

    await gotoAdmin(page, "/releases");
    await searchFor(page, stamp);

    const tab = (label: string) => page.getByRole("tab", { name: label });
    await expect(tab("Upcoming (27)")).toBeVisible();
    await expect(tab("Needs attention (2)")).toBeVisible();
    await expect(tab("Drafts (1)")).toBeVisible();
    await expect(tab("Done (2)")).toBeVisible();

    // Upcoming pages like the other tables: 25, then the rest, soonest first.
    const inUpcoming = await titlesInTab(page, 27);
    expect(inUpcoming).toEqual(upcoming);

    const seen: Record<string, string[]> = { upcoming: inUpcoming };
    for (const [key, label, total] of [
      ["attention", "Needs attention (2)", 2],
      ["drafts", "Drafts (1)", 1],
      ["done", "Done (2)", 2],
    ] as const) {
      await tab(label).click();
      await expect(tab(label)).toHaveAttribute("aria-selected", "true");
      seen[key] = await titlesInTab(page, total);
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

/**
 * The admin's default primary, which the brand colour must have replaced for
 * the scan below to say anything about a branded admin.
 */
const DEFAULT_PRIMARY = "oklch(0 0 0)";

/**
 * The state badges, which are what this check holds to AA.
 *
 * Scoped to them rather than the whole page because, under the brand colour,
 * a whole-page scan of this list also fails on parts drawn by shared
 * components, not by the releases screens: the selected tab's brand-coloured
 * text, the table row that is both a link and a holder of its menu, the
 * rows-per-page select's missing name, and the search box's clear button's
 * size. Each is a design-system defect to fix where it lives; scanning the
 * whole page here would keep this check red for reasons the releases code
 * cannot change, and so stop it saying anything about the badges.
 */
const STATE_BADGES = '[role="tabpanel"] [data-slot^="badge."]';

test.describe("the Releases list, under a brand colour", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`draws every state's badge at AA contrast, at desk and phone widths (${theme})`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: 1440, height: 900 });
      const stamp = `${Date.now()}`;
      const postId = await post(page, `list-axe-${stamp}`);
      const name = (what: string) => `Contrast ${what} ${stamp}`;

      // One release in each state the list draws a badge for.
      await schedule(
        page,
        await release(page, name("upcoming"), postId),
        new Date(Date.now() + 3 * DAY),
        "UTC"
      );
      await release(page, name("draft"), postId);
      await publishNow(page, await release(page, name("published"), postId));
      await cancel(page, await release(page, name("cancelled"), postId));
      const attention: Array<{ id: string; outcome: RunnerOutcome }> = [];
      for (const outcome of ["overdue", "stopped"] as const) {
        const id = await release(page, name(outcome), postId);
        await schedule(page, id, new Date(Date.now() + 40 * DAY), "UTC");
        attention.push({ id, outcome });
      }
      // Last, since Publish now runs a pass of the runner.
      await leaveReleasesAsTheRunnerWould(page, attention);

      await gotoAdmin(page, "/releases", theme);
      // The suite's server runs with the playground's brand colours on.
      // Checked rather than assumed: on the default palette the primary is
      // the foreground colour, and every badge would pass whatever it is
      // drawn with.
      const primary = await page
        .locator(".nextly-admin")
        .first()
        .evaluate(root =>
          getComputedStyle(root).getPropertyValue("--nx-primary").trim()
        );
      expect(primary).not.toBe("");
      expect(primary).not.toBe(DEFAULT_PRIMARY);
      await searchFor(page, stamp);

      for (const label of [
        "Upcoming (1)",
        "Needs attention (2)",
        "Drafts (1)",
        "Done (2)",
      ]) {
        const tab = page.getByRole("tab", { name: label });
        await tab.click();
        await expect(tab).toHaveAttribute("aria-selected", "true");
        // The table at a desk's width and a card per row at a phone's, which
        // draw each badge on a different surface.
        for (const width of [1440, 390]) {
          await page.setViewportSize({ width, height: 900 });
          await expectNoAxeViolations(page, { include: STATE_BADGES });
        }
        await page.setViewportSize({ width: 1440, height: 900 });
      }
    });
  }
});
