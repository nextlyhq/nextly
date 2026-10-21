/**
 * The Releases calendar in a real browser: the zone that decides a day, a
 * busy day's complete "+N more" and its list, a release on the day it really
 * went out, every state by its word, and the whole grid by keyboard alone.
 *
 * The releases are written through the API, each named with a stamp this run
 * owns, on dates far enough ahead that nothing else the suite writes lands on
 * them. The browser reads as New York, so the reader's zone and the zone a
 * release was scheduled in differ.
 *
 * @module e2e/tests/releases-calendar.spec
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { test } from "./support/test";
import { gotoAdmin } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
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

/** Page forward with the Next month button until `label` is shown. */
async function showMonth(page: Page, label: string): Promise<void> {
  for (let i = 0; i < MONTH_LIMIT; i += 1) {
    if ((await monthHeading(page).textContent())?.trim() === label) return;
    await page.getByRole("button", { name: "Next month" }).click();
  }
  await expect(monthHeading(page)).toHaveText(label);
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
    // 03:30 UTC on 10 March 2027 is 22:30 on the 9th in New York, and 08:30
    // on the 10th in Karachi, where it was scheduled.
    const title = `Near midnight ${stamp}`;
    await schedule(
      page,
      await release(page, title, postId),
      new Date("2027-03-10T03:30:00.000Z"),
      "Asia/Karachi"
    );

    await openCalendar(page);
    await expect(
      page.getByRole("button", { name: /Times in America\/New York/ })
    ).toBeVisible();
    await showMonth(page, "March 2027");

    const inNewYork = chip(dayCell(page, "2027-03-09"), title);
    await expect(inNewYork).toBeVisible();
    await expect(inNewYork).toContainText(new RegExp(`10:30${SPACE}PM`));
    await expect(chip(dayCell(page, "2027-03-10"), title)).toHaveCount(0);

    // The zone it was scheduled in is offered by name, above every other.
    await page.getByRole("button", { name: /Times in/ }).click();
    const scheduledIn = page.getByRole("group", { name: "Scheduled in" });
    await scheduledIn.getByRole("option", { name: /Asia\/Karachi/ }).click();

    await expect(
      page.getByRole("button", { name: /Times in Asia\/Karachi/ })
    ).toBeVisible();
    await expect(monthHeading(page)).toHaveText("March 2027");
    const inKarachi = chip(dayCell(page, "2027-03-10"), title);
    await expect(inKarachi).toBeVisible();
    await expect(inKarachi).toContainText(new RegExp(`8:30${SPACE}AM`));
    await expect(chip(dayCell(page, "2027-03-09"), title)).toHaveCount(0);
  });

  test("counts a busy day in full, and opens its whole list from '+N more'", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const stamp = `${Date.now()}`;
    const postId = await post(page, `cal-dense-${stamp}`);
    // Seven on one day, more than its three rows hold, an hour apart from
    // 09:00 UTC, which is the morning of the same day in New York.
    const titles: string[] = [];
    for (let i = 0; i < 7; i += 1) {
      const title = `Dense ${String(i + 1).padStart(2, "0")} ${stamp}`;
      await schedule(
        page,
        await release(page, title, postId),
        new Date(Date.UTC(2027, 3, 14, 9 + i)),
        "UTC"
      );
      titles.push(title);
    }

    await openCalendar(page);
    await showMonth(page, "April 2027");
    const cell = dayCell(page, "2027-04-14");
    // Two chips, the first two of the day, and the other five counted.
    await expect(cell.getByRole("link")).toHaveCount(2);
    await expect(chip(cell, titles[0])).toBeVisible();
    await expect(chip(cell, titles[1])).toBeVisible();
    await expect(page.locator('[data-day="2027-04-14"]')).toHaveAttribute(
      "aria-label",
      /7 releases$/
    );

    await cell.getByRole("button", { name: /^\+5 more/ }).click();
    const list = page.getByRole("dialog", {
      name: /Wednesday, April 14, 2027/,
    });
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
    const publishedId = await release(page, published, postId);
    await schedule(
      page,
      publishedId,
      new Date("2027-05-20T15:00:00.000Z"),
      "UTC"
    );
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
      await schedule(page, id, new Date("2027-05-21T15:00:00.000Z"), "UTC");
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

    await showMonth(page, "May 2027");
    await expect(chip(dayCell(page, "2027-05-20"), published)).toHaveCount(0);
  });

  test("works by keyboard alone, announces today, and passes axe", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const stamp = `${Date.now()}`;
    const postId = await post(page, `cal-keys-${stamp}`);
    const titles: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const title = `Keys ${i + 1} ${stamp}`;
      await schedule(
        page,
        await release(page, title, postId),
        new Date(Date.UTC(2027, 5, 9, 14 + i)),
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

    // Page Down to June 2027, then arrows to the 9th.
    for (let i = 0; i < MONTH_LIMIT; i += 1) {
      if ((await monthHeading(page).textContent())?.trim() === "June 2027") {
        break;
      }
      await page.keyboard.press("PageDown");
    }
    await expect(monthHeading(page)).toHaveText("June 2027");
    const from = (await focusedDay(page)) ?? "";
    expect(from.startsWith("2027-06")).toBe(true);
    const steps = Number(from.slice(8, 10)) - 9;
    for (let i = 0; i < Math.abs(steps); i += 1) {
      await page.keyboard.press(steps > 0 ? "ArrowLeft" : "ArrowRight");
    }
    expect(await focusedDay(page)).toBe("2027-06-09");
    await page.keyboard.press("ArrowDown");
    expect(await focusedDay(page)).toBe("2027-06-16");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Home");
    expect(await focusedDay(page)).toBe("2027-06-07");
    await page.keyboard.press("End");
    expect(await focusedDay(page)).toBe("2027-06-13");
    for (let i = 0; i < 4; i += 1) await page.keyboard.press("ArrowLeft");
    expect(await focusedDay(page)).toBe("2027-06-09");

    // Enter opens the day's list; Escape closes it and returns to the day.
    await page.keyboard.press("Enter");
    const list = page.getByRole("dialog", { name: /Wednesday, June 9, 2027/ });
    await expect(list).toBeVisible();
    await expect(
      list.getByRole("list", { name: "Releases on this day" }).getByRole("link")
    ).toHaveCount(4);
    await page.keyboard.press("Escape");
    await expect(list).toBeHidden();
    // Returned once the sheet has finished closing, so waited for.
    await expect(page.locator('[data-day="2027-06-09"]')).toBeFocused();

    // Tab moves on to that day's own releases, and Enter opens one.
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toContainText(titles[0]);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/admin\/releases\/[^/?#]+$/);
    await expect(
      page.getByRole("heading", { name: titles[0] }).first()
    ).toBeVisible();
  });
});
