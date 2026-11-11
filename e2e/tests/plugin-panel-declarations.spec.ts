/**
 * A standalone plugin's panel, as the plugin declares it, in a browser: the
 * style fixture (apps/playground/src/plugins/style-fixture) lists an item
 * naming no group first, then its Library and Checks groups under their
 * headings; a quiet count of its own collection, narrowed by a `where`; a
 * badge read from one of its own Needs your attention items; and a badge at
 * 0, which is not drawn. Each number is read in one request while the panel
 * is open, and arriving moves no item.
 *
 * The fixture's attention items count swatches in a state only this file
 * stores, and it removes them again, so the dashboard's card reads as
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
const RUN = Date.now().toString(36);

let admin: APIRequestContext;
const created: string[] = [];

/** How many swatches are in the state the checks count, before this file adds any. */
let toFixBefore = 0;

test.beforeAll(async ({ playwright }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
  admin = await playwright.request.newContext({
    baseURL,
    storageState: STORAGE_STATE,
  });
  // The fixture's collection exists only on a server started with the e2e
  // fixtures; without it this file fails here, saying so.
  const listed = await admin.get(
    `/admin/api/collections/${SWATCHES}/entries?limit=1&where[state][equals]=to-fix`
  );
  await expectOk(
    listed,
    "the style fixture's swatches collection (NEXTLY_E2E_STYLE_FIXTURE=1)"
  );
  toFixBefore = ((await listed.json()) as { meta: { total: number } }).meta
    .total;
  for (const n of [1, 2]) {
    created.push(
      await createEntry(admin, SWATCHES, {
        title: `Swatch ${n} ${RUN}`,
        state: "to-fix",
      })
    );
  }
});

test.afterAll(async () => {
  for (const id of created) {
    await admin?.delete(`/admin/api/collections/${SWATCHES}/entries/${id}`);
  }
  await admin?.dispose();
});

/** The batches the panel sent, as they leave the browser. */
function panelBatches(page: Page): Request[] {
  const sent: Request[] = [];
  page.on("request", request => {
    if (
      request.method() === "POST" &&
      request.url().endsWith("/admin/api/dashboard/query") &&
      (request.postData() ?? "").includes(`collection:${SWATCHES}`)
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
  // named with its number.
  const expected = toFixBefore + created.length;
  await expect(
    library.getByRole("link", { name: `Swatches to fix, ${expected}` })
  ).toBeVisible();
  // The badge, from the fixture's attention item, named as the Needs your
  // attention card names a count.
  await expect(
    checks.getByRole("link", { name: `Fixture checks: ${expected}` })
  ).toBeVisible();
  await expect(checks.getByTestId("plugin-item-badge")).toHaveCount(1);
  // A badge at 0 is not drawn: the link keeps its plain name.
  await expect(
    checks.getByRole("link", { name: "Quiet checks", exact: true })
  ).toBeVisible();

  // The number arriving moved nothing.
  expect(await counted.boundingBox()).toEqual(before);

  // Every number came from one request.
  expect(batches).toHaveLength(1);
  const queries = (
    JSON.parse(batches[0].postData() ?? "{}") as {
      queries: Array<{ source: string }>;
    }
  ).queries.map(query => query.source);
  expect(queries).toEqual(["system:attention", `collection:${SWATCHES}`]);
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
