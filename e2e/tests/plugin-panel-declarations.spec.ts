/**
 * A standalone plugin's panel, as the plugin declares it, in a browser: the
 * style fixture (apps/playground/src/plugins/style-fixture) lists an item
 * naming no group first, then its Library and Checks groups under their
 * headings; a quiet count of its own collection, narrowed by a `where`, which
 * is hidden from the navigation and so kept off the dashboard; a badge read
 * from one of its own Needs your attention items; and a badge at 0, which is
 * not drawn. Every number is read in one request naming only the plugin
 * while the panel is open, and arriving moves no item.
 *
 * The fixture's attention items count checks (a listed collection: Needs
 * your attention leaves hidden ones out) in a state only this file stores,
 * and it removes them again, so the dashboard's card reads as
 * it would without them everywhere else; it takes the dashboard's lock while
 * they exist.
 */
import {
  expect,
  type APIRequestContext,
  type Page,
  type Request,
} from "@playwright/test";

import { STORAGE_STATE } from "../global-setup";

import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { createEntry, expectOk } from "./support/runtime-collection";
import { test } from "./support/test";

test.describe.configure({ mode: "serial", lock: [LOCK.dashboard] });

const SWATCHES = "style-fixture-swatches";
const CHECKS = "style-fixture-checks";
const RUN = Date.now().toString(36);

let admin: APIRequestContext;
const created: Array<{ slug: string; id: string }> = [];

/** How many swatches and checks are to fix, before this file adds any. */
let swatchesBefore = 0;
let checksBefore = 0;

/** How many entries of `slug` are to fix, as the API lists them. */
async function toFix(slug: string, what: string): Promise<number> {
  const listed = await admin.get(
    `/admin/api/collections/${slug}/entries?limit=1&where[state][equals]=to-fix`
  );
  await expectOk(listed, what);
  return ((await listed.json()) as { meta: { total: number } }).meta.total;
}

/** Stores `n` entries of `slug` to fix, each removed again after the file. */
async function seed(slug: string, n: number): Promise<void> {
  for (let i = 1; i <= n; i += 1) {
    const id = await createEntry(admin, slug, {
      title: `Fixture ${slug} ${i} ${RUN}`,
      state: "to-fix",
    });
    created.push({ slug, id });
  }
}

test.beforeAll(async ({ playwright }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
  admin = await playwright.request.newContext({
    baseURL,
    storageState: STORAGE_STATE,
  });
  // The fixture's collections exist only on a server started with the e2e
  // fixtures; without them this file fails here, saying so.
  const needs = "the style fixture's collections (NEXTLY_E2E_STYLE_FIXTURE=1)";
  swatchesBefore = await toFix(SWATCHES, needs);
  checksBefore = await toFix(CHECKS, needs);
  // Stored before the page loads, so the panel's one request reads them: two
  // swatches for the count, three checks for the badge, so neither number
  // can stand in for the other.
  await seed(SWATCHES, 2);
  await seed(CHECKS, 3);
});

test.afterAll(async () => {
  for (const { slug, id } of created) {
    await admin?.delete(`/admin/api/collections/${slug}/entries/${id}`);
  }
  await admin?.dispose();
});

/** The panel's number requests, as they leave the browser. */
function panelBatches(page: Page): Request[] {
  const sent: Request[] = [];
  page.on("request", request => {
    if (
      request.method() === "GET" &&
      new URL(request.url()).pathname ===
        "/admin/api/admin-meta/plugin-panel-numbers"
    ) {
      sent.push(request);
    }
  });
  return sent;
}

test("draws the fixture's groups, counts and badges in its own panel", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const batches = panelBatches(page);
  await gotoAdmin(page, "/plugins/style-fixture/panel-overview");
  const panel = page.getByTestId("sub-sidebar");

  // Drawn at once, before any number: the item naming no group is first, and
  // each group follows under its heading in the order declared.
  const overview = panel.getByRole("link", { name: "Fixture overview" });
  await expect(overview).toBeVisible();
  const library = panel.getByRole("group", { name: "Library" });
  const checks = panel.getByRole("group", { name: "Checks" });
  await expect(library).toBeVisible();
  await expect(checks).toBeVisible();
  const order = await Promise.all(
    [overview, library, checks].map(async l => (await l.boundingBox())?.y ?? 0)
  );
  expect(order).toEqual([...order].sort((a, b) => a - b));

  // Where the counted item sat before its number arrived.
  const counted = library.getByRole("link", { name: /^Swatches to fix/ });
  const before = await counted.boundingBox();

  // The quiet count of the fixture's own collection, narrowed by its where,
  // named with its number: a collection hidden from the navigation is
  // counted all the same.
  await expect(
    library.getByRole("link", {
      name: `Swatches to fix, ${swatchesBefore + 2}`,
      exact: true,
    })
  ).toBeVisible();
  // The badge, from the fixture's attention item, named as the Needs your
  // attention card names a count.
  // Read from the reader's digest, which is read afresh for the request;
  // given a digest item's own budget to answer.
  await expect(
    checks.getByRole("link", {
      name: `Fixture checks: ${checksBefore + 3}`,
      exact: true,
    })
  ).toBeVisible({ timeout: 15_000 });
  await expect(checks.getByTestId("plugin-item-badge")).toHaveCount(1);
  // A badge at 0 is not drawn: the link keeps its plain name.
  await expect(
    checks.getByRole("link", { name: "Quiet checks", exact: true })
  ).toBeVisible();

  // The number arriving moved nothing.
  expect(await counted.boundingBox()).toEqual(before);

  // Every number came from one request, which names only the plugin.
  expect(batches).toHaveLength(1);
  expect([...new URL(batches[0].url()).searchParams]).toEqual([
    ["plugin", "style-fixture"],
  ]);
});

test("keeps the fixture's older pages in the Plugins panel, which asks no count", async ({
  page,
}) => {
  // The showcase page keeps to the Plugins section, so the panel beside it is
  // the Plugins panel, as before the fixture had one of its own.
  await page.setViewportSize({ width: 1440, height: 900 });
  const batches = panelBatches(page);
  await gotoAdmin(page, "/plugins/style-fixture/showcase");
  const panel = page.getByTestId("sub-sidebar");
  await expect(panel.getByText("Plugins", { exact: true })).toBeVisible();
  await expect(panel.getByRole("group", { name: "Library" })).toHaveCount(0);
  expect(batches).toHaveLength(0);
});
