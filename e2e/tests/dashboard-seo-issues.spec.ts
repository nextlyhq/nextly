/**
 * The SEO plugin's card and its Needs attention line in a browser, from the
 * plugin as it ships: the playground registers it for this suite's server
 * (`NEXTLY_PLAYGROUND_PLUGINS=seo`, set by `e2e/playwright.config.ts`),
 * extending the `seo-pages` collection, which no other spec writes.
 *
 * Both count the SEO problem list, as the person looking may read it: the
 * card draws it by kind, and the line counts it whole. Each is compared with
 * what the list's own route answers the same person, read once the save's
 * check of the pages this spec writes has kept their problems.
 *
 * The card is placed by the test through the layout, as the Breakdown spec
 * places its card. The Needs attention line is read from the dashboard's own
 * query route, the attention digest the Needs attention card and the header
 * read, as the signed-in person asks for it.
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
/** Core's Needs your attention card, which draws the plugin's lines. */
const ATTENTION_CARD = "core/needs-attention";
const PAGES = "seo-pages";
/** The plugin's one Needs attention line, counting the problem list. */
const PROBLEMS_LINE = "seo/problems";
/** The problem list's route, and its screen. */
const PROBLEMS = `${API}/plugins/@nextlyhq/plugin-seo/problems`;
const PROBLEMS_SCREEN = "plugins/nextlyhq-plugin-seo/problems";
/** The kind of problem a title longer than Google shows is listed under. */
const LONG_TITLE = "Title longer than Google shows";

/** One problem of the list, as far as this spec reads it. */
interface Problem {
  kind: string;
  subject: { label: string };
}

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
 * The bars the card draws, each kind's count by its name, or none while the
 * card says there is nothing to fix.
 */
async function drawnBars(card: Locator): Promise<Record<string, number>> {
  await expect(
    card.getByTestId("chart-drawing").or(card.getByTestId("card-empty"))
  ).toBeVisible();
  if (await card.getByTestId("card-empty").isVisible()) {
    await expect(card.getByTestId("card-empty")).toContainText(
      "The SEO problem list has nothing to fix."
    );
    return {};
  }
  // Each drawn row's count by its name: the chart engine writes the names in
  // one column and the counts in another, a row apart from the next. A name
  // is read whole, whatever the card's width: from the `<title>` a cut name
  // has, else from the `aria-label` every name has, since the drawn text of a
  // cut one ends in "…".
  const rows = await card.getByTestId("chart-drawing").evaluate(element => {
    const [nameAxis, countAxis] = [
      ...element.querySelectorAll(".recharts-yAxis-tick-labels"),
    ];
    const names = [...(nameAxis?.querySelectorAll("text") ?? [])].map(
      text =>
        text.parentElement?.querySelector(":scope > title")?.textContent ??
        text.getAttribute("aria-label") ??
        ""
    );
    const counts = [...(countAxis?.querySelectorAll("text") ?? [])].map(
      text => text.textContent ?? ""
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

/** The SEO line of the attention digest `request`'s person is answered, if any. */
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
  return items.find(item => item.id === PROBLEMS_LINE);
}

/** Write a page to the checked collection; answers its id. */
async function writePage(title: string, slug: string): Promise<string> {
  const { item } = await ok<{ item: { id: string | number } }>(
    await admin.post(`${API}/collections/${PAGES}/entries`, {
      data: { title, slug },
    })
  );
  return String(item.id);
}

/**
 * The problem list `request`'s person is answered, once the save's check of
 * the page titled `title` has kept its problems: a save's check runs after
 * the save, so the list is read until it names the page.
 */
async function listNaming(
  request: APIRequestContext,
  title: string
): Promise<Problem[]> {
  let problems: Problem[] = [];
  await expect(async () => {
    const body = await ok<{
      problems?: Problem[];
      item?: { problems: Problem[] };
    }>(await request.get(PROBLEMS));
    problems = body.problems ?? body.item?.problems ?? [];
    expect(problems.some(p => p.subject.label === title)).toBe(true);
  }).toPass({ timeout: 15_000 });
  return problems;
}

/**
 * The list as the card counts it: every problem but a redirect chain, which
 * the list names only to someone holding site-wide SEO and a card cannot ask
 * about.
 */
const counted = (problems: readonly Problem[]) =>
  problems.filter(problem => problem.kind !== "redirectChain");

test("the SEO issues card draws the problem list by kind", async ({ page }) => {
  const stamp = Date.now().toString(36);
  const title = `SEO e2e card ${stamp} ${"t".repeat(60)}`;
  await writePage(title, `seo-e2e-card-${stamp}`);
  const list = counted(await listNaming(admin, title));
  expect(list.some(problem => problem.kind === "longTitle")).toBe(true);

  await gotoAdmin(page, "/");
  await placeCard(page);
  await gotoAdmin(page, "/");
  const card = page
    .getByTestId(`widget-cell-${CARD}`)
    .filter({ visible: true });
  await expect(card).toBeVisible();
  const bars = await drawnBars(card);

  // As many problems as the list holds, the long title among them. The bars
  // view orders its rows by count, so totals and one named bar are asserted.
  expect(bars[LONG_TITLE] ?? 0).toBeGreaterThan(0);
  expect(Object.values(bars).reduce((sum, n) => sum + n, 0)).toBe(list.length);
});

test("its count is a Needs attention line linked to the problem list", async ({
  page,
}) => {
  const stamp = Date.now().toString(36);
  const title = `SEO e2e attention ${stamp} ${"t".repeat(60)}`;
  await writePage(title, `seo-e2e-attention-${stamp}`);
  const problems = counted(await listNaming(page.request, title)).length;
  const shown = problems > 99 ? "99+" : String(problems);

  await gotoAdmin(page, "/");
  // The line as Needs your attention draws it, found by its label among the
  // card's rows: other specs' items share the card, which draws every item,
  // with nothing folded behind "Show N more".
  const attention = page
    .getByTestId(`widget-cell-${ATTENTION_CARD}`)
    .filter({ visible: true });
  await expect(attention).toBeVisible();
  await expect(
    attention.getByRole("button", { name: /^Show \d+ more$/ })
  ).toHaveCount(0);
  const line = attention
    .getByTestId("needs-attention-item")
    .filter({ hasText: "SEO problems" });
  await expect(line).toBeVisible();
  await expect(line).toContainText(`SEO problems · ${shown}`);

  // Its one Review opens the problem list.
  const review = line.getByRole("link", { name: /^Review /i });
  await expect(review).toHaveAttribute(
    "href",
    new RegExp(`/admin/${PROBLEMS_SCREEN}$`)
  );
  await review.click();
  await expect(page).toHaveURL(new RegExp(`/admin/${PROBLEMS_SCREEN}(\\?|$)`));

  // The digest the card draws answers the same line, as the route answers it.
  expect(await seoLineFor(page.request)).toEqual(
    expect.objectContaining({
      label: "SEO problems",
      count: problems,
      link: PROBLEMS_SCREEN,
    })
  );
});

test("a reader who may not read the pages is offered neither the card nor the line", async () => {
  // 🔴 Both read as the person asking. A reader of posts alone is told the card
  // is not available, and is shown no line at all, not even its label, while
  // the pages hold problems the super-admin is shown.
  const stamp = Date.now().toString(36);
  const title = `SEO e2e unseen ${stamp} ${"t".repeat(60)}`;
  await writePage(title, `seo-e2e-unseen-${stamp}`);
  await listNaming(admin, title);
  expect((await seoLineFor(admin))?.count ?? 0).toBeGreaterThan(0);

  const request = outsider.context.request;
  expect(await askDashboard(request, { widget: CARD, settings: {} })).toEqual(
    expect.objectContaining({ ok: false, code: "unavailable" })
  );
  expect(await seoLineFor(request)).toBeUndefined();
});
