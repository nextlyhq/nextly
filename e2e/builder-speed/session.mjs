/**
 * The measures around an editing session: publishing, opening the builder on
 * a slow network, an idle minute, and heap growth.
 *
 * @module builder-speed/session
 */

import {
  canvasOf,
  commitsOf,
  heapUsed,
  roundsOf,
  selectAndWait,
  sentBetween,
  slowNetwork,
  textOf,
  visible,
} from "./browser.mjs";
import {
  BASE,
  HEADING,
  HEAP_INSERTS,
  HEAP_SELECTIONS,
  IDLE_MS,
  LATENCY_MS,
  LEAD,
  SHOW_LIMIT_MS,
  sleep,
} from "./config.mjs";
import {
  addButton,
  caretAtEnd,
  closeAddPanel,
  insertHeadingAndUndo,
} from "./editing.mjs";

/**
 * Makes one text edit, lets the editor's own autosave settle, then presses
 * Save (which publishes a published page's changes), `count` times. Times the
 * click to the save request's send, and to the editor saying it is saved.
 */
export async function publishes(page, watcher, id, count) {
  const base = (await textOf(page, HEADING)).replace(/!$/, "");
  await selectAndWait(page, HEADING, await textOf(page, HEADING));
  const out = { request: [], saved: [] };
  for (let i = 0; i < count; i++) {
    const current = await textOf(page, HEADING);
    const expected = current.endsWith("!") ? base : `${base}!`;
    await caretAtEnd(page);
    if (expected === base) await page.keyboard.press("Backspace");
    else await page.keyboard.type("!");
    await page.keyboard.press("Tab");
    // The id travels as an argument: the callback runs in the browser, where
    // this module's constants don't exist.
    await page.waitForFunction(
      ({ id, text }) => window.__builderSpeedChecks.canvasText({ id, text }),
      { id: HEADING, text: expected },
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
export async function opens(page, cdp, watcher, id, count) {
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
    const link = page.getByRole("link", { name: "Open in builder" });
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

/** A minute with the builder open and untouched: requests and React commits. */
export async function idleMinute(page, watcher) {
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

/** Heap growth from the 100th to the 200th selection, and over 50 inserts. */
export async function heapGrowth(page, cdp, watcher) {
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
    await insertHeadingAndUndo(page, base);
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
