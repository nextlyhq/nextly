/**
 * The measures an author's editing makes: selecting, quick clicks, the Add
 * panel with its inserts and undo, typing, dragging a label, and resting the
 * pointer on the footer.
 *
 * @module builder-speed/editing
 */

import {
  blockingBetween,
  canvasNode,
  canvasOf,
  select,
  selectAndWait,
  sentBetween,
  textOf,
  visible,
  visibleAll,
} from "./browser.mjs";
import {
  FOOTER_REST_MS,
  HEADING,
  KEYSTROKE_LIMIT_MS,
  LEAD,
  QUICK,
  SHOW_LIMIT_MS,
  sleep,
} from "./config.mjs";
import { statementsBetween } from "./server.mjs";

/**
 * Alternates selecting the heading and the lead, `count` times, and times
 * each selection: the sidebar, the outline, and the requests and statements
 * it set off. Lock renewals run on a timer whatever the author does, so they
 * are not counted against a selection.
 */
export async function selections(page, watcher, count, log) {
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
    // after its result showed, read once that window has passed.
    const clicked = sample.start ?? Date.now();
    const shown = Math.max(clicked, ...sample.ends.filter(e => e !== null));
    const now = await page.evaluate(
      () => performance.timeOrigin + performance.now()
    );
    if (shown + 1500 > now) await sleep(shown + 1500 - now);
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
export async function sidebarTimes(page, watcher, count) {
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

/**
 * Four clicks on four blocks, each 100 ms after the page took the last; the
 * main thread's long tasks are summed from the first click until the last
 * block is shown and a second passes with no long task. Each click lands
 * away from the selected block's toolbar, which floats over the block above.
 */
export async function quickClicks(page, count) {
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
    // Until a second passes with no new long task, for at most a minute: a
    // page that never falls quiet is no reading.
    let seen = -1;
    let settled = false;
    const settleBy = Date.now() + SHOW_LIMIT_MS;
    while (Date.now() < settleBy) {
      await sleep(1000);
      const n = await page.evaluate(
        () => window.__builderSpeed.longTasks.length
      );
      if (n === seen) {
        settled = true;
        break;
      }
      seen = n;
    }
    const to = await page.evaluate(
      () => performance.timeOrigin + performance.now()
    );
    // Clicks that never selected the last block, or a page that never fell
    // quiet, measured nothing.
    totals.push(
      landed && settled ? await blockingBetween(page, from, to) : null
    );
  }
  return totals;
}

export const addButton = page =>
  page
    .getByRole("navigation", { name: "Editor panels" })
    .getByRole("button", { name: "Add", exact: true });

/**
 * With the Add panel open on a page of `base` blocks, inserts a Heading and
 * undoes it, waiting each time until the canvas draws the new count.
 */
export async function insertHeadingAndUndo(page, base) {
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

export async function closeAddPanel(page) {
  if ((await addButton(page).getAttribute("aria-pressed")) === "true") {
    await addButton(page).click();
    await page
      .getByRole("combobox", { name: "Insert a block" })
      .waitFor({ state: "detached", timeout: SHOW_LIMIT_MS });
  }
}

/**
 * Starts counting the header and footer elements an action hides: in every
 * animation frame from now, how many of the elements the regions drew before
 * (with a size) are gone from the page or drawn with no size. The most in any
 * one frame is the count, so an element that blinks out and back is counted
 * once, and one taken away and drawn again as a new element counts too.
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
    const regions = [...doc.querySelectorAll("[data-nx-region]")];
    const areas = new Set(regions.map(r => r.getAttribute("data-nx-region")));
    // Both regions, or the count below would read none for want of anything
    // to watch.
    if (!areas.has("header") || !areas.has("footer"))
      throw new Error("the canvas draws no header or no footer to watch");
    const drawn = regions
      .flatMap(region => [region, ...region.querySelectorAll("*")])
      .filter(element => !empty(element));
    const frame = () => {
      if (watch.stop) return;
      let hidden = 0;
      for (const element of drawn)
        if (!element.isConnected || empty(element)) hidden += 1;
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
export async function addInsertUndo(page, watcher, count) {
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

/**
 * The heading's text field in the sidebar's Content tab: a plain text input,
 * the kind of field that writes as it is typed. The lead is a Text, whose
 * words are edited in a rich field (bold, italic, links), so typing is timed
 * on the heading.
 */
function headingField(page) {
  return page
    .getByTestId("inspector")
    .locator('[data-content-control="text"] input')
    .first();
}

/**
 * Focuses the heading's text field with the caret after its last character. Set
 * directly: End moves only to the end of the wrapped line the caret is on.
 */
export async function caretAtEnd(page) {
  const field = headingField(page);
  await field.click();
  const focused = await field.evaluate(element => {
    element.setSelectionRange(element.value.length, element.value.length);
    return element.ownerDocument.activeElement === element;
  });
  // A key pressed anywhere else could edit the page itself (Backspace on a
  // selected block deletes it), and every later measure would run on a
  // different page.
  if (!focused) throw new Error("the heading's text field did not take focus");
}

/**
 * Types one character into the heading's text field, or deletes the one the
 * last sample typed, and times how long until the canvas shows it; then
 * leaves the field with Tab and times the canvas again. Alternating keeps the
 * page the same size from sample to sample.
 */
export async function typing(page, watcher, count) {
  const base = await textOf(page, HEADING);
  await selectAndWait(page, HEADING, base);
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
        args: { id: HEADING, text: expected },
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
        args: { id: HEADING, text: expected },
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
export async function labelDrags(page, watcher, count) {
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
export async function footerRest(page) {
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
