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

import { test } from "./support/test";
import { gotoAdmin } from "./support/admin";
import {
  expectBrandColourApplied,
  expectNoAxeViolations,
  expectShortTextReadable,
} from "./support/axe";
import { leaveReleasesAsTheRunnerWould } from "./support/release-states";
import { post, publishNow, release, schedule } from "./support/releases-api";

test.use({ timezoneId: "America/New_York" });

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
    // 09:00 UTC, which is the morning of the same day in New York.
    const day = dayAhead(3, 14);
    const titles: string[] = [];
    for (let i = 0; i < 7; i += 1) {
      const title = `Dense ${String(i + 1).padStart(2, "0")} ${stamp}`;
      await schedule(
        page,
        await release(page, title, postId),
        at(day, 9 + i),
        "UTC"
      );
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
    await leaveReleasesAsTheRunnerWould(page, attention);

    await openCalendar(page);
    const grid = page.getByRole("grid");
    const today = grid.locator("td", {
      has: page.locator('[aria-current="date"]'),
    });
    await expect(chip(today, published)).toContainText("Published");
    // Overdue and stopped were due an hour ago, which near midnight is
    // yesterday, so they are found on the grid rather than on today.
    await expect(chip(grid, overdue)).toContainText("Overdue");
    await expect(chip(grid, overdue)).not.toContainText("Scheduled");
    await expect(chip(grid, stopped)).toContainText("Stopped");

    await showMonth(page, scheduledFor);
    await expect(chip(dayCell(page, scheduledFor), published)).toHaveCount(0);
  });

  test("works by keyboard alone, announces today, and passes axe", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const stamp = `${Date.now()}`;
    const postId = await post(page, `cal-keys-${stamp}`);
    const day = dayAhead(4, 9);
    const titles: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const title = `Keys ${i + 1} ${stamp}`;
      await schedule(
        page,
        await release(page, title, postId),
        at(day, 14 + i),
        "UTC"
      );
      titles.push(title);
    }

    await page.setViewportSize({ width: 1440, height: 1000 });
    await gotoAdmin(page, "/releases");

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
        await scanCalendar(page);
        await scanDayList(page, today);

        await showMonth(page, future);
        await scanCalendar(page);
        await scanDayList(page, page.locator(`[data-day="${future}"]`));
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

/** The month on screen, and each day's date and count, held to AA. */
async function scanCalendar(page: Page): Promise<void> {
  // Each day's data has arrived: a day with releases names their count.
  await expect(page.locator("[data-day]").first()).toBeVisible();
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
