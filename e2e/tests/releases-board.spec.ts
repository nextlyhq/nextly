/**
 * The Releases page's three views in a real browser: List, Calendar and a
 * read-only Board grouped by state, a single-document release marked in each
 * as the list marks it, and "Hide single documents" holding for all three.
 *
 * The Board has no search, so it shows whatever the suite's database holds.
 * Each column is therefore held to what the server's list answers for its
 * tab: the same first releases, in the same order, and the same count. The
 * tabs never share a release, so neither do the columns. This run's own
 * releases are written so each leads its column (the newest draft and the
 * most recently finished lead theirs, and the scheduled ones are due before
 * anything else the suite schedules), and each is found in its own column
 * and in no other.
 *
 * @module e2e/tests/releases-board.spec
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { test } from "./support/test";
import { gotoAdmin } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import {
  leaveReleasesAsTheRunnerWould,
  type RunnerOutcome,
} from "./support/release-states";
import {
  cancel,
  ok,
  post,
  publishNow,
  release,
  releasesPerDay,
  schedule,
  scheduleDocument,
  type Requester,
} from "./support/releases-api";
import { LOCK } from "./support/locks";

// Reads every release as a whole (each column and its count), so it takes
// the lock the other release specs write under.
test.describe.configure({ lock: [LOCK.releases] });

/** The zone the browser reads in, so a day on the calendar is a UTC day. */
const READER_ZONE = "UTC";

test.use({ timezoneId: READER_ZONE });

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** How many releases a Board column shows before "+N more". */
const BOARD_LIMIT = 8;

/** The Board's columns, each the list tab it reads. */
const COLUMNS = [
  { tab: "drafts", label: "Draft" },
  { tab: "upcoming", label: "Scheduled" },
  { tab: "attention", label: "Needs attention" },
  { tab: "done", label: "Done" },
] as const;

type Tab = (typeof COLUMNS)[number]["tab"];

/** One tab's first releases and its count, as the list's read answers. */
async function tabRead(
  page: Requester,
  tab: Tab,
  kind?: "release"
): Promise<{ ids: string[]; total: number }> {
  const search = new URLSearchParams({ tab, limit: String(BOARD_LIMIT) });
  if (kind) search.set("kind", kind);
  const answer = await ok<{
    items: Array<{ id: string }>;
    meta: { total: number };
  }>(await page.request.get(`/admin/api/releases?${search.toString()}`));
  return { ids: answer.items.map(each => each.id), total: answer.meta.total };
}

/** A Board column, by the state it is named for. */
const column = (page: Page, label: string): Locator =>
  page.getByRole("region", { name: label, exact: true });

/** The release ids a column's tiles open, top to bottom. */
async function tileIds(column: Locator): Promise<string[]> {
  const hrefs = await column
    .getByRole("link")
    .evaluateAll(links => links.map(link => link.getAttribute("href") ?? ""));
  return hrefs.map(href => href.split("/").pop() ?? "");
}

/**
 * Hold every column to the list's read of its tab: the same first releases
 * in the same order, and the same count beside its name.
 */
async function expectColumnsAsTheList(
  page: Page,
  kind?: "release"
): Promise<Record<Tab, string[]>> {
  const shown = {} as Record<Tab, string[]>;
  for (const { tab, label } of COLUMNS) {
    const read = await tabRead(page, tab, kind);
    const region = column(page, label);
    // The heading is the column's name and then its count.
    await expect(region.getByRole("heading")).toHaveText(
      new RegExp(`^${label}\\s*${read.total}$`)
    );
    await expect
      .poll(() => tileIds(region), { message: `the ${label} column` })
      .toEqual(read.ids);
    shown[tab] = read.ids;
  }
  return shown;
}

/** Switch the page to one of its views. */
async function showView(page: Page, view: "list" | "calendar" | "board") {
  await page.getByRole("button", { name: view, exact: true }).click();
  await expect(
    page.getByRole("button", { name: view, exact: true })
  ).toHaveAttribute("aria-pressed", "true");
}

/** Day `day` of the month `months` after the current one, as `YYYY-MM-DD`. */
function dayAhead(months: number, day: number): string {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months, day)
  )
    .toISOString()
    .slice(0, 10);
}

/**
 * A day eight months ahead that holds no release yet, so a calendar cell
 * there shows this run's releases alone. Further ahead than the calendar
 * spec's days, so the two never choose the same one.
 */
async function freeDay(page: Requester): Promise<string> {
  const from = dayAhead(8, 1);
  const to = dayAhead(8, 28);
  const perDay = await releasesPerDay(page, from, to, READER_ZONE);
  for (const [day, count] of perDay) if (count === 0) return day;
  throw new Error(`Every day from ${from} to ${to} already holds a release.`);
}

/** Page the calendar with its month buttons to `day`'s month. */
async function showMonth(page: Page, day: string): Promise<void> {
  const target = day.slice(0, 7);
  for (let i = 0; i < 12; i += 1) {
    const shown = (
      (await page.locator("[data-day]").nth(14).getAttribute("data-day")) ?? ""
    ).slice(0, 7);
    if (shown === target) return;
    await page.getByRole("button", { name: "Next month" }).click();
  }
  throw new Error(`The calendar never showed ${target}.`);
}

test.describe("the Releases page's views", () => {
  test("offers List, Calendar and a read-only Board, marks single documents in each, and hides them in each", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const stamp = `${Date.now()}`;
    const name = (what: string) => `${what} ${stamp}`;
    const postId = await post(page, stamp);

    // One release in every state. The scheduled ones are due before
    // anything else the suite schedules, so they lead Scheduled, and are
    // cancelled once read, well before they would run.
    const soon = new Date(Date.now() + 20 * MINUTE);
    const scheduled = await release(page, name("Scheduled"), postId);
    await schedule(page, scheduled, soon, "UTC");
    const single = await scheduleDocument(
      page,
      await post(page, `${stamp}-single`),
      "publish",
      {
        into: "own",
        title: name("Single"),
        at: new Date(soon.getTime() + MINUTE).toISOString(),
        timezone: "UTC",
      }
    );
    // On a calendar day of their own: one ordinary release beside one that
    // holds a single document.
    const day = await freeDay(page);
    const onDay = new Date(Date.parse(`${day}T12:00:00.000Z`));
    const dayOrdinary = await release(page, name("Day ordinary"), postId);
    await schedule(page, dayOrdinary, onDay, "UTC");
    const daySingle = await scheduleDocument(
      page,
      await post(page, `${stamp}-day-single`),
      "publish",
      {
        into: "own",
        title: name("Day single"),
        at: new Date(onDay.getTime() + 60 * MINUTE).toISOString(),
        timezone: "UTC",
      }
    );
    const needAttention: Array<{ id: string; outcome: RunnerOutcome }> = [];
    for (const outcome of ["stopped", "overdue"] as const) {
      const id = await release(page, name(outcome), postId);
      await schedule(page, id, new Date(Date.now() + 40 * DAY), "UTC");
      needAttention.push({ id, outcome });
    }
    const published = await release(page, name("Published"), postId);
    await publishNow(page, published);
    const cancelled = await release(page, name("Cancelled"), postId);
    await cancel(page, cancelled);
    const draft = await release(page, name("Draft"), postId);
    // Left as the runner leaves them only after every other write: Publish
    // now runs a pass of the runner, which would run an overdue release.
    await leaveReleasesAsTheRunnerWould(page, needAttention);
    const [stopped, overdue] = needAttention.map(each => each.id);

    try {
      await gotoAdmin(page, "/releases");
      await expect(
        page
          .getByRole("group", { name: "View releases as" })
          .getByRole("button")
      ).toHaveText(["list", "calendar", "board"]);

      // The Board: four columns, each as the list's tab reads, so every
      // release is in exactly one of them.
      await showView(page, "board");
      const shown = await expectColumnsAsTheList(page);
      const where = (id: string) =>
        COLUMNS.filter(({ tab }) => shown[tab].includes(id)).map(
          each => each.label
        );
      expect(where(draft)).toEqual(["Draft"]);
      expect(where(scheduled)).toEqual(["Scheduled"]);
      expect(where(single)).toEqual(["Scheduled"]);
      expect(where(stopped)).toEqual(["Needs attention"]);
      expect(where(overdue)).toEqual(["Needs attention"]);
      expect(where(published)).toEqual(["Done"]);
      expect(where(cancelled)).toEqual(["Done"]);

      // The single-document release carries the list's mark, in words a
      // screen reader hears with its title; the ordinary one does not.
      const scheduledColumn = column(page, "Scheduled");
      const singleTile = scheduledColumn.getByRole("link", {
        name: new RegExp(`^${name("Single")} Single document\\b`),
      });
      await expect(singleTile).toBeVisible();
      await expect(
        scheduledColumn.getByRole("link", { name: name("Scheduled") })
      ).not.toContainText("Single document");

      // Read-only: dragged onto Done, a tile stays where it was.
      await singleTile.dragTo(column(page, "Done"));
      await expect(page).toHaveURL(/\/admin\/releases$/);
      await expectColumnsAsTheList(page);
      await expectNoAxeViolations(page);

      // The Calendar: the chip carries the same mark, and the day's count
      // holds both releases.
      await showView(page, "calendar");
      await showMonth(page, day);
      // The day's cell: its chips sit beside its button, not inside it.
      const cell = page
        .getByRole("gridcell")
        .filter({ has: page.locator(`[data-day="${day}"]`) });
      await expect(
        cell.getByRole("link", {
          name: new RegExp(`^${name("Day single")} Single document\\b`),
        })
      ).toBeVisible();
      await expect(
        cell.getByRole("link", { name: new RegExp(name("Day ordinary")) })
      ).not.toContainText("Single document");
      await expect(page.locator(`[data-day="${day}"]`)).toHaveAttribute(
        "aria-label",
        /2 releases/
      );
      await expectNoAxeViolations(page);

      // The List: its mark is the one the other views copy. Hide single
      // documents there, and the other two views leave them out too.
      await showView(page, "list");
      await page.getByPlaceholder("Search by title or description").fill(stamp);
      await expect(
        page.getByRole("row", { name: new RegExp(name("Single")) })
      ).toContainText("Single document");
      await page.getByRole("switch", { name: "Hide single documents" }).click();
      await expect(
        page.getByRole("row", { name: new RegExp(name("Single")) })
      ).toHaveCount(0);
      await expectNoAxeViolations(page);

      await showView(page, "board");
      const filtered = await expectColumnsAsTheList(page, "release");
      expect(filtered.upcoming).not.toContain(single);
      expect(filtered.upcoming).toContain(scheduled);
      await expect(page.getByText("Single document")).toHaveCount(0);

      await showView(page, "calendar");
      await showMonth(page, day);
      await expect(
        cell.getByRole("link", { name: new RegExp(name("Day single")) })
      ).toHaveCount(0);
      await expect(
        cell.getByRole("link", { name: new RegExp(name("Day ordinary")) })
      ).toBeVisible();
      await expect(page.locator(`[data-day="${day}"]`)).toHaveAttribute(
        "aria-label",
        /1 release\b/
      );
    } finally {
      // Nothing of this run is left to run, or to stand in a later spec's
      // attention strip.
      for (const id of [
        scheduled,
        single,
        dayOrdinary,
        daySingle,
        stopped,
        overdue,
      ]) {
        if (id) await cancel(page, id);
      }
    }
  });
});
