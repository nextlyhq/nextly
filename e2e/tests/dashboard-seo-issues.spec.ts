/**
 * The SEO plugin's card and its Needs attention line in a browser, from the
 * plugin as it ships: the playground registers it for this suite's server
 * (`NEXTLY_PLAYGROUND_PLUGINS=seo`, set by `e2e/playwright.config.ts`),
 * extending the `seo-pages` collection, which no other spec writes.
 *
 * The card is placed by the test through the layout, as the Breakdown spec
 * places its card. Its counts are read back before and after the spec writes
 * its pages, so a retry, which writes them again, still finds exactly what it
 * added.
 *
 * The Needs attention line is read from the dashboard's own query route, the
 * attention digest the Needs attention card and the header read, as the
 * signed-in person asks for it.
 */
import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { defaultSizeOf } from "./support/dashboard-sizes";
import { signInAsLimitedUser, type LimitedUser } from "./support/limited-user";
import { LOCK } from "./support/locks";
import { ok } from "./support/releases-api";
import { fileAccount, test } from "./support/test";

// Shares state with other specs; see support/locks.ts for what each lock guards.
// One limited user for the whole file: signing in spends the auth budget.
test.describe.configure({ lock: [LOCK.dashboard], mode: "serial" });

const API = "/admin/api";
const CARD = "seo/issues";
const PAGES = "seo-pages";
/** The Needs attention line of the one collection the plugin checks here. */
const PAGES_LINE = "seo/issues-seo-pages";

/** The issues a page with no SEO fields filled in has. */
const ALL_MISSING = [
  "Missing meta title",
  "Missing canonical URL",
  "Missing meta description",
  "Missing social image",
];

interface Layout {
  version: number;
  scope: string;
  placements: Array<{ widgetId: string }>;
}

/** One item of the attention digest, as the route answers it. */
interface DigestItem {
  id: string;
  label: string;
  count: number;
  link: string;
}

/** One answer of the dashboard's query route. */
type Slot =
  | { ok: true; result: { items?: DigestItem[] } }
  | { ok: false; code?: string };

let admin: APIRequestContext;
let outsider: LimitedUser;

test.beforeAll(async ({ browser, playwright }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
  admin = await playwright.request.newContext({
    baseURL,
    storageState: await fileAccount(baseURL, testInfo),
  });
  // A reader of posts, who may not read the pages the plugin checks.
  outsider = await signInAsLimitedUser(browser, admin, baseURL, ["read-posts"]);
});

test.afterAll(async () => {
  await outsider?.context.close();
  await admin?.dispose();
});

/** Put the SEO issues card on the reader's dashboard, at its default size. */
async function placeCard(page: Page): Promise<void> {
  const layout = await ok<Layout>(
    await page.request.get(`${API}/dashboard/layout`)
  );
  const others = layout.placements.filter(p => p.widgetId !== CARD);
  await ok(
    await page.request.put(`${API}/dashboard/layout`, {
      data: {
        placements: [
          {
            id: "e2e-seo-issues",
            widgetId: CARD,
            ...(await defaultSizeOf(page, CARD)),
            removed: false,
            config: {},
          },
          ...others,
        ],
        version: layout.version,
        scope: layout.scope,
      },
    })
  );
}

/**
 * The bars the card draws, each issue's count by its name, or none while the
 * card says there is nothing to fix.
 */
async function drawnBars(card: Locator): Promise<Record<string, number>> {
  await expect(
    card.getByTestId("chart-drawing").or(card.getByTestId("card-empty"))
  ).toBeVisible();
  if (await card.getByTestId("card-empty").isVisible()) {
    await expect(card.getByTestId("card-empty")).toContainText(
      "No SEO issues in published pages."
    );
    return {};
  }
  // Each drawn row's count by its name: the chart engine writes the names in
  // one column and the counts in another, a row apart from the next.
  const rows = await card.getByTestId("chart-drawing").evaluate(element => {
    const [names = [], counts = []] = [
      ...element.querySelectorAll(".recharts-yAxis-tick-labels"),
    ].map(axis =>
      [...axis.querySelectorAll("text")].map(text => text.textContent ?? "")
    );
    return names.map((name, index) => [name, counts[index] ?? ""] as const);
  });
  return Object.fromEntries(rows.map(([name, count]) => [name, Number(count)]));
}

/** What the dashboard's query route answers `request`'s person for `query`. */
async function askDashboard(
  request: APIRequestContext,
  query: Record<string, unknown>
): Promise<Slot> {
  const { results } = await ok<{ results: [Slot] }>(
    await request.post(`${API}/dashboard/query`, {
      data: { queries: [query] },
    })
  );
  return results[0];
}

/** The pages' SEO line of the attention digest `request`'s person is answered, if any. */
async function seoLineFor(
  request: APIRequestContext
): Promise<DigestItem | undefined> {
  const slot = await askDashboard(request, {
    source: "system:attention",
    op: "list",
    limit: 50,
  });
  expect(slot.ok, JSON.stringify(slot)).toBe(true);
  const items = slot.ok ? (slot.result.items ?? []) : [];
  return items.find(item => item.id === PAGES_LINE);
}

/** Write a page to the checked collection, with the SEO fields given. */
async function writePage(
  title: string,
  seo?: Record<string, unknown>
): Promise<void> {
  await ok(
    await admin.post(`${API}/collections/${PAGES}/entries`, {
      data: { title, ...(seo === undefined ? {} : { seo }) },
    })
  );
}

test("the SEO issues card draws a bar for each issue the pages have", async ({
  page,
}) => {
  const stamp = Date.now().toString(36);
  await gotoAdmin(page, "/");
  await placeCard(page);
  await gotoAdmin(page, "/");
  const card = page
    .getByTestId(`widget-cell-${CARD}`)
    .filter({ visible: true });
  await expect(card).toBeVisible();
  const before = await drawnBars(card);

  // A bare page has all four gaps; a titled one has three.
  await writePage(`SEO e2e bare ${stamp}`);
  await writePage(`SEO e2e titled ${stamp}`, { metaTitle: "Titled" });
  await gotoAdmin(page, "/");
  const after = await drawnBars(card);

  // One bar per issue, each risen by what the two pages added, and in the
  // order a reader should meet them: a missing title first.
  expect(Object.keys(after)).toEqual(ALL_MISSING);
  for (const issue of ALL_MISSING) {
    const added = issue === "Missing meta title" ? 1 : 2;
    expect(after[issue], issue).toBe((before[issue] ?? 0) + added);
  }
});

test("its issue count is a Needs attention line naming the pages it checks", async ({
  page,
}) => {
  const stamp = Date.now().toString(36);
  await writePage(`SEO e2e attention ${stamp}`);
  await gotoAdmin(page, "/");
  await placeCard(page);
  await gotoAdmin(page, "/");
  const bars = await drawnBars(
    page.getByTestId(`widget-cell-${CARD}`).filter({ visible: true })
  );

  const line = await seoLineFor(page.request);
  // The same issues the card draws, as one count, linked to the list they are
  // fixed in: the card reads this one collection, which has this one line.
  expect(line).toEqual(
    expect.objectContaining({
      label: `SEO issues in ${PAGES}`,
      count: Object.values(bars).reduce((sum, n) => sum + n, 0),
      link: `collections/${PAGES}`,
    })
  );
});

test("a reader who may not read the pages is offered neither the card nor the line", async () => {
  // 🔴 Both read as the person asking. A reader of posts alone is told the card
  // is not available, and is shown no line at all, not even its label, while
  // the pages hold issues the super-admin is shown.
  await writePage(`SEO e2e unseen ${Date.now().toString(36)}`);
  expect((await seoLineFor(admin))?.count ?? 0).toBeGreaterThan(0);

  const request = outsider.context.request;
  expect(await askDashboard(request, { widget: CARD, settings: {} })).toEqual(
    expect.objectContaining({ ok: false, code: "unavailable" })
  );
  expect(await seoLineFor(request)).toBeUndefined();
});
