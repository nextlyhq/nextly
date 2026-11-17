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
import fs from "node:fs";
import path from "node:path";

import { chromium } from "@playwright/test";

import {
  canvasOf,
  fixtureIds,
  measuredPage,
  openBuilder,
  signIn,
  throttle,
  watchRequests,
} from "./browser.mjs";
import { BUDGETS } from "./budgets.mjs";
import {
  BASE,
  KEYSTROKE_LIMIT_MS,
  ONLY,
  OUT_DIR,
  OWN_SERVER,
  RATE,
  ROOT,
  SAMPLES,
  flag,
  option,
  wanted,
} from "./config.mjs";
import {
  addInsertUndo,
  footerRest,
  labelDrags,
  quickClicks,
  selections,
  sidebarTimes,
  typing,
} from "./editing.mjs";
import { EXPECTED_FAILURES } from "./expected-failures.mjs";
import { judge, percentile, table } from "./report.mjs";
import { startOwnServer } from "./server.mjs";
import { heapGrowth, idleMinute, opens, publishes } from "./session.mjs";

async function measure(log) {
  const browser = await chromium.launch();
  const measured = {};
  const extra = {};
  const keep = (id, samples, note) => {
    measured[id] = { samples, ...(note === undefined ? {} : { note }) };
  };
  try {
    const { page, cdp } = await measuredPage(browser);
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
    /*
     * The page every editing measure runs on must stay the page it was: an
     * edit a measure failed to take back would leave every later measure on
     * a different page. Its blocks are counted before and after the group,
     * and a change fails the group, naming it.
     */
    const blocksOnCanvas = () =>
      canvasOf(page).locator(".nx-canvas [data-nx-node]").count();
    const group = async (ids, title, work, { samePage = false } = {}) => {
      if (!wanted(...ids)) return;
      console.log(`[builder-speed] ${title}`);
      try {
        const before = samePage ? await blocksOnCanvas() : 0;
        await work();
        if (samePage) {
          const after = await blocksOnCanvas();
          if (after !== before)
            throw new Error(
              `the page changed during the measure: ${String(before)} blocks on the canvas before, ${String(after)} after`
            );
        }
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
        // Every measure of the group, including any it already kept: those
        // samples may have been taken on a page that has since changed.
        for (const id of ids)
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
      },
      { samePage: true }
    );
    await group(
      ["quick-clicks-blocking"],
      "four quick clicks",
      async () => {
        keep("quick-clicks-blocking", await quickClicks(page, SAMPLES));
      },
      { samePage: true }
    );
    await group(
      ["add-panel-open", "add-panel-insert", "undo", "insert-hides-regions"],
      "the Add panel, inserts and undo",
      async () => {
        const a = await addInsertUndo(page, watcher, SAMPLES);
        keep("add-panel-open", a.open);
        keep("add-panel-insert", a.insert);
        keep("undo", a.undo);
        keep("insert-hides-regions", a.hidden);
      },
      { samePage: true }
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
      },
      { samePage: true }
    );
    await group(
      ["label-drag-release"],
      "label drags",
      async () => {
        keep("label-drag-release", await labelDrags(page, watcher, SAMPLES));
      },
      { samePage: true }
    );
    await group(
      ["footer-resizes"],
      "the pointer resting on the footer",
      async () => {
        const f = await footerRest(page);
        keep("footer-resizes", [f.value], f.note);
      },
      { samePage: true }
    );
    await group(
      ["publish-request", "publish-saved"],
      "publishing",
      async () => {
        const p = await publishes(page, watcher, large, SAMPLES);
        keep("publish-request", p.request);
        keep("publish-saved", p.saved);
      },
      { samePage: true }
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
  // Before anything is built or started: an `--only` that names no budget
  // would run for minutes and measure nothing.
  const unknown = (ONLY ?? []).filter(id => !BUDGETS.some(b => b.id === id));
  if (unknown.length > 0)
    throw new Error(`--only names no budget: ${unknown.join(", ")}`);
  const dir = OUT_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const log = OWN_SERVER ? path.join(dir, "statements.jsonl") : null;
  let server;
  try {
    if (OWN_SERVER) server = await startOwnServer(log);
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
      server.release();
      console.log(
        `[builder-speed] the server stays up (process group ${String(server.pid)}); measure it again with --base-url ${BASE}, and stop it with: kill -- -${String(server.pid)}`
      );
    } else {
      await server?.stop();
    }
  }
}

await main();
