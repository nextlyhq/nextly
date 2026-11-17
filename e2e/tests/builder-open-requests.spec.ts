/**
 * What the builder asks as it opens: each question once.
 *
 * The page builder's own reads (the collections a list may show, the custom
 * sources, what the author may do, the site style and the pages collection)
 * arrive in one start-up request rather than one request each, each one
 * answered there, and no route is asked twice for the same thing: the open
 * document's "bindings to fix" is read once, and the whole report only when
 * its list is opened.
 *
 * Counted from the moment the builder's address is opened until its canvas
 * draws the page and the reads it started have settled. The document's lock
 * is left out: it is taken and renewed on its own schedule.
 *
 * @module tests/builder-open-requests.spec
 */
import { expect, type Page, type Request } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { canvasBlock } from "./support/canvas-frame";
import { test } from "./support/test";

const PAGES = "/admin/api/collections/pages/entries";
const PLUGIN = "/admin/api/plugins/@nextlyhq/plugin-page-builder";
const LEAD = "00000000-0000-4000-8000-0000000c0001";

/** The reads the start-up request stands in for, by their own routes. */
const IN_THE_START_UP_READ = [
  "/loop-collections",
  "/named-queries",
  "/capability",
  "/site/style",
  "/layouts/page-collection",
];

async function seed(page: Page): Promise<string> {
  const run = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const created = await page.request.post(PAGES, {
    data: {
      title: "Open requests",
      slug: `open-requests-${run}`,
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: LEAD,
            type: "core/heading",
            version: 1,
            props: { text: "A page to open", level: "h2" },
          },
        ],
      },
    },
  });
  expect(
    created.ok(),
    `seeding the page: ${created.status()} ${await created.text()}`
  ).toBe(true);
  return ((await created.json()) as { item: { id: string } }).item.id;
}

/** Every admin API request the page sends from now on, as method and URL. */
function apiRequests(page: Page): string[] {
  const sent: string[] = [];
  page.on("request", (request: Request) => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/admin/api/")) return;
    // The document's lock is taken and renewed on its own schedule, and a
    // development build takes it twice as its effects run twice.
    if (url.pathname.endsWith("/document-lock")) return;
    sent.push(`${request.method()} ${url.pathname}${url.search}`);
  });
  return sent;
}

test("the builder asks each question once as it opens", async ({ page }) => {
  test.setTimeout(120_000);
  const id = await seed(page);
  const sent = apiRequests(page);
  const startup = page.waitForResponse(response =>
    new URL(response.url()).pathname.endsWith("/builder/startup")
  );
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(canvasBlock(page, LEAD)).toBeVisible({ timeout: 60_000 });
  // The reads started as it opened, settled.
  await page.waitForLoadState("networkidle");

  const pluginPaths = sent
    .map(line => line.split(" ")[1] ?? "")
    .filter(url => url.startsWith(`${PLUGIN}/`))
    .map(url => new URL(url, "http://page").pathname.slice(PLUGIN.length));

  // Each read the start-up request named, answered there.
  const answered = (await (await startup).json()) as {
    reads: Record<string, { status: number }>;
  };
  expect(
    Object.keys(answered.reads)
      .map(read => new URL(read, "http://page").pathname)
      .sort()
  ).toEqual([...IN_THE_START_UP_READ].sort());
  for (const [read, answer] of Object.entries(answered.reads)) {
    expect(answer.status, read).toBe(200);
  }

  // One start-up request, standing in for the reads it names.
  expect(pluginPaths.filter(path => path === "/builder/startup")).toHaveLength(
    1
  );
  for (const path of IN_THE_START_UP_READ) {
    expect(pluginPaths, `${path} asked on its own`).not.toContain(path);
  }
  // Each of the plugin's routes asked at most once.
  const twice = pluginPaths.filter(
    (path, at) => pluginPaths.indexOf(path) !== at
  );
  expect(twice, "plugin routes asked more than once").toEqual([]);
  // And no request repeated, for any route.
  const repeated = sent.filter((line, at) => sent.indexOf(line) !== at);
  expect(repeated, "requests sent twice").toEqual([]);
});
