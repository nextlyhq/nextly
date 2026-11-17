/**
 * The long editing session: half an hour of an author's ordinary editing on
 * the 150-block page, on a production build, recording the main thread's long
 * tasks and the heap as it goes, and failing when any task runs longer than
 * a second after the first minute, or the editor loses its document lock.
 *
 *   node e2e/builder-speed/long-session.mjs [--build] [--minutes 30]
 *                                           [--rate 4] [--json out.json]
 *   node e2e/builder-speed/long-session.mjs --base-url https://… [--rate 1]
 *
 * The server, the fixture, the sign-in and `--rate` are the speed check's
 * own (`measure.mjs` describes them). `--minutes` sets how long the editing
 * runs, 30 by default; a shorter run is for trying the session out, and only
 * the full one says whether the builder stays responsive for half an hour.
 *
 * ## What one round of editing is
 *
 * Two selections, a round trip from the sidebar's Content tab to its Style
 * tab and back, a text edit taken back again, an insert from the Add panel
 * and its undo, and the pointer swept over the blocks in view. Every edit is
 * taken back, so the page is the same page at the end as at the start, and
 * the session checks that it is.
 *
 * ## What it records
 *
 * - **Long tasks** from every frame, merged (`long-session-report.mjs`), read
 *   out of the page as it goes so the page does not hold them all.
 * - **Heap**, once a minute, after a forced garbage collection, with the DOM
 *   nodes and event listeners Chromium counts. The task that runs those
 *   collections is the check's own, and is left out of the long tasks.
 * - **Selection time**, the median of 10 selections, at the start and at the
 *   end.
 * - **The document lock**: what the editor's lock notice says, if it shows
 *   one, on every reading. A notice offering to take the document back means
 *   the lock was lost.
 *
 * Results go to `--json` (`e2e/.playwright/builder-speed/long-session.json`).
 *
 * @module builder-speed/long-session
 */
import fs from "node:fs";
import path from "node:path";

import { chromium } from "@playwright/test";

import {
  canvasOf,
  fixtureIds,
  heapUsed,
  measuredPage,
  openBuilder,
  selectAndWait,
  signIn,
  textOf,
  throttle,
  watchRequests,
} from "./browser.mjs";
import {
  BASE,
  HEADING,
  LEAD,
  OUT_DIR,
  OWN_SERVER,
  RATE,
  ROOT,
  SHOW_LIMIT_MS,
  option,
  sleep,
} from "./config.mjs";
import {
  addButton,
  caretAtEnd,
  closeAddPanel,
  insertHeadingAndUndo,
  sidebarTimes,
} from "./editing.mjs";
import {
  heapGrowth,
  judgeLongTasks,
  mergeLongTasks,
  readingsAt,
} from "./long-session-report.mjs";
import { percentile } from "./report.mjs";
import { startOwnServer } from "./server.mjs";

const MINUTES = Number(option("minutes") ?? 30);
/** How often the heap, the DOM and the lock are read. */
const READ_EVERY_MS = 60_000;
/** Blocks the pointer passes over in one sweep, 100 ms apart. */
const SWEEP_BLOCKS = 15;

/** The page's own clock, which the long tasks are timed on. */
const pageNow = page =>
  page.evaluate(() => performance.timeOrigin + performance.now());

/** The long tasks every frame has seen since the last call, taken out. */
async function drainLongTasks(page) {
  const lists = [];
  for (const frame of page.frames()) {
    const tasks = await frame
      .evaluate(() => window.__builderSpeed?.longTasks.splice(0) ?? [])
      .catch(() => []);
    lists.push(tasks);
  }
  return lists;
}

/** What the editor's lock notice says, or null when it shows none. */
async function lockNotice(page) {
  const banner = page.getByTestId("document-lock-banner");
  if ((await banner.count()) === 0) return null;
  return {
    text: (await banner.first().innerText()).trim(),
    takeBack:
      (await banner
        .first()
        .getByRole("button", { name: /take it back|continue editing here/i })
        .count()) > 0,
  };
}

/** One round of editing, as the module's header lists it. */
async function editingRound(page, watcher, texts) {
  await selectAndWait(page, HEADING, texts[HEADING]);
  await selectAndWait(page, LEAD, texts[LEAD]);

  // The sidebar's Style tab and back to Content.
  const inspector = page.getByTestId("inspector");
  await inspector.getByRole("tab", { name: "Style" }).click();
  await inspector
    .getByRole("tab", { name: "Style", selected: true })
    .waitFor({ timeout: SHOW_LIMIT_MS });
  await inspector.getByRole("tab", { name: "Content" }).click();
  await inspector
    .getByRole("tab", { name: "Content", selected: true })
    .waitFor({ timeout: SHOW_LIMIT_MS });

  // A text edit, then the same edit taken back.
  for (const [key, expected] of [
    ["!", `${texts[LEAD]}!`],
    ["Backspace", texts[LEAD]],
  ]) {
    await caretAtEnd(page);
    if (key === "!") await page.keyboard.type("!");
    else await page.keyboard.press(key);
    await page.keyboard.press("Tab");
    await page.waitForFunction(
      text =>
        window.__builderSpeedChecks.canvasText({
          id: "speed-hero-lead",
          text,
        }),
      expected,
      { timeout: SHOW_LIMIT_MS, polling: 100 }
    );
  }

  // An insert from the Add panel, and its undo.
  await selectAndWait(page, HEADING, texts[HEADING]);
  const blocks = canvasOf(page).locator(".nx-canvas [data-nx-node]");
  const base = await blocks.count();
  await addButton(page).click();
  await page
    .getByRole("combobox", { name: "Insert a block" })
    .waitFor({ timeout: SHOW_LIMIT_MS });
  await insertHeadingAndUndo(page, base);
  await closeAddPanel(page);

  // The pointer over the blocks in view, as an author's does on its way.
  const count = Math.min(SWEEP_BLOCKS, await blocks.count());
  for (let i = 0; i < count; i++) {
    const box = await blocks.nth(i).boundingBox();
    if (box === null || box.y < 0 || box.y > 900) continue;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await sleep(100);
  }
  await page.mouse.move(5, 5);
  await watcher.quiet();
}

/** The median of 10 selections between the heading and the lead. */
async function selectionTime(page, watcher) {
  return percentile(await sidebarTimes(page, watcher, 10), 50);
}

async function session() {
  const browser = await chromium.launch();
  const tasks = [];
  const paused = [];
  const samples = [];
  let rounds = 0;
  try {
    const { page, cdp } = await measuredPage(browser);
    const watcher = watchRequests(page);
    await signIn(page);
    const ids = await fixtureIds(page);

    await throttle(cdp, RATE);
    await openBuilder(page, ids.large);
    await watcher.quiet();
    const texts = {
      [HEADING]: await textOf(page, HEADING),
      [LEAD]: await textOf(page, LEAD),
    };
    const blocksAtStart = await canvasOf(page)
      .locator(".nx-canvas [data-nx-node]")
      .count();
    const selectionAtStart = await selectionTime(page, watcher);
    console.log(
      `[long-session] selection at the start: ${String(selectionAtStart)} ms`
    );

    /** Heap, DOM, lock, and the long tasks so far, as one reading. */
    const read = async startedAt => {
      tasks.push(...mergeLongTasks(await drainLongTasks(page)));
      const from = await pageNow(page);
      const heapBytes = await heapUsed(cdp);
      const dom = await cdp.send("Memory.getDOMCounters");
      const to = await pageNow(page);
      paused.push({ from, to });
      const sample = {
        minute: Number(((to - startedAt) / 60_000).toFixed(2)),
        rounds,
        heapBytes,
        nodes: dom.nodes,
        listeners: dom.jsEventListeners,
        lock: await lockNotice(page),
      };
      samples.push(sample);
      console.log(
        `[long-session] ${sample.minute.toFixed(1)} min: ${String(rounds)} rounds, heap ${(heapBytes / 1e6).toFixed(1)} MB, ${String(dom.nodes)} nodes, ${String(dom.jsEventListeners)} listeners${sample.lock ? `, lock notice: ${sample.lock.text}` : ""}`
      );
      return sample;
    };

    // Long tasks before this point are the opening and the first timing,
    // which the speed check measures; the session starts here.
    await drainLongTasks(page);
    const startedAt = await pageNow(page);
    const endsAt = startedAt + MINUTES * 60_000;
    await read(startedAt);
    let nextRead = startedAt + READ_EVERY_MS;
    for (;;) {
      const now = await pageNow(page);
      if (now >= endsAt) break;
      if (now >= nextRead) {
        await read(startedAt);
        nextRead += READ_EVERY_MS;
      }
      await editingRound(page, watcher, texts);
      rounds += 1;
    }
    const selectionAtEnd = await selectionTime(page, watcher);
    console.log(
      `[long-session] selection at the end: ${String(selectionAtEnd)} ms`
    );
    const last = await read(startedAt);
    const endedAt = await pageNow(page);

    const blocksAtEnd = await canvasOf(page)
      .locator(".nx-canvas [data-nx-node]")
      .count();
    if (blocksAtEnd !== blocksAtStart)
      throw new Error(
        `the page changed during the session: ${String(blocksAtStart)} blocks on the canvas at the start, ${String(blocksAtEnd)} at the end`
      );
    return {
      startedAt,
      endedAt,
      tasks,
      paused,
      samples,
      rounds,
      selectionAtStart,
      selectionAtEnd,
      lockAtEnd: last.lock,
    };
  } catch (error) {
    // What the page showed, beside the results, for whoever reads why.
    const page = browser.contexts()[0]?.pages()[0];
    await page
      ?.screenshot({ path: path.join(OUT_DIR, "long-session-failed.png") })
      .catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }
}

async function main() {
  if (!Number.isFinite(MINUTES) || MINUTES <= 0)
    throw new Error(
      `--minutes must be a positive number, not ${String(MINUTES)}`
    );
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let server;
  try {
    if (OWN_SERVER) server = await startOwnServer();
    const s = await session();
    const verdict = judgeLongTasks(s.tasks, s);
    const lockLost = s.samples.find(sample => sample.lock?.takeBack);
    const out = {
      base: BASE,
      rate: RATE,
      minutes: MINUTES,
      rounds: s.rounds,
      longTasks: {
        limitMs: 1000,
        afterFirstMinute: verdict,
        all: s.tasks.map(task => ({
          atSecond: Number(((task.start - s.startedAt) / 1000).toFixed(1)),
          ms: Math.round(task.duration),
        })),
      },
      selectionMs: { start: s.selectionAtStart, end: s.selectionAtEnd },
      heap: {
        growthFromMinuteOnePercent: heapGrowth(s.samples),
        at: readingsAt(s.samples, [1, 10, 20, 30]),
        samples: s.samples,
      },
      lock: { lost: lockLost !== undefined, atEnd: s.lockAtEnd },
    };
    const json = option("json") ?? path.join(OUT_DIR, "long-session.json");
    fs.writeFileSync(json, `${JSON.stringify(out, null, 2)}\n`);
    console.log(
      `\n[long-session] ${BASE}, processor slowed ${String(RATE)}×, ${String(MINUTES)} min, ${String(s.rounds)} rounds\n` +
        `- long tasks after the first minute: ${String(verdict.counted)}, the longest ${String(verdict.longestMs)} ms, ${String(verdict.over.length)} over 1000 ms\n` +
        `- selection: ${String(s.selectionAtStart)} ms at the start, ${String(s.selectionAtEnd)} ms at the end\n` +
        `- heap from the first minute to the end: ${String(out.heap.growthFromMinuteOnePercent)}%\n` +
        `- results written to ${path.relative(ROOT, json)}`
    );
    const problems = [
      ...verdict.over.map(
        task =>
          `a main-thread task of ${String(task.ms)} ms at ${String(task.atSecond)} s (limit 1000 ms after the first minute)`
      ),
      ...(lockLost
        ? [
            `the editor lost its document lock at ${lockLost.minute.toFixed(1)} min: "${lockLost.lock.text}"`,
          ]
        : []),
    ];
    if (problems.length > 0) {
      console.error(
        `\n[long-session] ${String(problems.length)} problem(s):\n- ${problems.join("\n- ")}`
      );
      process.exitCode = 1;
    }
  } finally {
    await server?.stop();
  }
}

await main();
