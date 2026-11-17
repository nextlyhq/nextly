/**
 * What saving and publishing from the builder asks of the server: one write,
 * at most one read of the entry afterwards, and no media reads, with the
 * canvas left as drawn when the read matches what is on screen. And what it
 * does before sending: no walk of the whole document, since each edit was
 * judged as it was made and the save route judges what it stores.
 *
 * Counted from the press of the top bar's primary button until the editor
 * says the page is saved and the requests it started have settled. The
 * document's lock and the autosave of the working copy are left out: both run
 * on their own schedule, not because of the press.
 *
 * Black box like the rest of `e2e/`: no product code is imported.
 *
 * @module tests/builder-publish-requests.spec
 */
import {
  expect,
  type CDPSession,
  type Page,
  type Request,
} from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { canvasBlock, canvasFrame } from "./support/canvas-frame";
import { uploadImage } from "./support/media-upload";
import { test } from "./support/test";

const PAGES = "/admin/api/collections/pages/entries";
const LEAD = "00000000-0000-4000-8000-0000000c0101";
const IMAGE = "00000000-0000-4000-8000-0000000c0102";

/** A page with a heading and an image, published or a draft. */
async function seed(
  page: Page,
  status: "published" | "draft"
): Promise<{ id: string; imageFile: string }> {
  const run = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const media = await uploadImage(page.request, run);
  const created = await page.request.post(PAGES, {
    data: {
      title: `Publish requests ${run}`,
      slug: `publish-requests-${run}`,
      status,
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: LEAD,
            type: "core/heading",
            version: 1,
            props: { text: "A page to publish", level: "h2" },
          },
          {
            id: IMAGE,
            type: "core/image",
            version: 1,
            props: { mediaId: media.id, alt: "A swatch" },
          },
        ],
      },
    },
  });
  expect(
    created.ok(),
    `seeding the page: ${created.status()} ${await created.text()}`
  ).toBe(true);
  return {
    id: ((await created.json()) as { item: { id: string } }).item.id,
    imageFile: new URL(media.url, "http://localhost").pathname,
  };
}

/**
 * Every admin API request the page sends once `start` is called, and every
 * fetch of the image's file.
 */
function apiRequests(
  page: Page,
  imageFile: string
): { sent: string[]; imageFetches: string[]; start: () => void } {
  const sent: string[] = [];
  const imageFetches: string[] = [];
  let counting = false;
  page.on("request", (request: Request) => {
    if (!counting) return;
    const url = new URL(request.url());
    if (url.pathname === imageFile) imageFetches.push(url.href);
    if (!url.pathname.startsWith("/admin/api/")) return;
    // Taken and renewed on its own schedule.
    if (url.pathname.endsWith("/document-lock")) return;
    // The working copy's autosave runs a pause after an edit, not on a press.
    if (url.pathname.endsWith("/versions/autosave")) return;
    sent.push(`${request.method()} ${url.pathname}${url.search}`);
  });
  return {
    sent,
    imageFetches,
    start: () => {
      counting = true;
    },
  };
}

/**
 * Resolves once no admin API request has started for a second and none
 * started in the last twenty seconds is still open. Not `networkidle`: a
 * development server holds its reload poll open for seconds at a time, so the
 * page may never go a moment without a request; and a request held open for
 * longer than any answer takes is a stream, not a read still on its way. The
 * poll and the document's lock are left out, as the count leaves them.
 */
function settling(page: Page): () => Promise<void> {
  const inFlight = new Map<Request, number>();
  let lastStart = Date.now();
  const counts = (request: Request) => {
    const path = new URL(request.url()).pathname;
    return (
      path.startsWith("/admin/api/") &&
      !path.endsWith("/dev-reload") &&
      !path.endsWith("/document-lock")
    );
  };
  page.on("request", request => {
    if (!counts(request)) return;
    lastStart = Date.now();
    inFlight.set(request, lastStart);
  });
  const done = (request: Request) => inFlight.delete(request);
  page.on("requestfinished", done);
  page.on("requestfailed", done);
  return () =>
    expect
      .poll(
        () => {
          const now = Date.now();
          const open = [...inFlight.values()].filter(at => now - at < 20_000);
          return open.length === 0 && now - lastStart > 1_000;
        },
        {
          timeout: 60_000,
          intervals: [250],
        }
      )
      .toBe(true);
}

/**
 * How many times the engine's whole-document survey ran since the last ask,
 * read from the browser's own call counts. Asking resets them. The survey
 * keeps its name only in a development build, which is where this suite runs.
 */
async function surveysSince(cdp: CDPSession): Promise<number> {
  const { result } = (await cdp.send("Profiler.takePreciseCoverage")) as {
    result: {
      functions: { functionName: string; ranges: { count: number }[] }[];
    }[];
  };
  let count = 0;
  for (const script of result) {
    for (const fn of script.functions) {
      if (fn.functionName === "surveyDocument") {
        count += fn.ranges[0]?.count ?? 0;
      }
    }
  }
  return count;
}

/** Change the lead's text through the sidebar, and leave the field. */
async function editLead(page: Page, text: string): Promise<void> {
  await canvasBlock(page, LEAD).click();
  const field = page
    .getByRole("complementary", { name: "Inspector" })
    .getByRole("textbox", { name: "Text" });
  await field.fill(text);
  await page.keyboard.press("Tab");
  await expect(canvasBlock(page, LEAD)).toHaveText(text);
}

/**
 * Counts the elements the canvas adds or removes from now on: a canvas drawn
 * again from a read of the entry replaces its blocks, and an image replaced
 * loads again.
 */
async function watchCanvas(page: Page): Promise<() => Promise<number>> {
  const handle = await canvasFrame(page).locator(".nx-canvas").elementHandle();
  if (handle === null) throw new Error("[e2e] the canvas is not drawn");
  await handle.evaluate(canvas => {
    const seen = { changed: 0 };
    (window as unknown as { __canvasChanges: typeof seen }).__canvasChanges =
      seen;
    new MutationObserver(records => {
      for (const record of records) {
        seen.changed += record.addedNodes.length + record.removedNodes.length;
      }
    }).observe(canvas, { childList: true, subtree: true });
  });
  return () =>
    handle.evaluate(
      () =>
        (window as unknown as { __canvasChanges: { changed: number } })
          .__canvasChanges.changed
    );
}

/** One of the top bar's actions, by what it does. */
const barAction = (page: Page, action: "save" | "publish") =>
  page.locator(`[data-topbar="end"] [data-action="${action}"]`);

/** The editor says the page is saved and has nothing left to save. */
async function expectSaved(
  page: Page,
  status: "published" | "draft"
): Promise<void> {
  await expect(barAction(page, "save")).toHaveText("Saved", {
    timeout: 30_000,
  });
  await expect(barAction(page, "save")).toBeDisabled();
  if (status === "published") {
    await expect(barAction(page, "publish")).toHaveText("Published");
  }
}

/** Publishing a published page's change, and saving a draft's. */
for (const status of ["published", "draft"] as const) {
  const verb = status === "published" ? "publishing" : "saving";
  test(`${verb} a ${status} page writes once and reads the entry at most once`, async ({
    page,
  }) => {
    // The first case compiles the builder on a cold development server.
    test.setTimeout(240_000);
    await gotoAdmin(page, "/");
    const { id, imageFile } = await seed(page, status);
    const { sent, imageFetches, start } = apiRequests(page, imageFile);
    const settled = settling(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.startPreciseCoverage", {
      callCount: true,
      detailed: false,
    });
    await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
    await expect(canvasBlock(page, LEAD)).toBeVisible({ timeout: 60_000 });
    // The picture is the block's own root, or inside it.
    await expect(
      canvasFrame(page)
        .locator(`img[data-nx-node="${IMAGE}"], [data-nx-node="${IMAGE}"] img`)
        .first()
    ).toBeVisible();
    await settled();

    await editLead(page, "A page published once");
    await settled();
    const changes = await watchCanvas(page);
    await surveysSince(cdp);
    // Read as the write leaves: what the press did before sending it.
    let beforeSending: Promise<number> | undefined;
    page.on("request", request => {
      if (
        beforeSending === undefined &&
        request.method() === "PATCH" &&
        new URL(request.url()).pathname === `${PAGES}/${id}`
      ) {
        beforeSending = surveysSince(cdp);
      }
    });
    start();
    await barAction(page, status === "published" ? "publish" : "save").click();
    await expectSaved(page, status);
    await settled();

    const entryPath = `${PAGES}/${id}`;
    const onEntry = (method: string) =>
      sent.filter(line => {
        const [m, url = ""] = line.split(" ");
        return m === method && url.split("?")[0] === entryPath;
      });
    expect(
      onEntry("PATCH"),
      `writes of the entry, in ${JSON.stringify(sent)}`
    ).toHaveLength(1);
    expect(
      onEntry("GET").length,
      `reads of the entry after the write, in ${JSON.stringify(sent)}`
    ).toBeLessThanOrEqual(1);
    const media = sent.filter(line =>
      (line.split(" ")[1] ?? "").startsWith("/admin/api/media")
    );
    expect(media, "media reads").toEqual([]);
    expect(imageFetches, "the image fetched again").toEqual([]);
    // No whole-document check between the press and the write: the editor
    // judged each edit as it was made, and the save route judges what enters.
    expect(beforeSending, "the write was seen leaving").toBeDefined();
    expect(await beforeSending, "whole-document surveys before sending").toBe(
      0
    );
    // The control: the counter sees the survey the save's own move of the
    // stored copy runs, so a count of none is not a counter seeing nothing.
    expect(await surveysSince(cdp), "surveys after the write").toBeGreaterThan(
      0
    );
    // The read matches what is shown: the canvas keeps its drawn blocks.
    expect(await changes(), "canvas elements replaced").toBe(0);
  });
}
