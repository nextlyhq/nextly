/**
 * SPIKE, throwaway: the two canvas-frame risks, driven with real input.
 *
 * Run after `node build.mjs`, one browser per run (BROWSER=chromium|firefox).
 * Playwright's mouse and keyboard go through the browser's own input routing,
 * so hit-testing across the frame, pointer capture and focus are the browser's,
 * not simulated. Each run records a video under the system temp directory.
 */

import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { after, afterEach, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/* global process, window, document */

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../..");
const playwright = createRequire(join(repo, "e2e/package.json"))(
  "@playwright/test"
);
// Read through one alias: the run is configured by the shell, not by turbo.
const env = process.env;
const BROWSER = env.BROWSER ?? "chromium";
const ZOOM = 0.75;
/** Where `build.mjs` writes the bundle. */
const OUT = join(tmpdir(), "canvas-frame-spike", "out");

let server;
let browser;
let context;
let page;
let base;
const errors = [];

before(async () => {
  server = createServer((req, res) => {
    const path = join(OUT, new URL(req.url, "http://x").pathname);
    const type = { ".html": "text/html", ".js": "text/javascript" }[
      extname(path)
    ];
    res.setHeader("content-type", type ?? "application/octet-stream");
    createReadStream(path)
      .on("error", () => res.writeHead(404).end())
      .pipe(res);
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await playwright[BROWSER].launch(
    env.SPIKE_EXECUTABLE ? { executablePath: env.SPIKE_EXECUTABLE } : {}
  );
  context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    recordVideo: {
      dir: join(tmpdir(), "canvas-frame-spike", "videos", BROWSER),
      size: { width: 1280, height: 900 },
    },
  });
  page = await context.newPage();
  page.on("pageerror", e => errors.push(`pageerror: ${e.message}`));
  page.on("console", m => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  await page.goto(`${base}/index.html?zoom=${ZOOM}`);
  await page.waitForFunction(() =>
    window.__spike?.frame()?.contentDocument?.querySelector('[data-nx-node="s11"]')
  );
});

// A failed drag test must not leave the button down for the next one.
afterEach(async () => {
  await page?.mouse.up().catch(() => {});
});

after(async () => {
  await context?.close();
  await browser?.close();
  server?.close();
});

/** Reads from the host page; `fn` gets the frame's document and the spike. */
const inFrame = (fn, arg) =>
  page.evaluate(
    `(${fn.toString()})(window.__spike.frame().contentDocument, window.__spike, ${JSON.stringify(arg ?? null)})`
  );

/** A frame element's centre, or a point in it, in HOST client coordinates. */
function hostPointOf(selector, where = "centre") {
  return inFrame(
    (doc, spike, [sel, at]) => {
      const el = doc.querySelector(sel);
      const r = el.getBoundingClientRect();
      const f = spike.frame().getBoundingClientRect();
      const x = at === "centre" ? r.left + r.width / 2 : r.left + at.x;
      const y = at === "centre" ? r.top + r.height / 2 : r.top + at.y;
      return { x: f.left + x * spike.zoom, y: f.top + y * spike.zoom };
    },
    [selector, where]
  );
}

const frameBox = () => page.getByTestId("frame").boundingBox();
const scrollTop = () => inFrame(doc => doc.scrollingElement.scrollTop);
const setScroll = y =>
  inFrame((doc, _s, v) => (doc.scrollingElement.scrollTop = v), y);
const order = () =>
  page.evaluate(() => window.__spike.document().nodes.map(n => n.id));
const resetLog = () =>
  page.evaluate(() =>
    Object.assign(window.__spike.log, {
      frameMoves: 0,
      hostMoves: 0,
      outsideMoves: 0,
      lastFramePoint: null,
      scrolled: 0,
      ups: [],
      drops: [],
      swallowedClicks: 0,
    })
  );
const spikeLog = () => page.evaluate(() => window.__spike.log);
const MOD = process.platform === "darwin" ? "Meta" : "Control";

void describe(`the frame is a real viewport (${BROWSER})`, () => {
  void it("resolves vw and media queries against the frame, not the admin", async () => {
    const r = await inFrame(doc => ({
      separate: doc !== window.document,
      probe: doc.querySelector('[data-testid="vw-probe"]').getBoundingClientRect()
        .width,
      mq: doc.defaultView.getComputedStyle(
        doc.querySelector('[data-testid="mq-probe"]'),
        "::after"
      ).content,
      innerWidth: doc.defaultView.innerWidth,
      hostWidth: window.innerWidth,
    }));
    assert.equal(r.separate, true);
    assert.equal(r.innerWidth, 800);
    assert.equal(r.hostWidth, 1280);
    assert.equal(r.probe, 400, "50vw is half the FRAME's width");
    assert.equal(r.mq, '"wide"');
  });
});

void describe(`risk 1: Lexical on a frame root, the admin's one copy (${BROWSER})`, () => {
  void it("attaches the admin's editor to a passage inside the frame, caret where pressed", async () => {
    const p = await hostPointOf('[data-body="s1"] p', { x: 120, y: 10 });
    await page.mouse.dblclick(p.x, p.y);
    await page.getByTestId("editing").filter({ hasText: "editing s1" }).waitFor();
    const r = await inFrame(doc => {
      const el = doc.querySelector('[data-body="s1"]');
      const sel = doc.defaultView.getSelection();
      return {
        editable: el.getAttribute("contenteditable"),
        lexical: el.hasAttribute("data-lexical-editor"),
        focused: doc.activeElement === el,
        hostFocus: window.document.activeElement?.tagName,
        inside: sel.rangeCount === 1 && el.contains(sel.anchorNode),
        offset: sel.anchorOffset,
        text: el.textContent,
      };
    });
    assert.equal(r.editable, "true");
    assert.equal(r.lexical, true, "Lexical marked the frame element as its root");
    assert.equal(r.focused, true, "focus is on the passage in the FRAME's document");
    assert.equal(r.hostFocus, "IFRAME");
    assert.equal(r.inside, true, "the frame window's selection is in the passage");
    // "Section 1 passage text": 120 frame px in lands inside the passage, not at the end.
    assert.ok(r.offset > 0 && r.offset < r.text.length, `caret offset ${r.offset}`);
  });

  void it("types, formats, splits and undoes with the keyboard inside the frame", async () => {
    await page.keyboard.press("End");
    await page.keyboard.type(" EDITED");
    await page.keyboard.down("Shift");
    await page.keyboard.press(`${MOD === "Meta" ? "Alt" : "Control"}+ArrowLeft`);
    await page.keyboard.up("Shift");
    await page.keyboard.press(`${MOD}+b`);
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Second line");
    const typed = await inFrame(doc => {
      const el = doc.querySelector('[data-body="s1"]');
      return {
        paragraphs: el.querySelectorAll("p").length,
        text: el.textContent,
        bold: [...el.querySelectorAll("strong, b, .font-bold, [class*='bold']")]
          .map(n => n.textContent)
          .join("|"),
      };
    });
    assert.equal(typed.paragraphs, 2);
    assert.match(typed.text, /Section 1 passage text EDITED/);
    assert.match(typed.text, /Second line/);
    assert.match(typed.bold, /EDITED/, "Ctrl+B made the selected word bold");

    await page.keyboard.press(`${MOD}+z`);
    const undone = await inFrame(
      doc => doc.querySelector('[data-body="s1"]').textContent
    );
    assert.doesNotMatch(undone, /Second line/, "undo works on the frame root");
    await page.keyboard.press(`${MOD}+Shift+z`);
    const redone = await inFrame(
      doc => doc.querySelector('[data-body="s1"]').textContent
    );
    assert.match(redone, /Second line/, "redo works on the frame root");
  });

  void it("commits on blur when focus moves out to the host, through the builder's store", async () => {
    // Any click in the host blurs the frame passage; the hook commits on blur.
    await page.getByTestId("done").click();
    await page.getByTestId("editing").filter({ hasText: "not editing" }).waitFor();
    const stored = await page.evaluate(() =>
      window.__spike.document().nodes.find(n => n.id === "s1").props.body
    );
    const texts = stored.root.children.map(p =>
      p.children.map(t => `${t.text}${t.format & 1 ? "[b]" : ""}`).join("")
    );
    // Bold carries into the new paragraph, as Lexical does for any root.
    assert.deepEqual(texts, ["Section 1 passage text EDITED[b]", "Second line[b]"]);
    const dom = await inFrame(doc => {
      const el = doc.querySelector('[data-body="s1"]');
      return {
        editable: el.getAttribute("contenteditable"),
        lexical: el.hasAttribute("data-lexical-editor"),
        html: el.innerHTML,
      };
    });
    assert.equal(dom.editable, null);
    assert.equal(dom.lexical, false);
    assert.match(dom.html, /<strong>EDITED<\/strong>/);
    assert.match(dom.html, /Second line/);
  });

  void it("Escape inside the frame cancels, restores the passage exactly and writes nothing", async () => {
    const before = await page.evaluate(() =>
      JSON.stringify(window.__spike.document())
    );
    const html = await inFrame(doc => doc.querySelector('[data-body="s2"]').innerHTML);
    const p = await hostPointOf('[data-body="s2"] p', { x: 40, y: 10 });
    await page.mouse.dblclick(p.x, p.y);
    await page.getByTestId("editing").filter({ hasText: "editing s2" }).waitFor();
    await page.keyboard.type("throwaway words");
    const typedIn = await inFrame(doc => doc.querySelector('[data-body="s2"]').textContent);
    assert.match(typedIn, /throwaway words/);
    await page.keyboard.press("Escape");
    await page.getByTestId("editing").filter({ hasText: "not editing" }).waitFor();
    assert.equal(
      await page.evaluate(() => JSON.stringify(window.__spike.document())),
      before
    );
    assert.equal(
      await inFrame(doc => doc.querySelector('[data-body="s2"]').innerHTML),
      html
    );
  });

  void it("raised no page or console errors", () => {
    assert.deepEqual(errors, []);
  });
});

void describe(`risk 2: pointer capture and autoscroll across the frame's edge (${BROWSER})`, () => {
  void it("a block drag keeps its moves above the frame, autoscrolls up, and drops", async () => {
    await setScroll(900);
    await resetLog();
    const startTop = await scrollTop();
    const box = await frameBox();
    const g = await hostPointOf('[data-grip="s7"]');
    await page.mouse.move(g.x, g.y);
    await page.mouse.down();
    await page.mouse.move(g.x, g.y + 12, { steps: 3 });
    // Up past the frame's top edge, into the host's toolbar.
    const above = { x: g.x, y: 40 };
    await page.mouse.move(above.x, above.y, { steps: 10 });
    await page.waitForTimeout(700);
    const mid = await spikeLog();
    assert.ok(mid.outsideMoves > 0, "moves arrive while the pointer is outside the frame");
    const expectY = (above.y - box.y) / ZOOM;
    assert.ok(
      Math.abs(mid.lastFramePoint.y - expectY) <= 1.5,
      `frame-space Y ${mid.lastFramePoint.y} should be ${expectY}`
    );
    assert.ok(mid.scrolled < 0, `autoscroll moved up (${mid.scrolled}px)`);
    assert.ok((await scrollTop()) < startTop);
    assert.equal(await page.getByTestId("indicator").count(), 1);
    // Back in, release over the top of the page.
    await setScroll(0);
    const target = await hostPointOf('[data-nx-node="s1"]', { x: 50, y: 5 });
    await page.mouse.move(target.x, target.y, { steps: 10 });
    await page.mouse.up();
    const done = await spikeLog();
    assert.deepEqual(done.ups.map(u => u.source), ["frame"]);
    assert.deepEqual(done.drops, ["move s7 -> 1"]);
    assert.deepEqual((await order()).slice(0, 3), ["s0", "s7", "s1"]);
    assert.equal(await page.getByTestId("indicator").count(), 0);
  });

  void it("released over the host below the frame, the frame still gets the release, after scrolling down", async () => {
    await setScroll(0);
    await resetLog();
    const box = await frameBox();
    const g = await hostPointOf('[data-grip="s2"]');
    await page.mouse.move(g.x, g.y);
    await page.mouse.down();
    await page.mouse.move(g.x, g.y + 12, { steps: 3 });
    const below = { x: g.x, y: 860 }; // the host's status bar
    assert.ok(below.y > box.y + box.height);
    await page.mouse.move(below.x, below.y, { steps: 10 });
    await page.waitForTimeout(700);
    const mid = await spikeLog();
    assert.ok(mid.scrolled > 0, `autoscroll moved down (${mid.scrolled}px)`);
    const expectY = (below.y - box.y) / ZOOM;
    assert.ok(Math.abs(mid.lastFramePoint.y - expectY) <= 1.5);
    await page.mouse.up();
    const done = await spikeLog();
    assert.deepEqual(done.ups.map(u => u.source), ["frame"], "no stuck drag");
    assert.equal(done.drops.length, 1);
    assert.match(done.drops[0], /^move s2 -> \d+$/);
    // Nothing follows the pointer after the release.
    const moves = done.frameMoves;
    const inside = await hostPointOf('[data-nx-node="s5"]');
    await page.mouse.move(inside.x, inside.y, { steps: 5 });
    assert.equal((await spikeLog()).frameMoves, moves);
    assert.equal(await page.getByTestId("indicator").count(), 0);
  });

  void it("left past the frame's side, moves continue with no autoscroll; Escape in the frame cancels", async () => {
    await setScroll(0);
    await resetLog();
    const before = await order();
    const box = await frameBox();
    const g = await hostPointOf('[data-grip="s1"]');
    await page.mouse.move(g.x, g.y);
    await page.mouse.down();
    await page.mouse.move(g.x, g.y + 12, { steps: 3 });
    await page.mouse.move(100, g.y + 12, { steps: 10 }); // over the palette
    await page.waitForTimeout(300);
    const mid = await spikeLog();
    assert.ok(mid.lastFramePoint.x < 0);
    assert.ok(Math.abs(mid.lastFramePoint.x - (100 - box.x) / ZOOM) <= 1.5);
    assert.equal(mid.scrolled, 0);
    // Focus is still in the frame from the last edit, so its keydown listener
    // hears Escape: key events in the frame never reach the host.
    assert.equal(await page.evaluate(() => document.activeElement?.tagName), "IFRAME");
    await page.keyboard.press("Escape");
    assert.equal(await page.getByTestId("indicator").count(), 0);
    await page.mouse.up();
    const done = await spikeLog();
    assert.deepEqual(done.drops, [], "cancelled: nothing dropped");
    assert.deepEqual(done.ups, [], "listeners were gone before the release");
    assert.deepEqual(await order(), before);
  });

  void it("a palette drag from the host crosses into the frame, autoscrolls, and inserts", async () => {
    await setScroll(0);
    await resetLog();
    const before = (await order()).length;
    const pal = await page.getByTestId("palette").boundingBox();
    await page.mouse.move(pal.x + 20, pal.y + 10);
    await page.mouse.down();
    await page.mouse.move(pal.x + 60, pal.y + 30, { steps: 5 });
    const host = await spikeLog();
    assert.ok(host.hostMoves > 0, "the host document follows it outside the frame");
    // Into the frame, low enough to sit in the bottom autoscroll band.
    const box = await frameBox();
    const low = { x: box.x + 200, y: box.y + box.height - 10 };
    await page.mouse.move(low.x, low.y, { steps: 12 });
    await page.waitForTimeout(600);
    const mid = await spikeLog();
    assert.ok(mid.frameMoves > 0, "the frame document takes over over the frame");
    assert.ok(mid.scrolled > 0, `autoscroll from a host drag (${mid.scrolled}px)`);
    // The host-drawn indicator lines up with a gap in the frame (geometry.ts mapping).
    const ind = await page.getByTestId("indicator").boundingBox();
    assert.ok(ind, "indicator drawn in the host");
    // Settle in the middle of the frame, where nothing scrolls.
    await page.mouse.move(box.x + 200, box.y + box.height / 2, { steps: 5 });
    await page.waitForTimeout(200);
    const settled = await page.getByTestId("indicator").boundingBox();
    // The host-drawn line sits on a real gap between frame blocks: mapped back
    // into frame space it lands on some block's top edge (geometry.ts mapping).
    const gapY = (settled.y + 1 - box.y) / ZOOM;
    const tops = await inFrame(doc =>
      [...doc.querySelectorAll("[data-nx-node]")].map(
        n => n.getBoundingClientRect().top
      )
    );
    assert.ok(
      tops.some(t => Math.abs(t - gapY) <= 1.5),
      `indicator maps to frame y ${gapY}; block tops ${tops.join(",")}`
    );
    assert.ok(settled.y >= box.y && settled.y <= box.y + box.height);
    await page.mouse.up();
    const done = await spikeLog();
    assert.deepEqual(done.ups.map(u => u.source), ["frame"]);
    assert.match(done.drops[0], /^insert s\d+ -> \d+$/);
    assert.equal((await order()).length, before + 1);
  });

  void it("a palette drag released back over the host inserts nothing", async () => {
    await resetLog();
    const before = (await order()).length;
    const pal = await page.getByTestId("palette").boundingBox();
    const box = await frameBox();
    await page.mouse.move(pal.x + 20, pal.y + 10);
    await page.mouse.down();
    await page.mouse.move(box.x + 100, box.y + 100, { steps: 10 });
    await page.mouse.move(pal.x + 20, pal.y + 200, { steps: 10 });
    await page.mouse.up();
    const done = await spikeLog();
    assert.deepEqual(done.ups.map(u => u.source), ["host"]);
    assert.deepEqual(done.drops, ["insert cancelled (released outside the frame)"]);
    assert.equal((await order()).length, before);
  });

  void it("raised no page or console errors", () => {
    assert.deepEqual(errors, []);
  });
});
