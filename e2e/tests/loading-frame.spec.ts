/**
 * What the admin draws while its server has not answered: the frame at once,
 * then the screen's still outline from 0.4 s, a moving line under the bar from
 * 0.5 s and one status line from 5 s, each only past its time, and the screen
 * replacing the outline without moving the frame.
 *
 * Every admin request is held on a promise the test releases, or behind a gate
 * that opens a set time after the first request, so "the server has not
 * answered" is a state the test holds rather than a race it hopes to win. The
 * browser records when each part first appears, timed from the frame's first
 * paint, which is when the admin's wait clock starts.
 *
 * Each test runs in a browser that has signed in here before (the record is
 * written before the page loads): that is the browser the frame is for. A
 * browser with no record is shown the sign-in form instead, which the
 * production suite covers (`production/sign-in-while-starting`).
 *
 * @module tests/loading-frame.spec
 */
import { expect, type Page } from "@playwright/test";

import { ADMIN } from "./support/admin";
import { mainColumnBox } from "./support/shell-geometry";
import { test } from "./support/test";

/** The admin's record that this browser has signed in here before. */
const SIGNED_IN_HERE_KEY = "nextly:admin:signed-in-here";
/** Where the admin keeps what it remembers of the menu and schemas. */
const REMEMBERED_PREFIX = "nextly:admin:memory:";

/** The times the frame's parts appear at, in milliseconds. */
const OUTLINE_AT = 400;
const LINE_AT = 500;
const STATUS_AT = 5_000;
/** Timer slack between the admin's clock starting and the frame painting. */
const SLACK = 50;

const SELECTORS = {
  frame: "aside[data-shell-answers]",
  outline: "[data-outline-shown]",
  line: '[data-testid="screen-wait-line"]',
  status: '[data-testid="screen-wait-status"]',
} as const;

type Part = keyof typeof SELECTORS;
type Marks = Record<Part, number | null>;

/**
 * Records, in the page, when each part first appears (`performance.now()`),
 * and writes the signed-in record, with no remembered menu, before the
 * admin's code reads it.
 */
async function recordParts(page: Page): Promise<void> {
  await page.addInitScript(
    ([key, memory, selectors]) => {
      window.localStorage.setItem(key, "1");
      // Nothing remembered of the menu, so the frame is the one a browser
      // draws before it has one: the rail drawn from memory is
      // device-memory.spec's.
      for (const stored of Object.keys(window.localStorage)) {
        if (stored.startsWith(memory)) window.localStorage.removeItem(stored);
      }
      const marks: Record<string, number | null> = {};
      for (const part of Object.keys(selectors)) marks[part] = null;
      (window as unknown as { __marks: typeof marks }).__marks = marks;
      const look = () => {
        for (const [part, selector] of Object.entries(selectors)) {
          if (marks[part] === null && document.querySelector(selector)) {
            marks[part] = performance.now();
          }
        }
      };
      new MutationObserver(look).observe(document, {
        childList: true,
        subtree: true,
        attributes: true,
      });
    },
    [SIGNED_IN_HERE_KEY, REMEMBERED_PREFIX, SELECTORS] as const
  );
}

const marksOf = (page: Page): Promise<Marks> =>
  page.evaluate(() => (window as unknown as { __marks: Marks }).__marks);

/**
 * The admin's requests a test holds: every one under its API, save the
 * development server's schema-reload stream, which is no answer the admin
 * waits on, and which reloads the page if it is held and then let through.
 */
const isAdminRequest = (url: URL): boolean =>
  url.pathname.startsWith("/admin/api/") &&
  url.pathname !== "/admin/api/dev-reload";

/**
 * Holds every admin request until `release` is called, and counts them, so a
 * test can prove the requests really were held.
 */
async function holdAdminRequests(page: Page) {
  let release = () => {};
  const released = new Promise<void>(resolve => {
    release = resolve;
  });
  let held = 0;
  await page.route(isAdminRequest, async route => {
    held += 1;
    try {
      await released;
      await route.continue();
    } catch {
      // The page went away while the request was held.
    }
  });
  return { release, held: () => held };
}

/**
 * Holds every admin request until `holdMs` after the first one, then lets
 * every request through: a server that answers nothing for that long, then
 * everything.
 */
async function holdAdminRequestsFor(page: Page, holdMs: number) {
  let gate: Promise<void> | null = null;
  await page.route(isAdminRequest, async route => {
    gate ??= new Promise(resolve => setTimeout(resolve, holdMs));
    try {
      await gate;
      await route.continue();
    } catch {
      // The page went away while the request was held.
    }
  });
}

/** Opens `path` in light mode, without waiting for anything to answer. */
async function openHeld(page: Page, path: string): Promise<void> {
  await page.addInitScript(() =>
    window.localStorage.setItem("nextly-theme", "light")
  );
  await page.goto(`${ADMIN}${path}`, { waitUntil: "commit" });
}

/** Until the screen's data has replaced its outline. */
async function screenArrived(page: Page): Promise<void> {
  await expect(page.locator("main")).toBeVisible({ timeout: 60_000 });
  // By CSS rather than test id: the suite's test-id locators see visible
  // elements only, and an outline not yet shown is there, but has no size.
  await expect(page.locator('[data-testid="screen-outline"]')).toHaveCount(0, {
    timeout: 60_000,
  });
  await expect(page.locator(SELECTORS.line)).toHaveCount(0);
  await expect(page.locator(SELECTORS.status)).toHaveCount(0);
}

/** How long after the frame painted each part appeared, or null for never. */
function sinceFrame(
  marks: Marks
): Record<Exclude<Part, "frame">, number | null> {
  const frame = marks.frame;
  expect(frame, "the frame never painted").not.toBeNull();
  const since = (at: number | null) =>
    at === null ? null : at - (frame as number);
  return {
    outline: since(marks.outline),
    line: since(marks.line),
    status: since(marks.status),
  };
}

test.beforeEach(async ({ page }) => {
  // A dev server compiles each route on its first request; one visit first,
  // so the times below are the admin's, not the compiler's.
  await page.goto(`${ADMIN}`);
  await expect(page.locator("main")).toBeVisible({ timeout: 60_000 });
});

test.describe("the admin's frame while the server has not answered", () => {
  test("paints the bar, the rail and the logo with every admin request held", async ({
    page,
  }) => {
    await recordParts(page);
    const held = await holdAdminRequests(page);
    await openHeld(page, "");

    const rail = page.locator(SELECTORS.frame);
    await expect(rail).toBeVisible();
    // The logo, the rail's first link.
    await expect(rail.locator("a").first()).toBeVisible();
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.locator("main")).toBeVisible();
    // The menu is not known: neutral shapes hold the rail's places.
    await expect(page.getByTestId("rail-ghost-item").first()).toBeVisible();
    // Nothing read from the server is drawn: no screen, no reader's menu.
    await expect(page.getByTestId("dashboard-container")).toHaveCount(0);
    await expect(rail.locator("nav [aria-label]")).toHaveCount(0);
    // The requests really were held, or the above proves nothing.
    expect(held.held()).toBeGreaterThan(0);

    held.release();
    await screenArrived(page);
  });

  for (const holdMs of [300, 2_000, 6_000]) {
    test(`shows each part only past its time, with requests held ${holdMs} ms`, async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await recordParts(page);
      await holdAdminRequestsFor(page, holdMs);
      await openHeld(page, "");
      await screenArrived(page);

      const at = sinceFrame(await marksOf(page));
      // Never before its time, whatever the hold.
      if (at.outline !== null)
        expect(at.outline).toBeGreaterThanOrEqual(OUTLINE_AT - SLACK);
      if (at.line !== null)
        expect(at.line).toBeGreaterThanOrEqual(LINE_AT - SLACK);
      if (at.status !== null)
        expect(at.status).toBeGreaterThanOrEqual(STATUS_AT - SLACK);
      // And present once the hold outlasts its time.
      if (holdMs >= 2_000) {
        expect(at.outline, "the outline never appeared").not.toBeNull();
        expect(at.line, "the line never appeared").not.toBeNull();
      }
      if (holdMs < STATUS_AT) {
        expect(at.status, "the status appeared on a short wait").toBeNull();
      } else {
        expect(at.status, "the status never appeared").not.toBeNull();
      }
    });
  }

  test("moves nothing under reduced motion: no line, no spinner", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await recordParts(page);
    const held = await holdAdminRequests(page);
    await openHeld(page, "");

    const status = page.locator(SELECTORS.status);
    await expect(status).toBeVisible({ timeout: STATUS_AT + 5_000 });
    await expect(status).toHaveText(
      "Starting the server. The first visit after a quiet spell takes a little longer."
    );
    // The line is in place but not drawn, and the status has no spinner.
    await expect(page.locator(SELECTORS.line)).toBeAttached();
    await expect(page.locator(SELECTORS.line)).toBeHidden();
    await expect(status.locator('[aria-hidden="true"]')).toBeHidden();
    // Nothing on the page is animating.
    const running = await page.evaluate(
      () =>
        document.getAnimations().filter(animation => {
          const effect = animation.effect as KeyframeEffect | null;
          const target = effect?.target;
          return (
            animation.playState === "running" &&
            target instanceof Element &&
            target.closest("main, header, aside, [data-testid]") !== null
          );
        }).length
    );
    expect(running).toBe(0);

    held.release();
    await screenArrived(page);
  });
});

/** Every layout shift after `startAt`, and the elements each one moved. */
async function recordShifts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const shifts: { value: number; at: number; sources: string[] }[] = [];
    (window as unknown as { __shifts: typeof shifts }).__shifts = shifts;
    new PerformanceObserver(list => {
      for (const entry of list.getEntries() as (PerformanceEntry & {
        value: number;
        hadRecentInput: boolean;
        sources: {
          node: Node | null;
          previousRect: DOMRectReadOnly;
          currentRect: DOMRectReadOnly;
        }[];
      })[]) {
        if (entry.hadRecentInput) continue;
        // An element by where it is, its tag and its test id or first class,
        // with its box before and after, so a red names what moved.
        const box = (rect: DOMRectReadOnly) =>
          `${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}x${Math.round(rect.height)}`;
        shifts.push({
          value: entry.value,
          at: entry.startTime,
          sources: entry.sources.map(source => {
            const node = source.node;
            if (!(node instanceof Element)) return "removed";
            const where = node.closest("main") ? "main" : "shell";
            const name =
              node.getAttribute("data-testid") ??
              node.className.toString().split(" ").slice(0, 3).join(".");
            return `${where}:${node.tagName.toLowerCase()}(${name}) ${box(source.previousRect)} -> ${box(source.currentRect)}`;
          }),
        });
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
}

/** The shell's own boxes: the rail, the bar and the main column. */
async function shellBoxes(page: Page) {
  const box = async (selector: string) => {
    const found = await page.locator(selector).first().boundingBox();
    expect(found, `${selector} has no box`).not.toBeNull();
    return found;
  };
  return {
    rail: await box(SELECTORS.frame),
    bar: await box("header:not([data-slot])"),
    main: await mainColumnBox(page),
  };
}

test.describe("the screen replacing its outline", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const screenName of ["dashboard", "list", "edit"] as const) {
    test(`moves no part of the ${screenName} as its data arrives`, async ({
      page,
    }) => {
      test.setTimeout(90_000);
      let path = "";
      if (screenName === "list") path = "/collections/posts";
      if (screenName === "edit") {
        const read = await page.request.get(
          "/admin/api/collections/posts/entries?limit=1"
        );
        expect(read.ok(), await read.text()).toBe(true);
        const { items } = (await read.json()) as { items: { id: string }[] };
        expect(items.length, "no post to open").toBeGreaterThan(0);
        path = `/collections/posts/${items[0]!.id}`;
        // The edit route's code, compiled before the measured visit.
        await page.goto(`${ADMIN}${path}`);
        await expect(page.locator("main")).toBeVisible({ timeout: 60_000 });
      } else if (screenName === "list") {
        await page.goto(`${ADMIN}${path}`);
        await expect(page.locator("main")).toBeVisible({ timeout: 60_000 });
      }

      await recordShifts(page);
      await recordParts(page);
      const held = await holdAdminRequests(page);
      await openHeld(page, path);

      // The outline is on screen, so there is something for the data to replace.
      await expect(page.locator(SELECTORS.outline).first()).toBeVisible();
      const before = await shellBoxes(page);
      const releasedAt = await page.evaluate(() => performance.now());

      held.release();
      await screenArrived(page);
      // Every answer the shell draws from is in.
      await expect(page.locator('[data-shell-answers="pending"]')).toHaveCount(
        0,
        { timeout: 60_000 }
      );
      const after = await shellBoxes(page);

      // The frame did not move: the rail, the bar and the main column.
      expect(after.rail).toEqual(before.rail);
      expect(after.bar).toEqual(before.bar);
      expect(after.main).toEqual(before.main);

      const shifts = (
        await page.evaluate(
          () =>
            (
              window as unknown as {
                __shifts: { value: number; at: number; sources: string[] }[];
              }
            ).__shifts
        )
      ).filter(shift => shift.at >= releasedAt);
      const shellMoved = shifts.filter(shift =>
        shift.sources.some(source => source.startsWith("shell:"))
      );
      expect(shellMoved, JSON.stringify(shellMoved)).toEqual([]);
      const total = shifts.reduce((sum, shift) => sum + shift.value, 0);
      test.info().annotations.push({
        type: "layout-shift",
        description: `${screenName}: ${total.toFixed(4)} after the release`,
      });
      expect(total).toBeLessThanOrEqual(0.05);
    });
  }
});
