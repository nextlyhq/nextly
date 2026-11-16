/**
 * Driving the browser for the speed check: the timing probe ("visible"), the
 * requests the page sends, signing in, finding the fixture pages, opening
 * the builder and selecting blocks.
 *
 * @module builder-speed/browser
 */

import {
  BASE,
  HEADING,
  QUIET_MS,
  SHOW_LIMIT_MS,
  SLUGS,
  USER,
  sleep,
} from "./config.mjs";

/** The canvas frame, as Playwright reaches it. */
export function canvasOf(page) {
  return page.frameLocator('iframe[title^="Page canvas"]');
}

export function canvasNode(page, id) {
  return canvasOf(page).locator(`.nx-canvas [data-nx-node="${id}"]`).first();
}

/**
 * How long until each check holds, from the input event `act` causes: arms
 * the probe for the input kinds in `on`, runs `act`, and reads, for each
 * check, the first animation frame in which it holds. A check that never
 * holds within `limit` milliseconds reads as null.
 *
 * `checks` is a list of `[name, args]`; `visible` returns their times in the
 * same order, with the input's own time as `start`.
 */
export async function visibleAll(
  page,
  { on, checks, limit = SHOW_LIMIT_MS },
  act
) {
  await page.evaluate(
    ({ on, checks, limit }) => {
      const speed = window.__builderSpeed;
      const probe = { on, start: null, ends: checks.map(() => null) };
      speed.probe = probe;
      const stop = Date.now() + limit;
      const frame = () => {
        if (speed.probe !== probe) return;
        const now = performance.timeOrigin + performance.now();
        if (probe.start !== null) {
          checks.forEach(([name, args], i) => {
            if (
              probe.ends[i] === null &&
              window.__builderSpeedChecks[name](args)
            )
              probe.ends[i] = now;
          });
          if (probe.ends.every(end => end !== null)) return;
        }
        if (Date.now() > stop) return;
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    },
    { on, checks, limit }
  );
  await act();
  const until = Date.now() + limit + 1000;
  for (;;) {
    const probe = await page.evaluate(() => window.__builderSpeed.probe);
    const done = probe.start !== null && probe.ends.every(end => end !== null);
    if (done || Date.now() > until) {
      return {
        start: probe.start,
        ms: probe.ends.map(end =>
          end === null || probe.start === null
            ? null
            : Math.round(end - probe.start)
        ),
        ends: probe.ends,
      };
    }
    await sleep(25);
  }
}

/** `visibleAll` for one check. */
export async function visible(page, { on, check, args = {}, limit }, act) {
  const result = await visibleAll(
    page,
    { on, checks: [[check, args]], ...(limit === undefined ? {} : { limit }) },
    act
  );
  return { start: result.start, ms: result.ms[0], end: result.ends[0] };
}

/** Every admin API request the page sends, with when it started and ended. */
export function watchRequests(page) {
  const requests = [];
  page.on("request", request => {
    const { pathname } = new URL(request.url());
    if (!pathname.startsWith("/admin/api/")) return;
    const entry = {
      method: request.method(),
      path: pathname,
      start: Date.now(),
    };
    request.__speed = entry;
    requests.push(entry);
  });
  const end = request => {
    if (request.__speed && request.__speed.end === undefined)
      request.__speed.end = Date.now();
  };
  page.on("requestfinished", end);
  page.on("requestfailed", end);
  page.on("response", response => end(response.request()));
  return {
    requests,
    between: (from, to) =>
      requests.filter(r => r.start >= from && r.start <= to),
    /** Until no admin request has started or been open for `QUIET_MS`. */
    async quiet(limit = 30_000) {
      const until = Date.now() + limit;
      for (;;) {
        const last = Math.max(
          0,
          ...requests.map(r => Math.max(r.start, r.end ?? Date.now()))
        );
        if (Date.now() - last >= QUIET_MS) return;
        if (Date.now() > until) return;
        await sleep(100);
      }
    },
  };
}

/**
 * The admin API requests every frame of the page sent between two times, on
 * the page's own clock (the input events' clock), with when each was
 * answered. Read from the page rather than from Playwright's events, which
 * arrive in Node a moment late and on another clock.
 */
export async function sentBetween(page, from, to) {
  const all = [];
  for (const frame of page.frames()) {
    const sent = await frame
      .evaluate(() => window.__builderSpeed?.sent ?? [])
      .catch(() => []);
    all.push(...sent);
  }
  return all
    .filter(
      s =>
        s.t >= from &&
        s.t <= to &&
        new URL(s.url, "http://page").pathname.startsWith("/admin/api/")
    )
    .map(s => ({
      method: s.method,
      path: new URL(s.url, "http://page").pathname,
      start: s.t,
      ...(s.done === null ? {} : { end: s.done }),
    }));
}

/** The longest chain of requests in which each began after an earlier one ended. */
export function roundsOf(requests) {
  const sorted = [...requests].sort((a, b) => a.start - b.start);
  const depth = new Map();
  for (const request of sorted) {
    let d = 1;
    for (const before of sorted)
      if (
        before !== request &&
        before.end !== undefined &&
        before.end <= request.start
      )
        d = Math.max(d, (depth.get(before) ?? 1) + 1);
    depth.set(request, d);
  }
  return Math.max(0, ...depth.values());
}

export async function signIn(page) {
  await page.goto(`${BASE}/admin`, { timeout: 120_000 });
  await page.getByRole("textbox", { name: /email/i }).fill(USER.email);
  await page.getByRole("textbox", { name: /password/i }).fill(USER.password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page
    .locator('aside[data-shell-answers="settled"]')
    .waitFor({ timeout: 300_000 });
}

/** The fixture pages' ids, read by slug through the API the admin uses. */
export async function fixtureIds(page) {
  const ids = {};
  for (const [which, slug] of Object.entries(SLUGS)) {
    const response = await page.request.get(
      `${BASE}/admin/api/collections/pages/entries?where[slug][equals]=${slug}&status=all&depth=0&limit=1`
    );
    if (!response.ok())
      throw new Error(
        `reading the fixture page ${slug}: ${String(response.status())}`
      );
    const body = await response.json();
    const id = body.items?.[0]?.id;
    if (typeof id !== "string")
      throw new Error(
        `the fixture page ${slug} is missing; seed it with scripts/seed-speed-fixture.ts`
      );
    ids[which] = id;
  }
  return ids;
}

export async function throttle(cdp, rate) {
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
}

export async function openBuilder(page, id) {
  await page.goto(
    `${BASE}/admin/collections/pages/${id}/builder?field=content`,
    {
      timeout: 120_000,
    }
  );
  await canvasNode(page, HEADING).waitFor({ timeout: 120_000 });
}

export async function select(page, id) {
  await canvasNode(page, id).click();
}

/** Selects `id` and waits until the sidebar shows it. */
export async function selectAndWait(page, id, text) {
  await select(page, id);
  await page.waitForFunction(
    t => window.__builderSpeedChecks.sidebarShows({ text: t }),
    text,
    { timeout: SHOW_LIMIT_MS, polling: 50 }
  );
}

export async function textOf(page, id) {
  return (await canvasNode(page, id).textContent())?.trim() ?? "";
}

/** Long tasks' total duration between two times, from the admin's frame. */
export function blockingBetween(page, from, to) {
  return page.evaluate(
    ({ from, to }) =>
      Math.round(
        window.__builderSpeed.longTasks
          .filter(t => t.start >= from && t.start <= to)
          .reduce((sum, t) => sum + t.duration, 0)
      ),
    { from, to }
  );
}

/** Holds every request `latency` ms longer, as a far-away server would. */
export async function slowNetwork(cdp, latency) {
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
}

/** Commits in every frame of the page, the canvas's own included. */
export async function commitsOf(page) {
  let total = 0;
  for (const frame of page.frames()) {
    total += await frame
      .evaluate(() => window.__builderSpeed?.commits ?? 0)
      .catch(() => 0);
  }
  return total;
}

export async function heapUsed(cdp) {
  await cdp.send("HeapProfiler.collectGarbage");
  await sleep(200);
  await cdp.send("HeapProfiler.collectGarbage");
  const { usedSize } = await cdp.send("Runtime.getHeapUsage");
  return usedSize;
}
