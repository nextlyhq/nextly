/**
 * The builder's speed check: how long an author waits for the page builder,
 * measured in a real browser against a production build, and judged against
 * the budgets in `budgets.mjs`.
 *
 *   node e2e/builder-speed/measure.mjs [--build] [--keep] [--rate 4]
 *                                      [--samples 10] [--only id,id]
 *                                      [--json out.json]
 *   node e2e/builder-speed/measure.mjs --base-url https://… [--rate 1]
 *
 * Without `--base-url`, it starts the playground's production build on its
 * own port and its own SQLite database, freshly seeded with the speed fixture
 * (the playground's `scripts/seed-speed-fixture.ts`), with the statement
 * counter (`../admin-speed/preload.mjs`) loaded into the server. `--build`
 * builds the playground first; without it the last build is served. `--keep`
 * leaves the server running when the run ends and prints how to measure it
 * again with `--base-url`, which skips the build, the seed and the start.
 *
 * With `--base-url`, it measures a server that is already running, a deployed
 * preview included, whose database already holds the fixture; it signs in as
 * `BUILDER_SPEED_EMAIL` and `BUILDER_SPEED_PASSWORD` (the playground's seeded
 * user by default). Statements are counted only on a server it started.
 *
 * ## The method
 *
 * - Chromium's processor is slowed by `--rate` (4 by default, through CDP's
 *   `Emulation.setCPUThrottlingRate`); `--rate 1` measures without slowing.
 * - "Visible" is the time from the input event (its own timestamp) to the
 *   first animation frame in which the result is on screen: a check run in
 *   every frame finds it there.
 * - Each timing is the 75th percentile of `--samples` samples (10) on the
 *   150-block page, unless its budget says otherwise.
 * - React commits are counted through a stand-in for the React DevTools hook,
 *   which a production build reports to as a development one does.
 * - Heap growth is read with the processor not slowed: a slowdown changes how
 *   long the 250 actions take, not what they keep, and the run stays bounded.
 *
 * Results go to `--json` (`e2e/.playwright/builder-speed/results.json`):
 * every budget's samples, result and outcome, and the size curve. A miss that
 * `expected-failures.mjs` does not list fails the run, naming the measure,
 * its result and its budget; so does a listed one that passes.
 *
 * @module builder-speed/measure
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { BUDGETS } from "./budgets.mjs";
import { EXPECTED_FAILURES } from "./expected-failures.mjs";
import { judge, percentile, table } from "./report.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const PLAYGROUND = path.join(ROOT, "apps", "playground");
const PRELOAD = path.join(ROOT, "e2e", "admin-speed", "preload.mjs");
const DIST_DIR = ".next-builder-speed";
const DB_FILE = path.join(PLAYGROUND, "data", "builder-speed.db");
const DB_URL = "file:./data/builder-speed.db";
// A port of its own, so a server of another check never answers this one.
const PORT = Number(process.env.BUILDER_SPEED_PORT || 3104);
const SECRET = "builder-speed-check-secret-not-for-production-0123456789";
/** Where the results, the statement log and any failure's screenshot go. */
const OUT_DIR = path.join(ROOT, "e2e", ".playwright", "builder-speed");

const argv = process.argv.slice(2);
const flag = name => argv.includes(`--${name}`);
const option = name => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};

const RATE = Number(option("rate") ?? 4);
const SAMPLES = Number(option("samples") ?? 10);
const ONLY = option("only")?.split(",");
const BASE = (option("base-url") ?? `http://localhost:${PORT}`).replace(
  /\/$/,
  ""
);
const OWN_SERVER = option("base-url") === undefined;
const USER = {
  email: process.env.BUILDER_SPEED_EMAIL ?? "dev@nextly.local",
  password: process.env.BUILDER_SPEED_PASSWORD ?? "DevPassword123!",
};

/** The fixture's slugs and the ids the script acts on (`seed/speed-fixture`). */
const SLUGS = {
  large: "speed-fixture-150",
  small: "speed-fixture-4",
  twenty: "speed-fixture-20",
  thirtyEight: "speed-fixture-38",
};
const HEADING = "speed-hero-heading";
const LEAD = "speed-hero-lead";
/** Four blocks in the first view of the large page, for the quick clicks. */
const QUICK = [HEADING, LEAD, "speed-hero-start", "speed-hero-demo"];

/** How long a result may take to show before the sample reads as not shown. */
const SHOW_LIMIT_MS = 60_000;
/** How long the keystroke row waits for the canvas before the field is left. */
const KEYSTROKE_LIMIT_MS = 3000;
/** Quiet after an action: no admin request started or open for this long. */
const QUIET_MS = 1500;
/** The round-trip latency the slow-network open adds, as the budget names. */
const LATENCY_MS = 150;
const IDLE_MS = 60_000;
const FOOTER_REST_MS = 5000;
const HEAP_SELECTIONS = 200;
const HEAP_INSERTS = 50;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function wanted(...ids) {
  return ONLY === undefined || ids.some(id => ONLY.includes(id));
}

// ---------------------------------------------------------------------------
// The server
// ---------------------------------------------------------------------------

function serverEnv(log) {
  const { NODE_ENV: _inherited, ...base } = process.env;
  return {
    ...base,
    PORT: String(PORT),
    DB_DIALECT: "sqlite",
    DATABASE_URL: DB_URL,
    NEXTLY_SECRET: SECRET,
    NEXT_PUBLIC_APP_URL: BASE,
    NEXT_DIST_DIR: DIST_DIR,
    NEXT_TELEMETRY_DISABLED: "1",
    NEXTLY_GENERATED_FILES_WRITE: "0",
    // The playground's fixture collections and blocks, as the production
    // browser suite serves them; nothing here reads them.
    NEXTLY_E2E_STYLE_FIXTURE: "1",
    ...(log ? { NEXTLY_SPEED_STATEMENT_LOG: log } : {}),
  };
}

function run(command, env) {
  const result = spawnSync(command, {
    cwd: ROOT,
    env,
    shell: true,
    stdio: "inherit",
  });
  if (result.status !== 0)
    throw new Error(`"${command}" ended with ${String(result.status)}`);
}

async function portOpen(port) {
  return new Promise(resolve => {
    const socket = net.connect(port, "127.0.0.1");
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
  });
}

/**
 * A fresh database with the playground's seed, its plugins installed, and
 * the speed fixture, as a deployment migrates and seeds before it builds.
 */
function prepareDatabase(env) {
  for (const suffix of ["", "-shm", "-wal"])
    fs.rmSync(DB_FILE + suffix, { force: true });
  run("pnpm --filter playground exec tsx scripts/seed.ts", env);
  run("pnpm --filter playground exec nextly plugins install --all", env);
  run("pnpm --filter playground exec tsx scripts/seed-speed-fixture.ts", env);
}

async function startServer(env) {
  const server = spawn(
    "pnpm",
    ["--filter", "playground", "exec", "next", "start", "-p", String(PORT)],
    {
      cwd: ROOT,
      env: {
        ...env,
        NODE_OPTIONS: `${env.NODE_OPTIONS ?? ""} --import ${PRELOAD}`.trim(),
      },
      detached: true,
    }
  );
  let output = "";
  server.stdout.on("data", chunk => (output += chunk));
  server.stderr.on("data", chunk => (output += chunk));
  const until = Date.now() + 120_000;
  for (;;) {
    if (server.exitCode !== null)
      throw new Error(`the server exited:\n${output.slice(-2000)}`);
    if (await portOpen(PORT)) {
      const health = await fetch(`${BASE}/api/health`).catch(() => null);
      if (health?.ok) break;
    }
    if (Date.now() > until)
      throw new Error(`the server never answered:\n${output.slice(-2000)}`);
    await sleep(250);
  }
  return {
    pid: server.pid,
    stop: async () => {
      // The whole process group: `pnpm exec` and the Next.js server under it.
      if (server.pid !== undefined) {
        try {
          process.kill(-server.pid, "SIGTERM");
        } catch {
          // Already gone.
        }
      }
      await sleep(1000);
    },
  };
}

function statementsBetween(log, from, to) {
  if (!log || !fs.existsSync(log)) return null;
  return fs
    .readFileSync(log, "utf8")
    .split("\n")
    .filter(Boolean)
    .map(line => JSON.parse(line))
    .filter(s => s.t >= from && s.t <= to).length;
}

// ---------------------------------------------------------------------------
// What runs in the page
// ---------------------------------------------------------------------------

/**
 * Installed in every frame before any of the page's scripts. Counts React
 * commits (through a stand-in for the DevTools hook), long tasks, and the
 * admin requests the page sends with the time it sent them; and offers the
 * checks `visible` runs in every animation frame. Times are milliseconds since
 * the epoch (`timeOrigin + now`), so the admin's frame and the canvas frame,
 * which keep separate clocks, can be compared.
 */
function pageAgent() {
  const now = () => performance.timeOrigin + performance.now();
  const speed = {
    commits: 0,
    longTasks: [],
    sent: [],
    probe: null,
  };
  window.__builderSpeed = speed;
  // React reads this hook once, when it loads, and reports each commit.
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers: new Map(),
    inject(renderer) {
      const id = this.renderers.size + 1;
      this.renderers.set(id, renderer);
      return id;
    },
    onCommitFiberRoot() {
      speed.commits += 1;
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    checkDCE() {},
  };
  try {
    new PerformanceObserver(list => {
      for (const entry of list.getEntries())
        speed.longTasks.push({
          start: performance.timeOrigin + entry.startTime,
          duration: entry.duration,
        });
    }).observe({ type: "longtask", buffered: true });
  } catch {
    // No long-task timing in this frame.
  }
  const originalFetch = window.fetch;
  window.fetch = function (input, init) {
    let entry = null;
    try {
      const request = input instanceof Request ? input : null;
      const url =
        request !== null
          ? request.url
          : input instanceof URL
            ? input.href
            : typeof input === "string"
              ? input
              : "";
      const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
      entry = { url, method, t: now(), done: null };
      speed.sent.push(entry);
    } catch {
      // Recording never stands in the way of the request.
    }
    const answer = originalFetch.apply(this, arguments);
    // When the answer arrived, on the same clock, for round trips and saves.
    answer.then(
      () => {
        if (entry) entry.done = now();
      },
      () => {
        if (entry) entry.done = now();
      }
    );
    return answer;
  };
  // The first input event of the kind armed, in this frame or the canvas's.
  const onInput = event => {
    const probe = window.top?.__builderSpeed?.probe;
    if (!probe || probe.start !== null || !probe.on.includes(event.type))
      return;
    probe.start = performance.timeOrigin + event.timeStamp;
  };
  for (const type of ["pointerdown", "pointerup", "keydown"])
    window.addEventListener(type, onInput, { capture: true });
}

/**
 * The checks `visible` can run, by name, in the admin's frame. Each reads the
 * canvas frame's document where the result is drawn.
 */
function pageChecks() {
  const canvas = () =>
    document.querySelector('iframe[title^="Page canvas"]')?.contentDocument ??
    null;
  const node = id =>
    canvas()?.querySelector(`.nx-canvas [data-nx-node="${id}"]`) ?? null;
  const inspector = () => document.querySelector('[data-testid="inspector"]');
  window.__builderSpeedChecks = {
    /** The inspector shows the block whose text is `text`. */
    sidebarShows({ text }) {
      const root = inspector();
      if (!root) return false;
      for (const field of root.querySelectorAll(
        "[data-content-control] input, [data-content-control] textarea"
      ))
        if (field.value === text) return true;
      return false;
    },
    /** The selection outline lies over block `id`. */
    outlineOn({ id }) {
      const frame = document.querySelector('iframe[title^="Page canvas"]');
      const block = node(id);
      const mark = document.querySelector(
        '.nx-canvas-mark[data-mark="selected"]:not([data-hidden])'
      );
      if (!frame || !block || !mark) return false;
      const outer = frame.getBoundingClientRect();
      const scale = frame.offsetWidth ? outer.width / frame.offsetWidth : 1;
      const inner = block.getBoundingClientRect();
      const drawn = mark.getBoundingClientRect();
      // The outline is drawn a few pixels outside the block, so it is
      // matched by its centre and, loosely, its width.
      const x = outer.left + (inner.left + inner.width / 2) * scale;
      const y = outer.top + (inner.top + inner.height / 2) * scale;
      return (
        Math.abs(drawn.left + drawn.width / 2 - x) < 3 &&
        Math.abs(drawn.top + drawn.height / 2 - y) < 3 &&
        Math.abs(drawn.width - inner.width * scale) < 16
      );
    },
    /** Block `id` reads `text` on the canvas. */
    canvasText({ id, text }) {
      return node(id)?.textContent?.trim() === text;
    },
    /** Block `id`'s font size on the canvas is `size`. */
    canvasFontSize({ id, size }) {
      const element = node(id);
      if (!element) return false;
      return (
        element.ownerDocument.defaultView?.getComputedStyle(element)
          .fontSize === size
      );
    },
    /** The page's blocks on the canvas number `count`. */
    canvasBlocks({ count }) {
      return (
        canvas()?.querySelectorAll(".nx-canvas [data-nx-node]").length === count
      );
    },
    /** The canvas has drawn block `id`. */
    canvasDrawn({ id }) {
      const element = node(id);
      return element !== null && element.getBoundingClientRect().height > 0;
    },
    /** The Add panel is open with its blocks listed. */
    addPanelOpen() {
      const search = document.querySelector(
        'input[cmdk-input][placeholder^="Search blocks"]'
      );
      return (
        search !== null &&
        document.querySelectorAll('[role="option"]').length > 0
      );
    },
    /** The editor says the page is saved and has nothing left to save. */
    saved() {
      // The save itself must have been sent after the click and answered:
      // the indicator can still read "saved" from an earlier autosave while
      // the button is already disabled for the save in flight.
      const start = window.__builderSpeed.probe?.start ?? null;
      const answered = window.__builderSpeed.sent.some(
        s =>
          start !== null &&
          s.t >= start &&
          s.done !== null &&
          s.method !== "GET" &&
          s.url.includes("/collections/pages/entries/") &&
          !s.url.includes("/versions/")
      );
      if (!answered) return false;
      const button = document.querySelector(
        '[data-publish-split] [data-primary="true"]'
      );
      const state = document.querySelector(
        '[data-testid="save-state-indicator"]'
      );
      return (
        button instanceof HTMLButtonElement &&
        button.disabled &&
        state?.getAttribute("data-tone") === "saved"
      );
    },
  };
}

/** The canvas frame, as Playwright reaches it. */
function canvasOf(page) {
  return page.frameLocator('iframe[title^="Page canvas"]');
}

function canvasNode(page, id) {
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
async function visibleAll(page, { on, checks, limit = SHOW_LIMIT_MS }, act) {
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
async function visible(page, { on, check, args = {}, limit }, act) {
  const result = await visibleAll(
    page,
    { on, checks: [[check, args]], ...(limit === undefined ? {} : { limit }) },
    act
  );
  return { start: result.start, ms: result.ms[0], end: result.ends[0] };
}

// ---------------------------------------------------------------------------
// The browser session
// ---------------------------------------------------------------------------

/** Every admin API request the page sends, with when it started and ended. */
function watchRequests(page) {
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
async function sentBetween(page, from, to) {
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
function roundsOf(requests) {
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

async function signIn(page) {
  await page.goto(`${BASE}/admin`, { timeout: 120_000 });
  await page.getByRole("textbox", { name: /email/i }).fill(USER.email);
  await page.getByRole("textbox", { name: /password/i }).fill(USER.password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page
    .locator('aside[data-shell-answers="settled"]')
    .waitFor({ timeout: 300_000 });
}

/** The fixture pages' ids, read by slug through the API the admin uses. */
async function fixtureIds(page) {
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

async function throttle(cdp, rate) {
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
}

async function openBuilder(page, id) {
  await page.goto(
    `${BASE}/admin/collections/pages/${id}/builder?field=content`,
    {
      timeout: 120_000,
    }
  );
  await canvasNode(page, HEADING).waitFor({ timeout: 120_000 });
}

async function select(page, id) {
  await canvasNode(page, id).click();
}

/** Selects `id` and waits until the sidebar shows it. */
async function selectAndWait(page, id, text) {
  await select(page, id);
  await page.waitForFunction(
    t => window.__builderSpeedChecks.sidebarShows({ text: t }),
    text,
    { timeout: SHOW_LIMIT_MS, polling: 50 }
  );
}

async function textOf(page, id) {
  return (await canvasNode(page, id).textContent())?.trim() ?? "";
}

/**
 * Alternates selecting the heading and the lead, `count` times, and times
 * each selection: the sidebar, the outline, and the requests and statements
 * it set off. Lock renewals run on a timer whatever the author does, so they
 * are not counted against a selection.
 */
async function selections(page, watcher, count, log) {
  const texts = {
    [HEADING]: await textOf(page, HEADING),
    [LEAD]: await textOf(page, LEAD),
  };
  await selectAndWait(page, LEAD, texts[LEAD]);
  await watcher.quiet();
  const out = {
    sidebar: [],
    outline: [],
    requests: [],
    kinds: [],
    statements: [],
  };
  for (let i = 0; i < count; i++) {
    const id = i % 2 === 0 ? HEADING : LEAD;
    const sample = await visibleAll(
      page,
      {
        on: ["pointerdown"],
        checks: [
          ["sidebarShows", { text: texts[id] }],
          ["outlineOn", { id }],
        ],
      },
      async () => {
        await select(page, id);
      }
    );
    out.sidebar.push(sample.ms[0]);
    out.outline.push(sample.ms[1]);
    await watcher.quiet();
    // What the click set off: every request sent from the click until 1.5 s
    // after its result showed.
    const clicked = sample.start ?? Date.now();
    const shown = Math.max(clicked, ...sample.ends.filter(e => e !== null));
    const sent = (await sentBetween(page, clicked, shown + 1500)).filter(
      r => !r.path.endsWith("/document-lock")
    );
    out.requests.push(sent.length);
    out.kinds.push(sent.map(r => `${r.method} ${r.path}`));
    const statements = statementsBetween(log, clicked, shown + 1500);
    if (statements !== null) out.statements.push(statements);
  }
  return out;
}

/** Selection on a smaller page, for the size curve: the sidebar only. */
async function sidebarTimes(page, watcher, count) {
  const texts = {
    [HEADING]: await textOf(page, HEADING),
    [LEAD]: await textOf(page, LEAD),
  };
  await selectAndWait(page, LEAD, texts[LEAD]);
  await watcher.quiet();
  const times = [];
  for (let i = 0; i < count; i++) {
    const id = i % 2 === 0 ? HEADING : LEAD;
    const sample = await visible(
      page,
      { on: ["pointerdown"], check: "sidebarShows", args: { text: texts[id] } },
      async () => {
        await select(page, id);
      }
    );
    times.push(sample.ms);
    await watcher.quiet();
  }
  return times;
}

/** Long tasks' total duration between two times, from the admin's frame. */
function blockingBetween(page, from, to) {
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

/**
 * Four clicks on four blocks, each 100 ms after the page took the last; the
 * main thread's long tasks are summed from the first click until the last
 * block is shown and a second passes with no long task. Each click lands
 * away from the selected block's toolbar, which floats over the block above.
 */
async function quickClicks(page, count) {
  const texts = {};
  for (const id of QUICK) texts[id] = await textOf(page, id);
  const totals = [];
  for (let i = 0; i < count; i++) {
    await selectAndWait(page, LEAD, texts[LEAD]);
    await sleep(1000);
    const points = [];
    for (const id of QUICK) {
      const box = await canvasNode(page, id).boundingBox();
      if (!box) throw new Error(`the quick-click block ${id} is not drawn`);
      points.push({
        x: box.x + (box.width > 200 ? box.width * 0.75 : box.width / 2),
        y: box.y + box.height / 2,
      });
    }
    const from = await page.evaluate(
      () => performance.timeOrigin + performance.now()
    );
    // Each click as soon as the page takes the last, 100 ms after: a busy
    // page takes input only between its tasks, so the clicks queue behind
    // its work as a person's do.
    for (const point of points) {
      await page.mouse.click(point.x, point.y);
      await sleep(100);
    }
    const last = QUICK[QUICK.length - 1];
    // The last block is a button: the inspector shows its label.
    // Landed once the sidebar shows the last block clicked.
    const landed = await page
      .waitForFunction(
        t => window.__builderSpeedChecks.sidebarShows({ text: t }),
        texts[last],
        { timeout: SHOW_LIMIT_MS, polling: 100 }
      )
      .then(
        () => true,
        () => false
      );
    // Until a second passes with no new long task.
    let seen = -1;
    for (;;) {
      await sleep(1000);
      const n = await page.evaluate(
        () => window.__builderSpeed.longTasks.length
      );
      if (n === seen) break;
      seen = n;
    }
    const to = await page.evaluate(
      () => performance.timeOrigin + performance.now()
    );
    // Clicks that never selected the last block measured nothing.
    totals.push(landed ? await blockingBetween(page, from, to) : null);
  }
  return totals;
}

const addButton = page =>
  page
    .getByRole("navigation", { name: "Editor panels" })
    .getByRole("button", { name: "Add", exact: true });

async function closeAddPanel(page) {
  if ((await addButton(page).getAttribute("aria-pressed")) === "true") {
    await addButton(page).click();
    await page
      .getByRole("combobox", { name: "Insert a block" })
      .waitFor({ state: "detached", timeout: SHOW_LIMIT_MS });
  }
}

/**
 * Starts counting the header and footer elements an action hides: in every
 * animation frame from now, how many elements inside the regions are drawn
 * with no size, beyond the number drawn with none before. A region missing
 * altogether counts as all the elements it held. The most in any one frame is
 * the count, so an element that blinks out and back is counted, once.
 */
async function watchRegions(page) {
  await page.evaluate(() => {
    const doc = document.querySelector(
      'iframe[title^="Page canvas"]'
    )?.contentDocument;
    const speed = window.__builderSpeed;
    speed.regionWatch = { stop: false, most: 0 };
    const watch = speed.regionWatch;
    if (!doc) return;
    const empty = element => {
      const box = element.getBoundingClientRect();
      return box.width === 0 || box.height === 0;
    };
    const census = () => {
      const counts = {};
      for (const region of doc.querySelectorAll("[data-nx-region]")) {
        const all = [region, ...region.querySelectorAll("*")];
        counts[region.getAttribute("data-nx-region")] = {
          all: all.length,
          empty: all.filter(empty).length,
        };
      }
      return counts;
    };
    const before = census();
    // Both regions, or the count below would read none for want of anything
    // to watch.
    if (before.header === undefined || before.footer === undefined)
      throw new Error("the canvas draws no header or no footer to watch");
    const frame = () => {
      if (watch.stop) return;
      const now = census();
      let hidden = 0;
      for (const [area, was] of Object.entries(before)) {
        const is = now[area];
        hidden +=
          is === undefined ? was.all : Math.max(0, is.empty - was.empty);
      }
      watch.most = Math.max(watch.most, hidden);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

function regionsHidden(page) {
  return page.evaluate(() => {
    const watch = window.__builderSpeed.regionWatch;
    if (!watch) return 0;
    watch.stop = true;
    return watch.most;
  });
}

/**
 * Opens the Add panel with the heading selected, inserts a Heading after it,
 * and undoes the insert, `count` times; times each, and counts the header and
 * footer elements each insert took off the canvas.
 */
async function addInsertUndo(page, watcher, count) {
  const heading = await textOf(page, HEADING);
  const out = { open: [], insert: [], undo: [], hidden: [] };
  for (let i = 0; i < count; i++) {
    await closeAddPanel(page);
    await selectAndWait(page, HEADING, heading);
    await watcher.quiet();
    const base = await canvasOf(page)
      .locator(".nx-canvas [data-nx-node]")
      .count();
    const open = await visible(
      page,
      { on: ["pointerdown"], check: "addPanelOpen" },
      async () => {
        await addButton(page).click();
      }
    );
    out.open.push(open.ms);
    await page
      .locator(".nx-insert-panel__placement")
      .getByText("Adding after Heading")
      .waitFor({ timeout: SHOW_LIMIT_MS });
    await watcher.quiet();
    await watchRegions(page);
    const insert = await visible(
      page,
      { on: ["pointerdown"], check: "canvasBlocks", args: { count: base + 1 } },
      async () => {
        await page
          .getByRole("option", { name: "Heading", exact: true })
          .click();
      }
    );
    out.insert.push(insert.ms);
    await watcher.quiet();
    await sleep(500);
    out.hidden.push(await regionsHidden(page));
    const undo = await visible(
      page,
      { on: ["pointerdown"], check: "canvasBlocks", args: { count: base } },
      async () => {
        await page.getByRole("button", { name: "Undo", exact: true }).click();
      }
    );
    out.undo.push(undo.ms);
    await watcher.quiet();
  }
  await closeAddPanel(page);
  return out;
}

/** The lead's text field in the sidebar's Content tab. */
function leadField(page) {
  return page
    .getByTestId("inspector")
    .locator('[data-content-control="textarea"] textarea')
    .first();
}

/**
 * Focuses the lead's text field with the caret after its last character. Set
 * directly: End moves only to the end of the wrapped line the caret is on.
 */
async function caretAtEnd(page) {
  const field = leadField(page);
  await field.click();
  await field.evaluate(element => {
    element.setSelectionRange(element.value.length, element.value.length);
  });
}

/**
 * Types one character into the lead's text field, or deletes the one the
 * last sample typed, and times how long until the canvas shows it; then
 * leaves the field with Tab and times the canvas again. Alternating keeps the
 * page the same size from sample to sample.
 */
async function typing(page, watcher, count) {
  const base = await textOf(page, LEAD);
  await selectAndWait(page, LEAD, base);
  const out = { keystroke: [], leave: [], unshown: 0 };
  for (let i = 0; i < count; i++) {
    await watcher.quiet();
    const adding = i % 2 === 0;
    const expected = adding ? `${base}!` : base;
    await caretAtEnd(page);
    const keystroke = await visible(
      page,
      {
        on: ["keydown"],
        check: "canvasText",
        args: { id: LEAD, text: expected },
        limit: KEYSTROKE_LIMIT_MS,
      },
      async () => {
        if (adding) await page.keyboard.type("!");
        else await page.keyboard.press("Backspace");
      }
    );
    // Not shown before the wait ran out reads as the wait itself: a lower
    // bound, and over any budget below it. The input itself was seen, so
    // this is a reading, not a failure to measure.
    out.keystroke.push(
      keystroke.ms ?? (keystroke.start === null ? null : KEYSTROKE_LIMIT_MS)
    );
    out.unshown += keystroke.ms === null ? 1 : 0;
    const leave = await visible(
      page,
      {
        on: ["keydown"],
        check: "canvasText",
        args: { id: LEAD, text: expected },
      },
      async () => {
        await page.keyboard.press("Tab");
      }
    );
    out.leave.push(leave.ms);
  }
  await watcher.quiet();
  return out;
}

/** The heading's Font size field and the label that drags it. */
async function fontSizeControl(page) {
  await page
    .getByTestId("inspector")
    .getByRole("tab", { name: "Style" })
    .click();
  const section = page.getByRole("button", { name: /^Typography/ }).first();
  if ((await section.getAttribute("aria-expanded")) !== "true")
    await section.click();
  const field = page
    .getByTestId("inspector")
    .getByRole("textbox", { name: /^Font size\b/ });
  await field.waitFor({ timeout: SHOW_LIMIT_MS });
  const id = await field.getAttribute("id");
  return { field, label: page.locator(`label[for="${id}"]`) };
}

/**
 * Drags the heading's Font size label 10 px right, or back left, and times
 * how long after the release the canvas draws the new size.
 */
async function labelDrags(page, watcher, count) {
  await selectAndWait(page, HEADING, await textOf(page, HEADING));
  const { field, label } = await fontSizeControl(page);
  const out = [];
  for (let i = 0; i < count; i++) {
    await watcher.quiet();
    const box = await label.boundingBox();
    if (!box) throw new Error("the Font size label is not drawn");
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const was = await field.inputValue();
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + (i % 2 === 0 ? 10 : -10), y, { steps: 8 });
    const value = await field.inputValue();
    // A drag that moved nothing would time a release that writes nothing.
    if (value === was)
      throw new Error(`the Font size drag left the value at ${was}`);
    const sample = await visible(
      page,
      {
        on: ["pointerup"],
        check: "canvasFontSize",
        args: { id: HEADING, size: `${value}px` },
      },
      async () => {
        await page.mouse.up();
      }
    );
    out.push(sample.ms);
  }
  await page
    .getByTestId("inspector")
    .getByRole("tab", { name: "Content" })
    .click();
  await watcher.quiet();
  return out;
}

/**
 * Rests the pointer 10 px inside the top edge of the footer drawn around the
 * page for five seconds, and counts the footer's size changes meanwhile.
 */
async function footerRest(page) {
  const point = await page.evaluate(() => {
    const frame = document.querySelector('iframe[title^="Page canvas"]');
    const footer = frame?.contentDocument?.querySelector(
      '[data-nx-region="footer"]'
    );
    if (!frame || !footer) return null;
    footer.scrollIntoView({ block: "center" });
    return true;
  });
  if (point === null) return { value: null, note: "the page draws no footer" };
  await sleep(1500);
  // Watched from before the pointer arrives, so a change its arrival causes
  // is counted too.
  const at = await page.evaluate(() => {
    const frame = document.querySelector('iframe[title^="Page canvas"]');
    const footer = frame.contentDocument.querySelector(
      '[data-nx-region="footer"]'
    );
    const speed = window.__builderSpeed;
    speed.footerChanges = 0;
    let last = null;
    speed.footerObserver = new frame.contentWindow.ResizeObserver(entries => {
      for (const entry of entries) {
        const size = `${entry.contentRect.width}x${entry.contentRect.height}`;
        if (last !== null && size !== last) speed.footerChanges += 1;
        last = size;
      }
    });
    speed.footerObserver.observe(footer);
    // Whether the pointer reached the footer: read from the pointer's own
    // events, since the footer may move away from under a resting pointer.
    speed.footerHit = false;
    frame.contentDocument.addEventListener(
      "pointermove",
      event => {
        if (event.target?.closest?.('[data-nx-region="footer"]'))
          speed.footerHit = true;
      },
      { capture: true }
    );
    const outer = frame.getBoundingClientRect();
    const scale = frame.offsetWidth ? outer.width / frame.offsetWidth : 1;
    const inner = footer.getBoundingClientRect();
    const ix = inner.left + inner.width / 2;
    const iy = inner.top + 10;
    return {
      ix,
      iy,
      x: outer.left + ix * scale,
      y: outer.top + iy * scale,
      inView: iy >= 0 && iy < frame.contentWindow.innerHeight,
    };
  });
  if (!at.inView) throw new Error("the footer's top edge is not in view");
  await page.mouse.move(at.x, at.y, { steps: 4 });
  // The pointer reached the footer, or the rest measured nothing.
  const over = await page.evaluate(() => window.__builderSpeed.footerHit);
  if (!over) throw new Error("the pointer did not land on the footer");
  await sleep(FOOTER_REST_MS);
  const changes = await page.evaluate(() => {
    const speed = window.__builderSpeed;
    speed.footerObserver.disconnect();
    return speed.footerChanges;
  });
  await page.mouse.move(5, 5);
  return { value: changes };
}

/**
 * Makes one text edit, lets the editor's own autosave settle, then presses
 * Save (which publishes a published page's changes), `count` times. Times the
 * click to the save request's send, and to the editor saying it is saved.
 */
async function publishes(page, watcher, id, count) {
  const base = (await textOf(page, LEAD)).replace(/!$/, "");
  await selectAndWait(page, LEAD, await textOf(page, LEAD));
  const out = { request: [], saved: [] };
  for (let i = 0; i < count; i++) {
    const current = await textOf(page, LEAD);
    const expected = current.endsWith("!") ? base : `${base}!`;
    await caretAtEnd(page);
    if (expected === base) await page.keyboard.press("Backspace");
    else await page.keyboard.type("!");
    await page.keyboard.press("Tab");
    await page.waitForFunction(
      t =>
        window.__builderSpeedChecks.canvasText({
          id: "speed-hero-lead",
          text: t,
        }),
      expected,
      { timeout: SHOW_LIMIT_MS, polling: 100 }
    );
    // The autosave a pause after the edit, so every press starts alike.
    await page
      .waitForResponse(
        response =>
          response.url().includes(`/entries/${id}/versions/autosave`) &&
          response.request().method() === "PUT",
        { timeout: 20_000 }
      )
      .catch(() => {});
    await watcher.quiet();
    const sentBefore = await page.evaluate(
      () => window.__builderSpeed.sent.length
    );
    const saved = await visible(
      page,
      { on: ["pointerdown"], check: "saved" },
      async () => {
        await page
          .locator('[data-publish-split] [data-primary="true"]')
          .click();
      }
    );
    out.saved.push(saved.ms);
    const request = await page.evaluate(
      ({ sentBefore, id }) =>
        window.__builderSpeed.sent
          .slice(sentBefore)
          .find(
            s =>
              s.method !== "GET" &&
              s.url.includes(`/collections/pages/entries/${id}`) &&
              !s.url.includes("/versions/")
          )?.t ?? null,
      { sentBefore, id }
    );
    out.request.push(
      request === null || saved.start === null
        ? null
        : Math.round(request - saved.start)
    );
    await watcher.quiet();
  }
  return out;
}

/** Holds every request `latency` ms longer, as a far-away server would. */
async function slowNetwork(cdp, latency) {
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
}

/**
 * Opens the builder with every request held `LATENCY_MS` longer, `count`
 * times, two ways:
 *
 * - **loaded**, the budget: the builder's address loaded as a page, with the
 *   admin's code already in the browser's cache from earlier visits, as an
 *   author arrives from a link, a bookmark or a reload. Timed from the
 *   navigation's start (the new page's own time origin) to the first frame
 *   drawing the page's first block, with the admin API requests sent before
 *   it and their longest chain of back-to-back round trips;
 * - **from the edit screen**, reported beside it: a click on "Open Page
 *   Builder" on the page's edit screen, an in-app move that reuses the entry
 *   the screen already read, so it is the lighter of the two.
 */
async function opens(page, cdp, watcher, id, count) {
  const out = {
    canvas: [],
    requests: [],
    rounds: [],
    fromEditScreen: { canvas: [], requests: [], rounds: [] },
  };
  const builder = `${BASE}/admin/collections/pages/${id}/builder?field=content`;
  for (let i = 0; i < count; i++) {
    // Loaded: from a page that is not the builder, so nothing of it is kept.
    await page.goto(`${BASE}/admin/collections/pages/${id}`, {
      timeout: 120_000,
    });
    await watcher.quiet();
    await slowNetwork(cdp, LATENCY_MS);
    await page.goto(builder, { waitUntil: "commit", timeout: 120_000 });
    const drawn = await page
      .waitForFunction(
        block =>
          window.__builderSpeedChecks?.canvasDrawn({ id: block })
            ? performance.timeOrigin + performance.now()
            : false,
        HEADING,
        { polling: "raf", timeout: SHOW_LIMIT_MS }
      )
      .then(handle => handle.jsonValue())
      .catch(() => null);
    const origin = await page.evaluate(() => performance.timeOrigin);
    if (drawn === null) {
      out.canvas.push(null);
      out.requests.push(null);
      out.rounds.push(null);
    } else {
      out.canvas.push(Math.round(drawn - origin));
      const before = await sentBetween(page, origin, drawn);
      out.requests.push(before.length);
      out.rounds.push(roundsOf(before));
    }
    await watcher.quiet();
    await slowNetwork(cdp, 0);

    // From the edit screen.
    await page.goto(`${BASE}/admin/collections/pages/${id}`, {
      timeout: 120_000,
    });
    const link = page.getByRole("link", { name: "Open Page Builder" });
    await link.waitFor({ timeout: SHOW_LIMIT_MS });
    await watcher.quiet();
    await slowNetwork(cdp, LATENCY_MS);
    const sample = await visible(
      page,
      { on: ["pointerdown"], check: "canvasDrawn", args: { id: HEADING } },
      async () => {
        await link.click();
      }
    );
    const from = out.fromEditScreen;
    from.canvas.push(sample.ms);
    if (sample.start !== null && sample.end !== null) {
      const before = await sentBetween(page, sample.start, sample.end);
      from.requests.push(before.length);
      from.rounds.push(roundsOf(before));
    }
    await watcher.quiet();
    await slowNetwork(cdp, 0);
  }
  return out;
}

/** Commits in every frame of the page, the canvas's own included. */
async function commitsOf(page) {
  let total = 0;
  for (const frame of page.frames()) {
    total += await frame
      .evaluate(() => window.__builderSpeed?.commits ?? 0)
      .catch(() => 0);
  }
  return total;
}

/** A minute with the builder open and untouched: requests and React commits. */
async function idleMinute(page, watcher) {
  await page.mouse.move(5, 5);
  await watcher.quiet();
  await sleep(5000);
  const commits = await commitsOf(page);
  const from = Date.now();
  await sleep(IDLE_MS);
  return {
    requests: watcher.between(from, Date.now()).length,
    commits: (await commitsOf(page)) - commits,
  };
}

async function heapUsed(cdp) {
  await cdp.send("HeapProfiler.collectGarbage");
  await sleep(200);
  await cdp.send("HeapProfiler.collectGarbage");
  const { usedSize } = await cdp.send("Runtime.getHeapUsage");
  return usedSize;
}

/** Heap growth from the 100th to the 200th selection, and over 50 inserts. */
async function heapGrowth(page, cdp, watcher) {
  const texts = {
    [HEADING]: await textOf(page, HEADING),
    [LEAD]: await textOf(page, LEAD),
  };
  let at100 = 0;
  for (let i = 1; i <= HEAP_SELECTIONS; i++) {
    const id = i % 2 === 0 ? HEADING : LEAD;
    await selectAndWait(page, id, texts[id]);
    if (i === HEAP_SELECTIONS / 2) {
      await watcher.quiet();
      at100 = await heapUsed(cdp);
    }
  }
  await watcher.quiet();
  const at200 = await heapUsed(cdp);
  await selectAndWait(page, HEADING, texts[HEADING]);
  await addButton(page).click();
  await page.getByRole("combobox", { name: "Insert a block" }).waitFor();
  const base = await canvasOf(page)
    .locator(".nx-canvas [data-nx-node]")
    .count();
  await watcher.quiet();
  const beforeInserts = await heapUsed(cdp);
  for (let i = 0; i < HEAP_INSERTS; i++) {
    await selectAndWait(page, HEADING, texts[HEADING]);
    await page.getByRole("option", { name: "Heading", exact: true }).click();
    await page.waitForFunction(
      n => window.__builderSpeedChecks.canvasBlocks({ count: n }),
      base + 1,
      { timeout: SHOW_LIMIT_MS, polling: 100 }
    );
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await page.waitForFunction(
      n => window.__builderSpeedChecks.canvasBlocks({ count: n }),
      base,
      { timeout: SHOW_LIMIT_MS, polling: 100 }
    );
  }
  await watcher.quiet();
  const afterInserts = await heapUsed(cdp);
  await closeAddPanel(page);
  const growth = (a, b) => Number((((b - a) / a) * 100).toFixed(1));
  return {
    selections: growth(at100, at200),
    inserts: growth(beforeInserts, afterInserts),
    bytes: { at100, at200, beforeInserts, afterInserts },
  };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

async function measure(log) {
  const browser = await chromium.launch();
  const measured = {};
  const extra = {};
  const keep = (id, samples, note) => {
    measured[id] = { samples, ...(note === undefined ? {} : { note }) };
  };
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      bypassCSP: true,
    });
    await context.addInitScript(pageAgent);
    await context.addInitScript(pageChecks);
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    const watcher = watchRequests(page);
    await signIn(page);
    const ids = await fixtureIds(page);
    console.log(`[builder-speed] fixture pages: ${JSON.stringify(ids)}`);

    await throttle(cdp, RATE);
    await openBuilder(page, ids.large);
    await watcher.quiet();

    /*
     * Each group of measures in turn. A group that cannot finish (an element
     * that never appeared, a click the page refused) leaves its measures
     * unreadable, which fails them with the reason, and the run goes on from
     * a freshly opened builder: one broken step must not hide every other
     * result.
     */
    const group = async (ids, title, work) => {
      if (!wanted(...ids)) return;
      console.log(`[builder-speed] ${title}`);
      try {
        await work();
      } catch (error) {
        const reason =
          error instanceof Error ? error.message.split("\n")[0] : String(error);
        console.error(
          `[builder-speed] ${title} could not be measured: ${reason}`
        );
        // What the page showed, kept beside the results for whoever reads why.
        await page
          .screenshot({
            path: path.join(OUT_DIR, `${ids[0]}-failed.png`),
          })
          .catch(() => {});
        for (const id of ids)
          if (measured[id] === undefined)
            keep(id, [null], `could not be measured: ${reason}`);
        await throttle(cdp, RATE);
        await openBuilder(page, large).catch(() => {});
        await watcher.quiet();
      }
    };
    const large = ids.large;

    await group(
      ["select-sidebar", "select-outline", "select-requests"],
      "selections on the 150-block page",
      async () => {
        const s = await selections(page, watcher, SAMPLES, log);
        keep("select-sidebar", s.sidebar);
        keep("select-outline", s.outline);
        keep("select-requests", s.requests);
        extra.selectionStatements = s.statements;
        extra.selectionRequests = s.kinds;
      }
    );
    await group(["quick-clicks-blocking"], "four quick clicks", async () => {
      keep("quick-clicks-blocking", await quickClicks(page, SAMPLES));
    });
    await group(
      ["add-panel-open", "add-panel-insert", "undo", "insert-hides-regions"],
      "the Add panel, inserts and undo",
      async () => {
        const a = await addInsertUndo(page, watcher, SAMPLES);
        keep("add-panel-open", a.open);
        keep("add-panel-insert", a.insert);
        keep("undo", a.undo);
        keep("insert-hides-regions", a.hidden);
      }
    );
    await group(
      ["keystroke-canvas", "leave-field-canvas"],
      "typing in a text field",
      async () => {
        const t = await typing(page, watcher, SAMPLES);
        keep(
          "keystroke-canvas",
          t.keystroke,
          t.unshown > 0
            ? `${String(t.unshown)} of ${String(t.keystroke.length)} keystrokes not shown on the canvas within ${String(KEYSTROKE_LIMIT_MS)} ms, before the field was left (read as ${String(KEYSTROKE_LIMIT_MS)} ms)`
            : undefined
        );
        keep("leave-field-canvas", t.leave);
      }
    );
    await group(["label-drag-release"], "label drags", async () => {
      keep("label-drag-release", await labelDrags(page, watcher, SAMPLES));
    });
    await group(
      ["footer-resizes"],
      "the pointer resting on the footer",
      async () => {
        const f = await footerRest(page);
        keep("footer-resizes", [f.value], f.note);
      }
    );
    await group(
      ["publish-request", "publish-saved"],
      "publishing",
      async () => {
        const p = await publishes(page, watcher, large, SAMPLES);
        keep("publish-request", p.request);
        keep("publish-saved", p.saved);
      }
    );
    await group(
      ["select-size-ratio"],
      "selections on the 4, 20 and 38-block pages",
      async () => {
        extra.curve = {};
        for (const which of ["small", "twenty", "thirtyEight"]) {
          await openBuilder(page, ids[which]);
          await watcher.quiet();
          const times = await sidebarTimes(page, watcher, SAMPLES);
          extra.curve[which] = { samples: times, p75: percentile(times, 75) };
        }
        // The large page's own times, taken here when this run skipped them.
        let big = measured["select-sidebar"]?.samples;
        if (big === undefined) {
          await openBuilder(page, large);
          await watcher.quiet();
          big = await sidebarTimes(page, watcher, SAMPLES);
        }
        const small = extra.curve.small.samples;
        const ratio =
          big.some(v => v === null) || small.some(v => v === null)
            ? null
            : Number((percentile(big, 75) / percentile(small, 75)).toFixed(2));
        extra.curve.large = { samples: big, p75: percentile(big, 75) };
        keep(
          "select-size-ratio",
          [ratio],
          ratio === null
            ? "a selection on one of the two pages never showed"
            : undefined
        );
      }
    );
    await group(
      ["open-canvas-slow-network", "open-requests", "open-round-trips"],
      "opening the builder on a slow network",
      async () => {
        try {
          const o = await opens(page, cdp, watcher, large, SAMPLES);
          keep("open-canvas-slow-network", o.canvas);
          keep("open-requests", o.requests);
          keep("open-round-trips", o.rounds);
          extra.openFromEditScreen = o.fromEditScreen;
        } finally {
          await cdp.send("Network.emulateNetworkConditions", {
            offline: false,
            latency: 0,
            downloadThroughput: -1,
            uploadThroughput: -1,
          });
        }
      }
    );
    await group(
      ["idle-requests", "idle-commits"],
      "an idle minute",
      async () => {
        if (!page.url().includes(`/${large}/builder`))
          await openBuilder(page, large);
        const idle = await idleMinute(page, watcher);
        keep("idle-requests", [idle.requests]);
        keep("idle-commits", [idle.commits]);
      }
    );
    await group(
      ["heap-selections", "heap-inserts"],
      "heap growth (processor not slowed)",
      async () => {
        await throttle(cdp, 1);
        await openBuilder(page, large);
        await watcher.quiet();
        const heap = await heapGrowth(page, cdp, watcher);
        keep("heap-selections", [heap.selections]);
        keep("heap-inserts", [heap.inserts]);
        extra.heapBytes = heap.bytes;
      }
    );
  } finally {
    await browser.close();
  }
  return { measured, extra };
}

async function main() {
  const dir = OUT_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const log = OWN_SERVER ? path.join(dir, "statements.jsonl") : null;
  let server;
  try {
    if (OWN_SERVER) {
      if (await portOpen(PORT))
        throw new Error(
          `port ${String(PORT)} is already in use; stop what listens there, set BUILDER_SPEED_PORT, or measure it with --base-url`
        );
      const env = serverEnv();
      prepareDatabase(env);
      if (flag("build")) run("pnpm --filter playground exec next build", env);
      fs.rmSync(log, { force: true });
      server = await startServer(serverEnv(log));
    }
    const started = Date.now();
    const { measured, extra } = await measure(log);
    const { rows, problems } = judge(measured, BUDGETS, EXPECTED_FAILURES, {
      ...(ONLY === undefined ? {} : { only: ONLY }),
    });
    const out = {
      base: BASE,
      rate: RATE,
      samples: SAMPLES,
      seconds: Math.round((Date.now() - started) / 1000),
      rows,
      ...extra,
    };
    const json = option("json") ?? path.join(dir, "results.json");
    fs.writeFileSync(json, `${JSON.stringify(out, null, 2)}\n`);
    console.log(
      `\n[builder-speed] ${BASE}, processor slowed ${String(RATE)}×\n${table(rows)}`
    );
    console.log(
      `[builder-speed] results written to ${path.relative(ROOT, json)}`
    );
    if (problems.length > 0) {
      console.error(
        `\n[builder-speed] ${String(problems.length)} problem(s):\n- ${problems.join("\n- ")}`
      );
      process.exitCode = 1;
    }
  } finally {
    if (server && flag("keep")) {
      console.log(
        `[builder-speed] the server stays up (process group ${String(server.pid)}); measure it again with --base-url ${BASE}, and stop it with: kill -- -${String(server.pid)}`
      );
    } else {
      await server?.stop();
    }
  }
}

await main();
