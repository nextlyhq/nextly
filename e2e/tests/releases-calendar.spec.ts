/**
 * The Releases calendar in a real browser: the zone that decides a day, a
 * busy day's complete "+N more" and its list, a release on the day it really
 * went out, every state by its word, and the whole grid by keyboard alone.
 *
 * The releases are written through the API, each named with a stamp this run
 * owns, on dates two to five months after today, worked out from the clock
 * when the test runs: far enough ahead that nothing else the suite writes
 * lands on them, always in the future so they are scheduled rather than run,
 * and never a month that expires. The browser reads as New York, so the
 * reader's zone and the zone a release was scheduled in differ.
 *
 * @module e2e/tests/releases-calendar.spec
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { dayKeyIn } from "../../packages/admin/src/components/features/releases/release-timezone";

import { test } from "./support/test";
import { gotoAdmin } from "./support/admin";
import {
  expectBrandColourApplied,
  expectNoAxeViolations,
  expectShortTextReadable,
} from "./support/axe";
import { leaveReleasesAsTheRunnerWould } from "./support/release-states";
import {
  post,
  publishNow,
  release,
  releasesPerDay,
  schedule,
} from "./support/releases-api";
import { LOCK } from "./support/locks";
import { waitForShellAnswers } from "./support/shell-geometry";

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ lock: [LOCK.releases] });

/** The zone the browser reads in, and so the zone the calendar opens in. */
const READER_ZONE = "America/New_York";

test.use({ timezoneId: READER_ZONE });

/** The most months a test pages through before it gives up. */
const MONTH_LIMIT = 30;

/** Open the releases page in its calendar view, at 1440 wide. */
async function openCalendar(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await gotoAdmin(page, "/releases");
  await page.getByRole("button", { name: "calendar" }).click();
  await expect(page.getByRole("grid")).toBeVisible();
}

/** The month heading above the grid. */
function monthHeading(page: Page): Locator {
  return page.getByRole("heading", { level: 2 });
}

const DAY_MS = 86_400_000;

/** Day `day` of the month `months` after the current one, as `YYYY-MM-DD`. */
function dayAhead(months: number, day: number): string {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months, day)
  )
    .toISOString()
    .slice(0, 10);
}

/** The day `offset` days from `day`. */
function shiftDay(day: string, offset: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + offset * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** `day` at `hour` UTC, plus `minute`. */
function at(day: string, hour: number, minute = 0): Date {
  return new Date(
    Date.parse(`${day}T00:00:00.000Z`) + (hour * 60 + minute) * 60_000
  );
}

/**
 * The first of the days `first` to `last` of the month `months` ahead that
 * holds no release in the reader's zone, so that what the test counts there
 * is its own releases alone.
 *
 * The suite shares one database, and a test run again in it, as a retry or
 * under --repeat-each, finds its earlier run's releases on whichever fixed day
 * that run used: the day then counts them all. Asked of the calendar read the
 * grid draws from, which places each release on its day in the zone asked.
 */
async function freeDay(
  page: Page,
  months: number,
  first: number,
  last: number
): Promise<string> {
  const from = dayAhead(months, first);
  const to = dayAhead(months, last);
  const perDay = await releasesPerDay(page, from, to, READER_ZONE);
  for (let day = from; day <= to; day = shiftDay(day, 1)) {
    if (perDay.get(day) === 0) return day;
  }
  throw new Error(
    `Every day from ${from} to ${to} already holds a release in this database.`
  );
}

/**
 * Hold that `instants` all fall on `day` in the reader's zone, by the rule
 * the calendar places a release with: the test counts them on that day, and
 * a free day says nothing about a release that lands on its neighbour.
 */
function expectOnDay(instants: readonly Date[], day: string): void {
  expect(instants.map(instant => dayKeyIn(instant, READER_ZONE))).toEqual(
    instants.map(() => day)
  );
}

/** What the admin heads a month with, in the browser's en-US: "March 2027". */
function monthLabel(day: string): string {
  return new Date(`${day}T12:00:00.000Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** What the admin names a day by: "Wednesday, March 10, 2027". */
function longDay(day: string): string {
  return new Date(`${day}T12:00:00.000Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The month the grid shows, read from its days: its third row always lies
 * wholly inside the month shown.
 */
async function shownMonth(page: Page): Promise<string> {
  const day = await page.locator("[data-day]").nth(14).getAttribute("data-day");
  return (day ?? "").slice(0, 7);
}

/** Page with the month buttons, in whichever direction, to `day`'s month. */
async function showMonth(page: Page, day: string): Promise<void> {
  const target = day.slice(0, 7);
  for (let i = 0; i < MONTH_LIMIT; i += 1) {
    const shown = await shownMonth(page);
    if (shown === target) break;
    await page
      .getByRole("button", {
        name: shown < target ? "Next month" : "Previous month",
      })
      .click();
  }
  await expect(monthHeading(page)).toHaveText(monthLabel(day));
}

/** The grid cell of one day. */
function dayCell(page: Page, date: string): Locator {
  return page.locator("td", { has: page.locator(`[data-day="${date}"]`) });
}

/** A chip for the release titled `title`, in `scope`. */
function chip(scope: Locator, title: string): Locator {
  return scope.getByRole("link").filter({ hasText: title });
}

/** The most pages of one day's list a test reads before it gives up. */
const DAY_PAGE_LIMIT = 10;

/**
 * Open `day`'s full list from the day itself, which must be in the month on
 * screen, and answer the row of the release titled `title` in it; the caller
 * closes the list. By keyboard: at a desk's width the day's chips cover the
 * middle of its button, where a pointer click would land on a chip.
 *
 * Read page by page from the first. The list draws one page of the day at a
 * time, and a day the suite's other specs have filled can put the release
 * past the first page. A page is read once its rows have replaced the
 * previous page's, which a new first row says.
 */
async function dayListRow(
  page: Page,
  day: string,
  title: string
): Promise<Locator> {
  await page.locator(`[data-day="${day}"]`).focus();
  await page.keyboard.press("Enter");
  const sheet = page.getByRole("dialog", { name: longDay(day) });
  const list = sheet.getByRole("list", { name: "Releases on this day" });
  const row = list.getByRole("listitem").filter({ hasText: title });
  const first = list.getByRole("link").first();
  const pager = sheet.getByRole("navigation", {
    name: "Pages of this day's releases",
  });
  const next = pager.getByRole("button", { name: "Go to next page" });
  await expect(first).toBeVisible();
  if (await pager.isVisible()) await expect(pager).toContainText("Page 1 of");
  for (let i = 0; i < DAY_PAGE_LIMIT; i += 1) {
    if ((await row.count()) > 0) break;
    if (!(await next.isVisible()) || (await next.isDisabled())) break;
    const shown = (await first.getAttribute("href")) ?? "";
    await next.click();
    await expect(first).not.toHaveAttribute("href", shown);
  }
  return row;
}

/** The date of the day button holding focus. */
async function focusedDay(page: Page): Promise<string | null> {
  return page.evaluate(
    () => document.activeElement?.getAttribute("data-day") ?? null
  );
}

/**
 * ICU writes a narrow no-break space before AM/PM in some versions and a
 * plain space in others; the reader sees a space either way.
 */
const SPACE = "[\\s\\u202f]";

test.describe("the Releases calendar", () => {
  test("puts a release near midnight on the day it runs in the chosen zone", async ({
    page,
  }) => {
    const stamp = `${Date.now()}`;
    const postId = await post(page, `cal-midnight-${stamp}`);
    // 03:30 UTC on the 10th is the evening of the 9th in New York (22:30 or
    // 23:30, by daylight saving), and 08:30 on the 10th in Karachi, where it
    // was scheduled.
    const day = dayAhead(2, 10);
    const eve = shiftDay(day, -1);
    const title = `Near midnight ${stamp}`;
    await schedule(
      page,
      await release(page, title, postId),
      at(day, 3, 30),
      "Asia/Karachi"
    );

    await openCalendar(page);
    await expect(
      page.getByRole("button", { name: /Times in America\/New York/ })
    ).toBeVisible();
    await showMonth(page, day);

    const inNewYork = chip(dayCell(page, eve), title);
    await expect(inNewYork).toBeVisible();
    await expect(inNewYork).toContainText(new RegExp(`1[01]:30${SPACE}PM`));
    await expect(chip(dayCell(page, day), title)).toHaveCount(0);

    // The zone it was scheduled in is offered by name, above every other.
    await page.getByRole("button", { name: /Times in/ }).click();
    const scheduledIn = page.getByRole("group", { name: "Scheduled in" });
    await scheduledIn.getByRole("option", { name: /Asia\/Karachi/ }).click();

    await expect(
      page.getByRole("button", { name: /Times in Asia\/Karachi/ })
    ).toBeVisible();
    await expect(monthHeading(page)).toHaveText(monthLabel(day));
    const inKarachi = chip(dayCell(page, day), title);
    await expect(inKarachi).toBeVisible();
    await expect(inKarachi).toContainText(new RegExp(`8:30${SPACE}AM`));
    await expect(chip(dayCell(page, eve), title)).toHaveCount(0);
  });

  test("counts a busy day in full, and opens its whole list from '+N more'", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const stamp = `${Date.now()}`;
    const postId = await post(page, `cal-dense-${stamp}`);
    // Seven on one day, more than its three rows hold, an hour apart from
    // 09:00 UTC, which is the morning of the same day in New York. The day
    // holds nothing else, so the counts below are these seven alone.
    const day = await freeDay(page, 3, 1, 28);
    const instants = Array.from({ length: 7 }, (_, i) => at(day, 9 + i));
    expectOnDay(instants, day);
    const titles: string[] = [];
    for (const [i, instant] of instants.entries()) {
      const title = `Dense ${String(i + 1).padStart(2, "0")} ${stamp}`;
      await schedule(page, await release(page, title, postId), instant, "UTC");
      titles.push(title);
    }

    await openCalendar(page);
    await showMonth(page, day);
    const cell = dayCell(page, day);
    // Two chips, the first two of the day, and the other five counted.
    await expect(cell.getByRole("link")).toHaveCount(2);
    await expect(chip(cell, titles[0])).toBeVisible();
    await expect(chip(cell, titles[1])).toBeVisible();
    await expect(page.locator(`[data-day="${day}"]`)).toHaveAttribute(
      "aria-label",
      /7 releases$/
    );

    await cell.getByRole("button", { name: /^\+5 more/ }).click();
    const list = page.getByRole("dialog", { name: longDay(day) });
    await expect(list).toBeVisible();
    await expect(list).toContainText("7 releases");
    const rows = list.getByRole("list", { name: "Releases on this day" });
    await expect(rows.getByRole("listitem")).toHaveCount(7);
    expect(
      (await rows.getByRole("link").allTextContents()).map(t => t.trim())
    ).toEqual(titles);

    await expectNoAxeViolations(page);
    await page.keyboard.press("Escape");
    await expect(list).toBeHidden();
  });

  test("shows a release on the day it went out, and every state by its word", async ({
    page,
  }) => {
    const stamp = `${Date.now()}`;
    const postId = await post(page, `cal-states-${stamp}`);
    // Scheduled for a day months ahead, then published now: it went out
    // today, and today is where it belongs.
    const published = `Went out today ${stamp}`;
    const scheduledFor = dayAhead(5, 20);
    const publishedId = await release(page, published, postId);
    await schedule(page, publishedId, at(scheduledFor, 15), "UTC");
    await publishNow(page, publishedId);

    // Named without a state word, so the state on the chip is the one the
    // calendar wrote and not part of the title.
    const overdue = `Missed launch ${stamp}`;
    const stopped = `Problem launch ${stamp}`;
    const attention = [];
    for (const [title, outcome] of [
      [overdue, "overdue"],
      [stopped, "stopped"],
    ] as const) {
      const id = await release(page, title, postId);
      await schedule(page, id, at(dayAhead(5, 21), 15), "UTC");
      attention.push({ id, outcome });
    }
    // Last, since Publish now runs a pass of the runner, which would run an
    // overdue release it found.
    const due = await leaveReleasesAsTheRunnerWould(page, attention);

    // Read from each day's full list rather than its chips. The suite shares
    // one database, and other specs leave releases on today and the hour
    // before it, so a day here may hold more than its chips draw: the rest
    // are counted in "+N more", and only the day's list names every one.
    await openCalendar(page);
    const today =
      (await page
        .getByRole("grid")
        .locator('[aria-current="date"]')
        .getAttribute("data-day")) ?? "";
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await expect(await dayListRow(page, today, published)).toContainText(
      "Published"
    );
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();

    // Overdue and stopped were due an hour ago, which near midnight is
    // yesterday, and on the first of a month is in the month before. Their
    // day is the one the calendar's own rule places them on.
    const dueDay = dayKeyIn(due, READER_ZONE);
    await showMonth(page, dueDay);
    const overdueRow = await dayListRow(page, dueDay, overdue);
    await expect(overdueRow).toContainText("Overdue");
    await expect(overdueRow).not.toContainText("Scheduled");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(await dayListRow(page, dueDay, stopped)).toContainText(
      "Stopped"
    );
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();

    await showMonth(page, scheduledFor);
    await expect(chip(dayCell(page, scheduledFor), published)).toHaveCount(0);
  });

  test("works by keyboard alone, announces today, and passes axe", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const stamp = `${Date.now()}`;
    const postId = await post(page, `cal-keys-${stamp}`);
    // A day holding nothing else, so its list is these four alone, whatever
    // an earlier run in this database left. From the 8th to the 21st, so the
    // day's week and the week below it stay inside its month, where the
    // arrows below move. No other test uses this month.
    const day = await freeDay(page, 4, 8, 21);
    const instants = Array.from({ length: 4 }, (_, i) => at(day, 14 + i));
    expectOnDay(instants, day);
    const titles: string[] = [];
    for (const [i, instant] of instants.entries()) {
      const title = `Keys ${i + 1} ${stamp}`;
      await schedule(page, await release(page, title, postId), instant, "UTC");
      titles.push(title);
    }

    await page.setViewportSize({ width: 1440, height: 1000 });
    await gotoAdmin(page, "/releases");
    // Drawn in full before the first key, as a reader waits to see the page.
    // A page still drawing replaces what holds focus: the skip link's target
    // loses it to the document, and Tab starts over from the top. The fuller
    // the list, the longer it draws, so a database the suite has filled
    // showed it where a fresh one did not.
    await waitForShellAnswers(page);
    await expect(page.getByRole("button", { name: "calendar" })).toBeVisible();
    await expect(
      page.getByRole("table", { name: "Upcoming releases" })
    ).toBeVisible();

    // Skip the admin's navigation first, as a keyboard user would: the sidebar
    // lists every collection and Single, so tabbing through it takes as many
    // stops as the schema has entries. The skip link is the first stop, and
    // it moves focus into the page.
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toHaveAccessibleName(
      "Skip to content"
    );
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main")).toBeFocused();

    // Tab to the view switch, and into the grid, as a keyboard user would.
    const reach = async (found: () => Promise<boolean>) => {
      for (let i = 0; i < 80; i += 1) {
        if (await found()) return;
        await page.keyboard.press("Tab");
      }
      throw new Error("never reached by Tab");
    };
    await reach(() =>
      page.evaluate(
        () => document.activeElement?.textContent?.trim() === "calendar"
      )
    );
    await page.keyboard.press("Enter");
    await expect(page.getByRole("grid")).toBeVisible();
    await reach(async () => (await focusedDay(page)) !== null);

    // The grid's one tab stop opens on today, and says so.
    const opened = page.locator(":focus");
    await expect(opened).toHaveAttribute("aria-current", "date");
    await expect(opened).toHaveAttribute("aria-label", /, today, /);
    await expectNoAxeViolations(page);

    // Page Down to the releases' month, then arrows to their day.
    for (let i = 0; i < MONTH_LIMIT; i += 1) {
      if ((await shownMonth(page)) === day.slice(0, 7)) break;
      await page.keyboard.press("PageDown");
    }
    await expect(monthHeading(page)).toHaveText(monthLabel(day));
    const from = (await focusedDay(page)) ?? "";
    expect(from.slice(0, 7)).toBe(day.slice(0, 7));
    const steps = Number(from.slice(8, 10)) - Number(day.slice(8, 10));
    for (let i = 0; i < Math.abs(steps); i += 1) {
      await page.keyboard.press(steps > 0 ? "ArrowLeft" : "ArrowRight");
    }
    expect(await focusedDay(page)).toBe(day);
    await page.keyboard.press("ArrowDown");
    expect(await focusedDay(page)).toBe(shiftDay(day, 7));
    await page.keyboard.press("ArrowUp");
    // The week runs Monday to Sunday, as the grid's columns do.
    const weekday = (new Date(`${day}T00:00:00.000Z`).getUTCDay() + 6) % 7;
    await page.keyboard.press("Home");
    expect(await focusedDay(page)).toBe(shiftDay(day, -weekday));
    await page.keyboard.press("End");
    expect(await focusedDay(page)).toBe(shiftDay(day, 6 - weekday));
    for (let i = 0; i < 6 - weekday; i += 1) {
      await page.keyboard.press("ArrowLeft");
    }
    expect(await focusedDay(page)).toBe(day);

    // Enter opens the day's list; Escape closes it and returns to the day.
    await page.keyboard.press("Enter");
    const list = page.getByRole("dialog", { name: longDay(day) });
    await expect(list).toBeVisible();
    await expect(
      list.getByRole("list", { name: "Releases on this day" }).getByRole("link")
    ).toHaveCount(4);
    await page.keyboard.press("Escape");
    await expect(list).toBeHidden();
    // Returned once the sheet has finished closing, so waited for.
    await expect(page.locator(`[data-day="${day}"]`)).toBeFocused();

    // Tab moves on to that day's own releases, and Enter opens one.
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toContainText(titles[0]);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/admin\/releases\/[^/?#]+$/);
    await expect(
      page.getByRole("heading", { name: titles[0] }).first()
    ).toBeVisible();
  });

  for (const theme of ["light", "dark"] as const) {
    test(`passes axe under the brand colour, grid and day lists, at desk and phone widths (${theme})`, async ({
      page,
    }) => {
      test.setTimeout(180_000);
      const stamp = `${Date.now()}`;
      const postId = await post(page, `cal-brand-${stamp}`);
      // Today holds a release published now and a stopped one due an hour
      // ago, so today's cell and list draw both; next month holds a
      // scheduled one, so a future day's cell and list are drawn too.
      const future = dayAhead(1, 12);
      await schedule(
        page,
        await release(page, `Brand future ${stamp}`, postId),
        at(future, 15),
        "UTC"
      );
      await publishNow(
        page,
        await release(page, `Brand today ${stamp}`, postId)
      );
      const stoppedId = await release(page, `Brand stopped ${stamp}`, postId);
      await schedule(page, stoppedId, at(dayAhead(5, 21), 15), "UTC");
      // Last, since Publish now runs the runner.
      await leaveReleasesAsTheRunnerWould(page, [
        { id: stoppedId, outcome: "stopped" },
      ]);

      for (const viewport of [
        { width: 1440, height: 1000 },
        { width: 390, height: 844 },
      ]) {
        await page.setViewportSize(viewport);
        await gotoAdmin(page, "/releases", theme);
        await expectBrandColourApplied(page);
        await page.getByRole("button", { name: "calendar" }).click();
        await expect(page.getByRole("grid")).toBeVisible();
        const today = page.locator('[aria-current="date"]');
        await scanCalendar(page, today);
        await scanDayList(page, today);

        await showMonth(page, future);
        const futureDay = page.locator(`[data-day="${future}"]`);
        await scanCalendar(page, futureDay);
        await scanDayList(page, futureDay);
      }
    });
  }
});

/**
 * Wait for the page to be at rest: the view switch, the grid and the sheet
 * colour in over 150ms, and a scan mid-transition reads a colour nobody sees
 * for long. The pointer is moved off, so no hover colour is judged either.
 */
async function settle(page: Page): Promise<void> {
  await page.mouse.move(0, 0);
  await page.waitForFunction(() => document.getAnimations().length === 0);
}

/**
 * The month on screen, and each day's date and count, held to AA, once the
 * month's read has answered and `seeded`, a day this test put releases on,
 * draws what it holds.
 *
 * The day buttons are drawn before the read answers, and at a phone's width
 * the grid shows no loading placeholder, so a scan started on the buttons
 * alone could judge a month whose counts have not arrived. Waited for twice:
 * the grid no longer busy, and the seeded day's own releases on screen, as
 * chips at a desk's width and as its count at a phone's.
 */
async function scanCalendar(page: Page, seeded: Locator): Promise<void> {
  await expect(page.getByRole("grid")).not.toHaveAttribute("aria-busy", "true");
  await expect(seeded).toHaveAttribute("aria-label", /\b[1-9]\d* releases?\b/);
  await expect(
    page
      .locator("td", { has: seeded })
      .locator("li, [data-day] > span:nth-child(2)")
      .filter({ visible: true })
      .first()
  ).toBeVisible();
  await settle(page);
  await expectNoAxeViolations(page);
  // The dates and counts are a character or two, which axe will not fail on
  // its own.
  await expectShortTextReadable(page, '[role="grid"]');
}

/** Open the list of the day `button` names, hold it to AA, and close it. */
async function scanDayList(page: Page, button: Locator): Promise<void> {
  // By keyboard: at a desk's width the day's chips cover the middle of its
  // button, where a pointer click would land on a chip.
  await button.focus();
  await page.keyboard.press("Enter");
  const list = page.getByRole("dialog");
  await expect(
    list.getByRole("list", { name: "Releases on this day" })
  ).toBeVisible();
  await settle(page);
  await expectNoAxeViolations(page);
  await expectShortTextReadable(page, '[role="dialog"]');
  await page.keyboard.press("Escape");
  await expect(list).toBeHidden();
}
