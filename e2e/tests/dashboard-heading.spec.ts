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
 * The offer is made on the setup card's first line, "Start with sample
 * content", which the server offers only while the site holds no entries and
 * nobody has answered, and other specs in this run create entries; the card
 * itself retires once a site's steps are done. So the layout read is passed
 * through with the setup card placed first, and the card's own answer in the
 * dashboard's batch (`POST /dashboard/query`) is replaced with that step open:
 * these tests are about what the admin draws for a given answer, not about
 * when the server offers the card.
 *
 * @module tests/dashboard-heading.spec
 */
import { expect, type Page } from "@playwright/test";

import { test } from "./support/test";
import { gotoAdmin, type Theme } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { LOCK } from "./support/locks";
import { answerProbe, placeSetupCard } from "./support/setup-card";

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ lock: [LOCK.dashboard] });

/** The offer's own action: present only when sample content is offered. */
const OFFER_ACTION = { name: "Add samples", exact: true } as const;

/**
 * The setup card's answer: sample content open, then a first entry to add. The
 * shape the card's `load` answers (`SetupCardData`), as the batch carries a
 * declared widget's own data.
 */
const SETUP_ANSWER = {
  setup: {
    known: true,
    steps: [
      { kind: "sample", status: "open" },
      { kind: "entry", status: "open", collection: "posts" },
    ],
    done: 0,
    total: 2,
  },
  collapsed: false,
  allSet: false,
} as const;

/** The page's level-one headings: exactly one, visible, named for the project. */
async function expectOneMainHeading(page: Page): Promise<void> {
  const mains = page.getByRole("heading", { level: 1 });
  await expect(mains).toHaveCount(1);
  await expect(mains).toBeVisible();
  // The greeting, by the reader's hour and first name, or "Welcome" for a
  // reader with none; "Dashboard" while the reader is still being read.
  await expect(mains).toHaveAccessibleName(
    /^(Good (morning|afternoon|evening), \S+|Welcome|Dashboard)$/
  );
}

test.describe("the dashboard's main heading", () => {
  test("is there before the offer is answered, and stays after", async ({
    page,
  }) => {
    let release!: () => void;
    const held = new Promise<void>(resolve => (release = resolve));
    const probes = await answerProbe(page, 200, held);
    await placeSetupCard(page, SETUP_ANSWER);

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
      await placeSetupCard(page, SETUP_ANSWER);
      await gotoAdmin(page, "/", theme);
      await expect(page.getByRole("button", OFFER_ACTION)).toBeVisible();
      await expectOneMainHeading(page);
      await expectNoAxeViolations(page);
    });

    test(`passes axe with no offer (${theme})`, async ({ page }) => {
      const probes = await answerProbe(page, 403);
      await placeSetupCard(page, SETUP_ANSWER);
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
    await placeSetupCard(page, SETUP_ANSWER);
    await gotoAdmin(page, "/");
    // The site's answer comes with the card's own data, so a yes from the
    // probe is all that stands between the card and the offer.
    await expect(page.getByRole("button", OFFER_ACTION)).toBeVisible();
  });

  test("is not made to a person the route refuses", async ({ page }) => {
    const probes = await answerProbe(page, 403);
    await placeSetupCard(page, SETUP_ANSWER);
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
    // draws the offer within milliseconds of its answer, so give it a second
    // to, then check it did not. The wait cannot fail a correct build; a slow
    // machine can only let a broken one through, and the probe's unit and
    // component tests are the proof of each answer. (Not `networkidle`: the
    // dev server holds a long poll open, so the page never goes idle.)
    await page.waitForTimeout(1_000);
    await expectOneMainHeading(page);
    await expect(page.getByRole("button", OFFER_ACTION)).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Welcome to Nextly." })
    ).toHaveCount(0);
  });
});
