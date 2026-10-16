/**
 * The dashboard's main heading and its sample-content offer, in a browser.
 *
 * Two promises, checked where a person meets them:
 *
 * - The dashboard has exactly one level-one heading in every state, from the
 *   first paint, and it passes axe's WCAG 2.2 AA scan. The heading used to
 *   vanish while the sample-content offer stood unanswered, which on a new
 *   site is the first thing anybody sees.
 * - Sample content is offered only to a person the sample-content route lets
 *   load it. The probe used to read a refusal (401, 403) as "the route
 *   exists", and offered a button whose every press failed.
 *
 * ## What is answered here rather than by the server
 *
 * The playground ships no sample-content route, and the suite signs in as one
 * user, so neither an administrator's nor an editor's real answer exists to
 * observe. These tests answer the probe as the blog template's route does for
 * each of them (200 with the template's headers for a person it lets load
 * sample content, a bare 403 for one it refuses) and the site's answer as
 * unanswered. Everything after the answer -- the probe, the offer, the card and
 * the page -- is the real admin.
 *
 * The card is in a dashboard only while the reader's site holds no entries and
 * nobody has answered the offer, and other specs in this run create entries.
 * So the layout read is passed through and the card's placement added when the
 * server has left it out: these tests are about what the admin draws for a
 * given answer, not about when the server offers the card.
 *
 * @module tests/dashboard-heading.spec
 */
import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type Page,
  type Request,
  type Route,
} from "@playwright/test";

import { gotoAdmin, type Theme } from "./support/admin";

/** The sample-content card's widget id, as core registers it. */
const SEED_WIDGET_ID = "core/seed-demo-content";

/** The offer's own action: present only when sample content is offered. */
const OFFER_ACTION = { name: "Seed demo content" } as const;

/** WCAG 2.2 AA and every level below it, as `builder-a11y.spec.ts` states. */
const AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * The host app's `<title>`, which the playground's client root layout cannot
 * declare. The reason is given in full in `builder-a11y.spec.ts`.
 */
const HOST_OWNED_RULES = ["document-title"];

/**
 * One known defect outside the dashboard, set aside by rule AND place.
 *
 * The sidebar's icon rail shows an icon only on each link, with the name in a
 * tooltip, so axe reports `link-name` on every one of them, on every admin
 * screen. It is a real defect in the admin's shared chrome, filed to be fixed
 * there; when that lands, this goes. Until then the scan drops exactly those
 * results: `link-name` nodes inside the rail. Every other rule still runs on
 * the rail, and `link-name` still fails anywhere else, so a new problem in
 * either place is not hidden the way excluding the element would hide it.
 */
const KNOWN_DEFECT = { rule: "link-name", within: "aside nav" } as const;

/**
 * Answer the sample-content probe with `status`, as the route would for this
 * person. Resolves `release` lets a test hold the answer, to look at the page
 * while the offer is still unanswered. Returns the probes seen, so a test can
 * show the probe was asked: an offer that is absent because nothing asked is
 * not an offer refused.
 */
async function answerProbe(
  page: Page,
  status: 200 | 403,
  hold?: Promise<void>
): Promise<Request[]> {
  const probes: Request[] = [];
  await page.route("**/admin/api/seed", async (route: Route) => {
    if (route.request().method() !== "HEAD") return route.fallback();
    probes.push(route.request());
    if (hold) await hold;
    await route.fulfill({
      status,
      headers:
        status === 200
          ? {
              "x-nextly-seed-template": "blog",
              "x-nextly-seed-template-label": "Blog",
            }
          : {},
      body: "",
    });
  });
  await page.route("**/admin/api/meta/seed-status", (route: Route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { completedAt: null, skippedAt: null } })
      : route.fallback()
  );
  return probes;
}

/**
 * The reads of the site's answer to the offer. The admin asks for it only once
 * the probe has said yes, so it is the observable trace of a yes.
 */
function trackStatusReads(page: Page): string[] {
  const reads: string[] = [];
  page.on("request", request => {
    if (request.url().endsWith("/admin/api/meta/seed-status")) {
      reads.push(request.method());
    }
  });
  return reads;
}

/** Pass the layout read through, with the sample-content card placed first. */
async function placeSeedCard(page: Page): Promise<void> {
  await page.route("**/dashboard/layout", async (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await route.fetch();
    const body = (await response.json()) as Record<string, unknown>;
    // The read may come bare or in a `data` envelope; place the card in
    // whichever holds the placements.
    const layout = (Array.isArray(body.placements) ? body : body.data) as {
      placements: Array<Record<string, unknown>>;
    };
    // The array order IS the dashboard's order, so the card goes first by
    // being first in the list; it is drawn full width, as the seed card is.
    if (!layout.placements.some(p => p.widgetId === SEED_WIDGET_ID)) {
      layout.placements.unshift({
        id: "e2e-seed-card",
        widgetId: SEED_WIDGET_ID,
        width: "full",
        removed: false,
      });
    }
    await route.fulfill({ response, json: body });
  });
}

/** The page's level-one headings: exactly one, visible, with a name. */
async function expectOneMainHeading(page: Page): Promise<void> {
  const mains = page.getByRole("heading", { level: 1 });
  await expect(mains).toHaveCount(1);
  await expect(mains).toBeVisible();
  await expect(mains).toHaveAccessibleName(/^Welcome/);
}

/** axe's AA violations on the whole page, named so a failure says what to fix. */
async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(AA_TAGS)
    .disableRules(HOST_OWNED_RULES)
    .analyze();
  // A scan of nothing reports no violations too; enough passing rules shows
  // it looked at a drawn page.
  expect(
    results.passes.length,
    "axe reported no passing rules, so it scanned nothing"
  ).toBeGreaterThan(10);
  const findings = [];
  for (const v of results.violations) {
    const targets: string[] = [];
    for (const node of v.nodes) {
      const selector = node.target.map(String).join(" ");
      if (v.id === KNOWN_DEFECT.rule) {
        // Asked of the page itself: a selector alone cannot say where its
        // element sits.
        const inRail = await page.evaluate(
          ([sel, within]) =>
            document.querySelector(sel)?.closest(within) != null,
          [selector, KNOWN_DEFECT.within] as const
        );
        if (inRail) continue;
      }
      targets.push(selector);
    }
    if (targets.length > 0) {
      findings.push({ id: v.id, impact: v.impact ?? "unknown", targets });
    }
  }
  expect(
    findings,
    `axe reported ${findings.length} violation(s):\n${JSON.stringify(findings, null, 2)}`
  ).toEqual([]);
}

test.describe("the dashboard's main heading", () => {
  test("is there before the offer is answered, and stays after", async ({
    page,
  }) => {
    let release!: () => void;
    const held = new Promise<void>(resolve => (release = resolve));
    const probes = await answerProbe(page, 200, held);
    await placeSeedCard(page);

    await gotoAdmin(page, "/");
    await expect.poll(() => probes.length).toBeGreaterThan(0);
    // The probe is still unanswered: the page has drawn, the offer has not.
    await expect(page.getByRole("button", OFFER_ACTION)).toHaveCount(0);
    await expectOneMainHeading(page);

    release();
    await expect(page.getByRole("button", OFFER_ACTION)).toBeVisible();
    await expectOneMainHeading(page);
  });

  for (const theme of ["light", "dark"] as Theme[]) {
    test(`passes axe with the offer standing (${theme})`, async ({ page }) => {
      await answerProbe(page, 200);
      await placeSeedCard(page);
      await gotoAdmin(page, "/", theme);
      await expect(page.getByRole("button", OFFER_ACTION)).toBeVisible();
      await expectOneMainHeading(page);
      await expectNoAxeViolations(page);
    });

    test(`passes axe with no offer (${theme})`, async ({ page }) => {
      const probes = await answerProbe(page, 403);
      await placeSeedCard(page);
      await gotoAdmin(page, "/", theme);
      await expect.poll(() => probes.length).toBeGreaterThan(0);
      await expectOneMainHeading(page);
      await expectNoAxeViolations(page);
    });
  }
});

test.describe("the sample-content offer", () => {
  test("is made to a person the route lets load sample content", async ({
    page,
  }) => {
    await answerProbe(page, 200);
    const statusReads = trackStatusReads(page);
    await placeSeedCard(page);
    await gotoAdmin(page, "/");
    await expect(page.getByRole("button", OFFER_ACTION)).toBeVisible();
    // The trace the refusal test looks for in vain is there for a yes, so
    // its absence there is a measurement and not a listener that never fires.
    expect(statusReads).toContain("GET");
  });

  test("is not made to a person the route refuses", async ({ page }) => {
    const probes = await answerProbe(page, 403);
    const statusReads = trackStatusReads(page);
    await placeSeedCard(page);
    await gotoAdmin(page, "/");
    // The probe was asked and answered before the verdict, so "no offer" is
    // the answer's doing, not a page that never asked.
    await expect.poll(() => probes.length).toBeGreaterThan(0);
    const answered = await probes[0]!.response();
    expect(answered?.status()).toBe(403);
    // "No offer" has no event of its own: a card that is not drawn looks the
    // same before the probe's answer is read as after, and nothing else on
    // the page is ordered after it (the cards come from their own reads, in
    // no fixed order with this one). A probe that took the refusal for a yes
    // goes on to read the site's answer and draws the card within
    // milliseconds, so give it a second to, then check it did neither. The
    // wait cannot fail a correct build, which never reads the site's answer;
    // a slow machine can only let a broken one through, and the probe's unit
    // tests are the proof of each answer. (Not `networkidle`: the dev server
    // holds a long poll open, so the page never goes idle.)
    await page.waitForTimeout(1_000);
    expect(
      statusReads,
      "the site's answer was read, so the probe said yes"
    ).toEqual([]);
    await expectOneMainHeading(page);
    await expect(page.getByRole("button", OFFER_ACTION)).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Welcome to Nextly." })
    ).toHaveCount(0);
  });
});
