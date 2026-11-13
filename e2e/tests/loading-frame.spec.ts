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
import { freeDocumentAt, includingHidden, ownSeat, test } from "./support/test";

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
async function recordParts(
  page: Page,
  { revisit = false }: { revisit?: boolean } = {}
): Promise<void> {
  await page.addInitScript(
    ([key, memory, selectors, keep]) => {
      window.localStorage.setItem(key, "1");
      // Nothing remembered of the menu, so the frame is the one a browser
      // draws before it has one: the rail drawn from memory is
      // device-memory.spec's. A revisit keeps what an earlier visit left.
      for (const stored of Object.keys(window.localStorage)) {
        if (!keep && stored.startsWith(memory)) {
          window.localStorage.removeItem(stored);
        }
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
    [SIGNED_IN_HERE_KEY, REMEMBERED_PREFIX, SELECTORS, revisit] as const
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
    await expect(
      includingHidden(page).getByTestId("dashboard-container")
    ).toHaveCount(0);
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

/**
 * How long a screen stays still, with nothing it asked for in flight, before
 * it counts as settled; and the longest it may take to get there once its data
 * is in. A part drawn from a later answer (the editor's trail, a list's rows)
 * lands well inside the window, so a move it makes is recorded.
 */
const SETTLE_QUIET_MS = 750;
const SETTLE_TIMEOUT_MS = 15_000;

/**
 * Every layout shift, and the elements each one moved; and when the page last
 * changed at all (a node, an attribute, a text, a shift), so a test can wait
 * until it has stopped.
 */
async function recordShifts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const shifts: { value: number; at: number; sources: string[] }[] = [];
    const record = window as unknown as {
      __shifts: typeof shifts;
      __lastChange: number;
    };
    record.__shifts = shifts;
    record.__lastChange = performance.now();
    new MutationObserver(() => {
      record.__lastChange = performance.now();
    }).observe(document, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
    new PerformanceObserver(list => {
      record.__lastChange = performance.now();
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

/**
 * Counts, in the page, the requests it has asked for and not had answered, by
 * wrapping its `fetch`, which every admin read goes through. Counted where
 * they are made rather than from the browser's request events: a read the page
 * gives up on while it is held reports no failure there, and would read as in
 * flight for ever.
 */
async function countFetches(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const record = window as unknown as {
      __fetching: Map<number, string>;
      __lastChange: number;
    };
    const fetching = new Map<number, string>();
    record.__fetching = fetching;
    let next = 0;
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const id = next++;
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        window.location.href
      );
      fetching.set(id, url.pathname);
      return original(input, init).finally(() => {
        fetching.delete(id);
        record.__lastChange = performance.now();
      });
    };
  });
}

/**
 * Until the screen has settled: nothing it asked for in flight, and nothing on
 * the page changed for `SETTLE_QUIET_MS`, measured on the page's own clock.
 * The shell settling is not enough: the editor's trail, for one, is drawn
 * from an answer that arrives after the shell's.
 */
async function screenSettled(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(quietMs => {
          const record = window as unknown as {
            __fetching: Map<number, string>;
            __lastChange: number;
          };
          if (record.__fetching.size > 0) {
            return `waiting on ${[...record.__fetching.values()].join(", ")}`;
          }
          const since = performance.now() - record.__lastChange;
          return since >= quietMs
            ? "settled"
            : `changed ${Math.round(since)} ms ago`;
        }, SETTLE_QUIET_MS),
      {
        message: "the screen never settled",
        timeout: SETTLE_TIMEOUT_MS,
        intervals: [100],
      }
    )
    .toBe("settled");
}

/** Whether `url` is the admin's address for claiming a document. */
const isDocumentLock = (url: string): boolean =>
  new URL(url).pathname === "/admin/api/document-lock";

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

/** Where the playground's posts are written. */
const POSTS = "/admin/api/collections/posts/entries";
/** The posts the edit test made, deleted after it, so no list counts them. */
const ownPosts: string[] = [];

test.describe("the screen replacing its outline", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.afterEach(async ({ page }) => {
    for (const id of ownPosts.splice(0)) {
      const removed = await page.request.delete(`${POSTS}/${id}`);
      expect(removed.ok(), await removed.text()).toBe(true);
    }
  });

  for (const screenName of ["dashboard", "edit"] as const) {
    test(`moves no part of the ${screenName} as its data arrives`, async ({
      page,
    }) => {
      test.setTimeout(90_000);
      let path = "";
      if (screenName === "edit") {
        // A post of the test's own, which no other test opens: an editor
        // open on a post elsewhere (another spec, a repeat on another worker)
        // holds it, and the banner saying so would land above the fields.
        const stamp = `${Date.now()}-${test.info().repeatEachIndex}`;
        const created = await page.request.post(POSTS, {
          data: {
            title: `Loading frame ${stamp}`,
            slug: `loading-frame-${stamp}`,
            excerpt: "Opened while every request is held.",
          },
        });
        expect(created.ok(), await created.text()).toBe(true);
        const { item } = (await created.json()) as { item: { id: string } };
        ownPosts.push(item.id);
        path = `/collections/posts/${item.id}`;
        // The edit route's code, compiled before the measured visit. The
        // editor claims the document it opens, and the claim outlives a page
        // left while every request is held, so the measured visit would open
        // a document its own warm-up still holds, with the banner saying so.
        // Freed here, as a reader's closed tab frees it.
        const claimed = page.waitForResponse(
          response =>
            isDocumentLock(response.url()) &&
            response.request().method() === "POST"
        );
        await page.goto(`${ADMIN}${path}`);
        await claimed;
        await page.goto("about:blank");
        await freeDocumentAt(
          page.request,
          { scopeKind: "collection", slug: "posts", entryId: item.id },
          "post"
        );
      }

      await recordShifts(page);
      await recordParts(page);
      const held = await holdAdminRequests(page);
      await countFetches(page);
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
      // And every part drawn from a later answer: a move that lands after the
      // shell settled is still a move the reader sees.
      await screenSettled(page);
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
      expect(total, JSON.stringify(shifts)).toBeLessThanOrEqual(0.05);
    });
  }
});

/** The widths a screen is held to: a laptop's, with the menu panel open, up. */
const WIDTHS = [1024, 1280, 1440] as const;

/**
 * How a screen is loaded: every admin request held until the outline shows
 * and then let through at once, or nothing held, as a reader meets it.
 */
type LoadMode = "held" | "unheld";

/** A box in CSS pixels, rounded so sub-pixel rendering never reads as a move. */
type PartBox = { x: number; y: number; width: number; height: number };

/**
 * Each named part of the screen (`data-frame-part`) the page draws, by name:
 * the outline's own, or the loaded screen's, outside any outline.
 */
async function frameParts(
  page: Page,
  drawnBy: "outline" | "screen"
): Promise<Record<string, PartBox>> {
  return page.evaluate(by => {
    const parts: Record<string, PartBox> = {};
    for (const element of Array.from(
      document.querySelectorAll("[data-frame-part]")
    )) {
      const inOutline =
        element.closest('[data-testid="screen-outline"]') !== null;
      if (inOutline !== (by === "outline")) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      parts[element.getAttribute("data-frame-part") as string] = {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    }
    return parts;
  }, drawnBy);
}

/** Every layout shift recorded from `since` on the page's clock. */
async function shiftsSince(page: Page, since: number) {
  return (
    await page.evaluate(
      () =>
        (
          window as unknown as {
            __shifts: { value: number; at: number; sources: string[] }[];
          }
        ).__shifts
    )
  ).filter(shift => shift.at >= since);
}

/**
 * Opens `path` as `mode` says and waits until it has settled; then holds the
 * promise: nothing moved, not the frame, not a part of the screen, and every
 * named part the outline drew stands where the screen drew it (the check a
 * layout-shift score cannot make, since an outline replaced by different
 * elements scores nothing however far off it was).
 */
async function expectStillLoad(
  page: Page,
  path: string,
  mode: LoadMode,
  {
    revisit = false,
    parts = true,
  }: {
    revisit?: boolean;
    /**
     * Whether the outline's named parts are held to the screen's. Not where a
     * plugin draws a block above them, which the outline cannot know of
     * before the server has answered.
     */
    parts?: boolean;
  } = {}
): Promise<void> {
  await recordShifts(page);
  await recordParts(page, { revisit });
  await countFetches(page);
  let releasedAt = 0;
  let before: Awaited<ReturnType<typeof shellBoxes>> | null = null;
  let outlined: Record<string, PartBox> = {};
  if (mode === "held") {
    const held = await holdAdminRequests(page);
    await openHeld(page, path);
    await expect(page.locator(SELECTORS.outline).first()).toBeVisible();
    before = await shellBoxes(page);
    outlined = await frameParts(page, "outline");
    releasedAt = await page.evaluate(() => performance.now());
    held.release();
  } else {
    await openHeld(page, path);
  }
  await screenArrived(page);
  await expect(page.locator('[data-shell-answers="pending"]')).toHaveCount(0, {
    timeout: 60_000,
  });
  await screenSettled(page);

  if (before !== null) {
    const after = await shellBoxes(page);
    expect(after.rail).toEqual(before.rail);
    expect(after.bar).toEqual(before.bar);
    expect(after.main).toEqual(before.main);
  }
  const shifts = await shiftsSince(page, releasedAt);
  const total = shifts.reduce((sum, shift) => sum + shift.value, 0);
  test.info().annotations.push({
    type: "layout-shift",
    description: `${mode} ${path}: ${total.toFixed(4)}`,
  });
  // Nothing moves: not a part of the screen, not the frame around it.
  expect(shifts, JSON.stringify(shifts)).toEqual([]);

  if (!parts) return;
  const loaded = await frameParts(page, "screen");
  for (const [name, box] of Object.entries(outlined)) {
    expect(loaded[name], `the screen draws no ${name}`).toBeDefined();
    expect(loaded[name], `the outline's ${name} against the screen's`).toEqual(
      box
    );
  }
}

/** The playground's entries API for a collection. */
const entriesOf = (slug: string) => `/admin/api/collections/${slug}/entries`;

/**
 * Makes `count` posts of the test's own, all carrying one stamp in their
 * excerpt, and returns the posts list's address filtered to them: a list
 * whose length the test decides, whatever other tests write meanwhile.
 */
/**
 * The text field each list's entries are stamped in, so its address can be
 * filtered to the test's own: the posts' excerpt, the tags' description.
 */
const STAMPED = { posts: "excerpt", tags: "description" } as const;

/**
 * Makes `count` entries of the test's own in `slug`, all carrying one stamp,
 * and returns the list's address filtered to them: a list whose length the
 * test decides, whatever other tests write meanwhile.
 */
async function ownList(
  page: Page,
  slug: keyof typeof STAMPED,
  count: number,
  made: string[]
): Promise<string> {
  const stamp = `frame-${Date.now()}-${test.info().repeatEachIndex}-${test.info().workerIndex}`;
  for (let index = 0; index < count; index += 1) {
    const created = await page.request.post(entriesOf(slug), {
      data: {
        title: `Frame ${index} ${stamp}`,
        slug: `${stamp}-${index}`,
        [STAMPED[slug]]: stamp,
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const { item } = (await created.json()) as { item: { id: string } };
    made.push(`${entriesOf(slug)}/${item.id}`);
  }
  const where = encodeURIComponent(
    JSON.stringify({ [STAMPED[slug]]: { equals: stamp } })
  );
  return `/collections/${slug}?where=${where}`;
}

/** A form of the test's own, which no other test holds open. */
async function ownForm(page: Page, made: string[]): Promise<string> {
  const stamp = `${Date.now().toString(36)}-${test.info().repeatEachIndex}-${test.info().workerIndex}`;
  const created = await page.request.post(entriesOf("forms"), {
    data: {
      name: `Frame form ${stamp}`,
      slug: `frame-form-${stamp}`,
      status: "published",
      fields: [
        { type: "text", name: "name", label: "Name" },
        { type: "email", name: "email", label: "Email" },
      ],
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const { item } = (await created.json()) as { item: { id: string } };
  made.push(`${entriesOf("forms")}/${item.id}`);
  return `/collections/forms/${item.id}`;
}

/** Visits `path` once, as a reader did before, so the device remembers it. */
async function visitOnce(page: Page, path: string): Promise<void> {
  await page.addInitScript(key => {
    window.localStorage.setItem(key, "1");
  }, SIGNED_IN_HERE_KEY);
  // What `screenSettled` reads: the page's last change and its open reads.
  await recordShifts(page);
  await countFetches(page);
  await page.goto(`${ADMIN}${path}`);
  await expect(page.locator("main")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-testid="screen-outline"]')).toHaveCount(0, {
    timeout: 60_000,
  });
  await screenSettled(page);
  await page.goto("about:blank");
}

test.describe("each screen's outline, held to the screen it stands for", () => {
  /** Entries the tests made, deleted after each, so no list counts them. */
  const made: string[] = [];

  test.afterEach(async ({ page }) => {
    for (const address of made.splice(0)) {
      const removed = await page.request.delete(address);
      expect(removed.ok(), await removed.text()).toBe(true);
    }
  });

  WIDTHS.forEach((width, index) => {
    test.describe(`at ${width} px`, () => {
      // An account of its own per width, so the loads below stay inside the
      // per-person request budget.
      ownSeat(index + 1);
      test.use({ viewport: { width, height: 900 } });

      for (const mode of ["held", "unheld"] as const) {
        // The posts list has a plugin's showcase under its table, which a
        // table that grows as its rows land would push down, and a plugin's
        // block above it; the tags list has neither, so its outline's rows
        // are held to the list's own.
        for (const slug of ["posts", "tags"] as const) {
          test(`moves no part of a list of five ${slug}, ${mode}`, async ({
            page,
          }) => {
            test.setTimeout(90_000);
            const path = await ownList(page, slug, 5, made);
            await expectStillLoad(page, path, mode, {
              parts: slug === "tags",
            });
          });

          test(`moves no part of a list of eleven ${slug} on a revisit, ${mode}`, async ({
            page,
          }) => {
            test.setTimeout(90_000);
            // More than the outline's first guess: the first visit learns how
            // many rows the list draws, and the next draws its outline so.
            const path = await ownList(page, slug, 11, made);
            await visitOnce(page, path);
            await expectStillLoad(page, path, mode, {
              revisit: true,
              parts: slug === "tags",
            });
          });
        }

        test(`moves no part of the form editor, ${mode}`, async ({ page }) => {
          test.setTimeout(90_000);
          const path = await ownForm(page, made);
          await expectStillLoad(page, path, mode);
        });

        test(`moves no part of the releases, ${mode}`, async ({ page }) => {
          test.setTimeout(90_000);
          await expectStillLoad(page, "/releases", mode);
        });

        test(`moves no part of the users on a revisit, ${mode}`, async ({
          page,
        }) => {
          test.setTimeout(90_000);
          // How many accounts there are is the suite's, not this test's: the
          // first visit learns how many rows the list draws.
          await visitOnce(page, "/users");
          await expectStillLoad(page, "/users", mode, { revisit: true });
        });
      }
    });
  });
});
